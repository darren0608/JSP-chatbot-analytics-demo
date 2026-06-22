# Handover & operating guide (for a non-technical owner)

This explains, in plain language, **what the app is made of, what the important
functions do, how each one gets triggered, where your data and secrets live, and
what to do when something looks wrong.** You do not need to be a programmer to
operate it. Keep this document with the project.

If you're setting it up for the first time, read **[DEPLOY.md](DEPLOY.md)** first.
This guide is about *running and maintaining* it afterwards.

---

## 1. The mental model (read this once)

The whole system is just **four things**:

| Thing | What it is | Where you find it |
|------|-------------|-------------------|
| **The code** | A Google Apps Script project (a bunch of `.gs` files + one web page). | script.google.com → your "Life Dashboard" project |
| **The data** | One Google Sheet. Each tab is a table (tasks, bills, holdings…). | Your Google Drive |
| **The secrets** | Passwords/keys for the optional connections (Telegram, IBKR…). Stored as "Script Properties". | Apps Script editor → Project Settings → Script Properties |
| **The scheduled jobs** | "Triggers" — little timers that run certain functions automatically (e.g. check Telegram every minute). | Apps Script editor → Triggers (the alarm-clock icon) |

> **Golden rules**
> - The web page never holds a secret. Secrets only live in Script Properties.
> - The app never deletes data — it only marks things "deleted" and keeps a log.
> - It never moves money or places trades. Money features are read-only.
> - It runs even with **no** connections set up (it shows realistic sample data).

---

## 2. Key functions — what they do and how they're called

You rarely call functions yourself. They run in one of **four ways**. Here are
the ones that matter.

### A. Runs automatically when you open the dashboard
| Function | In plain English |
|----------|------------------|
| `doGet` | Builds and shows the web page when you open the app's link. |
| `getDashboardState` | Gathers everything (agenda, tasks, money, habits…) into one bundle for the page. Results are cached for ~30 seconds so opening it repeatedly is cheap. |

### B. Runs when you click something in the app
These are the "api…" functions. Each button in the dashboard quietly calls one.
They always return a clean result, so a hiccup never wipes your screen.

| Button / action | Function it calls | What happens |
|-----------------|-------------------|--------------|
| Add a task | `apiAddTask` | Adds a task to your Sheet. |
| Tick a task complete | `apiCompleteTask` | Marks it done. |
| Re-open a task | `apiReopenTask` | Marks it open again. |
| Delete a task (🗑) | `apiDeleteTask` | **Soft**-deletes (hidden, but kept + logged). |
| The "+" quick-capture box | `apiQuickCapture` | Reads your text ("add task… ", "note: …") and files it in the right place. |
| Tap a habit ring | `apiCheckInHabit` | Checks the habit off for today (tap again to undo). |
| "↻ IBKR" button | `apiRefreshIbkr` | Pulls your latest brokerage holdings. |
| Search (🔍 or ⌘/Ctrl-K) | `apiSearch` | Searches tasks, events, notes, holdings. |
| Change a setting | `apiSaveSetting` | Saves a preference (timezone, currency…). |
| "Test integrations" | `apiDiagnose` | Checks every connection and reports status. |
| (automatic refresh) | `apiGetState` | Re-fetches the latest data after an action. |

### C. Runs on a schedule (Triggers you set up once)
Set these up in the Apps Script editor under **Triggers**. Recommended schedule
in brackets. All are optional except `telegramPoll` (needed for the bot).

| Function | Suggested schedule | What it does |
|----------|--------------------|--------------|
| `telegramPoll` | every **1 minute** | Checks for new Telegram messages and replies. **Required for the bot.** |
| `telegramScanReminders` | every **1 minute** | Sends task reminders to Telegram when they're due. |
| `pushDailyBriefing` | **daily**, your wake-up time | Sends the "here's your day" summary to Telegram. |
| `dailyMaintenance` | **daily** | Housekeeping: tidies internal tables, clears old error notes, refreshes currency rates. |
| `weeklyErrorDigest` | **weekly** | Sends a short health report to Telegram (silent if all is well). |

