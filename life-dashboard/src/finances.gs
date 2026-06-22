/**
 * finances.gs — net-worth / portfolio snapshot (READ-ONLY) for a SG user.
 *
 * Reads the `holdings` and `dividends` tabs (manual rows like CPF/SRS survive
 * refreshes; IBKR rows are refreshed by ibkr.gs). Computes summary cards:
 * total portfolio value, est. annual dividends, SRS balance + remaining top-up
 * room (cap − balance), and CPF total. Falls back to mock only when the Sheet
 * is not configured.
 */

var DIVIDENDS_TAB = 'dividends';
var DIVIDEND_HEADERS = ['instrument', 'amount', 'currency', 'pay_date'];

// FX to SGD now comes from fx.gs (Sheet/feed-backed, cached) rather than a
// constant. Headline totals are therefore approximate → flagged estimated:true.
function _toSgd(amount, currency) {
  return fxToSgd(amount, currency);
}

function _readHoldings() {
  if (!isConfigured('sheet')) return { live: false, holdings: getMockData().holdings.slice() };
  return { live: true, holdings: storeReadAll(HOLDINGS_TAB, HOLDING_HEADERS) };
}

function _readDividends() {
  if (!isConfigured('sheet')) return getMockData().dividends.slice();
  return storeReadAll(DIVIDENDS_TAB, DIVIDEND_HEADERS);
}

function getFinancesSection() {
  var h = _readHoldings();
  var holdings = h.holdings;
  var settings = getSettings();
  var asOf = now().toISOString();

  var totalSgd = 0, dividendsSgd = 0, srsBalance = 0, cpfTotal = 0;
  holdings.forEach(function (row) {
    totalSgd += _toSgd(row.current_value, row.currency);
    dividendsSgd += _toSgd(row.annual_dividend_est, row.currency);
    if (String(row.account).toUpperCase() === 'SRS') srsBalance += Number(row.current_value) || 0;
    if (String(row.account).toUpperCase() === 'CPF') cpfTotal += Number(row.current_value) || 0;
  });

  var cap = settings.srsAnnualCap;
  // estimated:true wherever multi-currency holdings were converted via FX.
  var summary = {
    total_portfolio_value: { value: round2(totalSgd), as_of: asOf, currency: 'SGD', estimated: true },
    annual_dividends_est: { value: round2(dividendsSgd), as_of: asOf, currency: 'SGD', estimated: true },
    srs_balance: { value: round2(srsBalance), as_of: asOf, currency: 'SGD' },
    srs_topup_remaining: { value: round2(Math.max(0, cap - srsBalance)), cap: cap, as_of: asOf, currency: 'SGD' },
    cpf_total: { value: round2(cpfTotal), as_of: asOf, currency: 'SGD' }
  };

  return { live: h.live, data: { summary: summary, holdings: holdings, dividends: _readDividends() } };
}
