/**
 * ibkr.gs — Interactive Brokers Flex Web Service auto-pull (READ-ONLY).
 *
 * Two-step protocol: SendRequest -> ReferenceCode, then GetStatement (which may
 * report "in progress" and must be polled). We parse OpenPosition rows and
 * REPLACE ONLY the IBKR account rows in the `holdings` tab, leaving manual rows
 * (CPF, SRS, etc.) untouched. Every refresh is audited. Overlapping refreshes
 * are rejected with a friendly message — never a double-run.
 *
 * Constraint: finance integrations never execute trades or move money.
 */

var FLEX_SEND = 'https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.SendRequest';
var FLEX_GET = 'https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement';
var IBKR_LOCK_KEY = 'IBKR_REFRESH_INPROGRESS';
var HOLDINGS_TAB = 'holdings';
var HOLDING_HEADERS = ['account', 'instrument', 'type', 'units', 'avg_cost', 'current_value', 'annual_dividend_est', 'currency', 'updated_at'];

function _xmlAttr(tag, name) {
  var m = tag.match(new RegExp(name + '="([^"]*)"'));
  return m ? m[1] : '';
}

function _parseFlexPositions(xml) {
  var status = (xml.match(/Status="?([A-Za-z ]+)"?/) || [])[1] || '';
  var positions = [];
  var re = /<OpenPosition\b[^>]*\/?>/g, m;
  while ((m = re.exec(xml)) !== null) {
    var tag = m[0];
    positions.push({
      account: 'IBKR',
      instrument: _xmlAttr(tag, 'symbol'),
      type: _mapAssetCategory(_xmlAttr(tag, 'assetCategory')),
      units: Number(_xmlAttr(tag, 'position')) || 0,
      avg_cost: round2(_xmlAttr(tag, 'costBasisPrice')),
      current_value: round2(_xmlAttr(tag, 'positionValue')),
      annual_dividend_est: 0,
      currency: _xmlAttr(tag, 'currency') || 'USD',
      updated_at: now().toISOString()
    });
  }
  return { status: status, positions: positions };
}

function _mapAssetCategory(c) {
  if (c === 'STK') return 'Stock';
  if (c === 'ETF') return 'ETF';
  if (c === 'BOND') return 'Bond';
  return c || 'Other';
}

function _flexFetch(url) {
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  return resp.getContentText();
}

// Public: pull positions and replace only IBKR rows. Returns a result summary.
function refreshIbkr() {
  if (!isConfigured('ibkr')) {
    return { ok: false, message: 'IBKR not connected. Add IBKR_FLEX_TOKEN and IBKR_FLEX_QUERY_ID in Settings.' };
  }
  if (cfgGet(IBKR_LOCK_KEY) === '1') {
    return { ok: false, busy: true, message: 'An IBKR refresh is already running — please wait a moment.' };
  }

  cfgSet(IBKR_LOCK_KEY, '1');
  try {
    var token = cfgGet('IBKR_FLEX_TOKEN');
    var query = cfgGet('IBKR_FLEX_QUERY_ID');

    var sendXml = _flexFetch(FLEX_SEND + '?t=' + encodeURIComponent(token) + '&q=' + encodeURIComponent(query) + '&v=3');
    var refCode = (sendXml.match(/<ReferenceCode>([^<]+)<\/ReferenceCode>/) || [])[1];
    var baseUrl = (sendXml.match(/<Url>([^<]+)<\/Url>/) || [])[1] || FLEX_GET;
    if (!refCode) {
      var err = (sendXml.match(/<ErrorMessage>([^<]+)<\/ErrorMessage>/) || [])[1] || 'unknown error';
      throw new Error('Flex SendRequest failed: ' + err);
    }

    // Poll GetStatement until it stops saying "in progress" (bounded).
    var parsed = null;
    for (var attempt = 0; attempt < 5; attempt++) {
      var stmtXml = _flexFetch(baseUrl + '?t=' + encodeURIComponent(token) + '&q=' + encodeURIComponent(refCode) + '&v=3');
      var p = _parseFlexPositions(stmtXml);
      if (/in progress/i.test(stmtXml) || /Warn/.test(p.status)) {
        Utilities.sleep(1000);
        continue;
      }
      parsed = p;
      break;
    }
    if (!parsed) return { ok: false, message: 'IBKR statement still generating — try again shortly.' };

    var count = storeReplaceWhere(HOLDINGS_TAB, HOLDING_HEADERS, 'account', 'IBKR', parsed.positions);
    auditLog('ibkr.refresh', 'IBKR', { positions: parsed.positions.length });
    return { ok: true, replaced: count, positions: parsed.positions.length };
  } catch (e) {
    return { ok: false, message: 'IBKR refresh failed: ' + (e.message || e) };
  } finally {
    cfgSet(IBKR_LOCK_KEY, '0');
  }
}

function ibkrTestCall() {
  if (!isConfigured('ibkr')) throw new Error('IBKR not configured');
  var token = cfgGet('IBKR_FLEX_TOKEN'), query = cfgGet('IBKR_FLEX_QUERY_ID');
  var xml = _flexFetch(FLEX_SEND + '?t=' + encodeURIComponent(token) + '&q=' + encodeURIComponent(query) + '&v=3');
  if (!/<ReferenceCode>/.test(xml)) throw new Error('Flex did not return a reference code');
  return { ok: true };
}