### D. Runs only when you press "Run" in the editor (rarely needed)
| Function | When you'd use it |
|----------|-------------------|
| `diagnose` | "Is everything connected?" — gives a ✅/❌ per connection. |
| `refreshIbkr` | Force a brokerage refresh right now. |
| `refreshFxRates` | Force-refresh currency exchange rates. |

### E. The Telegram bot (texting the app)
Only **your** phone (one whitelisted chat) is ever answered. It understands, e.g.:
`today` · `tomorrow` · `overdue` · `tasks` · `bills` · `portfolio` · `srs` ·
`cpf` · `dividends` · `birthdays` · `add task pay rent due Friday` ·
`note: call mum`. Anything that deletes or completes will **ask you "yes/no"
first** — it never guesses.

---

## 3. The connections (integrations) at a glance

Everything below is **optional** — the app works without any of them (it shows
sample data). Add them one at a time (see DEPLOY.md). "Direction" tells you
whether the app only *reads* from a service or also *writes* to it.

| Connection | What it gives you | Direction | Turned on by | Good to know |
|------------|-------------------|-----------|--------------|--------------|
| **Google Calendar** | Your events on the Time tab + Home agenda. | Read-only | `CALENDAR_PERSONAL_IDS` (+ `CALENDAR_BUSY_IDS`, `CALENDAR_BIRTHDAYS_ID`) | Your own calendars show in full. A **work/government** calendar goes in `CALENDAR_BUSY_IDS` and appears **only as "Busy"** — its titles/details are never read. |
| **TickTick** | Your TickTick to-dos appear alongside Sheet tasks; you can add/complete/delete them from the dashboard and the bot. | Read **and** write | `TICKTICK_ACCESS_TOKEN` | **Important quirk:** TickTick's feed only lists *unfinished* tasks, so a completed task disappears from it. The app keeps its own private note (the `task_overrides` tab) so "complete then delete" never errors. |
| **Interactive Brokers (IBKR)** | Auto-pulls your brokerage holdings into the `holdings` tab. | **Read-only** (never trades or moves money) | `IBKR_FLEX_TOKEN`, `IBKR_FLEX_QUERY_ID` | Uses IBKR's "Flex" report. A refresh **replaces only the IBKR rows** and **keeps your manual rows** (CPF, SRS, cash). Trigger it with the "↻ IBKR" button or the daily job. |
| **Telegram bot** | Text the dashboard to capture and ask questions on the go. | Read **and** write | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (+ `TELEGRAM_URL_SECRET`) | Only **your one** chat is ever answered. Anything destructive asks "yes/no" first. Needs the `telegramPoll` trigger running. |
| **Gemini AI** (optional) | Nicely phrases the daily briefing and understands fuzzier bot messages. | Read-only | `GCP_PROJECT_ID` (+ `GCP_LOCATION`) | The **only** paid piece (tiny cost, cached). Everything still works without it — plain wording + keyword matching take over. |
| **Currency rates (FX)** | Converts foreign holdings to SGD for the headline totals. | Read-only | (none — free & keyless) | Refreshes daily into the `fx` tab; totals are labelled **"est."** because rates are approximate. |

> **Two services let the app write back: TickTick and Telegram.** Everything
> else (Calendar, IBKR, Gemini, FX) is read-only. Nothing ever places trades or
> moves money.

---

## 4. Where your data lives (the Google Sheet tabs)

Each tab is a simple table. You **can** edit the "safe to hand-edit" ones
directly in Google Sheets; the app will pick up changes on the next refresh.

| Tab | Holds | Safe to hand-edit? |
|-----|-------|--------------------|
| `tasks` | Your tasks | Yes |
| `holdings` | Investments. IBKR rows are auto-managed; **your manual rows (CPF, SRS, cash) are preserved** on every refresh. | Yes — add manual rows freely |
| `dividends` | Upcoming dividend payments | Yes |
| `bills` | Recurring bills & subscriptions | Yes |
| `habits` | Habits + check-in dates | Yes (the app is easier) |
| `goals` | Goals and progress | Yes |
| `notes` | Quick notes / journal | Yes |
| `countdowns` | Birthdays, trips, key dates | Yes |
| `fx` | Currency exchange rates (auto-refreshed) | Only to override a rate |
| `task_overrides` | Internal bookkeeping for TickTick tasks | **No — leave it alone** |
| `audit` | A log of every change made | **No — read-only history** |
| `errors` | Notes about anything that failed | **No — read-only** |

