/**
 * countdowns.gs — key dates with "days until".
 *
 * Sources: the `countdowns` tab (manual) plus birthdays from a Google
 * "Birthdays" calendar (CALENDAR_BIRTHDAYS_ID) on a 30-day look-ahead. Birthday
 * titles from a personal birthdays calendar are fine to read (not work/gov).
 */

var COUNTDOWNS_TAB = 'countdowns';
var COUNTDOWN_HEADERS = ['id', 'title', 'date', 'kind', 'source'];

function _decorateCountdown(c) {
  var date = isoOf(c.date);
  return {
    id: String(c.id),
    title: c.title,
    date: date,
    kind: c.kind || 'date',
    source: c.source || 'sheet',
    days_until: date ? daysBetween(now(), date) : null,
    relative: date ? relativeTime(date) : ''
  };
}

function _readBirthdayCalendar(days) {
  var calId = cfgGet('CALENDAR_BIRTHDAYS_ID');
  if (!calId) return [];
  var cal = CalendarApp.getCalendarById(calId);
  if (!cal) return [];
  var start = startOfDay(now());
  var end = addDays(start, days || 30);
  return cal.getEvents(start, end).map(function (ev) {
    return { id: 'bday_' + ev.getId(), title: ev.getTitle(), date: ev.getStartTime().toISOString(), kind: 'birthday', source: 'calendar' };
  });
}

function getCountdownsSection() {
  var manual = isConfigured('sheet') ? storeReadAll(COUNTDOWNS_TAB, COUNTDOWN_HEADERS) : getMockData().countdowns;
  var live = isConfigured('sheet') || isConfigured('calendar');
  var rows = manual.slice();
  if (isConfigured('calendar')) {
    tryOr([], function () { return _readBirthdayCalendar(30); }).value.forEach(function (b) { rows.push(b); });
  }
  var items = rows.map(_decorateCountdown)
    .filter(function (c) { return c.days_until === null || c.days_until >= 0; })
    .sort(function (a, b) { return (a.days_until == null ? 1e9 : a.days_until) - (b.days_until == null ? 1e9 : b.days_until); });
  return { live: live, data: { items: items } };
}

// Birthdays within N days — used by the Telegram bot query.
function getUpcomingBirthdays(days) {
  return getCountdownsSection().data.items.filter(function (c) {
    return c.kind === 'birthday' && c.days_until != null && c.days_until <= (days || 30);
  });
}
