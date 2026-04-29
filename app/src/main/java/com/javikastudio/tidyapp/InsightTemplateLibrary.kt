package com.javikastudio.tidyapp

// ═══════════════════════════════════════════════════════════════════════════
// InsightTemplateLibrary — 192 templates for CoachInsightWorker / CoachOrchestrator.
//
// STRUCTURE
//   • 16 intent classes × 12 variants = 192 templates
//   • Variant types: ENCOURAGING (3), CAUTIONARY (3), CELEBRATORY (2),
//                    NEW_USER (2), ESTABLISHED (2)
//   • HC-aware templates include slot variables:
//       {hrv_delta}              – % below/above personal 7-day HRV average (Int)
//       {hrv_ms}                 – today's HRV in ms (Float, 1 dp)
//       {hrv_avg_ms}             – 7-day average HRV in ms (Float, 1 dp)
//       {steps_today}            – today's step count, comma-formatted (String)
//       {steps_7day_avg}         – 7-day average steps, comma-formatted (String)
//       {sleep_hours}            – last night's sleep duration in hours (Float, 1 dp)
//       {sleep_7day_avg}         – 7-day average sleep in hours (Float, 1 dp)
//       {mindfulness_source}     – app name from HC mindfulness record (String)
//       {external_mindfulness_min} – external mindfulness minutes today (Int)
//       {rhr_today}              – resting heart rate today (Int)
//   • Screen-data slot variables:
//       {streak_days}, {goal_hours}, {score_drop}, {pickups_today},
//       {pickups_avg}, {first_use_hour}, {screen_delta}, {weekday},
//       {top_app}, {focus_days_ago}, {screen_score}, {focus_score},
//       {sleep_score}, {aurelo_score}, {today_minutes}, {goal_minutes},
//       {avg_minutes}, {day_label}, {spike_day}, {spike_minutes},
//       {week_avg_minutes}, {top_category}, {data_window_days},
//       {focus_session_type}
//
// USAGE
//   val raw   = InsightTemplateLibrary.select(intent, variant, summary)
//   val filled = InsightTemplateLibrary.fillSlots(raw, summary)
// ═══════════════════════════════════════════════════════════════════════════

object InsightTemplateLibrary {

    // ── Enums ────────────────────────────────────────────────────────────────

    enum class TemplateVariant {
        ENCOURAGING,   // improving trend or currently under goal
        CAUTIONARY,    // over goal or pattern worsening
        CELEBRATORY,   // milestone, best score, streak achievement
        NEW_USER,      // < 7 days of data — no HC history yet
        ESTABLISHED    // 30+ days of data — richer HC correlations shown
    }

    // ── Data classes ─────────────────────────────────────────────────────────

    enum class HcSignal {
        HRV, SLEEP, STEPS, RHR, MINDFULNESS
    }

    enum class TemplateCondition {
        HRV_LOW,
        HRV_NORMAL,
        SLEEP_LOW,
        SLEEP_NORMAL,
        STEPS_HIGH,
        STEPS_LOW,
        SCORE_AVAILABLE,
        PICKUP_AVG_AVAILABLE,
        SOCIAL_CATEGORY_AVAILABLE
    }

    data class InsightText(
        val title: String,
        val body: String,
        val hcBased: Boolean = false,
        val variant: TemplateVariant = TemplateVariant.ENCOURAGING,
        val requiredSignals: Set<HcSignal> = emptySet(),
        val requiredConditions: Set<TemplateCondition> = emptySet(),
        val priority: Int = 0
    )

    // ── Template map ─────────────────────────────────────────────────────────
    // Key: intent string → TemplateVariant → ordered list (index 0 is default pick)

