#!/usr/bin/env python3
"""
Train Aurelo Coach behaviour classifier and export to ONNX.

This is the canonical retraining script. Re-run any time the label set
or feature set changes. Output is written to:

    app/src/main/assets/aurelo_coach.onnx

Companion runtime (Kotlin):
    app/src/main/java/com/javikastudio/tidyapp/CoachOnnxClassifier.kt
    app/src/main/java/com/javikastudio/tidyapp/CoachFeatureBuilder.kt

The label list returned by the model MUST match
``CoachOnnxClassifier.LABELS`` byte-for-byte. The feature order MUST
match ``CoachFeatureBuilder.toOnnx``.

Why a synthetic dataset?
------------------------
We don't have labelled production data — coach insights are
on-device and never sent off device. The deterministic
``KotlinPatternDetector`` already encodes the behavioural rules, but
it produces hard cliffs (priority 10 always wins, ties go to
arbitrary pattern). A learned model lets us:

  * smooth the cliffs into probabilistic boundaries,
  * generalise to feature combinations the rule list doesn't enumerate,
  * be cheaper to maintain when we add a new behavioural rule (we
    encode it once in this script's labelling fn and the trees pick
    it up automatically).

Reproducibility
---------------
RANDOM_SEED is fixed. The script emits a deterministic ONNX model
given the same scikit-learn / skl2onnx versions installed at
``pip install -r scripts/requirements-coach-train.txt``.
"""

from __future__ import annotations

import os
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from sklearn.ensemble import ExtraTreesClassifier, RandomForestClassifier
from sklearn.tree import DecisionTreeClassifier
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import train_test_split
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType

REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT = REPO_ROOT / "app" / "src" / "main" / "assets" / "aurelo_coach.onnx"

RANDOM_SEED = 42
TARGET_OPSET = 9            # matches the existing model's ai.onnx opset
ML_OPSET = 1                # matches ai.onnx.ml opset
# Hyper-parameters tuned for the (size ≤ 1 MB AND accuracy ≥ 95%) target.
#
# Method:
#   - Goal lives in the feature vector (15 features total) so the model
#     can normalise todayMinutes against the user's actual goal — without
#     this, ~35% of training rows had labels the model couldn't see.
#   - The labelling fn is deterministic and decidable from features alone,
#     so an ensemble of ~10 deep trees that each see all features can
#     approach 100% accuracy. Going wider (more trees) bloats the .onnx
#     without much accuracy gain because the per-tree predictions agree.
#   - max_features=None lets each tree see every feature at every split
#     — important here because the labelling rule conditions across
#     features (e.g. "first_use<=7 AND today>goal*0.7"), and the default
#     "sqrt(15)≈4" features per split was making each tree's view
#     incomplete.
# Single decision tree (see classifier construction in `train_and_export`).
# DEPTH 32 + MIN_SAMPLES_LEAF=1 lets the tree grow until it perfectly
# captures the rule boundaries; the deterministic labelling has no noise
# to overfit so this is fine. Asset size scales with the number of
# distinct leaves, which is bounded by the rule count × the goal × the
# discrete ranges of each feature.
N_ESTIMATORS = 1   # unused (DecisionTree, not RandomForest)
MAX_DEPTH = 40
MIN_SAMPLES_LEAF = 4
# Larger per-class cap → tighter boundary fitting. Asset size grows
# sub-linearly because identical leaves are shared in the export.
MAX_PER_CLASS = 12000
RAW_POOL_SIZE = 6_000_000

# ─────────────────────────────────────────────────────────────────────────────
# Label set — MUST mirror CoachOnnxClassifier.LABELS in the same order.
# Drops the legacy synonyms WORST_DAY_PATTERN / PICKUP_SPIKE / EVENING_USAGE /
# APP_CATEGORY_DRIFT (the orchestrator's normalizeIntent remaps them anyway)
# and adds the missing behavioural intents the orchestrator already supports:
# MORNING_DOOM_SCROLL, WEEKEND_BINGE, SOCIAL_SPIRAL, PRODUCTIVE_DAY,
# FOCUS_ON_TRACK.
# SCORE_DROP is intentionally not in the model's label set — it can't be
# reliably learned from the 14 input features (yesterday's score isn't a
# feature). The pattern detector and predefined-question router produce it.
# ─────────────────────────────────────────────────────────────────────────────
LABELS = [
    "STREAK_AT_RISK",                       # 0
    "HC_POOR_SLEEP_HIGH_USAGE",             # 1
    "HC_ACTIVE_DAY_BETTER_FOCUS",           # 2
    "BEDTIME_REVENGE_PROCRASTINATION",      # 3
    "FOCUS_BURNOUT",                        # 4
    "DOPAMINE_LOOP",                        # 5
    "SOCIAL_SPIRAL",                        # 6
    "FOCUS_GAP",                            # 7
    "FOCUS_ON_TRACK",                       # 8
    "MORNING_DOOM_SCROLL",                  # 9
    "WEEKEND_BINGE",                        # 10
    "ANOMALOUS_SPIKE",                      # 11
    "PRODUCTIVE_DAY",                       # 12
    "RECOVERY_DAY",                         # 13
    "HEALTHY_PATTERN",                      # 14
    "GENERAL_SUMMARY",                      # 15
]

