#!/usr/bin/env python3
"""
Regression suite for aurelo_coach.onnx — runs inference on the audit
personas and asserts the prediction is sensible.

Run after every retrain:

    python scripts/validate_coach_onnx.py

Exits non-zero if any persona's prediction is in the rejected set.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort

REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL = REPO_ROOT / "app" / "src" / "main" / "assets" / "aurelo_coach.onnx"

# Must mirror CoachOnnxClassifier.LABELS in the runtime.
LABELS = [
    "STREAK_AT_RISK",
    "HC_POOR_SLEEP_HIGH_USAGE",
    "HC_ACTIVE_DAY_BETTER_FOCUS",
    "BEDTIME_REVENGE_PROCRASTINATION",
    "FOCUS_BURNOUT",
    "DOPAMINE_LOOP",
    "SOCIAL_SPIRAL",
    "FOCUS_GAP",
    "FOCUS_ON_TRACK",
    "MORNING_DOOM_SCROLL",
    "WEEKEND_BINGE",
    "ANOMALOUS_SPIKE",
    "PRODUCTIVE_DAY",
    "RECOVERY_DAY",
    "HEALTHY_PATTERN",
    "GENERAL_SUMMARY",
]

# (name, features, accept_set, reject_set)
# accept_set: intents that would be sensible. Empty → no positive constraint.
# reject_set: intents that would be obviously wrong; failing this fails CI.
# Each persona's feature vector is 15-long: the 14 features documented in
# CoachFeatureBuilder + dailyGoalMinutes at index 14 (added in retrain v2).
PERSONAS: list[tuple[str, list[float], set[str], set[str]]] = [
    (
        "A: brand new install, no data, no HC",
        [0, 0, 0, 14, 0, 0, 0, 9, 3, 0, 0, 0, 0, 0, 240],
        {"GENERAL_SUMMARY", "HEALTHY_PATTERN", "RECOVERY_DAY"},
        {
            "BEDTIME_REVENGE_PROCRASTINATION",
            "DOPAMINE_LOOP",
            "FOCUS_BURNOUT",
            "PICKUP_SPIKE",
            "ANOMALOUS_SPIKE",
        },
    ),
    (
        "B: established under-goal, productivity, HC normal",
        [110, 38, 4, 14, 1, 14, -17, 9, 3, 0.0, 9000, 7.5, 0, 0, 240],
        {"FOCUS_ON_TRACK", "HEALTHY_PATTERN", "HC_ACTIVE_DAY_BETTER_FOCUS", "PRODUCTIVE_DAY"},
        {"DOPAMINE_LOOP", "BEDTIME_REVENGE_PROCRASTINATION", "FOCUS_BURNOUT"},
    ),
    (
        "C: doom-scroller social, low score, no HC",
        [320, 90, 1, 14, 0, 1, 35, 6, 3, 0, 0, 0, 0, 0, 240],
        {
            "DOPAMINE_LOOP",
            "SOCIAL_SPIRAL",
            "STREAK_AT_RISK",
            "ANOMALOUS_SPIKE",
            "MORNING_DOOM_SCROLL",
            "FOCUS_BURNOUT",
        },
        {"HEALTHY_PATTERN", "FOCUS_ON_TRACK", "PRODUCTIVE_DAY", "HC_ACTIVE_DAY_BETTER_FOCUS"},
    ),
    (
        "D: sleep-deprived, HC on, low signals",
        [210, 70, 1, 14, 0, 5, 15, 8, 3, -17.0, 4200, 5.0, 0, 0, 240],
        {"HC_POOR_SLEEP_HIGH_USAGE", "BEDTIME_REVENGE_PROCRASTINATION", "FOCUS_GAP", "FOCUS_BURNOUT"},
        {"HEALTHY_PATTERN", "PRODUCTIVE_DAY", "HC_ACTIVE_DAY_BETTER_FOCUS"},
    ),
    (
        "E: HC partial — steps only",
        [140, 45, 4, 14, 1, 4, -5, 9, 3, 0.0, 9800, 0.0, 0, 0, 240],
        {"FOCUS_ON_TRACK", "HEALTHY_PATTERN", "HC_ACTIVE_DAY_BETTER_FOCUS"},
        {"DOPAMINE_LOOP", "BEDTIME_REVENGE_PROCRASTINATION"},
    ),
    (
        "F: late-night user (high evening pickups)",
        [400, 95, 0, 23, 0, 2, 40, 10, 3, 0, 0, 0, 0, 0, 240],
        {"BEDTIME_REVENGE_PROCRASTINATION", "STREAK_AT_RISK", "DOPAMINE_LOOP", "ANOMALOUS_SPIKE"},
        {"HEALTHY_PATTERN", "PRODUCTIVE_DAY", "HC_ACTIVE_DAY_BETTER_FOCUS"},
    ),
    (
        "G: perfect day, high streak, HC active day",
        [80, 35, 4, 14, 4, 30, -20, 10, 3, 5.0, 10500, 7.8, 0, 0, 240],
        {"PRODUCTIVE_DAY", "HEALTHY_PATTERN", "HC_ACTIVE_DAY_BETTER_FOCUS", "FOCUS_ON_TRACK"},
        {
            "DOPAMINE_LOOP",
            "BEDTIME_REVENGE_PROCRASTINATION",
            "ANOMALOUS_SPIKE",
            "FOCUS_BURNOUT",
            "STREAK_AT_RISK",
        },
    ),
    (
        "H: catastrophic day (long screen + low focus, no HC)",
        [450, 110, 1, 18, 0, 3, 55, 7, 3, 0, 0, 0, 0, 0, 240],
        {
            "ANOMALOUS_SPIKE",
            "DOPAMINE_LOOP",
            "STREAK_AT_RISK",
            "MORNING_DOOM_SCROLL",
            "FOCUS_BURNOUT",
            "SOCIAL_SPIRAL",
        },
        {"HEALTHY_PATTERN", "PRODUCTIVE_DAY", "HC_ACTIVE_DAY_BETTER_FOCUS", "FOCUS_ON_TRACK"},
    ),
    (
        "I: all zeros (boundary)",
        [0] * 14 + [240],
        {"GENERAL_SUMMARY", "HEALTHY_PATTERN", "RECOVERY_DAY"},
        {"BEDTIME_REVENGE_PROCRASTINATION", "DOPAMINE_LOOP", "PICKUP_SPIKE"},
    ),
    (
        "J: very early first use, low usage",
        [40, 25, 0, 9, 0, 5, -30, 6, 3, 0, 0, 0, 0, 0, 240],
        {"MORNING_DOOM_SCROLL", "HEALTHY_PATTERN", "RECOVERY_DAY", "GENERAL_SUMMARY"},
        {"BEDTIME_REVENGE_PROCRASTINATION", "DOPAMINE_LOOP"},
    ),
]


def main() -> int:
    if not MODEL.exists():
        print(f"FAIL: model not found at {MODEL}", file=sys.stderr)
        return 2

    sess = ort.InferenceSession(str(MODEL))
    failures = 0
    print(f"Validating {MODEL.relative_to(REPO_ROOT)} on {len(PERSONAS)} personas\n")

    for name, feats, accept, reject in PERSONAS:
        arr = np.array([feats], dtype=np.float32)
        out = sess.run(None, {"input": arr})
        label_idx = int(out[0][0])
        intent = LABELS[label_idx]
        # ZipMap output → list of {int_label: prob}
        probs = out[1][0]
        prob = float(probs.get(label_idx, 0.0))

        status = "OK"
        if intent in reject:
            status = "FAIL"
            failures += 1
        elif accept and intent not in accept:
            status = "WARN"

        # Top-3 for context
        ranked = sorted(probs.items(), key=lambda x: -x[1])[:3]
        ranked_str = ", ".join(f"{LABELS[int(k)]}={v:.2f}" for k, v in ranked)

        print(f"  [{status:4s}] {name}")
        print(f"         predicted: {intent} ({prob:.2f})")
        print(f"         top3: {ranked_str}")

    print()
    if failures:
        print(f"FAIL: {failures} persona(s) hit the reject set")
        return 1
    print("OK: no rejected predictions")
    return 0


if __name__ == "__main__":
    sys.exit(main())