    private val templates: Map<String, Map<TemplateVariant, List<InsightText>>> = mapOf(

        // ── 1. SCORE_DROP ───────────────────────────────────────────────────
        "SCORE_DROP" to mapOf(
            TemplateVariant.ENCOURAGING to listOf(
                InsightText(
                    title = "📉 Score dipped {score_drop} pts — recoverable",
                    body  = "Pickup count and first-use timing drove the drop. " +
                            "You're {screen_delta}% under your {weekday} average so far — " +
                            "keep that up and you'll claw back most of those points today."
                ),
                InsightText(
                    title = "📉 Down {score_drop} pts, but the day's not over",
                    body  = "Yesterday's pattern isn't today's destiny. You've already picked up " +
                            "your phone {pickups_today}× — your 7-day average is {pickups_avg}×. " +
                            "Stay there and the score recovers."
                ),
                InsightText(
                    title = "📉 Score drop — here's the cause",
                    body  = "Your HRV sits {hrv_delta}% below your average today, " +
                            "which lines up with the higher screen time that dragged your score. " +
                            "Low HRV days and heavy usage often move together — rest matters.",
                    hcBased = true
                )
            ),
            TemplateVariant.CAUTIONARY to listOf(
                InsightText(
                    title = "📉 Score fell {score_drop} pts — pattern worsening",
                    body  = "This is the second consecutive drop. Without a course-correction " +
                            "today your streak is at risk. A {focus_session_type} focus session " +
                            "now is worth more points than it looks."
                ),
                InsightText(
                    title = "📉 {score_drop}-point drop — your worst slide in 7 days",
                    body  = "You're {screen_delta}% above your {weekday} average and pickups are " +
                            "at {pickups_today}× — both pulled the score down. " +
                            "Locking social apps for the next 90 minutes would reverse most of this."
                ),
                InsightText(
                    title = "📉 Score down {score_drop} pts + HRV low",
                    body  = "Your HRV is {hrv_delta}% below your 7-day average ({hrv_ms} ms vs {hrv_avg_ms} ms). " +
                            "On low-HRV days screen time tends to run {screen_delta}% higher — " +
                            "your data confirms the pattern. Protect tonight's sleep.",
                    hcBased = true
                )
            ),
            TemplateVariant.CELEBRATORY to listOf(
                InsightText(
                    title = "✨ Bounced back from yesterday's dip!",
                    body  = "Score is up today after a {score_drop}-point drop yesterday. " +
                            "That recovery speed is what separates consistent users from inconsistent ones. Well done."
                ),
                InsightText(
                    title = "✨ Score recovered — streak intact",
                    body  = "Yesterday's drop of {score_drop} points didn't stick. " +
                            "Your {streak_days}-day streak is safe, and today's numbers are looking solid."
                )
            ),
            TemplateVariant.NEW_USER to listOf(
                InsightText(
                    title = "📉 Your score shifted — here's why",
                    body  = "Scores fluctuate a lot in your first week as Aurelo calibrates your baseline. " +
                            "The {score_drop}-point drop is normal — keep your goal of {goal_hours}h and it stabilises."
                ),
                InsightText(
                    title = "📉 Early score dip — don't read too much into it",
                    body  = "With only a few days of data, scores shift quickly. " +
                            "Focus on one thing: staying under {goal_minutes} minutes today. Everything else follows."
                )
            ),
            TemplateVariant.ESTABLISHED to listOf(
                InsightText(
                    title = "📉 {score_drop}-pt drop — unusual for you at day {streak_days}",
                    body  = "Over {data_window_days} days your average drop after a high-usage day is only 4 points — " +
                            "this {score_drop}-point slide is larger than usual. " +
                            "Your HRV ({hrv_ms} ms) reinforces it: recovery is needed.",
                    hcBased = true
                ),
                InsightText(
                    title = "📉 Score trend — your {data_window_days}-day picture",
                    body  = "Your established pattern shows {weekday}s tend to be your weakest day. " +
                            "Today fits. The good news: your {streak_days}-day history says you recover by tomorrow."
                )
            )
        ),

        // ── 2. STREAK_AT_RISK ───────────────────────────────────────────────
        "STREAK_AT_RISK" to mapOf(
            TemplateVariant.ENCOURAGING to listOf(
                InsightText(
                    title = "🔥 {streak_days}-day streak — protect it",
                    body  = "You're on pace to hit {goal_hours}h today, but only just. " +
                            "You've already kept this streak through {streak_days} days — " +
                            "don't let the next few hours undo that."
                ),
                InsightText(
                    title = "🔥 Streak at risk — you've got this",
                    body  = "Projected total is nudging toward your {goal_minutes}-min goal. " +
                            "Your pickup count ({pickups_today}×) is still under average. " +
                            "One focused afternoon keeps {streak_days} days alive."
                ),
                InsightText(
                    title = "🔥 {streak_days} days strong — finish it",
                    body  = "Based on your pace, you'll hit your goal unless you put the phone down now. " +
                            "You've never broken a streak this long before — this one is worth protecting."
                )
            ),
            TemplateVariant.CAUTIONARY to listOf(
                InsightText(
                    title = "🔥 Streak at real risk — act now",
                    body  = "At your current pace you'll exceed your {goal_minutes}-min goal before evening. " +
                            "{streak_days} days is your longest streak. Enable Focus Mode for the next 2 hours."
                ),
                InsightText(
                    title = "🔥 {streak_days}-day streak — final warning",
                    body  = "Pickups are at {pickups_today}× — {pickups_avg}× above your average. " +
                            "Each pickup adds roughly 4 minutes. At this rate your streak breaks by 7 PM."
                ),
                InsightText(
                    title = "🔥 Streak endangered — {today_minutes} min used of {goal_minutes}",
                    body  = "You've burned through {today_minutes} of your {goal_minutes}-minute daily budget. " +
                            "Bedtime Mode tonight can protect the final hours — enable it now to guarantee tomorrow's streak."
                )
            ),
            TemplateVariant.CELEBRATORY to listOf(
                InsightText(
                    title = "🏆 Streak survived another close call!",
                    body  = "You came within {screen_delta}% of your goal and still made it. " +
                            "{streak_days} days — one of your longest ever. The resilience is real."
                ),
                InsightText(
                    title = "🏆 {streak_days}-day streak — milestone unlocked!",
                    body  = "That felt close, but you held it together. " +
                            "{streak_days} days of consistent screen discipline is genuinely impressive."
                )
            ),
            TemplateVariant.NEW_USER to listOf(
                InsightText(
                    title = "🔥 Building your first streak — don't break it",
                    body  = "Every streak starts small. Your {streak_days}-day run is the foundation. " +
                            "Stay under {goal_minutes} minutes today and tomorrow feels easier."
                ),
                InsightText(
                    title = "🔥 Early streak at risk",
                    body  = "You're close to your {goal_hours}h limit. " +
                            "Early streaks are the hardest to maintain — put the phone face-down for the next hour."
                )
            ),
            TemplateVariant.ESTABLISHED to listOf(
                InsightText(
                    title = "🔥 {streak_days} days — your data knows how this plays out",
                    body  = "Over {data_window_days} days you've recovered a similar risk 73% of the time. " +
                            "Your proven move: close social apps before 8 PM and resist the first pickup urge."
                ),
                InsightText(
                    title = "🔥 Streak strategy — what worked before",
                    body  = "In your history, {weekday} is when streaks most often break. " +
                            "Your best defence: set a 30-min app limit on {top_app} right now."
                )
            )
        ),

        // ── 3. BEDTIME_REVENGE_PROCRASTINATION ────────────────────────────
        "BEDTIME_REVENGE_PROCRASTINATION" to mapOf(
            TemplateVariant.ENCOURAGING to listOf(
                InsightText(
                    title = "🌙 Late-night pattern detected",
                    body  = "Last night's late usage cost you screen time, but you caught it. " +
                            "Tonight: Bedtime Mode handles blocking automatically — enable it before 10 PM."
                ),
                InsightText(
                    title = "🌙 Evening scroll — you can break this",
                    body  = "Revenge procrastination is the most common pattern in Aurelo users. " +
                            "The fix is structural, not willpower: Bedtime Mode removes the decision entirely."
                ),
                InsightText(
                    title = "🌙 Late screen + low HRV next morning",
                    body  = "Your overnight HRV ({hrv_ms} ms) is {hrv_delta}% below average after last night's late session. " +
                            "The data link is clear: late screen time directly suppresses recovery. " +
                            "Tonight's cut-off: 10 PM.",
                    hcBased = true
                )
            ),
            TemplateVariant.CAUTIONARY to listOf(
                InsightText(
                    title = "🌙 Fourth night in a row — late-night scroll",
                    body  = "This pattern is now a habit loop. Each late session makes the next more likely. " +
                            "Set Bedtime Mode to activate at 9:30 PM tonight — you won't need willpower."
                ),
                InsightText(
                    title = "🌙 Late usage is dragging your sleep score",
                    body  = "Your sleep score dropped {score_drop} points this week. " +
                            "Bedtime Mode is the single highest-leverage change you can make right now."
                ),
                InsightText(
                    title = "🌙 Late screen → {sleep_hours}h sleep → more scrolling tomorrow",
                    body  = "Last night: {sleep_hours}h sleep (your average is {sleep_7day_avg}h). " +
                            "Lower sleep is directly predicting higher screen time today. " +
                            "Break the cycle tonight — Bedtime Mode at 10 PM.",
                    hcBased = true
                )
            ),
            TemplateVariant.CELEBRATORY to listOf(
                InsightText(
                    title = "✨ Phone down by 10 PM — great discipline",
                    body  = "You avoided the late-night scroll last night. " +
                            "Your sleep score reflects it — and so does your HRV."
                ),
                InsightText(
                    title = "✨ Bedtime Mode worked — night protected",
                    body  = "No late-night session detected. That's one of the highest-value wins " +
                            "in Aurelo — sleep quality compounds over days."
                )
            ),
            TemplateVariant.NEW_USER to listOf(
                InsightText(
                    title = "🌙 Late-night phone use — Aurelo spotted it",
                    body  = "Scrolling after 11 PM is the #1 hidden screen time drain. " +
                            "Try Bedtime Mode tonight — it takes 10 seconds to set up."
                ),
                InsightText(
                    title = "🌙 Evening pattern forming",
                    body  = "It's early in your Aurelo journey, but this pattern is worth catching now. " +
                            "Bedtime Mode below locks apps so you don't have to rely on willpower."
                )
            ),
            TemplateVariant.ESTABLISHED to listOf(
                InsightText(
                    title = "🌙 Late-night scroll — your {data_window_days}-day pattern",
                    body  = "Your data shows {weekday} nights are your highest-risk evenings. " +
                            "After {data_window_days} days of tracking, the link to next-morning HRV is consistent. " +
                            "Protecting {weekday} night protects {weekday+1} morning.",
                    hcBased = true
                ),
                InsightText(
                    title = "🌙 Your sleep-screen correlation is strong",
                    body  = "Over {data_window_days} days: every extra 30 mins of late-night screen time " +
                            "correlates with a {hrv_delta}% lower HRV the next morning. " +
                            "That's your data — not a guess.",
                    hcBased = true
                )
            )
        ),

        // ── 4. MORNING_DOOM_SCROLL ─────────────────────────────────────────
        "MORNING_DOOM_SCROLL" to mapOf(
            TemplateVariant.ENCOURAGING to listOf(
                InsightText(
                    title = "🌅 First use at {first_use_hour} AM — try waiting",
                    body  = "Reaching for your phone early anchors your attention to it all day. " +
                            "Tomorrow: wait until 9 AM. That one change is worth up to 20 Aurelo points."
                ),
                InsightText(
                    title = "🌅 Morning scroll detected",
                    body  = "Your first unlock at {first_use_hour} AM set a pattern for today's pickups. " +
                            "The good news: the 9 AM rule is the easiest single habit in Aurelo to start tomorrow."
                ),
                InsightText(
                    title = "🌅 Early phone use — pickups compound",
                    body  = "On days when your first use is before 8 AM, your daily pickup count runs " +
                            "{pickups_avg}× higher on average. Today: {pickups_today}× so far. " +
                            "Tomorrow's version of you wants a different alarm routine."
                )
            ),
            TemplateVariant.CAUTIONARY to listOf(
                InsightText(
                    title = "🌅 {first_use_hour} AM first use — daily pattern forming",
                    body  = "This is the third morning in a row. Early unlocks prime the brain's reward loop. " +
                            "Leave your phone on the other side of the room tonight."
                ),
                InsightText(
                    title = "🌅 Morning doom-scroll pulling your score",
                    body  = "Your first-use score component is dragging down your Screen Score. " +
                            "Even delaying to 8 AM tomorrow recovers the first-use points."
                ),
                InsightText(
                    title = "🌅 Early screen + {pickups_today} pickups today",
                    body  = "Starting the day with {top_app} at {first_use_hour} AM drove {pickups_today} pickups " +
                            "before noon — {screen_delta}% above your average by this time. " +
                            "One habit change eliminates the cascade."
                )
            ),
            TemplateVariant.CELEBRATORY to listOf(
                InsightText(
                    title = "✨ First use after 9 AM — perfect start",
                    body  = "No early doom-scroll today. Your morning first-use score is at 100%. " +
                            "Notice how your pickup count is tracking lower too?"
                ),
                InsightText(
                    title = "✨ Phone-free morning — your best first-use time this week",
                    body  = "Waiting until {first_use_hour} AM earned you full first-use points. " +
                            "That discipline at the start of the day shapes everything that follows."
                )
            ),
            TemplateVariant.NEW_USER to listOf(
                InsightText(
                    title = "🌅 Morning phone habits — what Aurelo tracks",
                    body  = "Your first daily unlock strongly predicts your pickup count. " +
                            "The 9 AM rule is your first keystone habit to try — one change, big impact."
                ),
                InsightText(
                    title = "🌅 Early morning scroll spotted",
                    body  = "You're new to Aurelo, so here's the most impactful quick win: " +
                            "delay your first phone use to 9 AM tomorrow. It's worth 20 Score points."
                )
            ),
            TemplateVariant.ESTABLISHED to listOf(
                InsightText(
                    title = "🌅 Your morning pattern — {data_window_days}-day view",
                    body  = "Over {data_window_days} days: your best screen days start with a first use after 9 AM. " +
                            "Your worst days start before 7 AM. The data is consistent — morning habits are the lever."
                ),
                InsightText(
                    title = "🌅 Early unlock → {screen_delta}% more screen time (your data)",
                    body  = "At {data_window_days} days of history, the correlation is clear: " +
                            "every hour earlier you first unlock adds an average of 18 minutes to your daily total. " +
                            "Set your phone across the room tonight."
                )
            )
        ),

        // ── 5. FOCUS_BURNOUT ──────────────────────────────────────────────
        "FOCUS_BURNOUT" to mapOf(
            TemplateVariant.ENCOURAGING to listOf(
                InsightText(
                    title = "💤 Focus feels hard today — that's okay",
                    body  = "High-pickup days make focus sessions feel impossible. " +
                            "A 5-min Gentle session is the re-entry point — not a commitment, just a reset."
                ),
                InsightText(
                    title = "💤 Focus burnout — light version",
                    body  = "Your focus sessions have been interrupted more than completed lately. " +
                            "Try a shorter session type — Mindful Pause requires zero commitment " +
                            "and still earns Focus Score points."
                ),
                InsightText(
                    title = "💤 Focus is hard + HRV is low today",
                    body  = "Your HRV ({hrv_ms} ms) is {hrv_delta}% below average — " +
                            "on low-HRV days sustained focus is physiologically harder. " +
                            "This isn't a willpower failure. A short Gentle session is the right move.",
                    hcBased = true
                )
            ),
            TemplateVariant.CAUTIONARY to listOf(
                InsightText(
                    title = "💤 Focus pattern worsening — {pickups_today} pickups",
                    body  = "You've had {pickups_today} pickups today — {screen_delta}% above average. " +
                            "Focus sessions interrupted at this pickup rate rarely complete. " +
                            "Block {top_app} first, then start a session."
                ),
                InsightText(
                    title = "💤 Burnout loop — screen time and focus declining together",
                    body  = "Your Focus Score and Screen Score are both trending down this week. " +
                            "That double-decline is a warning sign. Even one completed session today reverses the slide."
                ),
                InsightText(
                    title = "💤 Low HRV + high pickups = focus wall",
                    body  = "HRV at {hrv_ms} ms ({hrv_delta}% below your norm) and {pickups_today} pickups " +
                            "is a difficult combination. Your body is telling you it needs recovery, " +
                            "not more screen time. Rest > pushing through today.",
                    hcBased = true
                )
            ),
            TemplateVariant.CELEBRATORY to listOf(
                InsightText(
                    title = "✨ Focus session completed despite the burnout feeling",
                    body  = "Getting a session done on a tough day is worth double. " +
                            "Your Focus Score held because of that one session."
                ),
                InsightText(
                    title = "✨ Broke the burnout cycle today!",
                    body  = "Consecutive days of difficult focus, and you still got one in. " +
                            "That habit resilience is what the streak is built from."
                )
            ),
            TemplateVariant.NEW_USER to listOf(
                InsightText(
                    title = "💤 Focus feeling difficult — it's normal early on",
                    body  = "Screen habits take 2–3 weeks to shift. " +
                            "The Gentle session type in Aurelo is designed exactly for days like this — try it."
                ),
                InsightText(
                    title = "💤 Can't focus? — here's why it's hard early",
                    body  = "Your brain's attention system needs time to recalibrate. " +
                            "Even a 5-minute Mindful Pause earns Focus points and starts the shift."
                )
            ),
            TemplateVariant.ESTABLISHED to listOf(
                InsightText(
                    title = "💤 Burnout signal — your data vs your norm",
                    body  = "Your current focus session completion rate is below your {data_window_days}-day average. " +
                            "Combined with HRV at {hrv_ms} ms, your body is asking for a rest day, not a push day.",
                    hcBased = true
                ),
                InsightText(
                    title = "💤 You've recovered from this before",
                    body  = "In {data_window_days} days of history, you've hit similar burnout dips {score_drop} times. " +
                            "Each time, a 2-day lighter schedule followed by one full session reset the pattern. " +
                            "You know what to do."
                )
            )
        ),

        // ── 6. HC_POOR_SLEEP_HIGH_USAGE ───────────────────────────────────
        "HC_POOR_SLEEP_HIGH_USAGE" to mapOf(
            TemplateVariant.ENCOURAGING to listOf(
                InsightText(
                    title = "😴 Low HRV day — be kind to yourself",
                    body  = "HRV is {hrv_delta}% below your average ({hrv_ms} ms vs {hrv_avg_ms} ms). " +
                            "Screen time tends to run higher on days like this — awareness alone helps. " +
                            "A short walk could lift both your steps and your HRV recovery.",
                    hcBased = true
                ),
                InsightText(
                    title = "😴 Poor sleep → more scrolling — the data confirms it",
                    body  = "Last night: {sleep_hours}h (your average: {sleep_7day_avg}h). " +
                            "On under-slept days your screen time typically runs {screen_delta}% above your baseline. " +
                            "Today's your chance to break the pattern.",
                    hcBased = true
                ),
                InsightText(
                    title = "😴 {sleep_hours}h sleep last night — manage the day smartly",
                    body  = "Short sleep makes phones harder to resist. Your HRV ({hrv_ms} ms) confirms the strain. " +
                            "A Gentle 10-min session now helps more than scrolling — even if it doesn't feel like it.",
                    hcBased = true
                )
            ),
            TemplateVariant.CAUTIONARY to listOf(
                InsightText(
                    title = "😴 Poor sleep reinforcing heavy usage — act now",
                    body  = "HRV down {hrv_delta}%, screen time already {screen_delta}% above your {weekday} norm. " +
                            "This loop deepens unless you interrupt it. Block your top app for the next hour.",
                    hcBased = true
                ),
                InsightText(
                    title = "😴 Sleep debt + screen time — third day running",
                    body  = "Three consecutive nights under {sleep_7day_avg}h sleep and three days of elevated usage. " +
                            "Your HRV trend is declining. Tonight's sleep is the highest-leverage action you can take.",
                    hcBased = true
                ),
                InsightText(
                    title = "😴 {sleep_hours}h sleep → {screen_delta}% more screen time today",
                    body  = "The pattern in your Health Connect data is clear: " +
                            "short sleep nights predict high screen time days. " +
                            "Today fits the pattern. Protect tonight with Bedtime Mode — break the cycle.",
                    hcBased = true
                )
            ),
            TemplateVariant.CELEBRATORY to listOf(
                InsightText(
                    title = "✨ Low HRV day — you kept screen time in check!",
                    body  = "Despite an HRV {hrv_delta}% below average, you stayed under your {goal_minutes}-min goal. " +
                            "That's the hardest kind of win — managing usage when your body is signalling stress.",
                    hcBased = true
                ),
                InsightText(
                    title = "✨ Sleep recovered — HRV and usage both better",
                    body  = "Last night: {sleep_hours}h — back to your average. " +
                            "HRV reflects it, and your screen time so far is tracking lower. " +
                            "Sleep quality really does cascade.",
                    hcBased = true
                )
            ),
            TemplateVariant.NEW_USER to listOf(
                InsightText(
                    title = "😴 Sleep and screen time are connected",
                    body  = "Health Connect shows {sleep_hours}h sleep last night. " +
                            "Poor sleep makes phones harder to resist — it's biology, not weakness. " +
                            "Aurelo will track this pattern over time.",
                    hcBased = true
                ),
                InsightText(
                    title = "😴 HRV + screen — what Aurelo is learning",
                    body  = "With Health Connect connected, Aurelo can see how your sleep and HRV " +
                            "shape your phone use. It's early days — keep the connection active and the insights deepen.",
                    hcBased = true
                )
            ),
            TemplateVariant.ESTABLISHED to listOf(
                InsightText(
                    title = "😴 Your sleep-screen correlation — {data_window_days}-day view",
                    body  = "After {data_window_days} days: when your HRV is >{hrv_delta}% below average, " +
                            "your screen time averages {screen_delta}% higher. That correlation is specific to you. " +
                            "Tonight's sleep is a direct investment in tomorrow's score.",
                    hcBased = true
                ),
                InsightText(
                    title = "😴 You know your sleep threshold — {sleep_7day_avg}h is your baseline",
                    body  = "Last night was {sleep_hours}h — {hrv_delta}% below your personal average. " +
                            "At {data_window_days} days of data, we know how this day plays out for you. " +
                            "Set a 30-min limit on {top_app} now to override the pattern.",
                    hcBased = true
                )
            )
        ),

        // ── 7. HC_ACTIVE_DAY_BETTER_FOCUS ─────────────────────────────────
        "HC_ACTIVE_DAY_BETTER_FOCUS" to mapOf(
            TemplateVariant.ENCOURAGING to listOf(
                InsightText(
                    title = "🚶 Active day — your focus window is open",
                    body  = "{steps_today} steps so far. On days you clear {steps_7day_avg} steps, " +
                            "your screen time typically stays under goal. " +
                            "Pair it with a focus session while the momentum is there.",
                    hcBased = true
                ),
                InsightText(
                    title = "🚶 Moving more → using your phone less",
                    body  = "Your step count ({steps_today}) is tracking well above average. " +
                            "Active days correlate with lower pickup counts in your data — use that energy.",
                    hcBased = true
                ),
                InsightText(
                    title = "🚶 Good step day → good screen day",
                    body  = "Health Connect shows {steps_today} steps. " +
                            "On your best screen days in the last 7, average steps were {steps_7day_avg}+. " +
                            "Today fits the profile — you're set up for a strong score.",
                    hcBased = true
                )
            ),
            TemplateVariant.CAUTIONARY to listOf(
                InsightText(
                    title = "🚶 Great step day — don't waste it on the phone",
                    body  = "{steps_today} steps but screen time is tracking {screen_delta}% above your norm. " +
                            "Your activity has earned a better evening — put the phone down and let the day land well.",
                    hcBased = true
                ),
                InsightText(
                    title = "🚶 Active body, passive phone habits — mismatch",
                    body  = "You've hit {steps_today} steps, but pickups are at {pickups_today}× — above your average. " +
                            "Activity helps your HRV; screen time undermines it. " +
                            "One focus session now compounds the physical effort.",
                    hcBased = true
                ),
                InsightText(
                    title = "🚶 High steps + high screen time — conflicting signals",
                    body  = "Activity is great ({steps_today} steps), but screen time today is {screen_delta}% above baseline. " +
                            "The benefit of your active day is being offset. " +
                            "A 25-min app block this evening locks in the gains.",
                    hcBased = true
                )
            ),
            TemplateVariant.CELEBRATORY to listOf(
                InsightText(
                    title = "✨ Active day + under-goal screen time — double win",
                    body  = "{steps_today} steps and screen time under {goal_minutes} min. " +
                            "This is exactly the pattern that drives your best Aurelo scores. Keep it.",
                    hcBased = true
                ),
                InsightText(
                    title = "✨ {steps_today} steps → best screen day this week!",
                    body  = "Physical activity and phone discipline on the same day — rare and valuable. " +
                            "Your Body and Screen scores are both looking strong.",
                    hcBased = true
                )
            ),
            TemplateVariant.NEW_USER to listOf(
                InsightText(
                    title = "🚶 First active day — here's what it means for your score",
                    body  = "{steps_today} steps earns you activity bonus points on your Screen Score. " +
                            "Health Connect is already working — the data connection is live.",
                    hcBased = true
                ),
                InsightText(
                    title = "🚶 Steps + Aurelo — how they connect",
                    body  = "High-step days tend to produce lower screen time in most users. " +
                            "Aurelo will learn your personal correlation as you build history.",
                    hcBased = true
                )
            ),
            TemplateVariant.ESTABLISHED to listOf(
                InsightText(
                    title = "🚶 Your step-screen pattern — proven over {data_window_days} days",
                    body  = "On days when you hit {steps_7day_avg}+ steps, your screen time is {screen_delta}% lower on average — " +
                            "confirmed across {data_window_days} days of your data. " +
                            "Today's {steps_today} steps puts you in that zone.",
                    hcBased = true
                ),
                InsightText(
                    title = "🚶 Active days are your best screen days — consistently",
                    body  = "Over {data_window_days} days, your highest-step days and lowest-screen days overlap " +
                            "more than 70% of the time. Today: {steps_today} steps. " +
                            "The pattern says today should be a strong screen day — lean into it.",
                    hcBased = true
                )
            )
        ),

        // ── 8. PRODUCTIVE_DAY ─────────────────────────────────────────────
        "PRODUCTIVE_DAY" to mapOf(
            TemplateVariant.ENCOURAGING to listOf(
                InsightText(
                    title = "✦ Strong day building",
                    body  = "Screen {screen_score} · Focus {focus_score} · Sleep {sleep_score}. " +
                            "All three pillars are pointing up. Finish strong — don't pick up the phone unnecessarily this evening."
                ),
                InsightText(
                    title = "✦ On track for a great score today",
                    body  = "Aurelo Score {aurelo_score} — ahead of your weekly average. " +
                            "Your pickups ({pickups_today}×) are tracking below average. " +
                            "One focus session this afternoon seals it."
                ),
                InsightText(
                    title = "✦ Productive pattern confirmed",
                    body  = "You're under goal, pickups are controlled, and focus sessions are completed. " +
                            "This is exactly the profile that produces streak milestones."
                )
            ),
            TemplateVariant.CAUTIONARY to listOf(
                InsightText(
                    title = "✦ Good day — protect the evening",
                    body  = "You're on track right now, but {weekday} evenings are historically your riskiest time. " +
                            "Set Bedtime Mode for 10 PM and lock in today's solid numbers."
                ),
                InsightText(
                    title = "✦ Strong morning — don't slip after lunch",
                    body  = "First half of {weekday} looks great. Your data shows afternoon pickups are " +
                            "your most common weak point. Block {top_app} from 2–5 PM."
                ),
                InsightText(
                    title = "✦ Productive so far — one distraction away from a dip",
                    body  = "Score {aurelo_score} is strong, but the evening is ahead. " +
                            "Your {streak_days}-day streak deserves a clean finish today."
                )
            ),
            TemplateVariant.CELEBRATORY to listOf(
                InsightText(
                    title = "🏆 {streak_days}-day streak — milestone reached!",
                    body  = "Screen {screen_score} · Focus {focus_score} · Sleep {sleep_score}. " +
                            "You've hit a new milestone and every pillar earned it. Outstanding consistency."
                ),
                InsightText(
                    title = "🌟 Best Aurelo Score this month — {aurelo_score}!",
                    body  = "A new personal best. Screen time under goal, focus sessions completed, sleep score strong. " +
                            "This is what deliberate phone habits look like over time."
                )
            ),
            TemplateVariant.NEW_USER to listOf(
                InsightText(
                    title = "✦ Great start — this is what Aurelo is for",
                    body  = "Score {aurelo_score} in your first week. " +
                            "Awareness alone drives this kind of improvement — keep building the habit."
                ),
                InsightText(
                    title = "✦ Solid early results",
                    body  = "Under goal, pickups controlled, first-use time good. " +
                            "You're laying the foundation — the score compounds as your streak grows."
                )
            ),
            TemplateVariant.ESTABLISHED to listOf(
                InsightText(
                    title = "✦ {aurelo_score} — above your {data_window_days}-day average",
                    body  = "Screen {screen_score} · Focus {focus_score} · Sleep {sleep_score}. " +
                            "This is your established baseline performing at its best. " +
                            "Health Connect data reinforced all three pillars today.",
                    hcBased = true
                ),
                InsightText(
                    title = "✦ {data_window_days} days in — your best period yet",
                    body  = "Your {data_window_days}-day average score has climbed steadily. " +
                            "Today's {aurelo_score} is above that average — the habits are compounding."
                )
            )
        ),

        // ── 9. WEEKEND_BINGE ───────────────────────────────────────────────
        "WEEKEND_BINGE" to mapOf(
            TemplateVariant.ENCOURAGING to listOf(
                InsightText(
                    title = "📅 Weekend — your usage is climbing",
                    body  = "Weekend screen time runs {screen_delta}% higher than weekdays on average. " +
                            "That's normal — but one focused block during the day keeps it from becoming a binge."
                ),
                InsightText(
                    title = "📅 Saturday/Sunday pattern — catch it early",
                    body  = "Your best weekends start with a goal check before noon. " +
                            "You're at {today_minutes} min — your weekend goal is {goal_minutes} min. Still manageable."
                ),
                InsightText(
                    title = "📅 Weekend drift — a plan fixes it",
                    body  = "Unstructured time is the enemy of screen goals. " +
                            "Block a 2-hour activity window this afternoon — the phone use drops automatically."
                )
            ),
            TemplateVariant.CAUTIONARY to listOf(
                InsightText(
                    title = "📅 Weekend binge in progress — {today_minutes} min used",
                    body  = "You've used {today_minutes} of {goal_minutes} minutes and it's not evening yet. " +
                            "At this pace your streak breaks and your score dips. " +
                            "Put the phone in another room for the next 2 hours."
                ),
                InsightText(
                    title = "📅 Weekend pattern — 2× your weekday average",
                    body  = "This weekend you're at {screen_delta}% above your weekday baseline. " +
                            "The gap between weekday discipline and weekend habits is widening. " +
                            "Enable Focus Mode now for a 90-min reset."
                ),
                InsightText(
                    title = "📅 Sunday evening — last chance to protect the week",
                    body  = "If today ends over goal, your weekly summary takes the hit. " +
                            "{streak_days}-day streak is still intact — Bedtime Mode tonight keeps it that way."
                )
            ),
            TemplateVariant.CELEBRATORY to listOf(
                InsightText(
                    title = "✨ Weekend under control — rare and impressive",
                    body  = "You stayed under {goal_minutes} min on a weekend. " +
                            "That's one of the hardest Aurelo habits to build — you've built it."
                ),
                InsightText(
                    title = "✨ Best weekend screen score this month!",
                    body  = "Weekend discipline is the differentiator for long streaks. " +
                            "Your {streak_days}-day run is proof."
                )
            ),
            TemplateVariant.NEW_USER to listOf(
                InsightText(
                    title = "📅 Weekends are the hardest days — here's why",
                    body  = "No schedule means no natural phone breaks. " +
                            "Set a manual 3-hour screen block today — the goal is {goal_minutes} min total."
                ),
                InsightText(
                    title = "📅 Weekend binge detected — your first big test",
                    body  = "Most users' first streak breaks on a weekend. " +
                            "Knowing that is half the battle. You've got {goal_minutes} minutes left today — use them wisely."
                )
            ),
            TemplateVariant.ESTABLISHED to listOf(
                InsightText(
                    title = "📅 Your weekend pattern — {data_window_days}-day history",
                    body  = "Over {data_window_days} days, your weekends average {screen_delta}% more screen time than weekdays. " +
                            "{weekday} is your single highest-usage day. Plan around it — don't react to it."
                ),
                InsightText(
                    title = "📅 Weekend vs weekday — your personal gap",
                    body  = "Your data is clear: weekdays {avg_minutes} min avg vs weekends {today_minutes} min avg. " +
                            "The gap has widened this month. Your streak survived — but the trend needs attention."
                )
            )
        ),

        // ── 10. RECOVERY_DAY ─────────────────────────────────────────────
        "RECOVERY_DAY" to mapOf(
            TemplateVariant.ENCOURAGING to listOf(
                InsightText(
                    title = "📈 Recovery day — you're bouncing back",
                    body  = "Yesterday was tough ({avg_minutes} min over goal) but today is trending better. " +
                            "This is exactly the resilience pattern that keeps streaks alive."
                ),
                InsightText(
                    title = "📈 Below average today — great response",
                    body  = "Following a high-usage day with a low one is a strong self-correction pattern. " +
                            "Your Aurelo Score will reflect the rebound."
                ),
                InsightText(
                    title = "📈 Recovery in progress — HRV recovering too",
                    body  = "Screen time is down and your HRV ({hrv_ms} ms) is trending back toward your average. " +
                            "The two move together — today's restraint is tomorrow's better recovery.",
                    hcBased = true
                )
            ),
            TemplateVariant.CAUTIONARY to listOf(
                InsightText(
                    title = "📈 Second high day — recovery stalled",
                    body  = "Yesterday was above goal, and today is tracking similarly. " +
                            "Two consecutive over-goal days will drag your weekly average significantly. " +
                            "This afternoon is the correction window."
                ),
                InsightText(
                    title = "📈 Recovery day needed — but usage is still high",
                    body  = "After yesterday's spike ({avg_minutes} min), today should be lower. " +
                            "It's not yet. A 1-hour focus session now puts recovery back on track."
                ),
                InsightText(
                    title = "📈 No recovery yet — HRV still low",
                    body  = "After yesterday's heavy usage, your HRV ({hrv_ms} ms) hasn't bounced back. " +
                            "Your body needs recovery, and so does your score. " +
                            "Less screen time tonight directly affects tomorrow's HRV.",
                    hcBased = true
                )
            ),
            TemplateVariant.CELEBRATORY to listOf(
                InsightText(
                    title = "✨ Snapped back after a rough day — impressive",
                    body  = "Yesterday: over goal. Today: well under. " +
                            "That recovery speed is what separates consistent users. Great response."
                ),
                InsightText(
                    title = "✨ Recovery complete — score rebounding",
                    body  = "One bad day followed by one excellent recovery. " +
                            "Your score is trending back up and your streak survived."
                )
            ),
            TemplateVariant.NEW_USER to listOf(
                InsightText(
                    title = "📈 Bad day yesterday — don't let it spiral",
                    body  = "It's normal to overshoot your goal. What matters is today. " +
                            "Your {goal_minutes}-min target is fresh — start clean."
                ),
                InsightText(
                    title = "📈 Recovery day — what Aurelo tracks",
                    body  = "Aurelo watches how quickly you recover from high-usage days. " +
                            "A strong recovery today teaches the app your rebound pattern."
                )
            ),
            TemplateVariant.ESTABLISHED to listOf(
                InsightText(
                    title = "📈 Your recovery speed — {data_window_days}-day benchmark",
                    body  = "In your history, you typically recover within 1 day of a spike. " +
                            "Today is day 2 after yesterday's {avg_minutes}-min session — " +
                            "your pattern says today should be well under goal."
                ),
                InsightText(
                    title = "📈 Recovery + HRV — both tracking right",
                    body  = "Screen time down and HRV at {hrv_ms} ms — recovering toward your {hrv_avg_ms} ms average. " +
                            "Over {data_window_days} days, these two signals recover together consistently.",
                    hcBased = true
                )
            )
        ),

        // ── 11. SOCIAL_SPIRAL ─────────────────────────────────────────────
        "SOCIAL_SPIRAL" to mapOf(
            TemplateVariant.ENCOURAGING to listOf(
                InsightText(
                    title = "📱 Social apps leading — you can redirect this",
                    body  = "{top_app} is your top app today with {pickups_today} pickups. " +
                            "A 25-min block right now breaks the check-in loop and frees up the hour."
                ),
                InsightText(
                    title = "📱 Social spiral — catch it while it's small",
                    body  = "Social usage is at {screen_delta}% of your total screen time today. " +
                            "Setting a 30-min daily limit on {top_app} adds about 8 points to your Screen Score."
                ),
                InsightText(
                    title = "📱 Social category dominant today",
                    body  = "{top_category} is {screen_delta}% of today's usage. " +
                            "One focused afternoon block changes the daily breakdown significantly."
                )
            ),
            TemplateVariant.CAUTIONARY to listOf(
                InsightText(
                    title = "📱 Social spiral — {top_app} dominating",
                    body  = "{top_app} has driven {pickups_today} pickups — your highest single-app count this week. " +
                            "Block it for the rest of the day. The urge to check fades within 20 minutes."
                ),
                InsightText(
                    title = "📱 Social at {screen_delta}% of screen time — out of control",
                    body  = "Social apps are crowding out everything else today. " +
                            "Your Focus Score is taking the hit. " +
                            "Strict Mode on {top_app} — now, before the evening session starts."
                ),
                InsightText(
                    title = "📱 Spiral worsening — second day of social dominance",
                    body  = "Two consecutive days where {top_category} leads. " +
                            "This is how screen habits entrench. " +
                            "Structural change: daily limit set to 45 min total across social apps."
                )
            ),
            TemplateVariant.CELEBRATORY to listOf(
                InsightText(
                    title = "✨ Social apps under control today!",
                    body  = "{top_app} dropped from your top position. " +
                            "Your Screen Score reflects the redirect — well managed."
                ),
                InsightText(
                    title = "✨ Broke the social spiral — {streak_days} days of control",
                    body  = "Social category has been under 40% of total screen time for {streak_days} days. " +
                            "That's a meaningful habit shift."
                )
            ),
            TemplateVariant.NEW_USER to listOf(
                InsightText(
                    title = "📱 Social apps are top of your list — common early pattern",
                    body  = "Most new Aurelo users see social apps dominate week one. " +
                            "Setting a 45-min daily limit on {top_app} is the fastest score improvement available to you."
                ),
                InsightText(
                    title = "📱 Social category flagged — here's what to do",
                    body  = "{top_app} is your #1 app today. " +
                            "Try Aurelo's app timer for {top_app} — it's the highest-ROI first setting for new users."
                )
            ),
            TemplateVariant.ESTABLISHED to listOf(
                InsightText(
                    title = "📱 Social spiral — unusual for you at {streak_days} days",
                    body  = "Over {data_window_days} days your social category averages {screen_delta}% of usage. " +
                            "Today it's running higher than your norm. Something triggered this cycle — worth noticing."
                ),
                InsightText(
                    title = "📱 {top_app} usage — above your personal baseline",
                    body  = "Your established pattern has {top_app} lower than today's level. " +
                            "Stress, boredom, or disruption to your routine usually precede this. " +
                            "A 10-min Mindful Pause addresses the trigger, not just the symptom."
                )
            )
        ),

        // ── 12. HEALTHY_PATTERN ───────────────────────────────────────────
        "HEALTHY_PATTERN" to mapOf(
            TemplateVariant.ENCOURAGING to listOf(
                InsightText(
                    title = "✅ Everything is pointing in the right direction",
                    body  = "Goal met, focus sessions completed, pickups below average. " +
                            "This is your healthy baseline — and it's becoming your new normal."
                ),
                InsightText(
                    title = "✅ Healthy pattern — your habit is forming",
                    body  = "You're under goal, first-use time was good, and pickups are controlled. " +
                            "It takes about 21 days of consistency to lock this in. You're building it."
                ),
                InsightText(
                    title = "✅ Healthy pattern + strong HRV — everything aligned",
                    body  = "Screen time under goal, HRV at {hrv_ms} ms (near your {hrv_avg_ms} ms average), " +
                            "and steps at {steps_today}. On days like this your Sleep Score follows. " +
                            "Protect tonight's sleep.",
                    hcBased = true
                )
            ),
            TemplateVariant.CAUTIONARY to listOf(
                InsightText(
                    title = "✅ Healthy so far — protect the evening",
                    body  = "Strong morning and afternoon. The risk window is now through midnight. " +
                            "Set Bedtime Mode and let the day close cleanly."
                ),
                InsightText(
                    title = "✅ Good day — one slip away from breaking the pattern",
                    body  = "You're under goal and pickups are controlled. " +
                            "The data shows {weekday} evenings are your risk window — stay alert."
                ),
                InsightText(
                    title = "✅ Healthy pattern holding — but steps are low",
                    body  = "Screen time is good and HRV is stable. " +
                            "But {steps_today} steps is below your {steps_7day_avg} average. " +
                            "A short walk completes the picture.",
                    hcBased = true
                )
            ),
            TemplateVariant.CELEBRATORY to listOf(
                InsightText(
                    title = "🌟 Perfect day — all four pillars green",
                    body  = "Screen {screen_score} · Focus {focus_score} · Sleep {sleep_score} · Body {aurelo_score}. " +
                            "That's a complete performance. Genuinely rare."
                ),
                InsightText(
                    title = "🌟 Healthy pattern — {streak_days} days strong",
                    body  = "Every metric is where it should be, and the streak is at {streak_days} days. " +
                            "This is what sustainable phone health looks like."
                )
            ),
            TemplateVariant.NEW_USER to listOf(
                InsightText(
                    title = "✅ Great early pattern — keep this up",
                    body  = "Under goal, controlled pickups, reasonable first-use time. " +
                            "This is the foundation. Three weeks of this and it becomes automatic."
                ),
                InsightText(
                    title = "✅ Healthy day — Aurelo is working",
                    body  = "Your first strong day is the hardest to produce. " +
                            "Screen {screen_score} is a solid start — now repeat it tomorrow."
                )
            ),
            TemplateVariant.ESTABLISHED to listOf(
                InsightText(
                    title = "✅ Your healthy baseline — confirmed over {data_window_days} days",
                    body  = "At {data_window_days} days, your personal healthy baseline is clear: " +
                            "under {goal_minutes} min, under {pickups_avg} pickups, HRV at or above {hrv_avg_ms} ms. " +
                            "Today hits all three.",
                    hcBased = true
                ),
                InsightText(
                    title = "✅ Consistent healthy pattern — your new normal",
                    body  = "Over {data_window_days} days you've met your screen goal consistently. " +
                            "Health Connect confirms the physical side is keeping pace — " +
                            "HRV trend is stable, steps are solid."
                )
            )
        ),

        // ── 13. ANOMALOUS_SPIKE ───────────────────────────────────────────
        "ANOMALOUS_SPIKE" to mapOf(
            TemplateVariant.ENCOURAGING to listOf(
                InsightText(
                    title = "📊 Spike detected — what caused it?",
                    body  = "{spike_day}: {spike_minutes} min — {screen_delta}% above your {week_avg_minutes} min weekly average. " +
                            "Identifying the trigger is more useful than guilt. " +
                            "Was it boredom, stress, or a specific app?"
                ),
                InsightText(
                    title = "📊 Unusual day spotted — anomaly, not trend",
                    body  = "{spike_day}'s usage was {spike_minutes} min — nearly {screen_delta}% above your norm. " +
                            "One spike doesn't define your week. " +
                            "Today is the correction opportunity — you've already started well."
                ),
                InsightText(
                    title = "📊 Spike on {spike_day} — your body noticed too",
                    body  = "After {spike_minutes} min on {spike_day}, your HRV the next morning was {hrv_delta}% below average. " +
                            "High screen days have a biological cost. Today's lower usage is already helping recovery.",
                    hcBased = true
                )
            ),
            TemplateVariant.CAUTIONARY to listOf(
                InsightText(
                    title = "📊 Another spike — pattern becoming trend",
                    body  = "{spike_day}'s {spike_minutes} min followed a similar spike last {day_label}. " +
                            "Two spikes in one week signals a habit, not an exception. " +
                            "A scheduled focus session on {spike_day}s would interrupt this."
                ),
                InsightText(
                    title = "📊 Spike {screen_delta}% above baseline — streak risk",
                    body  = "This is your largest single-day spike in the past week. " +
                            "At this level your streak is at risk if it continues today. " +
                            "Block your top app now."
                ),
                InsightText(
                    title = "📊 Spike + low HRV the next day — linked pattern",
                    body  = "Every major spike ({spike_minutes} min+) in your history has been followed by " +
                            "a below-average HRV reading. Today's {hrv_ms} ms confirms it. " +
                            "Lower today's usage — your body is asking for recovery.",
                    hcBased = true
                )
            ),
            TemplateVariant.CELEBRATORY to listOf(
                InsightText(
                    title = "✨ Recovered from last week's spike",
                    body  = "Last {spike_day}'s {spike_minutes} min didn't spiral into a second high day. " +
                            "You corrected quickly — that's the discipline that protects streaks."
                ),
                InsightText(
                    title = "✨ Spike followed by your best day this week",
                    body  = "The rebound from {spike_day}'s anomaly was strong. " +
                            "Your self-correction speed is genuinely improving."
                )
            ),
            TemplateVariant.NEW_USER to listOf(
                InsightText(
                    title = "📊 Unusual high day — Aurelo flagged it",
                    body  = "{spike_day}: {spike_minutes} min — significantly above your young baseline. " +
                            "It's too early to call it a pattern. Focus on today's goal: {goal_minutes} min."
                ),
                InsightText(
                    title = "📊 Spike detected — your first anomaly",
                    body  = "Aurelo flagged {spike_day} as statistically unusual for your early data. " +
                            "As your baseline builds over the next few weeks, these detections become more precise."
                )
            ),
            TemplateVariant.ESTABLISHED to listOf(
                InsightText(
                    title = "📊 Spike vs your {data_window_days}-day baseline",
                    body  = "{spike_day}'s {spike_minutes} min is {screen_delta}% above your {data_window_days}-day average of {week_avg_minutes} min. " +
                            "In your history, spikes this size are usually followed by a correction the next day. " +
                            "Your pattern says today should be significantly lower."
                ),
                InsightText(
                    title = "📊 {spike_day} anomaly — rarest in your {data_window_days}-day history",
                    body  = "This is your highest single-day reading in recent history. " +
                            "Your established baseline of {week_avg_minutes} min makes this more visible — " +
                            "and your consistent history means one bad day won't define your score."
                )
            )
        ),

        // ── 14. FOCUS_GAP ─────────────────────────────────────────────────
        "FOCUS_GAP" to mapOf(
            TemplateVariant.ENCOURAGING to listOf(
                InsightText(
                    title = "🎯 {focus_days_ago} days without focus — let's fix that",
                    body  = "Your Focus Score drifts after 3 days without a session. " +
                            "Even a 10-min Gentle session today resets the streak and earns back points."
                ),
                InsightText(
                    title = "🎯 Focus gap — you've done this before",
                    body  = "{focus_days_ago} days is a longer gap than usual for you. " +
                            "You don't need a long session — a 5-min Mindful Pause counts and restarts the habit."
                ),
                InsightText(
                    title = "🎯 Focus gap — but mindfulness counts too",
                    body  = "No Aurelo session in {focus_days_ago} days, but Health Connect shows " +
                            "{external_mindfulness_min} min from {mindfulness_source}. " +
                            "That earns partial credit and reduces the gap's impact on your score.",
                    hcBased = true
                )
            ),
            TemplateVariant.CAUTIONARY to listOf(
                InsightText(
                    title = "🎯 {focus_days_ago}-day focus gap — score drifting",
                    body  = "Your Focus Score has slipped {score_drop} points over the gap. " +
                            "Every day without a session adds to the drift. " +
                            "A completed session today stops the slide immediately."
                ),
                InsightText(
                    title = "🎯 Longest focus gap in a month — {focus_days_ago} days",
                    body  = "You're going longer without sessions than at any point this month. " +
                            "The habit is at risk. A 10-min Gentle session today is the minimum to reset."
                ),
                InsightText(
                    title = "🎯 Focus gap + no external mindfulness — full gap",
                    body  = "No Aurelo sessions and no Health Connect mindfulness in {focus_days_ago} days. " +
                            "Your Focus Score is taking the full hit. " +
                            "Even Headspace or Calm logged to HC earns 50% credit — start there if it's easier.",
                    hcBased = true
                )
            ),
            TemplateVariant.CELEBRATORY to listOf(
                InsightText(
                    title = "✨ Focus gap closed — session completed!",
                    body  = "After {focus_days_ago} days, you came back. " +
                            "That re-entry session is always the hardest one — and you did it."
                ),
                InsightText(
                    title = "✨ Back to daily focus — streak alive",
                    body  = "The {focus_days_ago}-day gap is closed. " +
                            "Your Focus Score will recover within 2 days of consistent sessions."
                )
            ),
            TemplateVariant.NEW_USER to listOf(
                InsightText(
                    title = "🎯 Haven't tried a focus session yet",
                    body  = "Focus sessions are Aurelo's most powerful score booster. " +
                            "Start with a 5-min Gentle session — it's the lowest-friction first step."
                ),
                InsightText(
                    title = "🎯 First focus gap — normal early on",
                    body  = "Building a focus session habit takes a few weeks. " +
                            "The Gentle session type was designed for exactly this moment — no pressure, just a start."
                )
            ),
            TemplateVariant.ESTABLISHED to listOf(
                InsightText(
                    title = "🎯 Focus gap — unusual at {streak_days} days in",
                    body  = "Your {data_window_days}-day history shows you rarely go more than 2 days without a session. " +
                            "A {focus_days_ago}-day gap is outside your pattern. " +
                            "Something's been getting in the way — and a short session right now resets it."
                ),
                InsightText(
                    title = "🎯 {focus_days_ago}-day gap vs your {data_window_days}-day average",
                    body  = "Your established focus rhythm is shorter than {focus_days_ago} days. " +
                            "Health Connect shows {external_mindfulness_min} min from {mindfulness_source} this week — " +
                            "not nothing, but an Aurelo session earns full credit.",
                    hcBased = true
                )
            )
        ),

        // ── 15. DOPAMINE_LOOP ─────────────────────────────────────────────
        "DOPAMINE_LOOP" to mapOf(
            TemplateVariant.ENCOURAGING to listOf(
                InsightText(
                    title = "🔁 Dopamine loop detected — you can break it",
                    body  = "Aurelo spotted 5+ short sessions on {top_app} within a 20-min window. " +
                            "The loop is automatic — block {top_app} for 30 minutes to interrupt it. " +
                            "The urge fades faster than it feels like it will."
                ),
                InsightText(
                    title = "🔁 Mindless check-in loop — you're not alone",
                    body  = "Rapid repeat pickups on {top_app} is one of the most common patterns Aurelo detects. " +
                            "A single 25-min block is the most effective interruption. You've broken this before."
                ),
                InsightText(
                    title = "🔁 Loop caught early — easier to stop now",
                    body  = "The dopamine loop just started. Blocking {top_app} in the next 5 minutes " +
                            "is 3× more effective than waiting until the loop deepens."
                )
            ),
            TemplateVariant.CAUTIONARY to listOf(
                InsightText(
                    title = "🔁 Loop deepening — {pickups_today} pickups today",
                    body  = "The {top_app} check-in loop started early and it's been running all day. " +
                            "{pickups_today} pickups is {screen_delta}% above your average. " +
                            "Enable Strict Mode on {top_app} for the rest of the day."
                ),
                InsightText(
                    title = "🔁 Dopamine loop — most expensive pattern in your data",
                    body  = "Rapid-fire short sessions on {top_app} cost more screen time than long browsing sessions. " +
                            "Each loop cycle adds 15–20 min to your daily total. Block now."
                ),
                InsightText(
                    title = "🔁 Third loop today — pattern solidifying",
                    body  = "Multiple dopamine loops detected today. " +
                            "At this frequency, the habit is reinforcing. " +
                            "A focus session directly competes with the loop — even 10 minutes breaks the pattern."
                )
            ),
            TemplateVariant.CELEBRATORY to listOf(
                InsightText(
                    title = "✨ Loop-free day — pickups under control",
                    body  = "No rapid-fire short sessions detected today. " +
                            "Your pickup count ({pickups_today}×) is below average and the pattern is clean."
                ),
                InsightText(
                    title = "✨ Broke the {top_app} loop — well done",
                    body  = "You blocked the app when the loop started. " +
                            "That's the exact intervention that works — and you executed it."
                )
            ),
            TemplateVariant.NEW_USER to listOf(
                InsightText(
                    title = "🔁 Dopamine loop — what Aurelo just detected",
                    body  = "You opened {top_app} 5+ times in 20 minutes for short sessions. " +
                            "This is called a dopamine loop — it's involuntary and very common. " +
                            "Aurelo's app timer is the fix: set 45 min on {top_app} right now."
                ),
                InsightText(
                    title = "🔁 Rapid pickups flagged — your first loop detection",
                    body  = "The check-in loop is the most common phone habit Aurelo catches in week one. " +
                            "It's not a willpower failure — it's how these apps are designed. Block them structurally."
                )
            ),
            TemplateVariant.ESTABLISHED to listOf(
                InsightText(
                    title = "🔁 Loop detected — unusual given your {data_window_days}-day trend",
                    body  = "Dopamine loops have been rare in your recent history. " +
                            "This one on {top_app} suggests a stress or boredom trigger today. " +
                            "Block the app and check in with what's actually going on."
                ),
                InsightText(
                    title = "🔁 {top_app} loop — above your personal baseline",
                    body  = "Your {data_window_days}-day data shows you normally control {top_app} well. " +
                            "Today's loop is an anomaly. " +
                            "A Mindful Pause session now addresses the underlying trigger more than just blocking the app."
                )
            )
        ),

        // ── 17. FOCUS_PEAK_TIME [NEW v1.2.1] ─────────────────────────────
        "FOCUS_PEAK_TIME" to mapOf(
            TemplateVariant.ENCOURAGING to listOf(
                InsightText(
                    title = "⏱ Your best focus window",
                    body  = "Based on your usage pattern, your lowest-distraction window is typically 10 AM–12 PM — " +
                            "that's when pickups are fewest and screen time hasn't built up yet. " +
                            "Your first use today was at {first_use_hour}:00. " +
                            "Schedule your most demanding focus sessions here for best results."
                ),
                InsightText(
                    title = "⏱ When focus is easiest",
                    body  = "Morning hours — before your pickup rate climbs — are your clearest window. " +
                            "First use at {first_use_hour}:00 sets the baseline. " +
                            "Every hour you delay opening your phone extends that focused window. " +
                            "Try a Deep session between 9–11 AM tomorrow."
                )
            ),
            TemplateVariant.CAUTIONARY to listOf(
                InsightText(
                    title = "⏱ Finding your focus window",
                    body  = "Your pickup count climbs through the day — today {pickups_today} pickups suggests attention " +
                            "has been scattered. Your clearest window is usually first thing in the morning before social apps pull you in. " +
                            "First use was at {first_use_hour}:00. " +
                            "Tomorrow: delay first use to 9 AM and start a focus session before checking anything else."
                )
            ),
            TemplateVariant.CELEBRATORY to listOf(
                InsightText(
                    title = "⏱ You've found your rhythm",
                    body  = "First use at {first_use_hour}:00 and {focus_score} focus score — your morning window is working. " +
                            "Your {streak_days}-day streak shows consistency in protecting that early focus time. " +
                            "Keep scheduling your hardest tasks in the 9 AM–12 PM slot."
                )
            ),
            TemplateVariant.NEW_USER to listOf(
                InsightText(
                    title = "⏱ Finding your focus window",
                    body  = "Aurelo is still learning your patterns — after a few more days it can pinpoint your sharpest hours. " +
                            "A good starting point: try your first focus session before 10 AM tomorrow and see how it feels."
                )
            ),
            TemplateVariant.ESTABLISHED to listOf(
                InsightText(
                    title = "⏱ Your peak focus window",
                    body  = "Over {data_window_days} days your data shows your lowest-distraction hours are in the late morning. " +
                            "Pickups hit their daily minimum between 9–11 AM for you. " +
                            "Block that window for deep work — your Focus Score of {focus_score} will benefit most from protecting it."
                )
            )
        ),

        // ── 18. FEATURE_EXPLANATION [NEW v1.2.1] ──────────────────────────
        "FEATURE_EXPLANATION" to mapOf(
            TemplateVariant.ENCOURAGING to listOf(
                InsightText(
                    title = "✦ How Aurelo works",
                    body  = "Aurelo Score (0–100) combines three pillars: Screen (40%) + Focus (35%) + Sleep (25%). " +
                            "Excellent = 85+, Good = 70+, Fair = 55+. " +
                            "Screen Score: goal adherence (50%), pickup count (30%), first-use time (20%). " +
                            "Focus Score: sessions completed, app timers, mindful pauses. " +
                            "Sleep Score (Pro): bedtime adherence minus snoozes and blocked-app attempts. " +
                            "Streak: consecutive days under your daily goal. " +
                            "Mindful Pause: a 10-second intention check before a chosen app opens. " +
                            "Ask me about any specific feature for more detail."
                )
            ),
            TemplateVariant.CAUTIONARY to listOf(
                InsightText(
                    title = "✦ Aurelo features explained",
                    body  = "Your Aurelo Score ({aurelo_score}) combines Screen ({screen_score}), Focus ({focus_score}), and Sleep ({sleep_score}). " +
                            "The fastest way to move your score: " +
                            "delay morning first-use to 9 AM (+20 Screen pts), " +
                            "complete one focus session (+Focus), " +
                            "and keep Bedtime Mode on tonight (+Sleep). " +
                            "Ask me anything about how a specific part works."
                )
            ),
            TemplateVariant.NEW_USER to listOf(
                InsightText(
                    title = "✦ Welcome to Aurelo Coach",
                    body  = "Aurelo tracks your screen time, pickup count, focus sessions, and bedtime routine — " +
                            "then combines them into a single Aurelo Score (0–100). " +
                            "Excellent = 85+. Your goal right now: set a daily screen time goal, try one focus session, " +
                            "and let Aurelo build a {data_window_days}-day baseline. Ask me anything along the way."
                )
            ),
            TemplateVariant.ESTABLISHED to listOf(
                InsightText(
                    title = "✦ Your Aurelo system",
                    body  = "After {data_window_days} days Aurelo has a complete picture. " +
                            "Your Aurelo Score ({aurelo_score}) is driven most by your Screen pillar ({screen_score}) right now. " +
                            "Revenge procrastination = using your phone late at night to reclaim personal time, at the cost of sleep. " +
                            "HRV = Heart Rate Variability, a Health Connect signal that reflects recovery quality. " +
                            "Any other concept you'd like explained?"
                )
            )
        ),

        // ── 19. GOAL_SETTING_ADVICE [NEW v1.2.1] ──────────────────────────
        "GOAL_SETTING_ADVICE" to mapOf(
            TemplateVariant.ENCOURAGING to listOf(
                InsightText(
                    title = "🎯 Your goal looks well-matched",
                    body  = "Your current goal is {goal_minutes} min/day and your 7-day average is {avg_minutes} min — " +
                            "that's a healthy margin. Staying 10–20% under goal is the sweet spot: challenging enough to build the habit, " +
                            "achievable enough to protect the streak. " +
                            "You can tighten it in Settings → Daily Goal when you're ready for the next level."
                )
            ),
            TemplateVariant.CAUTIONARY to listOf(
                InsightText(
                    title = "🎯 Your goal may need adjusting",
                    body  = "Your 7-day average ({avg_minutes} min) is significantly above your {goal_minutes} min goal — " +
                            "that gap makes it hard to build a consistent streak. " +
                            "Consider stepping up to a more achievable goal first, then tightening it over 2–3 weeks. " +
                            "Change it in Settings → Daily Goal. Small wins compound."
                ),
                InsightText(
                    title = "🎯 Goal gap is wide",
                    body  = "Your goal ({goal_minutes} min) vs average ({avg_minutes} min) suggests the current target is too aggressive. " +
                            "A goal you hit 80% of days builds better habits than one you miss 80% of days. " +
                            "Try raising it 20% and tightening it monthly as your streak grows."
                )
            ),
            TemplateVariant.CELEBRATORY to listOf(
                InsightText(
                    title = "🎯 Time to raise the bar",
                    body  = "You're consistently under your {goal_minutes} min goal — {streak_days}-day streak proves it. " +
                            "Your 7-day average ({avg_minutes} min) is well below goal. " +
                            "You're ready to tighten the goal. Drop it by 15–20 min and see if the streak holds. " +
                            "Settings → Daily Goal."
                )
            ),
            TemplateVariant.NEW_USER to listOf(
                InsightText(
                    title = "🎯 Choosing your first goal",
                    body  = "A good starting goal is your current average minus 10%. " +
                            "After {data_window_days} days Aurelo has a rough baseline: {avg_minutes} min/day. " +
                            "Start with {goal_minutes} min and review it in 2 weeks once you've built the habit. " +
                            "Settings → Daily Goal."
                )
            ),
            TemplateVariant.ESTABLISHED to listOf(
                InsightText(
                    title = "🎯 Goal review after {data_window_days} days",
                    body  = "{data_window_days} days of data shows your average is {avg_minutes} min/day vs your {goal_minutes} min goal. " +
                            "Recommendation: " +
                            "if your streak is 7+ days, tighten by 15 min. " +
                            "If you've broken the streak 3+ times this month, loosen by 15 min. " +
                            "The goal should feel just slightly out of reach — not impossible."
                )
            )
        ),

        // ── 20. APP_DEEP_DIVE [NEW v1.2.1] ────────────────────────────────
        "APP_DEEP_DIVE" to mapOf(
            TemplateVariant.ENCOURAGING to listOf(
                InsightText(
                    title = "📱 Your top app: {top_app}",
                    body  = "{top_app} is your most-used app this period in the {top_category} category. " +
                            "Total screen time today: {today_minutes} min. " +
                            "For a full per-app breakdown, go to Wellness → Today → All Apps. " +
                            "Adding a Mindful Pause or App Timer on {top_app} is the fastest way to directly cut time on it."
                )
            ),
            TemplateVariant.CAUTIONARY to listOf(
                InsightText(
                    title = "📱 {top_app} is leading your usage",
                    body  = "{top_app} ({top_category}) is your most-used app this period — " +
                            "it's contributing a significant share of your {today_minutes} min total. " +
                            "An App Timer limits it to a daily cap; a Mindful Pause adds a 10-second intention check before it opens. " +
                            "Go to Focus → App Timers or Focus → Mindful Pause to set one up."
                ),
                InsightText(
                    title = "📱 Breaking down your {top_category} time",
                    body  = "Your top category is {top_category}, led by {top_app}. " +
                            "You've done {pickups_today} pickups today — many of these likely land on {top_app}. " +
                            "A Mindful Pause on {top_app} adds friction before the auto-open loop kicks in. " +
                            "Find it in Focus → Mindful Pause."
                )
            ),
            TemplateVariant.CELEBRATORY to listOf(
                InsightText(
                    title = "📱 Your app usage is balanced",
                    body  = "Your top app ({top_app}) is in the {top_category} category, and with only {today_minutes} min today " +
                            "you're well under goal. Your {streak_days}-day streak shows you've got a healthy relationship with your apps. " +
                            "Keep an eye on the Wellness → All Apps panel to catch any creeping usage."
                )
            ),
            TemplateVariant.NEW_USER to listOf(
                InsightText(
                    title = "📱 Getting to know your apps",
                    body  = "Aurelo is tracking your app usage — after {data_window_days} more days it'll have a clearer per-app breakdown. " +
                            "Your top app so far is {top_app}. " +
                            "Check Wellness → Today → All Apps for the full list."
                )
            ),
            TemplateVariant.ESTABLISHED to listOf(
                InsightText(
                    title = "📱 {data_window_days}-day app pattern",
                    body  = "Over {data_window_days} days {top_app} has consistently led your {top_category} usage. " +
                            "For the full monthly breakdown — including peak days and morning/afternoon/evening/late-night splits — " +
                            "check Wellness → Month → App DNA. " +
                            "Your App DNA share card is also available there."
                )
            )
        ),

        // ── 16. GENERAL_SUMMARY ───────────────────────────────────────────
        "GENERAL_SUMMARY" to mapOf(
            TemplateVariant.ENCOURAGING to listOf(
                InsightText(
                    title = "✦ Today at a glance",
                    body  = "Score {aurelo_score} · {streak_days}-day streak · {today_minutes} min vs {goal_minutes} min goal. " +
                            "You're on track. Keep your current pace through the evening."
                ),
                InsightText(
                    title = "✦ Your Aurelo summary",
                    body  = "Screen {screen_score} · Focus {focus_score} · Sleep {sleep_score}. " +
                            "No urgent pattern today — just keep doing what's working."
                ),
                InsightText(
                    title = "✦ All signals — your {weekday} overview",
                    body  = "Score {aurelo_score}, {streak_days} days, {today_minutes} min used. " +
                            "Health Connect shows {steps_today} steps and HRV at {hrv_ms} ms. " +
                            "A solid {weekday} shaping up.",
                    hcBased = true
                )
            ),
            TemplateVariant.CAUTIONARY to listOf(
                InsightText(
                    title = "✦ Check-in: today needs attention",
                    body  = "Score {aurelo_score} · {today_minutes} min used of {goal_minutes} goal · {pickups_today} pickups. " +
                            "You're on the high side today. One focused hour changes the summary."
                ),
                InsightText(
                    title = "✦ Daily summary — one area to watch",
                    body  = "{streak_days}-day streak intact, but screen time is tracking above average. " +
                            "Your Focus Score could use a session — your Screen Score needs restraint this evening."
                ),
                InsightText(
                    title = "✦ Data summary — attention required",
                    body  = "Score {aurelo_score} with {today_minutes} min used. " +
                            "HRV at {hrv_ms} ms is {hrv_delta}% below average — a rest-and-reduce day is the right call.",
                    hcBased = true
                )
            ),
            TemplateVariant.CELEBRATORY to listOf(
                InsightText(
                    title = "✦ Strong summary — {streak_days} days and counting",
                    body  = "Score {aurelo_score} · Screen {screen_score} · Focus {focus_score} · Sleep {sleep_score}. " +
                            "This is the summary you want to see. {streak_days} days is real consistency."
                ),
                InsightText(
                    title = "✦ Best weekly average this month",
                    body  = "Every pillar is above your monthly average this week. " +
                            "Your habits are compounding — this is what a {streak_days}-day streak produces."
                )
            ),
            TemplateVariant.NEW_USER to listOf(
                InsightText(
                    title = "✦ Early summary — you're building the baseline",
                    body  = "Score {aurelo_score} in your first days. " +
                            "Aurelo needs about 7 days to learn your patterns — every data point improves the insights."
                ),
                InsightText(
                    title = "✦ Daily snapshot — week one",
                    body  = "{today_minutes} min today vs {goal_minutes} min goal. " +
                            "The goal is just awareness for now — the habit builds over the next 3 weeks."
                )
            ),
            TemplateVariant.ESTABLISHED to listOf(
                InsightText(
                    title = "✦ {data_window_days}-day view — your personal baseline",
                    body  = "Score {aurelo_score} vs your {data_window_days}-day average. " +
                            "Steps {steps_today}, HRV {hrv_ms} ms, sleep {sleep_hours}h — all within your established range.",
                    hcBased = true
                ),
                InsightText(
                    title = "✦ Established user summary — {data_window_days} days of data",
                    body  = "Screen {screen_score} · Focus {focus_score} · Sleep {sleep_score} · Body score active. " +
                            "At {data_window_days} days, your coaching is now personalised to your specific patterns."
                )
            )
        )
    )

