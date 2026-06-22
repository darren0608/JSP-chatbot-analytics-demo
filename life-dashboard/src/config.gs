/**
 * config.gs — single source of truth.
 *
 * Holds: the canonical Sheet id, Script-Property accessors (cfgGet/cfgSet/
 * cfgIsSet), the required-credential registry per integration, user settings
 * with sane defaults, and the COMPLETE mock dataset (getMockState) so the app
 * renders fully with zero credentials.
 *
 * Constraint: no secret ever leaves the server. cfgGet reads PropertiesService;
 * the frontend only ever receives derived state, never raw credentials.
 */

// The one canonical datastore. Set via Script Property SHEET_ID in production.
function getSheetId() {
  return cfgGet('SHEET_ID') || '';
}

// --- Script Property accessors ---------------------------------------------
function cfgGet(key) {
  try {
    var v = PropertiesService.getScriptProperties().getProperty(key);
    return v === null ? '' : v;
  } catch (e) {
    return '';
  }
}

function cfgSet(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, String(value));
  return true;
}

function cfgIsSet(key) {
  var v = cfgGet(key);
  return v !== null && v !== undefined && String(v).trim() !== '';
}

// Are ALL the listed keys present?
function cfgAllSet(keys) {
  for (var i = 0; i < keys.length; i++) {
    if (!cfgIsSet(keys[i])) return false;
  }
  return true;
}

// --- Required-credential registry ------------------------------------------
// Each integration declares the Script Properties it needs to go "live".
// diagnose() and section assembly read this so behaviour is data-driven.
var CREDENTIAL_REGISTRY = {
  sheet:    { label: 'Google Sheet',    keys: ['SHEET_ID'] },
  calendar: { label: 'Google Calendar', keys: ['CALENDAR_PERSONAL_IDS'] },
  ticktick: { label: 'TickTick',        keys: ['TICKTICK_ACCESS_TOKEN'] },
  telegram: { label: 'Telegram bot',    keys: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'] },
  ibkr:     { label: 'IBKR Flex',       keys: ['IBKR_FLEX_TOKEN', 'IBKR_FLEX_QUERY_ID'] },
  ai:       { label: 'Gemini (Vertex)', keys: ['GCP_PROJECT_ID'] }
};

function isConfigured(integration) {
  var reg = CREDENTIAL_REGISTRY[integration];
  if (!reg) return false;
  return cfgAllSet(reg.keys);
}

// --- Settings (defaults; overridable via Settings screen) -------------------
var DEFAULT_SETTINGS = {
  timezone: 'Asia/Singapore',
  weekStart: 'mon',          // 'mon' | 'sun'
  timeViewDays: 7,
  reminderScanMinutes: 1,
  briefingTime: '07:00',
  aiModel: 'gemini-2.0-flash',
  currency: 'SGD',
  srsAnnualCap: 15300,       // SGD, SRS cap for citizens/PRs
  theme: 'system'            // 'light' | 'dark' | 'system'
};

function getSettings() {
  var s = {};
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
    var override = cfgGet('SETTING_' + k);
    s[k] = (override === '' || override === null) ? DEFAULT_SETTINGS[k] : coerceSetting(k, override);
  });
  return s;
}

function setSetting(key, value) {
  if (!DEFAULT_SETTINGS.hasOwnProperty(key)) throw new Error('Unknown setting: ' + key);
  cfgSet('SETTING_' + key, value);
  return getSettings();
}

function coerceSetting(key, raw) {
  var def = DEFAULT_SETTINGS[key];
  if (typeof def === 'number') return Number(raw);
  return raw;
}

// The timezone Apps Script actually runs in (from the manifest). All Date math
// uses this; if it drifts from settings.timezone, diagnose() flags it so the
// owner fixes the manifest rather than getting silently wrong times.
function getScriptTimeZone() {
  return tryOr(getSettings().timezone, function () { return Session.getScriptTimeZone(); }).value;
}

function timezoneIsConsistent() {
  return getScriptTimeZone() === getSettings().timezone;
}