LABEL_TO_ID = {l: i for i, l in enumerate(LABELS)}

# ─────────────────────────────────────────────────────────────────────────────
# Feature index reminders (must match CoachFeatureBuilder.toOnnx order):
#
#   0 todayMinutes
#   1 pickupsToday
#   2 topCategoryEncoded   (0 unassigned, 1 social, 2 entertainment,
#                           3 games, 4 productivity, 5 communication,
#                           6 browser, 7 health/fitness)
#   3 currentHour
#   4 focusSessionsCompleted
#   5 streakDays
#   6 pickupDeltaVsAvg
#   7 firstUseHour
#   8 dayOfWeek            (1 Sun, 2 Mon, ..., 7 Sat — Calendar.DAY_OF_WEEK)
#   9 hrvDeltaVsAvg        (0 when HC off; negative = below avg)
#  10 stepsToday           (0 when HC off)
#  11 sleepDurationHours   (0 when HC off)
#  12 rhrDeltaVsAvg        (0 when HC off; positive = elevated RHR)
#  13 externalMindfulnessMinutesToday (0 when HC off)
# ─────────────────────────────────────────────────────────────────────────────


def label_for(f: dict) -> str:
    """
    Decide the ground-truth label for a synthetic feature dict.

    Two design rules:

    1. **Mutually exclusive precedence.** Each row gets exactly one label.
       The first matching rule wins; later rules don't override. Guarantees
       a clean target distribution the model can learn rather than the
       fuzzy-overlap mess that came out of the original training set.

    2. **Decidable from the feature vector alone.** Every condition reads
       only the 14 ONNX features (plus `goal` / `hc_on` / `dow`, which are
       directly derivable from feature 8 and feature 11/9/10/13). No
       references to `daysSinceLastFocus`, `aureloScoreYesterday`, etc.,
       which are not features.

    Reconstructed quantities:
        pickup_avg = pickups - pickup_delta   (since runtime emits
                                               pickupsToday - pickups7DayAvg
                                               into feature 6)
    """
    today = f["today"]
    pickups = f["pickups"]
    cat = f["cat"]
    hour = f["hour"]
    sessions = f["sessions"]
    streak = f["streak"]
    pickup_delta = f["pickup_delta"]
    first_use = f["first_use"]
    dow = f["dow"]
    hrv_delta = f["hrv_delta"]
    steps = f["steps"]
    sleep_h = f["sleep_h"]

    goal = f["goal"]
    pickup_avg = max(pickups - pickup_delta, 1)
    pickup_ratio = pickups / pickup_avg
    hc_on = f["hc_on"]

    # ── 1. Fresh-install / no-data — catch this FIRST so it never gets
    #       confused with a quiet healthy day.
    if today < 20 and pickups < 10 and sessions == 0 and streak == 0:
        return "GENERAL_SUMMARY"

    # ── 2. PRODUCTIVE_DAY — composite "everything aligned"
    if (
        sessions >= 3
        and today <= goal * 0.7
        and first_use >= 9
        and pickup_ratio <= 0.85
        and streak >= 7
    ):
        return "PRODUCTIVE_DAY"

    # ── 3. HC: clear physiological stress + over-goal screen time
    if hc_on and hrv_delta <= -10 and today > goal * 0.9:
        return "HC_POOR_SLEEP_HIGH_USAGE"

    # ── 4. Late-night spike — non-HC bedtime signal. Exclusive: only fires
    #       at hour>=22, so STREAK_AT_RISK below (which doesn't condition
    #       on hour) won't claim these rows.
    if hour >= 22 and today > goal * 0.9:
        return "BEDTIME_REVENGE_PROCRASTINATION"

    # ── 5. HC: very short sleep with over-goal usage
    if hc_on and 0 < sleep_h < 6 and today > goal * 0.7:
        return "BEDTIME_REVENGE_PROCRASTINATION"

    # ── 6. Morning doom-scroll — early first use AND substantial usage.
    #       Exclusive at first_use<=7 (and hour<22 implicit since we got here).
    if first_use <= 7 and today > goal * 0.7:
        return "MORNING_DOOM_SCROLL"

    # ── 7. Weekend binge — Sat/Sun, with the morning/late-night /
    #       short-sleep cases already handled above.
    if dow in (1, 7) and today > goal * 1.3:
        return "WEEKEND_BINGE"

    # ── 8. Social spiral — Social cat + pickup spike + meaningful usage
    if cat == 1 and pickup_ratio > 1.3 and today > goal * 0.6:
        return "SOCIAL_SPIRAL"

    # ── 9. Dopamine loop — non-Social pickup spike with meaningful usage
    if cat != 1 and pickup_ratio > 1.5 and today > goal * 0.6:
        return "DOPAMINE_LOOP"

    # ── 10. Anomalous spike — extreme screen time not yet categorised
    if today > goal * 1.5:
        return "ANOMALOUS_SPIKE"

    # ── 11. Streak at risk — projection over goal, has streak, no extreme.
    #        Note: by construction we've already ruled out hour>=22,
    #        first_use<=7, weekend-over-goal, big pickup spikes, and
    #        extreme today>1.5× goal — so this is the residual "in trouble
    #        on a normal weekday afternoon" bucket.
    if (
        streak > 3
        and today > goal * 0.85
        and today <= goal * 1.5
    ):
        return "STREAK_AT_RISK"

    # ── 12. Focus burnout — no sessions + HC stress
    if sessions == 0 and hc_on and hrv_delta <= -10:
        return "FOCUS_BURNOUT"

    # ── 13. Focus gap — no sessions on a streak, mid-range usage
    if sessions == 0 and streak >= 2 and goal * 0.5 <= today <= goal * 1.1:
        return "FOCUS_GAP"

    # ── 14. Focus on track — has sessions, near or under goal
    if sessions >= 1 and today <= goal * 1.05:
        return "FOCUS_ON_TRACK"

    # ── 15. HC active day → better focus (steps signal)
    if hc_on and steps >= 8000 and today <= goal:
        return "HC_ACTIVE_DAY_BETTER_FOCUS"

    # ── 16. Recovery day — light day with active streak
    if 0 < today < goal * 0.5 and streak >= 1:
        return "RECOVERY_DAY"

    # ── 17. Healthy pattern — under goal, normal pickups
    if today < goal * 0.85 and pickup_ratio <= 1.0:
        return "HEALTHY_PATTERN"

    # ── 18. Catch-all
    return "GENERAL_SUMMARY"