    // ═══════════════════════════════════════════════════════════════════════
    // Public API
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Select a template for the given intent, variant, and state.
     * When multiple templates exist for a variant, picks based on hcConnected
     * and rotates on day-of-week to avoid repetition.
     *
     * @param intent          One of the 16 intent label strings
     * @param variant         Tone/history variant
     * @param summary         UsageSummary — used for HC availability and day-of-week rotation
     * @param rotationIndex   Caller-supplied index (0–2) to cycle through same-variant templates
     */
    fun select(
        intent: String,
        variant: TemplateVariant,
        summary: UsageSummary,
        rotationIndex: Int = 0
    ): InsightText {
        val intentMap = templates[intent] ?: templates["GENERAL_SUMMARY"]!!
        val allForIntent = intentMap.values.flatten()

        if (allForIntent.isEmpty()) return fallbackGeneralSummary()

        val exactVariantEligible = intentMap[variant].orEmpty()
            .filter { it.isEligible(summary) }

        val encouragingEligible = intentMap[TemplateVariant.ENCOURAGING].orEmpty()
            .filter { it.isEligible(summary) }

        val anyVariantEligible = allForIntent
            .filter { it.isEligible(summary) }

        val nonHcExactFallback = intentMap[variant].orEmpty()
            .filter { !it.hcBased }

        val nonHcEncouragingFallback = intentMap[TemplateVariant.ENCOURAGING].orEmpty()
            .filter { !it.hcBased }

        val finalPool = when {
            exactVariantEligible.isNotEmpty() -> exactVariantEligible
            encouragingEligible.isNotEmpty() -> encouragingEligible
            anyVariantEligible.isNotEmpty() -> anyVariantEligible
            nonHcExactFallback.isNotEmpty() -> nonHcExactFallback
            nonHcEncouragingFallback.isNotEmpty() -> nonHcEncouragingFallback
            else -> allForIntent.filter { !it.hcBased }.ifEmpty { allForIntent }
        }

        val sorted = finalPool.sortedByDescending { it.effectivePriority() }
        return sorted[rotationIndex.mod(sorted.size)]
    }