> Tabs are created automatically the first time they're needed. An empty tab is
> normal if you haven't used that feature yet.

---

## 5. Where the secrets live (Script Properties)

Apps Script editor → **Project Settings → Script Properties**. You'll see
**names** here; the app never shows the values on the web page. You only touch
these when connecting a service or rotating a key.

| Property name(s) | For |
|------------------|-----|
| `SHEET_ID` | Points the app at your Google Sheet. |
| `CALENDAR_PERSONAL_IDS`, `CALENDAR_BUSY_IDS`, `CALENDAR_BIRTHDAYS_ID` | Which calendars to read. Work/gov calendars go in `…BUSY…` and show only as "Busy". |
| `TICKTICK_ACCESS_TOKEN` | TickTick tasks. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_URL_SECRET` | The Telegram bot + the single phone it answers. |
| `IBKR_FLEX_TOKEN`, `IBKR_FLEX_QUERY_ID` | Interactive Brokers holdings. |
| `GCP_PROJECT_ID`, `GCP_LOCATION` | Optional AI phrasing of the briefing. |

(Other properties starting with `SETTING_`, `LASTGOOD_`, `TELEGRAM_LAST_…` are
managed by the app — leave them.)

---

## 6. "How do I…" — routine tasks

- **See what changed recently** → open the Sheet's `audit` tab (newest at the top).
- **Add a manual investment (e.g. CPF balance)** → add a row in the `holdings`
  tab with `account` = `CPF` (or `SRS`/`Cash`). It survives brokerage refreshes.
- **Change timezone / currency / SRS cap / briefing time** → in the app, go to
  **More → Settings**, or edit the value in Script Properties (`SETTING_…`).
- **Check everything is healthy** → app **More → Test integrations**, or run
  `diagnose` in the editor. You also get a weekly Telegram digest.
- **Pause the Telegram bot** → in the editor's Triggers, disable `telegramPoll`.
- **Rotate / replace a key** → update the relevant Script Property; nothing else
  to change. Run `diagnose` to confirm.

---

## 7. When something looks wrong

| You see… | What it means / what to do |
|----------|----------------------------|
| Top chip says **"Mock"** | No connections are set up yet — it's showing sample data. Add credentials (see DEPLOY.md) to go live. |
| Top chip says **"Degraded"** | One connection had a problem; the rest of the page is fine and shows the last good data. Hover the chip / read the warning bar to see which. Often temporary; run `diagnose`. |
| A section is **blank** | That source is genuinely empty (e.g. no bills yet). Once you've connected a source, the app does **not** fall back to sample data. |
| **Bot not replying** | Check the `telegramPoll` trigger is enabled; confirm `TELEGRAM_CHAT_ID` is your chat; run `diagnose`. |
| **"IBKR refresh already running"** | A refresh is in progress; wait a moment. (It auto-clears after 5 minutes if a run was interrupted.) |
| **Times look off by hours** | The project's timezone and your setting disagree. Run `diagnose` — the "Timezone" line shows both; match the project timezone to your setting. |

---

## 8. If you need a developer (the 2-minute brief for them)

- It's **Google Apps Script + one Google Sheet**. Source is in `src/` (one `.gs`
  per area; see the README "Architecture" table for the one-line map).
- There's a **full automated test suite**: `cd life-dashboard && npm test`
  (44 tests, no credentials needed). CI runs it on every change.
- Run `npm run preview` to open a **standalone, clickable demo** in a browser
  with sample data — no deployment needed.
- Everything degrades safely: one failing service never blanks the page, no
  secret is exposed, and work/gov calendars are only ever read as free/busy.
