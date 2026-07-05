# Deploy & setup guide

Written for a **non-technical owner**. You can deploy first and see a fully
working *mock* dashboard with **no credentials at all**, then add secrets one at
a time to make each section live. Nothing here requires you to edit code.

> **Golden rule:** every secret goes into **Script Properties** (server-side).
> The web page never sees a credential, and you never paste a secret into the
> HTML.

---

## 1. Create the project (5 minutes)

### Option A — clasp (recommended)
```bash
npm i -g @google/clasp
clasp login
# In life-dashboard/, create a standalone script:
clasp create --type webapp --title "Life Dashboard" --rootDir src
cp .clasp.json.example .clasp.json   # then paste the scriptId clasp printed
clasp push
```

### Option B — by hand
1. Go to <https://script.google.com> → **New project**.
2. Create one file per `src/*.gs` and the `dashboard.html` file, pasting the
   contents in. Set the manifest (`appsscript.json`) to match the one in `src/`
   (View → Show "appsscript.json" in Project Settings).

## 2. Deploy the web app
- **Deploy → New deployment → Web app**.
- **Execute as:** *Me*. **Who has access:** *Only myself*.
- Open the `/exec` URL. You should see a **beautiful mock dashboard** with the
  mode chip reading **"Mock"**. 🎉

## 3. Point it at your own Sheet (makes editing live)
1. Create a Google Sheet. Copy its ID from the URL
   (`https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`).
2. In the Apps Script editor: **Project Settings → Script Properties → Add**:
   - `SHEET_ID` = your sheet id.
3. Reload the dashboard. Tabs that read the Sheet now show *your* (empty) data —
   add a task and watch it persist. The app auto-creates tabs it needs
   (`tasks`, `holdings`, `habits`, `bills`, `goals`, `notes`, `countdowns`,
   `audit`, …) on first write.

> Manual rows you add yourself (e.g. a **CPF** or **SRS** row in `holdings`)
> survive every refresh — only IBKR rows get replaced.

## 4. Add credentials to light up each section

Add these as **Script Properties** (one at a time; reload to see the effect).

| Section | Script Properties | Where to get them |
|---------|-------------------|-------------------|
| **Calendar** | `CALENDAR_PERSONAL_IDS` (comma-sep), optional `CALENDAR_BUSY_IDS`, `CALENDAR_BIRTHDAYS_ID` | Google Calendar → each calendar's **Settings → Integrate → Calendar ID**. Put work/gov calendars in `CALENDAR_BUSY_IDS` — they show only as "Busy". |
| **TickTick** | `TICKTICK_ACCESS_TOKEN` | See the walkthrough below — it needs a one-time OAuth dance. |
| **IBKR** | `IBKR_FLEX_TOKEN`, `IBKR_FLEX_QUERY_ID` | See the walkthrough below. |
| **Telegram** | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, (optional) `TELEGRAM_URL_SECRET` | Create a bot via **@BotFather**; get your numeric chat id from **@userinfobot**. |
| **AI (Gemini)** | `GCP_PROJECT_ID`, optional `GCP_LOCATION` | A Google Cloud project with **Vertex AI API** enabled. Uses the script's own OAuth token (`cloud-platform` scope) — no API key to paste. |

### Getting the TickTick token (one-time, ~10 minutes)
TickTick uses OAuth, so the token takes a short one-time dance:
1. Go to the **[TickTick Developer Center](https://developer.ticktick.com/)** →
   **Manage Apps** → create an app. Set the *redirect URI* to
   `https://example.com` (anything works — you'll copy a code off the URL).
2. Note your app's **Client ID** and **Client Secret**.
3. In a browser, open (with your client id filled in):
   `https://ticktick.com/oauth/authorize?client_id=YOUR_ID&scope=tasks:read%20tasks:write&response_type=code&redirect_uri=https://example.com`
   → approve → you land on example.com with `?code=XXXX` in the address bar. Copy it.
4. Exchange the code for a token (any terminal, or an online HTTP tool):
   `curl -u YOUR_ID:YOUR_SECRET -d "code=XXXX&grant_type=authorization_code&redirect_uri=https://example.com" https://ticktick.com/oauth/token`
   The reply contains `"access_token": "…"` — that value is your
   **`TICKTICK_ACCESS_TOKEN`** Script Property.
5. Reload the dashboard: your TickTick tasks appear with a green *TickTick* badge.

### Getting the IBKR Flex token + query id (one-time, ~10 minutes)
1. Log in to **IBKR Client Portal** → **Performance & Reports → Flex Queries**.
2. Create an **Activity Flex Query**: give it a name, and under *Sections* tick
   **Open Positions** (select at least: Symbol, Asset Class, Position/Quantity,
   Cost Basis Price, Position Value, Currency). Save it.
3. The query list now shows a **Query ID** number → that's **`IBKR_FLEX_QUERY_ID`**.
4. Still in Flex Queries, open **Flex Web Service Configuration** → enable it →
   **Generate token** (choose a long expiry; note it expires and must be
   regenerated then). That's **`IBKR_FLEX_TOKEN`**.
5. Add both Script Properties, reload, and press **↻ IBKR** on the Money tab.
   Your live positions replace the IBKR rows (manual CPF/SRS rows are kept).

After adding each, open **More → Settings & diagnostics → Test integrations**
(or run `diagnose()` from the editor). You'll get a per-integration ✅/❌ report.

## 5. Install the scheduled jobs (one click)
In the Apps Script editor, pick **`setupTriggers`** in the function dropdown and
press **Run** once. That installs all five jobs (bot polling every minute, task
reminders, the daily briefing at your `briefingTime`, daily maintenance, and the
weekly health digest) and is safe to re-run — it replaces its own triggers and
never touches anyone else's. Run `removeTriggers` to uninstall them all.

## 6. Enable the Telegram bot (polling — robust, no public URL)
1. Set the three `TELEGRAM_*` properties above.
2. Make sure you ran `setupTriggers` (step 5) — `telegramPoll` is the job that
   reads your messages.
3. Message your bot. Try: `today`, `overdue`, `portfolio`,
   `add task pay rent due Friday`, `note: call mum`.
   Destructive actions (`delete …`, `complete …`) always ask **yes/no** first.
   Only your whitelisted `TELEGRAM_CHAT_ID` is ever served.

> Why polling and not a webhook? Apps Script `/exec` bounces unauthenticated
> external POSTs with a 302, so webhooks are unreliable. Polling every minute is
> rock-solid for a personal bot.

## 7. Adjust behaviour without code
**More → Settings** lets you change timezone, briefing time, week start,
currency, and the SRS annual cap. Secrets are write-only there — values are
never displayed.

## Troubleshooting
- **Mode chip says "Degraded"** → one source errored; hover it (or check the
  warning bar) to see which. The rest of the page still shows last-good data.
- **A section is blank but configured** → that source is genuinely empty (the
  app intentionally does *not* fall back to mock once you've added creds).
- **Run `diagnose()`** from the editor for a live test of every integration —
  it logs a `N/M integrations OK` summary and an audit row.