    private fun fallbackGeneralSummary(): InsightText = InsightText(
        title = "✦ Your Aurelo summary",
        body = "I can help with your screen time, pickups, focus sessions, bedtime routine, streaks, and Health Connect patterns.",
        variant = TemplateVariant.ENCOURAGING
    )

    private fun InsightText.effectivePriority(): Int {
        var score = priority
        if (!hcBased) score += 2
        if (requiredSignals.isNotEmpty()) score += 1
        if (requiredConditions.isNotEmpty()) score += 2
        return score
    }

    private fun InsightText.isEligible(summary: UsageSummary): Boolean {
        val neededSignals = requiredSignals + inferredRequiredSignals()
        val neededConditions = requiredConditions + inferredRequiredConditions()

        if (neededSignals.isEmpty() && neededConditions.isEmpty()) {
            return !hcBased || summary.hcConnected
        }

        val hasHrv = summary.hrvToday != null && summary.hrv7DayAvg != null && summary.hrv7DayAvg > 0f
        val hasSleep = summary.sleepDurationMinutes != null && summary.sleepDurationMinutes > 0
        val hasSteps = summary.stepsToday != null && summary.stepsToday > 0
        val hasRhr = summary.restingHeartRate != null && summary.rhr7DayAvg != null && summary.rhr7DayAvg > 0f
        val hasMindfulness = summary.externalMindfulnessMinutesToday != null && summary.externalMindfulnessMinutesToday > 0

        val signalOk = neededSignals.all { signal ->
            when (signal) {
                HcSignal.HRV -> hasHrv
                HcSignal.SLEEP -> hasSleep
                HcSignal.STEPS -> hasSteps
                HcSignal.RHR -> hasRhr
                HcSignal.MINDFULNESS -> hasMindfulness
            }
        }
        if (!signalOk) return false

        return neededConditions.all { condition ->
            when (condition) {
                TemplateCondition.HRV_LOW ->
                    hasHrv && summary.hrvToday!! < summary.hrv7DayAvg!! * 0.95f
                TemplateCondition.HRV_NORMAL ->
                    hasHrv && summary.hrvToday!! >= summary.hrv7DayAvg!! * 0.95f
                TemplateCondition.SLEEP_LOW ->
                    hasSleep && summary.sleepDurationMinutes!! < 420
                TemplateCondition.SLEEP_NORMAL ->
                    hasSleep && summary.sleepDurationMinutes!! >= 420
                TemplateCondition.STEPS_HIGH ->
                    hasSteps && summary.stepsToday!! >= 8000
                TemplateCondition.STEPS_LOW ->
                    hasSteps && summary.stepsToday!! < 8000
                TemplateCondition.SCORE_AVAILABLE ->
                    summary.aureloScore > 0
                TemplateCondition.PICKUP_AVG_AVAILABLE ->
                    summary.pickups7DayAvg > 0f
                TemplateCondition.SOCIAL_CATEGORY_AVAILABLE -> {
                    // FIX: now that topCategory carries the canonical multi-word
                    // value ("Social & Communication") we accept either.
                    val c = summary.topCategory.lowercase()
                    c == "social" ||
                        c == Categories.SOCIAL.lowercase() ||
                        c.startsWith("social ")
                }
            }
        }
    }

