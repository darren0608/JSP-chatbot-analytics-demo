/**
 * telegram.gs — two-way Telegram assistant (polling) + outbound reminders.
 *
 * Hard-won v1 lessons baked in:
 *   - Webhooks via Apps Script /exec are unreliable (302). Use POLLING: a
 *     1-minute time-trigger calls getUpdates, tracks an offset, processes new
 *     updates. The webhook handler is kept ONLY as an optional path and still
 *     requires a URL secret.
 *   - Deduplicate by update_id (persist last seen) so retries never double-send.
 *
 * Lockdown: whitelist one chat_id; require a URL secret for any webhook;
 * destructive actions need an explicit yes/no; unknown input → clarifying
 * question, never a guessed action.
 */

var TG_API = 'https://api.telegram.org/bot';
var TG_OFFSET_KEY = 'TELEGRAM_LAST_UPDATE_ID';
var TG_PENDING_KEY = 'TELEGRAM_PENDING';

function _tgToken() {
  var t = cfgGet('TELEGRAM_BOT_TOKEN');
  if (!t) throw new Error('TELEGRAM_BOT_TOKEN not configured');
  return t;
}

function telegramSend(text, chatId) {
  var chat = chatId || cfgGet('TELEGRAM_CHAT_ID');
  var resp = UrlFetchApp.fetch(TG_API + _tgToken() + '/sendMessage', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ chat_id: chat, text: text }),
    muteHttpExceptions: true
  });
  return resp.getResponseCode() < 400;
}

function _isWhitelisted(chatId) {
  return String(chatId) === String(cfgGet('TELEGRAM_CHAT_ID'));
}

// --- Polling entrypoint (time trigger) -------------------------------------
function telegramPoll() {
  if (!isConfigured('telegram')) return { ok: false, message: 'Telegram not configured' };
  var lastSeen = Number(cfgGet(TG_OFFSET_KEY)) || 0;
  var resp = UrlFetchApp.fetch(TG_API + _tgToken() + '/getUpdates?offset=' + (lastSeen + 1) + '&timeout=0', { muteHttpExceptions: true });
  var body = JSON.parse(resp.getContentText() || '{}');
  var updates = body.result || [];
  var processed = 0, maxId = lastSeen;

  updates.forEach(function (u) {
    if (u.update_id <= lastSeen) return; // dedup: already processed
    if (u.update_id > maxId) maxId = u.update_id;
    tryOr(null, function () { processUpdate(u); });
    processed++;
  });

  if (maxId > lastSeen) cfgSet(TG_OFFSET_KEY, maxId);
  return { ok: true, processed: processed, offset: maxId };
}

function processUpdate(update) {
  var msg = update.message || update.edited_message;
  if (!msg || !msg.text) return { ignored: true };
  return handleIncoming(msg.chat.id, msg.text);
}

// --- Optional webhook path (requires URL secret) ----------------------------
function telegramWebhook(e) {
  var secret = e && e.parameter && e.parameter.secret;
  if (!secret || secret !== cfgGet('TELEGRAM_URL_SECRET')) {
    return { ok: false, error: 'forbidden' };
  }
  var update = JSON.parse((e.postData && e.postData.contents) || '{}');
  return processUpdate(update);
}

// --- Core message handling --------------------------------------------------
function handleIncoming(chatId, text) {
  if (!_isWhitelisted(chatId)) {
    return { ok: false, rejected: true, reason: 'chat_id not whitelisted' };
  }

  var trimmed = String(text).trim();
  var pending = _getPending();

  // Resolve an outstanding yes/no confirmation first.
  if (pending) {
    if (/^(yes|y|confirm|ok)$/i.test(trimmed)) {
      _clearPending();
      var done = routeCommand({ action: pending.action, params: { title: pending.title } }, { execute: true, actor: 'telegram' });
      telegramSend(done.message, chatId);
      return done;
    }
    if (/^(no|n|cancel|stop)$/i.test(trimmed)) {
      _clearPending();
      telegramSend('Cancelled — nothing changed.', chatId);
      return { ok: true, cancelled: true };
    }
    // Neither yes nor no while pending → re-ask, never guess.
    telegramSend('Please reply yes or no. ' + pending.prompt, chatId);
    return { ok: true, awaiting: true };
  }

  var result = quickCapture(trimmed, { actor: 'telegram' }); // execute:false → destructive returns 'confirm'
  if (result.kind === 'confirm') {
    _setPending({ action: result.action, title: result.target.title, prompt: result.message });
  }
  telegramSend(result.message, chatId);
  return result;
}

// --- Pending-confirmation state ---------------------------------------------
function _getPending() {
  var raw = cfgGet(TG_PENDING_KEY);
  return raw ? JSON.parse(raw) : null;
}
function _setPending(obj) { cfgSet(TG_PENDING_KEY, JSON.stringify(obj)); }
function _clearPending() { cfgSet(TG_PENDING_KEY, ''); }

// --- Outbound reminders (time trigger) --------------------------------------
// Sends reminders for tasks whose reminder_at falls in the last scan window.
function telegramScanReminders() {
  if (!isConfigured('telegram')) return { ok: false };
  var windowMs = (getSettings().reminderScanMinutes || 1) * 60 * 1000;
  var nowT = nowMs();
  var due = tryOr([], listOpenTasks).value.filter(function (t) {
    if (!t.reminder_at) return false;
    var rt = toDate(t.reminder_at).getTime();
    return rt <= nowT && rt > nowT - windowMs;
  });
  due.forEach(function (t) { telegramSend('⏰ Reminder: ' + t.title); });
  return { ok: true, sent: due.length };
}

function telegramTestCall() {
  var resp = UrlFetchApp.fetch(TG_API + _tgToken() + '/getMe', { muteHttpExceptions: true });
  if (resp.getResponseCode() >= 400) throw new Error('Telegram getMe failed');
  return { ok: true };
}
