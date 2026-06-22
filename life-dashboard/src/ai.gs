/**
 * ai.gs — Gemini via the Vertex AI REST endpoint.
 *
 * v1 lesson: do NOT use the VertexAI "advanced service" wrapper (fragile
 * positional-arg parsing). Call the REST endpoint directly with UrlFetchApp +
 * ScriptApp.getOAuthToken() and the cloud-platform scope. Used for command
 * parsing (nlp.gs) and the daily briefing (briefing.gs). Always optional —
 * callers fall back to regex / templated text.
 */

function _vertexEndpoint(model) {
  var project = cfgGet('GCP_PROJECT_ID');
  var location = cfgGet('GCP_LOCATION') || 'us-central1';
  return 'https://' + location + '-aiplatform.googleapis.com/v1/projects/' + project +
    '/locations/' + location + '/publishers/google/models/' + model + ':generateContent';
}

function _vertexGenerate(prompt, opts) {
  opts = opts || {};
  var model = getSettings().aiModel;
  var payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: opts.temperature || 0.2, maxOutputTokens: opts.maxTokens || 512 }
  };
  var resp = UrlFetchApp.fetch(_vertexEndpoint(model), {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 400) throw new Error('Vertex ' + resp.getResponseCode() + ': ' + resp.getContentText());
  var json = JSON.parse(resp.getContentText());
  var parts = json && json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts;
  return parts && parts[0] ? parts[0].text : '';
}

// Ask the model to emit a strict JSON command. Throws on unparseable output so
// nlp.gs falls back to regex.
function aiParseCommand(text) {
  var prompt =
    'You convert a personal-assistant message into a JSON command. ' +
    'Respond with ONLY minified JSON, no prose. Schema: ' +
    '{"action":"add_task|complete_task|soft_delete_task|add_note|add_bill|query|unknown",' +
    '"target":string?,"params":{}}. ' +
    'For queries, target is one of today|tomorrow|week|overdue|tasks|birthdays|portfolio|srs|cpf|dividends|bills|habits. ' +
    'Message: ' + JSON.stringify(text);
  var out = _vertexGenerate(prompt, { temperature: 0 });
  var jsonText = (out.match(/\{[\s\S]*\}/) || [out])[0];
  var cmd = JSON.parse(jsonText);
  if (!cmd.params) cmd.params = {};
  return cmd;
}

function aiSummarize(prompt) {
  return _vertexGenerate(prompt, { temperature: 0.4, maxTokens: 256 });
}

function aiTestCall() {
  var out = _vertexGenerate('Reply with the single word: ok', { temperature: 0 });
  return { ok: true, sample: String(out).slice(0, 40) };
}