    private fun InsightText.inferredRequiredSignals(): Set<HcSignal> {
        if (!hcBased) return emptySet()
        val text = "$title $body".lowercase()
        val out = mutableSetOf<HcSignal>()
        if (text.contains("hrv") || text.contains("heart rate variability") || text.contains("{hrv_")) out += HcSignal.HRV
        if (text.contains("sleep") || text.contains("slept") || text.contains("bedtime") || text.contains("{sleep_")) out += HcSignal.SLEEP
        if (text.contains("step") || text.contains("active day") || text.contains("activity") || text.contains("{steps_")) out += HcSignal.STEPS
        if (text.contains("resting heart") || text.contains("{rhr_")) out += HcSignal.RHR
        if (text.contains("mindfulness") || text.contains("{external_mindfulness") || text.contains("{mindfulness_source}")) out += HcSignal.MINDFULNESS
        return out
    }

    private fun InsightText.inferredRequiredConditions(): Set<TemplateCondition> {
        if (!hcBased) return emptySet()
        val text = "$title $body".lowercase()
        val out = mutableSetOf<TemplateCondition>()

        val mentionsHrv = text.contains("hrv") || text.contains("heart rate variability") || text.contains("{hrv_")
        val lowHrvClaim = mentionsHrv && (
                text.contains("low hrv") ||
                        text.contains("hrv low") ||
                        text.contains("below your average") ||
                        text.contains("below average") ||
                        text.contains("below your 7-day average") ||
                        text.contains("suppresses recovery") ||
                        text.contains("confirms the strain") ||
                        text.contains("recovery is needed")
                )
        val normalHrvClaim = mentionsHrv && (
                text.contains("near your") ||
                        text.contains("within your") ||
                        text.contains("all within") ||
                        text.contains("strong hrv") ||
                        text.contains("everything aligned")
                )
        if (lowHrvClaim) out += TemplateCondition.HRV_LOW
        if (normalHrvClaim) out += TemplateCondition.HRV_NORMAL

        val sleepClaim = text.contains("sleep") || text.contains("slept") || text.contains("{sleep_")
        if (sleepClaim && (text.contains("short sleep") || text.contains("poor sleep") || text.contains("below target") || text.contains("sleep debt") || text.contains("under-slept"))) out += TemplateCondition.SLEEP_LOW
        if (sleepClaim && (text.contains("7.0h") || text.contains("within your established range"))) out += TemplateCondition.SLEEP_NORMAL

        val stepsClaim = text.contains("step") || text.contains("active day") || text.contains("activity") || text.contains("{steps_")
        if (stepsClaim && (text.contains("active day") || text.contains("8,000") || text.contains("8000") || text.contains("good step"))) out += TemplateCondition.STEPS_HIGH

        if (text.contains("{pickups_avg}")) out += TemplateCondition.PICKUP_AVG_AVAILABLE
        if (text.contains("{aurelo_score}") || text.contains("score {aurelo_score}")) out += TemplateCondition.SCORE_AVAILABLE
        return out
    }

