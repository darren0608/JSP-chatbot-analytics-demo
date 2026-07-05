/**
 * triggers.gs — one-click installation of all scheduled jobs.
 *
 * Run setupTriggers() ONCE from the Apps Script editor (Run ▶) after deploying.
 * It removes any existing triggers it owns and recreates the full set, so it is
 * safe to re-run at any time. Individual jobs no-op safely when their
 * integration isn't configured (e.g. telegramPoll without a bot token).
 */

var MANAGED_TRIGGERS = {
  telegramPoll: true,          // bot inbox (1 min)
  telegramScanReminders: true, // task reminders (5 min)
  pushDailyBriefing: true,     // morning summary (daily, briefingTime hour)
  dailyMaintenance: true,      // compaction + FX refresh (daily, 3am)
  weeklyErrorDigest: true      // health digest (Mondays, 9am)
};

function setupTriggers() {
  // Remove only the triggers this app manages — never someone else's.
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (MANAGED_TRIGGERS[t.getHandlerFunction()]) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });

  ScriptApp.newTrigger('telegramPoll').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('telegramScanReminders').timeBased().everyMinutes(5).create();

  var briefHour = parseInt(String(getSettings().briefingTime).split(':')[0], 10);
  if (isNaN(briefHour) || briefHour < 0 || briefHour > 23) briefHour = 7;
  ScriptApp.newTrigger('pushDailyBriefing').timeBased().atHour(briefHour).everyDays(1).create();

  ScriptApp.newTrigger('dailyMaintenance').timeBased().atHour(3).everyDays(1).create();
  ScriptApp.newTrigger('weeklyErrorDigest').timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).create();

  auditLog('triggers.setup', null, { removed: removed, created: 5 });
  return { ok: true, removed: removed, created: 5 };
}

// Remove every trigger this app manages (e.g. before handing the account over).
function removeTriggers() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (MANAGED_TRIGGERS[t.getHandlerFunction()]) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  auditLog('triggers.remove', null, { removed: removed });
  return { ok: true, removed: removed };
}