def random_row(rng: np.random.Generator) -> tuple[list[float], dict]:
    """
    Draw a single feature row uniformly across realistic value ranges.

    Train and test draws come from this same distribution, so the validation
    metrics reflect the model's ability to learn the labelling rule rather
    than its ability to memorise a biased mix.
    """
    hc_on = bool(rng.integers(0, 2))
    meta = {
        "today":        int(rng.integers(0, 620)),
        "pickups":      int(rng.integers(0, 200)),
        "cat":          int(rng.integers(0, 8)),
        "hour":         int(rng.integers(0, 24)),
        "sessions":     int(rng.integers(0, 6)),
        "streak":       int(rng.integers(0, 60)),
        "pickup_delta": int(rng.integers(-40, 90)),
        "first_use":    int(rng.integers(5, 14)),
        "dow":          int(rng.integers(1, 8)),
        "hc_on":        hc_on,
        # Goals span the realistic range for screen-time apps (90 min through
        # 6 h in 30-min increments) so the model learns the boundary at any
        # goal a user might pick.
        "goal":         int(rng.choice([90, 120, 150, 180, 210, 240, 270, 300, 330, 360])),
        "hrv_delta":    float(rng.normal(0, 12)) if hc_on else 0.0,
        "steps":        int(rng.integers(0, 18000)) if hc_on else 0,
        "sleep_h":      float(rng.uniform(3.5, 9.0)) if hc_on else 0.0,
        "rhr_delta":    float(rng.normal(0, 8)) if hc_on else 0.0,
        "mindful":      int(rng.integers(0, 30)) if hc_on else 0,
    }
    vec = [
        float(meta["today"]),
        float(meta["pickups"]),
        float(meta["cat"]),
        float(meta["hour"]),
        float(meta["sessions"]),
        float(meta["streak"]),
        float(meta["pickup_delta"]),
        float(meta["first_use"]),
        float(meta["dow"]),
        float(meta["hrv_delta"]),
        float(meta["steps"]),
        float(meta["sleep_h"]),
        float(meta["rhr_delta"]),
        float(meta["mindful"]),
        float(meta["goal"]),     # feature 14 — added in retrain v2
    ]
    return vec, meta


