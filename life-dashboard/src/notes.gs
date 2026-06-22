/**
 * notes.gs — lightweight notes / journal / quick inbox with date stamps.
 * Data in the `notes` tab. Newest first.
 */

var NOTES_TAB = 'notes';
var NOTE_HEADERS = ['id', 'text', 'created_at'];

function getNotesSection() {
  var rows = isConfigured('sheet') ? storeReadAll(NOTES_TAB, NOTE_HEADERS) : getMockData().notes;
  var items = rows.map(function (n) {
    return { id: String(n.id), text: n.text, created_at: isoOf(n.created_at), relative: relativeTime(n.created_at) };
  }).sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  return { live: isConfigured('sheet'), data: { items: items } };
}

function addNote(text) {
  if (!isConfigured('sheet')) throw new Error('Sheet not configured');
  if (!text || !String(text).trim()) throw new Error('Note text required');
  var n = { id: genId('n'), text: String(text).trim(), created_at: now().toISOString() };
  storeAppend(NOTES_TAB, NOTE_HEADERS, n);
  auditLog('note.add', n.id, {});
  return { ok: true, note: n };
}