// --- Complete mock dataset --------------------------------------------------
// Built relative to now() so the demo always looks current. Each section's
// module falls back to the matching slice of this when its creds are absent.
function getMockData() {
  var d = function (offsetDays, h, m) {
    var x = startOfDay(addDays(now(), offsetDays));
    x.setHours(h || 0, m || 0, 0, 0);
    return x.toISOString();
  };

  return {
    tasks: [
      { id: 'mt1', title: 'Renew passport', source: 'sheet', due: d(2, 0, 0), reminder_at: d(1, 9, 0), status: 'open', notes: 'ICA online', updated_at: d(-3, 10, 0) },
      { id: 'mt2', title: 'Reply to landlord about lease', source: 'sheet', due: d(-1, 18, 0), reminder_at: null, status: 'open', notes: '', updated_at: d(-2, 8, 0) },
      { id: 'mt3', title: 'Team standup', source: 'ticktick', due: d(0, 9, 30), reminder_at: d(0, 9, 15), status: 'open', notes: '', updated_at: d(0, 7, 0) },
      { id: 'mt4', title: 'Buy running shoes', source: 'ticktick', due: null, reminder_at: null, status: 'open', notes: 'size 9', updated_at: d(-5, 12, 0) },
      { id: 'mt5', title: 'Submit expense claim', source: 'sheet', due: d(3, 17, 0), reminder_at: null, status: 'open', notes: '', updated_at: d(-1, 9, 0) }
    ],
    events: [
      { id: 'me1', title: 'Dentist', start: d(0, 14, 0), end: d(0, 15, 0), allDay: false, owned: true, calendar: 'personal' },
      { id: 'me2', title: 'Busy', start: d(0, 10, 0), end: d(0, 11, 30), allDay: false, owned: false, calendar: 'work' },
      { id: 'me3', title: 'Dinner with Sam', start: d(1, 19, 0), end: d(1, 21, 0), allDay: false, owned: true, calendar: 'personal' },
      { id: 'me4', title: 'Flight to Tokyo', start: d(5, 8, 0), end: d(5, 15, 0), allDay: false, owned: true, calendar: 'personal' }
    ],
    holdings: [
      { account: 'IBKR', instrument: 'VWRA', type: 'ETF', units: 120, avg_cost: 95.2, current_value: 12480, annual_dividend_est: 180, currency: 'USD', updated_at: d(0, 6, 0) },
      { account: 'IBKR', instrument: 'D05 (DBS)', type: 'Stock', units: 400, avg_cost: 31.1, current_value: 14600, annual_dividend_est: 720, currency: 'SGD', updated_at: d(0, 6, 0) },
      { account: 'CPF', instrument: 'CPF OA+SA+MA', type: 'Retirement', units: 1, avg_cost: 0, current_value: 142300, annual_dividend_est: 0, currency: 'SGD', updated_at: d(-10, 0, 0) },
      { account: 'SRS', instrument: 'SRS Cash', type: 'Retirement', units: 1, avg_cost: 0, current_value: 8200, annual_dividend_est: 0, currency: 'SGD', updated_at: d(-10, 0, 0) }
    ],
    dividends: [
      { instrument: 'D05 (DBS)', amount: 180, currency: 'SGD', pay_date: d(20, 0, 0) },
      { instrument: 'VWRA', amount: 45, currency: 'USD', pay_date: d(40, 0, 0) }
    ],
    habits: [
      { id: 'mh1', title: 'Exercise', cadence: 'daily', target_per_week: 5, checkins: [d(-1), d(-2), d(-4)], updated_at: d(0) },
      { id: 'mh2', title: 'Read 20 min', cadence: 'daily', target_per_week: 7, checkins: [d(0), d(-1), d(-2), d(-3)], updated_at: d(0) },
      { id: 'mh3', title: 'No takeout', cadence: 'daily', target_per_week: 5, checkins: [d(-2), d(-3)], updated_at: d(0) }
    ],
    bills: [
      { id: 'mb1', name: 'Rent', amount: 2600, currency: 'SGD', cadence: 'monthly', next_due: d(4), category: 'Housing', updated_at: d(-30) },
      { id: 'mb2', name: 'Spotify', amount: 16.58, currency: 'SGD', cadence: 'monthly', next_due: d(12), category: 'Media', updated_at: d(-30) },
      { id: 'mb3', name: 'Insurance', amount: 220, currency: 'SGD', cadence: 'monthly', next_due: d(22), category: 'Insurance', updated_at: d(-30) },
      { id: 'mb4', name: 'Domain renewal', amount: 18, currency: 'USD', cadence: 'annual', next_due: d(60), category: 'Tech', updated_at: d(-30) }
    ],
    goals: [
      { id: 'mg1', title: 'Emergency fund', target: 30000, current: 19500, unit: 'SGD', due: d(120), updated_at: d(0) },
      { id: 'mg2', title: 'Run 500km in 2026', target: 500, current: 212, unit: 'km', due: d(190), updated_at: d(0) }
    ],
    notes: [
      { id: 'mn1', text: 'Idea: weekend trip to Bintan in Aug', created_at: d(-1, 21, 0) },
      { id: 'mn2', text: 'Wine Sam liked: Cloudy Bay Sauv Blanc', created_at: d(-4, 20, 0) }
    ],
    countdowns: [
      { id: 'mc1', title: "Mum's birthday", date: d(9), kind: 'birthday', source: 'sheet' },
      { id: 'mc2', title: 'Tokyo trip', date: d(5), kind: 'trip', source: 'sheet' },
      { id: 'mc3', title: 'Wedding anniversary', date: d(34), kind: 'anniversary', source: 'sheet' }
    ]
  };
}