def build_dataset() -> tuple[np.ndarray, np.ndarray]:
    """
    Build a labelled dataset by:
      1. drawing `RAW_POOL_SIZE` rows uniformly from the feature space,
      2. labelling each row deterministically via `label_for`,
      3. capping each class at `MAX_PER_CLASS` so the long-tail labels
         aren't drowned out by the dominant ones.

    Train/test split is downstream so distributions match exactly.
    """
    rng = np.random.default_rng(RANDOM_SEED)

    raw_rows: list[list[float]] = []
    raw_labels: list[int] = []
    raw_counts: Counter[str] = Counter()

    for _ in range(RAW_POOL_SIZE):
        vec, meta = random_row(rng)
        lbl_name = label_for(meta)
        raw_rows.append(vec)
        raw_labels.append(LABEL_TO_ID[lbl_name])
        raw_counts[lbl_name] += 1

    # Cap per-class.
    by_class: dict[int, list[int]] = {}
    for i, lid in enumerate(raw_labels):
        by_class.setdefault(lid, []).append(i)

    rng2 = np.random.default_rng(RANDOM_SEED + 1)
    chosen: list[int] = []
    for lid, idxs in by_class.items():
        if len(idxs) > MAX_PER_CLASS:
            picks = rng2.choice(idxs, size=MAX_PER_CLASS, replace=False)
            chosen.extend(int(p) for p in picks)
        else:
            chosen.extend(idxs)
    rng2.shuffle(chosen)

    rows_out = [raw_rows[i] for i in chosen]
    labels_out = [raw_labels[i] for i in chosen]

    final_counts = Counter(LABELS[l] for l in labels_out)
    print(f"\nRaw pool ({RAW_POOL_SIZE} rows) class counts:")
    for lbl in LABELS:
        print(f"  {lbl:35s} raw={raw_counts[lbl]:6d}  capped={final_counts[lbl]:5d}")
    print(f"  {'TOTAL':35s}              kept={sum(final_counts.values()):5d}")

    return np.array(rows_out, dtype=np.float32), np.array(labels_out, dtype=np.int64)


def train_and_export() -> None:
    print(f"sklearn={__import__('sklearn').__version__}, "
          f"skl2onnx={__import__('skl2onnx').__version__}")

    X, y = build_dataset()
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=RANDOM_SEED, stratify=y
    )

    # Single decision tree — smallest export shape and the labelling
    # rule is deterministic so no ensemble robustness is needed. Going
    # deep + min_samples_leaf=1 lets the tree fit the axis-aligned rule
    # boundaries exactly; any residual error is just boundary
    # quantisation, which we mitigate by drawing very large training
    # pools and letting the Pareto-optimal split land closer to the
    # true thresholds.
    clf = DecisionTreeClassifier(
        max_depth=MAX_DEPTH,
        min_samples_leaf=MIN_SAMPLES_LEAF,
        random_state=RANDOM_SEED,
    )
    clf.fit(X_train, y_train)

    train_acc = (clf.predict(X_train) == y_train).mean()
    print(f"\nTrain accuracy: {train_acc:.4f}  ({len(X_train)} rows)")

    y_pred = clf.predict(X_test)
    test_acc = (y_pred == y_test).mean()
    print(f"Test  accuracy: {test_acc:.4f}  ({len(X_test)} rows)")
    print("\n=== Validation report ===")
    target_names = [LABELS[i] for i in sorted(set(y_test))]
    print(classification_report(
        y_test, y_pred, target_names=target_names, digits=3, zero_division=0
    ))

    # Confusion matrix is too wide to print as a table — show top
    # confusions instead so reviewers can spot systematic mistakes.
    cm = confusion_matrix(y_test, y_pred, labels=list(range(len(LABELS))))
    print("\n=== Top off-diagonal confusions ===")
    pairs = []
    for i in range(len(LABELS)):
        for j in range(len(LABELS)):
            if i != j and cm[i][j] > 0:
                pairs.append((cm[i][j], LABELS[i], LABELS[j]))
    pairs.sort(reverse=True)
    for n, src, dst in pairs[:15]:
        print(f"  {src:35s} -> {dst:35s} : {n}")

    print("\n=== Exporting ONNX ===")
    initial_type = [("input", FloatTensorType([None, 15]))]
    onnx_model = convert_sklearn(
        clf,
        initial_types=initial_type,
        target_opset={"": TARGET_OPSET, "ai.onnx.ml": ML_OPSET},
        options={id(clf): {"zipmap": True}},
    )

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_bytes(onnx_model.SerializeToString())
    size_kb = OUTPUT.stat().st_size / 1024
    print(f"  wrote {OUTPUT.relative_to(REPO_ROOT)}  ({size_kb:.1f} KB)")


if __name__ == "__main__":
    train_and_export()
