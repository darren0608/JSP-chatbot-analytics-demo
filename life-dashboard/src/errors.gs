/**
 * errors.gs — lightweight observability.
 *
 * The audit log records intended writes; this records things that GO WRONG
 * (degraded sections, failed integrations) to an append-only `errors` tab, so a
 * non-technical owner gets a weekly Telegram digest instead of silently
 * tolerating a broken integration for months.
 *
 * Writes are rate-limited per source (once/hour via CacheService) so a source
 * that fails on every 30s refresh doesn't flood the tab.
 */

var ERRORS_TAB = 'errors';
var ERROR_HEADERS = ['ts', 'source', 'message'];

function logError(source, message) {
  var key = 'errseen_' + source;
  if (cacheGet(key)) return false;            // already logged this source recently
  cachePut(key, 1, 3600);                      // suppress dupes for an hour
  tryOr(null, function () {
    storeAppend(ERRORS_TAB, ERROR_HEADERS, { ts: now().toISOString(), source: source, message: String(message).slice(0, 500) });
  });
  return true;
}

// Called during state assembly: persist any degraded sections (rate-limited).
function recordDegradations(state) {
  (state.warnings || []).forEach(function (w) {
    logError('section:' + w.section, w.message);
  });
}

function readErrors(sinceMs) {
  if (!isConfigured('sheet')) return [];
  var cutoff = sinceMs || 0;
  return storeReadAll(ERRORS_TAB, ERROR_HEADERS).filter(function (r) {
    var t = toDate(r.ts);
    return t && t.getTime() >= cutoff;
  });
}

// Time-trigger entrypoint (weekly): summarise the week's errors + current
// degraded sources, push to Telegram. Silent if everything's healthy.
function weeklyErrorDigest() {
  var since = nowMs() - 7 * 24 * 3600 * 1000;
  var errs = readErrors(since);
  var degradedNow = [];
  tryOr(null, function () {
    var st = getDashboardState();
    Object.keys(st.sources).forEach(function (k) { if (st.sources[k] === 'degraded') degradedNow.push(k); });
  });

  if (!errs.length && !degradedNow.length) {
    auditLog('digest.weekly', null, 'all healthy');
    return { ok: true, healthy: true };
  }

  var bySource = {};
  errs.forEach(function (e) { bySource[e.source] = (bySource[e.source] || 0) + 1; });
  var lines = ['📊 Weekly health digest'];
  if (degradedNow.length) lines.push('Currently degraded: ' + degradedNow.join(', '));
  if (errs.length) {
    lines.push(errs.length + ' issue(s) logged this week:');
    Object.keys(bySource).forEach(function (s) { lines.push('• ' + s + ' ×' + bySource[s]); });
  } else {
    lines.push('No errors logged — looks healthy now.');
  }
  var text = lines.join('\n');
  if (isConfigured('telegram')) tryOr(null, function () { return telegramSend(text); });
  auditLog('digest.weekly', null, { errors: errs.length, degraded: degradedNow.length });
  return { ok: true, text: text, errors: errs.length, degraded: degradedNow };
}
