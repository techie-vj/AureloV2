/**
 * pro-upsell.js — Aurelo upsell bottom sheet
 *
 * Drop into assets/www/ alongside pro-gate.js.
 * Load AFTER pro-gate.js in index.html.
 *
 * Improvements over v1:
 *   1. Personalised data stat callout — shows user's real numbers in the sheet
 *   2. Free trial line below CTA — "7 days free · then $X/year · cancel anytime"
 *   3. Inline pricing in CTA button text where relevant
 *   4. Social proof line in footer
 *   5. Outcome-led copy rewrites across all features
 *
 * Exposes: window.ProUpsell
 *   ProUpsell.show('focus_unlimited', 'work')  // open sheet
 *   ProUpsell.hide()                           // close sheet
 *   ProUpsell.onBillingError(message)          // show error in sheet
 *   ProUpsell.showRestoring()                  // show restore spinner
 *   ProUpsell.showRestoreNotFound()            // show "no purchase found"
 *   ProUpsell.triggerRestoreWelcome()          // show "welcome back" snackbar
 *   ProUpsell.consumePendingWelcome()          // consume deferred snackbar (called by app-core)
 */

(function(window) {
  'use strict';

  // ── PERSONALISED DATA ─────────────────────────────────────────
  // Pulls one live data point from the current session to inject into the sheet.
  // Returns null if the data isn't available (demo mode / no permission granted).
  // Each COPY entry optionally defines a dataStat key to identify which stat to show.
  function _getSessionStat(key) {
    try {
      switch (key) {
        case 'screen_time': {
          const mins = (typeof TODAY_MINS !== 'undefined' && TODAY_MINS > 0) ? TODAY_MINS : 0;
          if (!mins) return null;
          const h = Math.floor(mins / 60), m = mins % 60;
          return (h > 0 ? h + 'h ' + m + 'm' : m + 'm') + ' on your phone today';
        }
        case 'pickups': {
          const p = (typeof PICKUPS !== 'undefined' && PICKUPS > 0) ? PICKUPS : 0;
          return p > 0 ? p + ' phone pickups today' : null;
        }
        case 'streak': {
          const s = (typeof IS_NATIVE !== 'undefined' && IS_NATIVE &&
                     typeof N !== 'undefined' && N.getStreakDays)
            ? N.getStreakDays() : 0;
          return s > 0 ? s + '-day streak — keep it going' : null;
        }
        case 'top_app': {
          const top = (typeof DAILY_USE !== 'undefined' && DAILY_USE.length > 0) ? DAILY_USE[0] : null;
          if (!top) return null;
          const h = Math.floor(top.totalMinutes / 60), m = top.totalMinutes % 60;
          const t = h > 0 ? h + 'h ' + m + 'm' : m + 'm';
          return t + ' on ' + top.name + ' today';
        }
        case 'ghost_count': {
          const g = (typeof GHOSTS !== 'undefined') ? GHOSTS.length : 0;
          return g > 0 ? g + ' unused app' + (g === 1 ? '' : 's') + ' on your phone' : null;
        }
        default: return null;
      }
    } catch(_) { return null; }
  }

  // ── UPSELL COPY ───────────────────────────────────────────────
  // dataStat: key passed to _getSessionStat() — shown as a highlighted callout
  //           above the body copy when the data is available.
  const COPY = {
    home_insight: {
      tag: 'Pro Insight',
      headline: 'Know what your screen time actually means.',
      body: 'Numbers alone don\'t change habits. Pro unlocks a daily contextual insight above your stats — telling you if today is better or worse than your average, and why it matters.',
      dataStat: 'screen_time',
      cta: 'Unlock Daily Insights',
      dismiss: 'Not now',
    },
    focus_unlimited: {
      tag: 'Unlimited Focus',
      headline: 'Want to block more apps?',
      body: 'Most people who build real focus habits block 5–7 apps per mode, not 3. Go Pro to remove the ceiling entirely and design a focus environment that actually works for you.',
      dataStat: 'pickups',
      cta: 'Unlock unlimited · from $1.67/mo',
      dismiss: 'Not now',
      variants: {
        work: {
          headline: 'Three apps blocked. Still distracted?',
          body: 'Deep focus usually means blocking more than 3. Pro removes the ceiling so you can block every app that pulls you away — social, news, games, all of it.',
          cta: 'Go Pro · Unlock unlimited',
          dismiss: 'Keep 3 for now',
        },
      },
    },
    focus_schedule: {
      tag: 'Focus Scheduling',
      headline: 'Stop relying on willpower to focus.',
      body: 'Set recurring focus sessions — like "Weekdays 9–11 AM" — and Aurelo activates the mode automatically. The apps that steal your attention get blocked before you even think to open them.',
      bullets: [
        'Recurring daily or weekly schedules',
        'Unlimited apps per mode',
        'Focus session history + streaks',
      ],
      cta: 'Unlock Focus Scheduling',
      dismiss: 'Maybe later',
    },
    focus_history: {
      tag: 'Focus History',
      headline: 'Are your focus habits building or slipping?',
      body: 'Track your weekly time-in-focus, session count, and streaks over time. You can\'t improve what you can\'t see — Pro shows you the full picture.',
      dataStat: 'streak',
      cta: 'Unlock Focus History',
      dismiss: 'Not now',
    },
    weekly_challenge: {
      tag: 'Weekly Challenge',
      headline: 'A new goal every Monday, built around your patterns.',
      body: 'Pro users get weekly challenges personalised to their real usage — not generic tips, but specific targets based on where your screen time actually goes.',
      dataStat: 'screen_time',
      cta: 'Join Weekly Challenges',
      dismiss: 'Maybe later',
    },
    monthly_depth: {
      tag: 'Monthly Deep Dive',
      headline: 'Are your habits actually improving over time?',
      body: 'A single day tells you nothing. The monthly calendar, App DNA review, and streak heatmap show whether your screen time is trending down — or just fluctuating.',
      dataStat: 'screen_time',
      cta: 'Unlock Monthly View',
      dismiss: 'Not now',
    },
    history_depth: {
      tag: 'Extended History',
      headline: 'Your patterns only show up over weeks.',
      body: 'Sort All Apps by Week or Month to find the apps that are quietly taking more and more of your time. Free users see today only — Pro shows you the trend.',
      dataStat: 'top_app',
      cta: 'Unlock History',
      dismiss: 'Not now',
    },
    unlimited_apps_list: {
      tag: 'Full App List',
      headline: 'See every app, not just your top 6.',
      body: 'Pro unlocks the full ranked list — every app you used today, with exact time and session count. The ones hiding outside the top 6 are often the most surprising.',
      dataStat: 'top_app',
      cta: 'Unlock Full List',
      dismiss: 'Not now',
    },
    categories: {
      tag: 'Pro Categories',
      headline: 'Organise your apps the way your brain works.',
      body: 'Unlimited custom categories, Play Store sync, and per-app overrides. Free users get auto-generated categories — Pro users decide what counts as productive.',
      cta: 'Unlock Categories',
      dismiss: 'Not now',
    },
    widget_themes: {
      tag: 'Widget Themes',
      headline: 'Your home screen, upgraded.',
      body: 'Unlock AMOLED Black, Minimal Mono, Neon Glow, Frosted Glass, and Dynamic Color — five themes designed to match your wallpaper and reduce visual noise every time you unlock.',
      cta: 'Unlock Themes',
      dismiss: 'Not now',
    },
    widget_insight: {
      tag: 'Widget Insight Bar',
      headline: 'One line that tells you where you stand.',
      body: 'The widget insight bar gives you a live daily signal — like "20% below your weekly average" — without opening the app. It turns your home screen into a habit checkpoint.',
      dataStat: 'screen_time',
      cta: 'Unlock Widget Insights',
      dismiss: 'Not now',
    },
    streak_depth: {
      tag: 'Streak Calendar',
      headline: 'See every streak day — and every break.',
      body: 'The streak calendar shows your whole month as a habit heatmap. Know exactly which days broke your streak, so you can spot the pattern and prevent it next time.',
      dataStat: 'streak',
      cta: 'Unlock Streak Calendar',
      dismiss: 'Not now',
    },
    app_mgmt: {
      tag: 'Unlimited Locks & Hides',
      headline: 'You\'ve reached the free limit.',
      body: 'Free users can lock or hide up to 3 apps. If you need more, Pro removes the ceiling — lock and hide as many as you need, no restrictions.',
      dataStat: 'pickups',
      cta: 'Go Pro · Unlock unlimited',
      dismiss: 'Keep limit for now',
    },
    timer_unlimited: {
          tag: 'Unlock All Timers',
          headline: "You've reached the free limit.",
          body: "Limit reached: 3 app timers set. Research shows managing 5–7 apps is the sweet spot for productivity. Go Pro for unlimited access.",
          cta: 'Go Pro · Unlock unlimited',
          dismiss: 'Keep limit for now',
        },
    mindful_unlimited: {
              tag: 'Total Mindful Access',
              headline: "You've reached the free limit.",
              body: "You're practicing mindfulness on 3 apps. To truly master your focus, we recommend covering your top 7 distractions. Go Pro to protect every app.",
              cta: 'Go Pro · Unlock unlimited',
              dismiss: 'Keep limit for now',
            },
    bedtime: {
      tag: 'Bedtime Mode',
      headline: 'Sleep Better, Stay Off Your Phone.',
      body: 'Set your bedtime once and Aurelo does the rest. We block 🚫 distracting apps and silence notifications automatically. No willpower needed—just better rest and a clear summary 📊 every morning.',
      dataStat: 'screen_time',
      cta: 'Unlock Bedtime Mode',
      dismiss: 'Not now',
    },
    themes: {
      tag: 'Pro Themes',
      headline: 'Make Aurelo feel like yours.',
      body: 'Unlock AMOLED Black, Warm Sand, Midnight, Forest, and Rose. Each theme is designed to reduce eye strain and give the app a feel that matches how you use your phone.',
      cta: 'Unlock All Themes',
      dismiss: 'Not now',
    },
    ad_free: {
      tag: 'Ad-Free',
      headline: 'A screen time app with ads is a contradiction.',
      body: 'Pro removes all sponsored cards from Discover. Pure signal, no noise — which is kind of the whole point of Aurelo.',
      cta: 'Go Ad-Free',
      dismiss: 'Not now',
    },
    tidy_score_pillars: {
      tag: 'Aurelo Score',
      headline: 'What\'s actually driving your score today?',
      body: 'Your Aurelo Score rolls Screen, Focus, and Sleep habits into one daily number. Pro unlocks the full per-pillar breakdown — with the specific score for each area and personalised tips on where to improve first.',
      dataStat: 'screen_time',
      cta: 'Unlock Score Breakdown',
      dismiss: 'Not now',
    },
    health_connect: {
      tag: 'Body Pillar · Pro',
      headline: 'Your Aurelo Score is missing a piece.',
      body: 'Health Connect adds a fourth pillar — Body — built from your real steps, HRV, and resting heart rate. It\'s the only signal that tells you whether a high screen day is paired with a healthy body or a depleted one.',
      bullets: [
        'Body Score from daily steps, HRV, and resting heart rate',
        'Sleep Score enhanced with overnight HRV from your wearable',
        'Focus Score boosted by mindfulness sessions from Calm or Headspace',
      ],
      dataStat: 'pickups',
      cta: 'Go Pro · Connect Health Connect',
      dismiss: 'Not now',
    },
    coach_upgrade: {
      tag: 'Aurelo Coach',
      headline: 'You\'ve used your 3 free questions today.',
      body: 'Coach analyses your screen time, pickups, focus sessions, and sleep patterns to give answers specific to your data — not generic tips. Pro removes the daily limit entirely.',
      dataStat: 'screen_time',
      cta: 'Unlock Unlimited Coach',
      dismiss: 'Maybe later',
    },
    screen_filter: {
      tag: 'Pro Scheduling',
      headline: 'Let your filter activate itself.',
      body: 'Sun-based scheduling turns the filter on at sunset and off at sunrise automatically. Custom scheduling lets you set your own start and end times. No manual switching — it just works.',
      cta: 'Unlock Scheduling',
      dismiss: 'Maybe later',
    },
    screen_filter_unlimited: {
      tag: 'Unlimited Filter Apps',
      headline: "You've reached the free limit.",
      body: 'Free users can pause the screen filter for up to 3 apps. Go Pro to add as many app exceptions as you need — camera, media players, whatever fits your workflow.',
      cta: 'Go Pro \u00b7 Unlock unlimited',
      dismiss: 'Keep limit for now',
    },
    score_history: {
      tag: 'Score History · Pro',
      headline: 'Are your habits actually improving?',
      body: 'A single day\'s score tells you almost nothing. Score History plots every pillar — Aurelo, Screen, Focus, Sleep, and Body — across 30, 90, and 365 days so you can see whether your habits are genuinely trending up or just fluctuating.',
      bullets: [
        '7-day view free · 30D, 90D, and 1Y unlocked with Pro',
        'Drag-to-scrub chart with daily score on any data point',
        'Period average, all-time best, and trend vs prior half',
      ],
      dataStat: 'streak',
      cta: 'Unlock Full Score History',
      dismiss: 'Maybe later',
    },
    upgrade_pro: {
      tag: 'Aurelo Pro',
      headline: 'Master your time, without limits.',
      body: 'Your personal AI wellness coach, body health signals, and deep habit analytics — all on-device, no accounts, no tracking.',
      bullets: [
        'Aurelo Coach — AI-powered insights that analyse your screen time, focus, sleep, and health data to explain your patterns and answer your questions, entirely on-device.',
        'Score History — Track all your score pillars over 30 or 90 days, tap any point for a full breakdown, and share your progress.',
        'Health Connect & Body Score — Connect your steps, HRV, and resting heart rate to unlock a Body Score and enrich every pillar with physical health context.',
        'Unlimited Focus Tools — No caps on Focus Mode, Mindful Pause, App Timers, App Lock, Hidden Apps, and Scheduled Routines.',
        'Bedtime Mode & Sleep Score — Automate your wind-down with app blocking, blue-light Screen Filter, and a nightly Sleep Score.',
        'Deep Habit Analytics — Monthly App DNA, calendar heatmaps, streak grids, and Weekly Challenges personalised to your usage.',
        'Pro Personalisation — Exclusive themes, unlimited custom categories with Play Store sync, and full widget themes with Insight bar.',
      ],
      cta: 'Unlock Pro',
      dismiss: 'Maybe later',
    },
  };

  // ── DOM INJECTION ─────────────────────────────────────────────
  const CSS = `
    .pu-backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.62);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      z-index: 9999;
      display: none; align-items: flex-end; justify-content: center;
      opacity: 0; transition: opacity 0.25s;
      pointer-events: none;
    }
    .pu-ready { display:flex; }
    .pu-backdrop.pu-visible {
      opacity: 1; pointer-events: all;
    }
    /* Top Right Close Button */
        .pu-close {
          position: absolute;
          top: 20px;
          right: 20px;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--s2);
          border: none;
          color: var(--t2);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 0.2s ease, transform 0.1s;
          -webkit-tap-highlight-color: transparent;
          z-index: 10;
        }
        .pu-close:active { transform: scale(0.9); background: var(--border2); }
    .pu-sheet {
      position: relative;
      /* FIX #2: add horizontal padding so content isn't edge-to-edge, matching score sheets */
      padding: 32px 20px 0;
      width: 100%; max-width: 480px;
      background: var(--s0);
      border-radius: 24px 24px 0 0;
      border: 1px solid var(--border2); border-bottom: none;
      transform: translateY(100%);
      transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1);
      box-sizing: border-box;
      will-change: transform;
      -webkit-backface-visibility: hidden; backface-visibility: hidden;
      max-height: 92vh;
      overflow-y: auto;
    }
    .pu-backdrop.pu-visible .pu-sheet {
      transform: translateY(0);
    }
    .pu-handle {
      width: 40px; height: 4px;
      background: var(--border2); border-radius: 2px;
      margin: 0 auto 20px;
    }
    .pu-tag {
      display: inline-block;
      padding: 4px 11px; border-radius: 40px;
      background: rgba(247,201,72,0.12);
      border: 1px solid rgba(247,201,72,0.25);
      color: #f7c948;
      font-size: var(--text-2xs); font-weight: 700;
      letter-spacing: 0.08em; font-family: var(--ff-m);
      margin-bottom: 14px;
    }
    .pu-headline {
      font-size: 20px; font-weight: 700;
      color: var(--t1); line-height: 1.25;
      margin-bottom: 10px; letter-spacing: -0.3px;
      font-family: var(--ff-b);
    }
    /* Personalised data callout */
    .pu-data-stat {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 14px; border-radius: 10px;
      background: rgba(108,99,255,0.10);
      border: 1px solid rgba(108,99,255,0.22);
      margin-bottom: 14px;
      animation: pgSlideIn 0.3s ease;
    }
    .pu-data-stat-icon { font-size: 16px; flex-shrink: 0; }
    .pu-data-stat-text {
      font-size: 13px; font-weight: 700; color: var(--p2);
      line-height: 1.3; font-family: var(--ff-m);
    }
    .pu-body {
      font-size: 14px; color: var(--t2);
      line-height: 1.6; margin-bottom: 16px;
      font-family: var(--ff-b);
    }
    .pu-bullets {
      list-style: none; padding: 0; margin: 0 0 18px;
      display: flex; flex-direction: column; gap: 12px;
    }
    .pu-bullets li {
      display: flex; align-items: center; gap: 10px;
      font-size: 13px; color: var(--t2); padding: 4px 0;
      font-family: var(--ff-b);
    }
    .pu-check {
      display: inline-flex; align-items: center; justify-content: center;
      width: 18px; height: 18px; border-radius: 50%;
      background: rgba(78,205,196,0.15); color: #4ecdc4;
      font-size: var(--text-2xs); font-weight: 700; flex-shrink: 0;
    }
    /* Footer */
    .pu-footer {
      margin-bottom: 18px;
      display: flex; flex-direction: column; gap: 6px;
    }
    .pu-privacy {
      font-size: var(--text-2xs); color: var(--t3);
      padding: 9px 14px;
      background: var(--s2);
      border-radius: 8px 8px 0 0;
      border: 1px solid var(--border2); border-bottom: none;
      font-family: var(--ff-m);
    }
    .pu-social-proof {
      font-size: var(--text-2xs); color: var(--t3);
      padding: 9px 14px;
      background: var(--s2);
      border-radius: 0 0 8px 8px;
      border: 1px solid var(--border2);
      display: flex; align-items: center; gap: 6px;
      font-family: var(--ff-m);
    }
    .pu-social-proof-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--g); flex-shrink: 0;
      box-shadow: 0 0 4px rgba(18,212,138,0.5);
    }
    .pu-bottom-area {
      margin-top: 20px;
      display: flex;
      flex-direction: column;
      padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 16px);
    }

        .pu-cta {
          width: 100%; padding: 18px; border-radius: 16px;
          background: linear-gradient(135deg, var(--p), var(--c));
          color: #fff; font-size: 16px; font-weight: 700;
          border: none; cursor: pointer;
          letter-spacing: 0.2px;
          transition: opacity 0.2s, transform 0.15s;
          box-shadow: 0 8px 24px rgba(108,99,255,0.25);
          font-family: var(--ff-b);
        }
        .pu-cta:active { transform: scale(0.98); }
    .pu-cta:hover { opacity: 0.9; }
    .pu-cta:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }
    .pu-cta:focus-visible {
      outline: 2px solid var(--focus-ring-color);
      outline-offset: 3px;
    }
    /* Plan picker */
    .pu-plans {
      display: flex; gap: 8px;
      margin-bottom: 14px;
    }
    .pu-plan {
          flex: 1; position: relative;
          display: flex; flex-direction: column; align-items: center;
          padding: 16px 8px 14px;
          border-radius: 16px;
          background: var(--s1);
          border: 2px solid transparent; /* Thicker, invisible border by default */
          box-shadow: inset 0 0 0 1px var(--border2); /* Inner fake border */
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
          text-align: center;
          -webkit-tap-highlight-color: transparent;
        }
        .pu-plan.pu-plan-selected {
          background: rgba(108,99,255,0.06);
          border: 2px solid var(--p);
          box-shadow: 0 4px 12px rgba(108,99,255,0.15);
          transform: translateY(-2px);
        }
    .pu-plan:hover { border-color: var(--p2); }

    .pu-plan:focus-visible {
      outline: 2px solid var(--focus-ring-color);
      outline-offset: 2px;
    }
    .pu-plan-badge {
      position: absolute; top: -9px; left: 50%; transform: translateX(-50%);
      padding: 2px 8px; border-radius: 40px;
      background: linear-gradient(135deg, var(--p), var(--p2));
      color: #fff; font-size: var(--text-2xs); font-weight: 700;
      letter-spacing: 0.06em; white-space: nowrap; font-family: var(--ff-m);
    }
    .pu-plan-name {
      font-size: var(--text-2xs); font-weight: 700; color: var(--t2);
      text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px;
      font-family: var(--ff-m);
    }
    .pu-plan-price {
      font-size: 22px; font-weight: 700; color: var(--t1);
      line-height: 1; letter-spacing: -0.5px; margin-bottom: 2px;
      font-family: var(--ff-d);
    }
    .pu-plan-per { font-size: var(--text-2xs); color: var(--t3); line-height: 1.3; font-family: var(--ff-m); }
    .pu-plan-trial {
      font-size: var(--text-2xs); color: var(--g); font-weight: 700;
      margin-top: 5px; font-family: var(--ff-m);
    }
    .pu-plan-selected .pu-plan-name  { color: var(--p2); }
    .pu-plan-selected .pu-plan-price { color: var(--t1); }
    .pu-plan-selected .pu-plan-per   { color: var(--t2); }
    .pu-plan-selected .pu-plan-trial { color: var(--c); }
    /* Subtext line below CTA */
    /* Primary Action Group */
        .pu-action-group {
          display: flex;
          flex-direction: column;
          margin-bottom: 12px;
        }

        .pu-cta-sub {
          text-align: center;
          font-size: 12px; color: var(--t3);
          margin-top: 6px; /* Tighter gap to the button */
          min-height: 16px;
          font-family: var(--ff-m);
        }

        /* Secondary Actions (Dismiss & Restore) */
        .pu-secondary-actions {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-top: 4px;
        }

        .pu-dismiss-text {
          background: transparent;
          border: none;
          color: var(--t3);
          font-size: 13px;
          font-weight: 600;
          font-family: var(--ff-m);
          cursor: pointer;
          padding: 8px 4px;
          transition: color 0.15s;
        }
        .pu-dismiss-text:hover { color: var(--t2); }
        .pu-dismiss-text:active { opacity: 0.7; }

        .pu-action-dot {
          color: var(--t3);
          opacity: 0.5;
          font-size: 14px;
        }

        .pu-meta-row {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 8px;
          margin-top: 10px;    /* was 14px — now purely for Restore purchase */
          margin-bottom: 4px;
        }

            .pu-restore-link {
              display: block;
              text-align: center;
              margin-top: 6px;
              font-size: 13px;
              color: var(--t3);
              cursor: pointer;
              text-decoration: underline;
              font-family: var(--ff-m);
            }
            .pu-restore-link:active { color: var(--t1); }

            .pu-meta-dot {
              color: var(--border2);
              font-size: 16px;
              line-height: 1;
            }

        .pu-restore-link:hover { color: var(--t2); }
    .pu-dismiss {
      width: 100%; padding: 13px; border-radius: 14px;
      background: transparent;
      color: var(--t2);
      font-size: 14px; font-weight: 600; cursor: pointer;
      box-sizing: border-box; font-family: var(--ff-m);
      min-height: 48px;
      border: 1.5px solid var(--border2);
      transition: background 0.15s, border-color 0.15s;
      margin-top: 2px;
    }
    .pu-dismiss:focus-visible {
      outline: 2px solid var(--focus-ring-color);
      outline-offset: 2px;
    }

    .pu-status {
      text-align: center; font-size: 13px;
      color: var(--t2); padding: 8px 0;
      display: none; font-family: var(--ff-m);
    }
    .pu-status.pu-visible { display: block; }
    .pu-error { color: var(--r) !important; }
    /* Gate component styles */
    .aurelo-header--pro {
      background: linear-gradient(135deg, rgba(26,23,48,0.95) 0%, rgba(14,15,19,0.95) 100%) !important;
      border-bottom-color: rgba(124,111,247,0.2) !important;
    }
    .pg-pro-pill {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 9px 3px 7px; border-radius: 40px;
      background: rgba(247,201,72,0.12); border: 1px solid rgba(247,201,72,0.25);
      color: #f7c948; margin-left: 8px; vertical-align: middle;
      animation: pgPillIn 0.35s ease;
    }
    .pg-pill-star { font-size: var(--text-2xs); opacity: 0.85; }
    .pg-pill-text { font-family: var(--ff-m); font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.08em; }
    /* pg-pro-badge: used by proBadge() helper */
    .pg-pro-badge {
      display: inline-flex; align-items: center;
      border-radius: 999px;
      background: linear-gradient(135deg, var(--p), var(--c));
      font-weight: 700; color: #fff;
      letter-spacing: 0.4px; flex-shrink: 0; vertical-align: middle;
    }
    @keyframes pgSlideIn { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:translateY(0); } }
    @keyframes pgPillIn  { from { opacity:0; transform:translateX(-4px) scale(0.9); } to { opacity:1; transform:translateX(0) scale(1); } }
    @media (prefers-reduced-motion: reduce) {
      .pu-sheet, .pu-backdrop { transition-duration: 0.01ms !important; }
      .pu-data-stat, .pg-pro-pill { animation: none !important; }
    }
  `;

  // ── PRICING ───────────────────────────────────────────────────
  // Fetched once from AppBridge.getProPricing() on first show(), cached for the session.
  // Falls back to hardcoded defaults if bridge is unavailable (demo / web mode).
  // AppBridge.getProPricing() should return JSON:
  //   {
  //     monthly:  { price: "$2.99",  perMonth: "$2.99", trialDays: 7 },
  //     annual:   { price: "$17.99", perMonth: "$1.49", trialDays: 7 },
  //     lifetime: { price: "$29.99", perMonth: null,    trialDays: 0 }
  //   }
  // Any key can be null/absent — that plan will be hidden from the picker.
  const PRICING_FALLBACK = {
    monthly:  { price: '$2.99',  perMonth: '$2.99', trialDays: 7 },
    annual:   { price: '$19.99', perMonth: '$1.66', trialDays: 7 },
    lifetime: { price: '$29.99', perMonth: null,    trialDays: 0 },
  };
  // ── PRICING ─────────────────────────────────────────────────────
  let _pricingCache = null;
  let _pricingFetched = false; // tracks whether a live fetch has ever succeeded

  function _fetchLivePricing() {
      // Always re-fetch on each sheet open so prices stay fresh
      _pricingFetched = false;
      try { AppBridge.getProPricing(); } catch(_) {}
  }

  window.onProPricingLoaded = function(json) {
      try {
          console.log('ProUpsell pricing received:', JSON.stringify(json));
          const parsed = typeof json === 'string' ? JSON.parse(json) : json;
          // Only merge non-null values — preserve fallback for missing plans
          const merged = Object.assign({}, PRICING_FALLBACK);
          if (parsed && typeof parsed === 'object') {
              Object.keys(parsed).forEach(k => {
                  if (parsed[k] != null && parsed[k].price) merged[k] = parsed[k];
              });
          }
          _pricingCache = merged;
          _pricingFetched = true;

          // Always re-render when live prices arrive, whether sheet is open or not
          if (_backdrop && _backdrop.classList.contains('pu-visible')) {
              _renderPlans(_pricingCache);
              _updateCtaForPlan(_selectedPlan);
          }
      } catch(_) {}
  };

  // ── STATE ─────────────────────────────────────────────────────
  let _backdrop, _ctaBtn, _statusEl, _restoreLink;
  let _currentUpsell = null;
  let _selectedPlan  = 'annual';   // always pre-select annual
  let _injected      = false;
  let _restoreInProgress = false;
  let _restoreTimer      = null;   // safety-net timeout handle
  let _pendingRestoreWelcome  = false; // set when restore fires before home is visible
  let _restoreWelcomeShown    = false; // set when welcome success state is rendered

  // ── INIT ──────────────────────────────────────────────────────
  function _inject() {
    if (_injected) return;
    // Bail out if the body isn't in the DOM yet (script loaded in <head>).
    // show() calls _inject() at the top, so the retry happens automatically
    // the first time a user triggers the sheet — by which point body exists.
    if (!document.body) return;
    _injected = true;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    _backdrop = document.createElement('div');
    _backdrop.className = 'pu-backdrop';
    _backdrop.innerHTML = `
          <div class="pu-sheet" role="dialog" aria-modal="true">
            <button class="pu-close" id="pu-close" aria-label="Close">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>

            <div class="pu-tag" id="pu-tag"></div>
            <div class="pu-headline" id="pu-headline"></div>

            <div class="pu-data-stat" id="pu-data-stat" style="display:none">
              <span class="pu-data-stat-icon" id="pu-data-stat-icon">📊</span>
              <span class="pu-data-stat-text" id="pu-data-stat-text"></span>
            </div>

            <div class="pu-body" id="pu-body"></div>
            <ul class="pu-bullets" id="pu-bullets" style="display:none"></ul>

            <div class="pu-footer">
              <div class="pu-privacy">
              🔒 No account needed. All data stays on your phone.</div>
              <div class="pu-social-proof">
                <div class="pu-social-proof-dot"></div>
                <span>All current and future Pro features included.</span>
              </div>
            </div>

            <div class="pu-plans" id="pu-plans"></div>
            <div class="pu-status" id="pu-status"></div>

            <div class="pu-bottom-area">
              <div class="pu-action-group">
                <button class="pu-cta" id="pu-cta"></button>
                <div class="pu-cta-sub" id="pu-cta-sub"></div>
              </div>
                <span class="pu-restore-link" id="pu-restore">Restore purchase</span>
            </div>
          </div>
        `;
    document.body.appendChild(_backdrop);

    _ctaBtn      = _backdrop.querySelector('#pu-cta');
    _statusEl    = _backdrop.querySelector('#pu-status');
    _restoreLink = _backdrop.querySelector('#pu-restore');

    _backdrop.addEventListener('click', function(e) {
      if (e.target === _backdrop) hide();
    });

    const _closeBtn = _backdrop.querySelector('#pu-close');
    if (_closeBtn) _closeBtn.addEventListener('click', hide);

    // BUG-4 FIX: swipe down on the sheet to dismiss.
    // Track touchstart Y on the sheet; if touchend moved down ≥72px, call hide().
    // passive:true keeps scroll performance fast; we never call preventDefault.
    var _swipeStartY = 0;
    var _sheet = _backdrop.querySelector('.pu-sheet');
    if (_sheet) {
      _sheet.addEventListener('touchstart', function(e) {
        _swipeStartY = e.touches[0].clientY;
      }, { passive: true });
      _sheet.addEventListener('touchend', function(e) {
        var dy = e.changedTouches[0].clientY - _swipeStartY;
        if (dy > 72) hide();
      }, { passive: true });
    }

    _ctaBtn.addEventListener('click', function() {
      _ctaBtn.disabled = true;
      _ctaBtn.textContent = 'Opening Play Store…';
      try {
        // Pass selected plan key so BillingManager can launch the correct SKU
        AppBridge.launchBillingFlow(_selectedPlan);
      } catch(e) {
        _showStatus('Could not connect to Play Store. Please try again.', true);
        _ctaBtn.disabled = false;
        _updateCtaForPlan(_selectedPlan);
      }
    });

    _restoreLink.addEventListener('click', function() {
      _restoreInProgress = true;
      _showStatus('Checking your purchases…');

      // Safety net — if Kotlin never calls back within 10s, show failure
      _clearRestoreTimeout();
      _restoreTimer = setTimeout(function() {
        if (_restoreInProgress) {
          _restoreInProgress = false;
          _showStatus('Could not verify purchase. Please try again.', true);
        }
      }, 10000);

      try {
        AppBridge.restorePurchase();
      } catch(e) {
        _clearRestoreTimeout();
        _restoreInProgress = false;
        _showStatus('Could not connect to Play Store.', true);
      }
    });
  }

  // ── PLAN PICKER ───────────────────────────────────────────────
  function _renderPlans(pricing) {
    const container = _backdrop ? _backdrop.querySelector('#pu-plans') : document.getElementById('pu-plans');
    if (!container) return;

    const defs = [
      { key: 'monthly',  label: 'Monthly',  badge: null         },
      { key: 'annual',   label: 'Annual',   badge: 'Best Value' },
      { key: 'lifetime', label: 'Lifetime', badge: null         },
    ].filter(function(p) { return pricing[p.key] != null; });

    container.innerHTML = defs.map(function(p) {
      const pd       = pricing[p.key];
      const selected = p.key === _selectedPlan;
      const hasTrial = pd.trialDays > 0;

      let priceDisplay, perLine;
      if (p.key === 'annual' && pd.perMonth) {
        priceDisplay = _esc(pd.perMonth) + '<span style="font-size:var(--text-2xs);font-weight:500;color:#5c6070">/mo</span>';
        perLine      = '<div class="pu-plan-per">' + _esc(pd.price) + '/year</div>';
      } else if (p.key === 'lifetime') {
        priceDisplay = _esc(pd.price);
        perLine      = '<div class="pu-plan-per">one-time</div>';
      } else {
        priceDisplay = _esc(pd.price) + '<span style="font-size:var(--text-2xs);font-weight:500;color:#5c6070">/mo</span>';
        perLine      = '<div class="pu-plan-per">billed monthly</div>';
      }

      return '<div class="pu-plan' + (selected ? ' pu-plan-selected' : '') + '"'
       + ' id="pu-plan-' + p.key + '"'
       + ' role="radio" tabindex="0" onclick="window._puSelectPlan(\'' + p.key + '\')"'
       + ' onkeydown="if(event.key===\'Enter\'||event.key===\' \')window._puSelectPlan(\'' + p.key + '\')">'
       + (p.badge ? '<div class="pu-plan-badge">' + _esc(p.badge) + '</div>' : '')
        + '<div class="pu-plan-name">'  + _esc(p.label) + '</div>'
        + '<div class="pu-plan-price">' + priceDisplay  + '</div>'
        + perLine
        + (hasTrial ? '<div class="pu-plan-trial">' + pd.trialDays + '-day free trial</div>' : '')
        + '</div>';
    }).join('');
  }

  // Exposed on window so the injected onclick can reach it
  window._puSelectPlan = function(plan) {
    _selectedPlan = plan;
    document.querySelectorAll('.pu-plan').forEach(function(el) {
      el.classList.toggle('pu-plan-selected', el.id === 'pu-plan-' + plan);
    });
    _updateCtaForPlan(plan);
    if (_statusEl) { _statusEl.textContent = ''; _statusEl.className = 'pu-status'; }
  };

  function _updateCtaForPlan(plan) {
       const pricing = _pricingCache || PRICING_FALLBACK;
      const pd      = pricing[plan];

      // Re-query every time — guards against stale references after DOM resets
      const btn    = _backdrop ? _backdrop.querySelector('#pu-cta')     : document.getElementById('pu-cta');
      const ctaSub = _backdrop ? _backdrop.querySelector('#pu-cta-sub') : document.getElementById('pu-cta-sub');

      // Also keep _ctaBtn in sync in case it went stale
      if (btn) _ctaBtn = btn;

      if (!pd) {
          // pd missing — still show a generic CTA so it's never blank
          if (_ctaBtn) { _ctaBtn.textContent = 'Unlock Pro'; _ctaBtn.disabled = false; }
          return;
      }
      if (!_ctaBtn) return;

      if (plan === 'lifetime') {
          _ctaBtn.textContent = 'Get Lifetime Access — ' + pd.price;
          if (ctaSub) ctaSub.textContent = 'One-time payment · All future updates included';
      } else if (pd.trialDays > 0) {
          _ctaBtn.textContent = 'Start ' + pd.trialDays + '-Day Free Trial →';
          if (ctaSub) ctaSub.textContent = 'Then ' + pd.price
              + (plan === 'annual' ? '/year' : '/month') + ' · Cancel anytime';
      } else {
          _ctaBtn.textContent = 'Unlock Pro — ' + pd.price
              + (plan === 'annual' ? '/year' : '/month');
          if (ctaSub) ctaSub.textContent = 'Cancel anytime';
      }
      _ctaBtn.disabled = false;
  }

  // ── PUBLIC API ────────────────────────────────────────────────
  function show(upsellKey, context) {
      // Ensure the sheet DOM exists — _inject() may have bailed on first call
      // if the script loaded before document.body was available.
      _inject();
      if (!_backdrop) return; // still no body (shouldn't happen in practice)

      if (window.ProTier && window.ProTier.isPro) return;

      const base = COPY[upsellKey];
      if (!base) { console.warn('ProUpsell: Unknown key', upsellKey); return; }

      const variant = context && base.variants && base.variants[context];
      const copy = variant ? Object.assign({}, base, variant) : base;

      _currentUpsell = { key: upsellKey, context, copy };

      // Tag / Headline / Body
      document.getElementById('pu-tag').textContent      = base.tag;
      document.getElementById('pu-headline').textContent = copy.headline;
      document.getElementById('pu-body').textContent     = copy.body;

      // Personalised stat
      const statEl     = document.getElementById('pu-data-stat');
      const statTextEl = document.getElementById('pu-data-stat-text');
      const statIconEl = document.getElementById('pu-data-stat-icon');
      const statKey    = base.dataStat || null;
      const statValue  = statKey ? _getSessionStat(statKey) : null;

      if (statValue && statEl && statTextEl) {
          statTextEl.textContent = statValue;
          if (statIconEl) {
              statIconEl.textContent =
                  statKey === 'streak'   ? '🔥' :
                  statKey === 'pickups'  ? '📱' :
                  statKey === 'top_app'  ? '⏱️' : '📊';
          }
          statEl.style.display = 'flex';
      } else if (statEl) {
          statEl.style.display = 'none';
      }

      // Bullets
      const bulletsList = document.getElementById('pu-bullets');
      if (copy.bullets && copy.bullets.length) {
          bulletsList.innerHTML = copy.bullets.map(b =>
              `<li><span class="pu-check">✓</span>${_esc(b)}</li>`
          ).join('');
          bulletsList.style.display = 'flex';
      } else {
          bulletsList.style.display = 'none';
      }

      // Clear status
      _statusEl.textContent = '';
      _statusEl.className   = 'pu-status';

      // Always default to annual
      _selectedPlan = 'annual';

      // Pricing: render fallback immediately
      const immediatePricing = _pricingCache || PRICING_FALLBACK;
      _renderPlans(immediatePricing);
      _updateCtaForPlan(_selectedPlan);

      // Dim prices while live fetch in-flight
      if (!_pricingFetched) {
          document.querySelectorAll('.pu-plan-price').forEach(el => {
              el.style.opacity = '0.3';
          });
          document.querySelectorAll('.pu-plan-trial').forEach(el => {
              el.style.opacity = '0.3';
          });
      }

      // Trigger fresh live fetch
      _fetchLivePricing();

      // Show sheet
      _backdrop.classList.add('pu-ready');
      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          _backdrop.classList.add('pu-visible');
          document.body.style.overflow = 'hidden';
        });
      });
  }

  function hide() {
    if (!_backdrop) return;
    _backdrop.classList.remove('pu-visible');
    document.body.style.overflow = '';
    _currentUpsell = null;
    setTimeout(function() {
      if (_backdrop && !_backdrop.classList.contains('pu-visible')) {
        _backdrop.classList.remove('pu-ready');
      }
    }, 320);
  }

  function onBillingError(message) {
    if (!_backdrop || !_backdrop.classList.contains('pu-visible')) return;
    _showStatus(message || 'Something went wrong. Please try again.', true);
    if (_ctaBtn) {
      _ctaBtn.disabled = false;
      _updateCtaForPlan(_selectedPlan);
    }
  }

  function showRestoring() {
    _showStatus('Checking your purchases…');
  }

  function showRestoreNotFound() {
    _showStatus('No Pro purchase found for this Google account.', false);
  }

  function onPurchaseSuccess() {
    if (!_backdrop || !_backdrop.classList.contains('pu-visible')) return;
    _restoreWelcomeShown = true;
    _clearRestoreTimeout();
    _restoreInProgress = false;

    document.getElementById('pu-tag').textContent      = 'Purchase Complete';
    document.getElementById('pu-headline').textContent = '✦ Welcome to Aurelo Pro';
    document.getElementById('pu-body').textContent     = 'All features are now unlocked. As always, your data never leaves your device.';

    const bullets = document.getElementById('pu-bullets');
    const statEl  = document.getElementById('pu-data-stat');
    const plans   = document.getElementById('pu-plans');
    const ctaSub  = document.getElementById('pu-cta-sub');
    if (bullets) bullets.style.display = 'none';
    if (statEl)  statEl.style.display  = 'none';
    if (plans)   plans.style.display   = 'none';
    if (ctaSub)  ctaSub.style.display  = 'none';

    if (_ctaBtn) {
      _ctaBtn.textContent          = '✓ You\'re Pro now!';
      _ctaBtn.disabled             = true;
      _ctaBtn.style.background     = 'linear-gradient(135deg,#12D48A,#0aab6e)';
      _ctaBtn.style.boxShadow      = '0 6px 20px rgba(18,212,138,0.3)';
    }
    if (_restoreLink) _restoreLink.style.display = 'none';
    if (_statusEl)  { _statusEl.textContent = ''; _statusEl.className = 'pu-status'; }

    setTimeout(function() {
      hide();
      // Reset for next open
      if (_ctaBtn) {
        _ctaBtn.style.background = '';
        _ctaBtn.style.boxShadow  = '';
        _ctaBtn.disabled         = false;
      }
      if (_restoreLink) _restoreLink.style.display = '';
      if (plans)        plans.style.display        = '';
      if (ctaSub)       ctaSub.style.display       = '';

      // ── Post-conversion: show referral panel once immediately after Pro purchase ──
      // Only shown for genuine new purchases (not restores). Gives the newly-Pro
      // user a one-tap way to share their referral link while the excitement is high.
      setTimeout(function() {
        const _shownKey = 'referral_post_conversion_shown';
        let alreadyShown = false;
        try {
          alreadyShown = IS_NATIVE && typeof N.getStringPref === 'function'
            && N.getStringPref(_shownKey) === '1';
        } catch (_) {}
        if (!alreadyShown && typeof Referral !== 'undefined') {
          try {
            if (IS_NATIVE && typeof N.setStringPref === 'function')
              N.setStringPref(_shownKey, '1');
            Referral.open();
          } catch (_) {}
        }
      }, 600);
    }, 3000);
  }

  // ── RESTORE WELCOME SNACKBAR ──────────────────────────────────
  // Shown when a Pro subscription is silently restored on reinstall / new device.
  // Self-contained: injects its own DOM and CSS, safe to call multiple times.

  function _injectRestoreSnackbar() {
    if (document.getElementById('au-restore-snack')) return;
    const style = document.createElement('style');
    style.textContent = `
      #au-restore-snack {
        position: fixed;
        bottom: -80px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 99999;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 20px;
        min-width: 280px;
        max-width: 88vw;
        border-radius: 14px;
        background: var(--s0);
        border: 1px solid rgba(18,212,138,0.4);
        box-shadow: 0 8px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(18,212,138,0.1);
        color: #fff;
        font-family: inherit;
        font-size: 14px;
        line-height: 1.35;
        transition: bottom 0.38s cubic-bezier(0.34,1.56,0.64,1), opacity 0.25s ease;
        opacity: 0;
        pointer-events: none;
        white-space: nowrap;
      }
      #au-restore-snack.au-snack-show {
        bottom: calc(env(safe-area-inset-bottom, 0px) + 24px);
        opacity: 1;
        pointer-events: auto;
      }
      #au-restore-snack .au-snack-icon { font-size: 20px; flex-shrink: 0; }
      #au-restore-snack .au-snack-text strong {
        display: block; font-size: 14px; color: #12D48A; margin-bottom: 1px;
      }
      #au-restore-snack .au-snack-text span {
        font-size: 12px; color: rgba(255,255,255,0.65);
      }
    `;
    document.head.appendChild(style);
    const el = document.createElement('div');
    el.id = 'au-restore-snack';
    el.innerHTML = `
      <div class="au-snack-icon">✦</div>
      <div class="au-snack-text">
        <strong>Welcome back to Pro!</strong>
        <span>Your subscription has been restored.</span>
      </div>`;
    document.body.appendChild(el);
  }

  function _showRestoreSnackbar() {
    _injectRestoreSnackbar();
    const el = document.getElementById('au-restore-snack');
    if (!el) return;
    el.classList.remove('au-snack-show');
    void el.offsetWidth; // force reflow so transition fires
    el.classList.add('au-snack-show');
    setTimeout(function() { el.classList.remove('au-snack-show'); }, 4500);
  }

  // Called by app-core.js onProStatusChanged when a silent restore is detected.
  // Handles its own timing: shows immediately if home is visible, defers if not.
  function triggerRestoreWelcome() {
    const loadingEl = document.getElementById('loading-screen');
    const loadingHidden = loadingEl && loadingEl.classList.contains('hidden');
    if (typeof S !== 'undefined' && !S.onboardingDone) {
            _pendingRestoreWelcome = true;
            return;
        }
    if (loadingHidden) {
      // Home is on screen — small delay lets the UI settle first
      setTimeout(_showRestoreSnackbar, 400);
    } else {
      // Still behind loading screen — defer; loadNativeData() will consume via
      // consumePendingWelcome() once home is painted.
      _pendingRestoreWelcome = true;
    }
  }

  // Called by loadNativeData() in app-core.js after home is fully painted.
  // Consumes the pending flag set by triggerRestoreWelcome() when home wasn't ready.
  function consumePendingWelcome() {
    if (_pendingRestoreWelcome) {
      _pendingRestoreWelcome = false;
      setTimeout(_showRestoreSnackbar, 400);
    }
  }

  // ── INTERNAL ─────────────────────────────────────────────────

  function _showStatus(msg, isError) {
    if (!_statusEl) return;
    _statusEl.textContent = msg;
    _statusEl.className   = 'pu-status pu-visible' + (isError ? ' pu-error' : '');
  }

  function _clearRestoreTimeout() {
    if (_restoreTimer) { clearTimeout(_restoreTimer); _restoreTimer = null; }
  }

  function _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── EXPOSE ────────────────────────────────────────────────────
  window.ProUpsell = {
    show,
    hide,
    onBillingError,
    showRestoring,
    showRestoreNotFound,
    onPurchaseSuccess,
    triggerRestoreWelcome,
    consumePendingWelcome,
  };

  // Eager-inject sheet HTML so it's ready before first open
  _inject();

  // Called by Kotlin (PurchaseRestoreHandler) when restore query begins
  window.onRestoreStarted = function () {
      _restoreInProgress = true;
      if (_backdrop && _backdrop.classList.contains('pu-visible')) {
          showRestoring(); // sheet is open — show inline spinner text
      }
  };

  // Called by Kotlin when no active purchase found on this account
  window.onRestoreNoPurchase = function () {
      _restoreInProgress = false;
      _clearRestoreTimeout();
      if (_backdrop && _backdrop.classList.contains('pu-visible')) {
          showRestoreNotFound(); // sheet is open — show inline message
      } else if (typeof toast === 'function') {
          toast('No previous purchase found.', 'warn'); // settings context
      }
  };

})(window);