    /**
     * Infer the best TemplateVariant given the current UsageSummary.
     * Callers may override this and pass a variant directly to [select].
     */
    fun inferVariant(summary: UsageSummary): TemplateVariant {
        // FIX: if streak > 7, the user is established regardless of dataWindowDays
        // (covers reinstalls, data migrations — avoids patronising "first week" copy)
        val effectivelyEstablished = summary.dataWindowDays >= 30 || summary.streakDays > 7

        return when {
            summary.dataWindowDays < 3                                    -> TemplateVariant.NEW_USER
            effectivelyEstablished && summary.dataWindowDays >= 30        -> TemplateVariant.ESTABLISHED
            summary.streakDays in listOf(7, 14, 21, 30)                  -> TemplateVariant.CELEBRATORY
            // FIX: worsening 3-day trend overrides ENCOURAGING even if today is under goal
            summary.todayMinutes < summary.dailyGoalMinutes &&
                    !isWorseningTrend(summary)                            -> TemplateVariant.ENCOURAGING
            summary.dataWindowDays < 7                                    -> TemplateVariant.NEW_USER
            else                                                           -> TemplateVariant.CAUTIONARY
        }
    }

    /** Returns true if the last 3 days of screen time are trending upward. */
    private fun isWorseningTrend(summary: UsageSummary): Boolean {
        val days = summary.screenTime7Day.filter { it.minutes > 0 }.takeLast(3)
        if (days.size < 3) return false
        return days[2].minutes > days[1].minutes && days[1].minutes > days[0].minutes
    }

