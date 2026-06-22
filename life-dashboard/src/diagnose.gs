/**
 * diagnose.gs — one-click self-check.
 *
 * For every integration: is it configured? does a live test call succeed?
 * Returns structured per-integration status and logs a summary. This saved
 * enormous debugging time in v1 — run it from the Apps Script editor or the
 * Settings screen's "test each integration" button.
 */

var INTEGRATION_TESTS = {
  calendar: function () { return calendarTestCall(); },
  ticktick: function () { return tickTickTestCall(); },
  telegram: function () { return telegramTestCall(); },
  ibkr: function () { return ibkrTestCall(); },
  ai: function () { return aiTestCall(); }
};

function diagnose() {
  var report = { generatedAt: now().toISOString(), integrations: [] };

  // Sheet first (foundational).
  report.integrations.push(_diagOne('sheet', function () {
    var n = storeReadAll('audit', AUDIT_HEADERS); // any read proves access
    return { ok: true, auditRows: n.length };
  }));

  Object.keys(INTEGRATION_TESTS).forEach(function (key) {
    report.integrations.push(_diagOne(key, INTEGRATION_TESTS[key]));
  });

  var ok = report.integrations.filter(function (i) { return i.status === 'ok'; }).length;
  report.summary = ok + '/' + report.integrations.length + ' integrations OK';
  tryOr(null, function () { auditLog('diagnose.run', null, report.summary); });
  return report;
}

function _diagOne(key, testFn) {
  var reg = CREDENTIAL_REGISTRY[key];
  if (!reg || !isConfigured(key)) {
    return { key: key, label: reg ? reg.label : key, status: 'not_configured', detail: reg ? ('missing: ' + reg.keys.filter(function (k) { return !cfgIsSet(k); }).join(', ')) : '' };
  }
  var r = tryOr(null, testFn);
  return r.ok
    ? { key: key, label: reg.label, status: 'ok', detail: r.value }
    : { key: key, label: reg.label, status: 'error', detail: r.error };
}
