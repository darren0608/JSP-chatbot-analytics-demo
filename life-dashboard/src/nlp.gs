/**
 * nlp.gs — natural-language → structured command parsing.
 *
 * parseCommand() tries the AI parser (ai.gs) first, then ALWAYS falls back to a
 * deterministic regex parser so common commands work with zero AI config or
 * when the LLM is down (a hard-won v1 lesson). Output shape:
 *   { action, target?, params:{}, confidence, source:'ai'|'regex' }
 * Unknown input → action 'unknown' (the bot then asks a clarifying question,
 * never guesses a destructive action).
 */

var QUERY_KEYWORDS = {
  today: 'today', tomorrow: 'tomorrow', 'this week': 'week', week: 'week',
  overdue: 'overdue', tasks: 'tasks', 'open tasks': 'tasks',
  birthdays: 'birthdays', portfolio: 'portfolio', 'net worth': 'portfolio',
  srs: 'srs', cpf: 'cpf', dividends: 'dividends', bills: 'bills', habits: 'habits'
};

// Parse a relative/absolute "when" phrase into an ISO datetime (end of day).
function parseWhen(text) {
  if (!text) return null;
  var s = String(text).toLowerCase().trim();
  var base = startOfDay(now());
  if (/\btoday\b/.test(s)) return _eod(base);
  if (/\btomorrow\b/.test(s)) return _eod(addDays(base, 1));
  if (/\bnext week\b/.test(s)) return _eod(addDays(base, 7));
  var inN = s.match(/\bin (\d+) days?\b/);
  if (inN) return _eod(addDays(base, Number(inN[1])));
  var weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (var i = 0; i < weekdays.length; i++) {
    if (new RegExp('\\b' + weekdays[i] + '\\b').test(s)) {
      var delta = (i - base.getDay() + 7) % 7 || 7;
      return _eod(addDays(base, delta));
    }
  }
  var iso = s.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return _eod(toDate(iso[1]));
  return null;
}
function _eod(d) { var x = startOfDay(d); x.setHours(18, 0, 0, 0); return x.toISOString(); }

// Parse a raw task-entry string into {title, due}. Used by the Tasks tab's add
// box, which must ALWAYS create a task — unlike quick capture, it never routes
// to queries, so "buy milk tomorrow" becomes a task, not an agenda lookup.
function parseTaskInput(text) {
  var raw = String(text || '').trim();
  var due = null, title = raw;
  var m = raw.match(/\s+(due|by|on)\s+(.+)$/i);
  if (m) {
    due = parseWhen(m[2]);
    if (due) title = raw.slice(0, m.index).trim();
  }
  if (!due) {
    // Bare trailing time word: "buy milk tomorrow" / "call mum friday"
    var tail = raw.match(/\s+(today|tomorrow|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i);
    if (tail) {
      due = parseWhen(tail[1]);
      if (due) title = raw.slice(0, tail.index).trim();
    }
  }
  return { title: title || raw, due: due };
}

// Deterministic fallback parser. Always available.
function regexParse(text) {
  var raw = String(text || '').trim();
  var s = raw.toLowerCase();
  if (!s) return { action: 'unknown', params: {}, confidence: 0, source: 'regex' };

  var m;
  if ((m = raw.match(/^add\s+task\s+(.+)/i))) {
    var rest = m[1];
    var when = null;
    var dueMatch = rest.match(/\s+(due|by|on)\s+(.+)$/i);
    var title = rest;
    if (dueMatch) {
      when = parseWhen(dueMatch[2]);
      if (when) title = rest.slice(0, dueMatch.index).trim();
    }
    return { action: 'add_task', params: { title: title, due: when }, confidence: 0.9, source: 'regex' };
  }
  if ((m = raw.match(/^(complete|done|finish)\s+(.+)/i))) {
    return { action: 'complete_task', target: m[2].trim(), params: { title: m[2].trim() }, confidence: 0.8, source: 'regex' };
  }
  if ((m = raw.match(/^(delete|remove)\s+(.+)/i))) {
    return { action: 'soft_delete_task', target: m[2].trim(), params: { title: m[2].trim() }, confidence: 0.8, source: 'regex' };
  }
  if ((m = raw.match(/^(note:?|remember)\s+(.+)/i))) {
    return { action: 'add_note', params: { text: m[2].trim() }, confidence: 0.85, source: 'regex' };
  }
  if ((m = raw.match(/^add\s+bill\s+(.+?)\s+\$?(\d+(?:\.\d+)?)/i))) {
    return { action: 'add_bill', params: { name: m[1].trim(), amount: Number(m[2]) }, confidence: 0.8, source: 'regex' };
  }

  var keys = Object.keys(QUERY_KEYWORDS).sort(function (a, b) { return b.length - a.length; });
  for (var i = 0; i < keys.length; i++) {
    if (new RegExp('(^|\\b)' + keys[i].replace(/ /g, '\\s+') + '($|\\b)').test(s)) {
      return { action: 'query', target: QUERY_KEYWORDS[keys[i]], params: {}, confidence: 0.7, source: 'regex' };
    }
  }
  return { action: 'unknown', params: { text: raw }, confidence: 0, source: 'regex' };
}

// Public entrypoint: AI first (if configured), regex fallback always.
function parseCommand(text) {
  if (isConfigured('ai')) {
    var ai = tryOr(null, function () { return aiParseCommand(text); });
    if (ai.ok && ai.value && ai.value.action && ai.value.action !== 'unknown') {
      ai.value.source = 'ai';
      return ai.value;
    }
  }
  return regexParse(text);
}