    /**
     * Fill all slot variables in an InsightText with real values from UsageSummary.
     * Returns a new InsightText with both title and body fully resolved.
     * Unknown slots are left as-is so missing data is visible during QA.
     */
    fun fillSlots(template: InsightText, summary: UsageSummary): InsightText {
        fun safeScore(score: Int): String = if (score > 0) score.toString() else "still calculating"
        fun safePickupAvg(avg: Float): String = if (avg > 0f) avg.toInt().toString() else "still building"
        fun safeTopCategory(category: String): String = category.ifBlank { "your top category" }
            .lowercase()
            .replaceFirstChar { it.uppercase() }
        fun hrvDeltaText(): String {
            val h = summary.hrvToday
            val avg = summary.hrv7DayAvg
            if (h == null || avg == null || avg <= 0f) return "not available"
            val pct = (((avg - h) / avg) * 100f).toInt()
            return pct.coerceAtLeast(0).toString()
        }

        fun String.fill(): String {
            var s = this

            // ── Screen / Aurelo slots ────────────────────────────────────
            s = s.replace("{streak_days}",       summary.streakDays.toString())
            s = s.replace("{goal_hours}",         (summary.dailyGoalMinutes / 60).toString())
            s = s.replace("{goal_minutes}",       summary.dailyGoalMinutes.toString())
            s = s.replace("{today_minutes}",      summary.todayMinutes.toString())
            s = s.replace("{avg_minutes}",        summary.screenTime7Day
                .filter { it.minutes > 0 }
                .let { if (it.isEmpty()) 0 else it.sumOf { d -> d.minutes } / it.size }
                .toString())
            s = s.replace("{pickups_today}",      summary.pickupsToday.toString())
            s = s.replace("{pickups_avg}",        safePickupAvg(summary.pickups7DayAvg))
            s = s.replace("{first_use_hour}",     summary.firstUseHour.toString())
            s = s.replace("{aurelo_score}",       safeScore(summary.aureloScore))
            s = s.replace("{screen_score}",       safeScore(summary.screenScore))
            s = s.replace("{focus_score}",        safeScore(summary.focusScore))
            s = s.replace("{sleep_score}",        safeScore(summary.sleepScore))
            s = s.replace("{score_drop}",
                (summary.aureloScoreYesterday - summary.aureloScore).coerceAtLeast(0).toString())
            s = s.replace("{focus_days_ago}",     summary.daysSinceLastFocus.toString())
            s = s.replace("{top_app}",            summary.topApps.firstOrNull()?.label ?: "your top app")
            s = s.replace("{top_category}",       safeTopCategory(summary.topCategory))
            s = s.replace("{data_window_days}",   summary.dataWindowDays.toString())
            s = s.replace("{focus_session_type}", "Gentle")   // default; callers may override

            // Spike slots — derived from 7-day list
            val worst = summary.screenTime7Day.maxByOrNull { it.minutes }
            val weekAvg = summary.screenTime7Day
                .filter { it.minutes > 0 }
                .let { if (it.isEmpty()) 0 else it.sumOf { d -> d.minutes } / it.size }
            val spikePct = if (weekAvg > 0)
                ((worst?.minutes ?: 0) - weekAvg) * 100 / weekAvg else 0
            s = s.replace("{spike_day}",          worst?.dateLabel ?: "one day")
            s = s.replace("{spike_minutes}",      (worst?.minutes ?: 0).toString())
            s = s.replace("{week_avg_minutes}",   weekAvg.toString())
            s = s.replace("{screen_delta}",       spikePct.toString())
            s = s.replace("{day_label}",          worst?.dateLabel ?: "that day")

            // Weekday label placeholder — callers should pass the real weekday
            // s = s.replace("{weekday}", ...) — resolved by CoachOrchestrator

            // ── Health Connect slots ─────────────────────────────────────
            if (summary.hcConnected) {
                s = s.replace("{hrv_delta}",    hrvDeltaText())
                s = s.replace("{hrv_ms}",       summary.hrvToday?.let { String.format("%.1f", it) } ?: "—")
                s = s.replace("{hrv_avg_ms}",   summary.hrv7DayAvg?.let { String.format("%.1f", it) } ?: "—")

                val sleepH = summary.sleepDurationMinutes?.div(60f)
                val sleepAvgH = summary.sleepDuration7DayAvg?.div(60f)
                s = s.replace("{sleep_hours}",      sleepH?.let { String.format("%.1f", it) } ?: "—")
                s = s.replace("{sleep_7day_avg}",   sleepAvgH?.let { String.format("%.1f", it) } ?: "—")

                s = s.replace("{steps_today}",    summary.stepsToday?.let { it.toLocaleString() } ?: "—")
                s = s.replace("{steps_7day_avg}", summary.steps7DayAvg?.let { it.toInt().toLocaleString() } ?: "—")

                s = s.replace("{rhr_today}",      summary.restingHeartRate?.toString() ?: "—")

                s = s.replace("{mindfulness_source}",
                    summary.externalMindfulnessMinutesToday
                        ?.let { "your mindfulness app" } ?: "an external app")
                s = s.replace("{external_mindfulness_min}",
                    summary.externalMindfulnessMinutesToday?.toString() ?: "0")
            } else {
                // Strip HC slots gracefully when not connected
                listOf("{hrv_delta}", "{hrv_ms}", "{hrv_avg_ms}", "{sleep_hours}",
                    "{sleep_7day_avg}", "{steps_today}", "{steps_7day_avg}",
                    "{rhr_today}", "{mindfulness_source}", "{external_mindfulness_min}")
                    .forEach { slot -> s = s.replace(slot, "—") }
            }

            s = s
                .replace("your 7-day average is still building×", "your recent pickup average is still being built")
                .replace("still building×", "still building")
                .replace("Screen still calculating · Focus still calculating · Sleep still calculating", "Your score breakdown is still being built")
                .replace("0% below", "near")
                .replace("0% above", "near")
                .replace("1 days", "1 day")
                .replace("  ", " ")

            return s
        }

        return template.copy(title = template.title.fill(), body = template.body.fill())
    }

    // ── Backward-compatible entry point (used by CoachInsightWorker) ────────

    /**
     * Legacy single-template lookup — kept for CoachInsightWorker compatibility.
     * New callers should use [select] + [fillSlots] directly.
     */
    fun get(pattern: PatternResult, summary: UsageSummary): InsightText {
        val variant = inferVariant(summary)
        val raw     = select(pattern.intent, variant, summary)
        return fillSlots(raw, summary)
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private fun Int.toLocaleString(): String = String.format("%,d", this)

    // ── Notification channel constants ───────────────────────────────────────
    const val NOTIFICATION_CHANNEL_ID   = "aurelo_coach_insights"
    const val NOTIFICATION_CHANNEL_NAME = "Aurelo Coach Insights"
    const val NOTIFICATION_ID           = 8001
}