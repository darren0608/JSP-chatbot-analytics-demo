/**
 * habits.gs — daily/weekly habits with check-offs, streaks, and rings.
 *
 * Data in the `habits` tab. A check-in is a date (ISO) the habit was done. We
 * compute a current streak (consecutive days back from today/yesterday) and a
 * weekly ring (check-ins this week vs target_per_week). Falls back to mock when
 * the Sheet is unconfigured.
 */

var HABITS_TAB = 'habits';
var HABIT_HEADERS = ['id', 'title', 'cadence', 'target_per_week', 'checkins', 'updated_at'];

function _parseCheckins(v) {
  if (Array.isArray(v)) return v.map(function (x) { return isoOf(x); }).filter(Boolean);
  if (!v) return [];
  return String(v).split(',').map(function (s) { return isoOf(s.trim()); }).filter(Boolean);
}

function _currentStreak(checkins, ref) {
  var days = {};
  checkins.forEach(function (c) { days[startOfDay(c).getTime()] = true; });
  var streak = 0;
  // Allow the streak to "hold" if today isn't done yet but yesterday was.
  var cursor = startOfDay(ref || now());
  if (!days[cursor.getTime()]) cursor = addDays(cursor, -1);
  while (days[startOfDay(cursor).getTime()]) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function _checkinsThisWeek(checkins, ref) {
  var weekStart = startOfDay(addDays(now(), -((now().getDay() + 6) % 7))); // Monday-based
  if (ref) weekStart = startOfDay(addDays(toDate(ref), -((toDate(ref).getDay() + 6) % 7)));
  var weekEnd = addDays(weekStart, 7);
  return checkins.filter(function (c) {
    var t = toDate(c).getTime();
    return t >= weekStart.getTime() && t < weekEnd.getTime();
  }).length;
}

function _decorateHabit(h) {
  var checkins = _parseCheckins(h.checkins);
  var target = Number(h.target_per_week) || 7;
  var weekCount = _checkinsThisWeek(checkins);
  return {
    id: String(h.id),
    title: h.title,
    cadence: h.cadence || 'daily',
    target_per_week: target,
    streak: _currentStreak(checkins),
    week_count: weekCount,
    ring: Math.min(1, target ? weekCount / target : 0),
    done_today: checkins.some(function (c) { return isSameDay(c, now()); }),
    checkins: checkins
  };
}

function getHabitsSection() {
  if (!isConfigured('sheet')) {
    return { live: false, data: { items: getMockData().habits.map(_decorateHabit) } };
  }
  var rows = storeReadAll(HABITS_TAB, HABIT_HEADERS);
  return { live: true, data: { items: rows.map(_decorateHabit) } };
}

// Toggle today's check-in for a habit. Idempotent per day.
function checkInHabit(id, dateIso) {
  if (!isConfigured('sheet')) throw new Error('Sheet not configured');
  var rows = storeReadAll(HABITS_TAB, HABIT_HEADERS);
  var row = null;
  for (var i = 0; i < rows.length; i++) if (String(rows[i].id) === String(id)) row = rows[i];
  if (!row) throw new Error('Habit not found: ' + id);

  var checkins = _parseCheckins(row.checkins);
  var when = startOfDay(dateIso || now()).toISOString();
  var already = checkins.some(function (c) { return isSameDay(c, when); });
  if (already) {
    checkins = checkins.filter(function (c) { return !isSameDay(c, when); });
  } else {
    checkins.push(when);
  }
  var updated = storeUpdateById(HABITS_TAB, HABIT_HEADERS, id, {
    checkins: checkins.join(','), updated_at: now().toISOString()
  });
  auditLog('habit.checkin', id, { added: !already, date: when });
  return { ok: true, done_today: !already, habit: _decorateHabit(updated) };
}

function addHabit(title, opts) {
  if (!isConfigured('sheet')) throw new Error('Sheet not configured');
  opts = opts || {};
  var h = { id: genId('h'), title: String(title).trim(), cadence: opts.cadence || 'daily', target_per_week: opts.target_per_week || 7, checkins: '', updated_at: now().toISOString() };
  storeAppend(HABITS_TAB, HABIT_HEADERS, h);
  auditLog('habit.add', h.id, { title: h.title });
  return { ok: true, habit: _decorateHabit(h) };
}
