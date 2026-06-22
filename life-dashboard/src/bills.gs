/**
 * bills.gs — recurring bills & subscriptions.
 *
 * Data in the `bills` tab. Each bill has a cadence (weekly/monthly/annual) and a
 * `next_due` date; we roll that forward past today to compute the true next due,
 * then surface upcoming bills and monthly/annual totals (annual amortised /12).
 */

var BILLS_TAB = 'bills';
var BILL_HEADERS = ['id', 'name', 'amount', 'currency', 'cadence', 'next_due', 'category', 'updated_at'];

function _rollForward(date, cadence, ref) {
  var d = toDate(date);
  var base = startOfDay(ref || now());
  if (!d) return null;
  var guard = 0;
  while (startOfDay(d).getTime() < base.getTime() && guard < 600) {
    if (cadence === 'weekly') d = addDays(d, 7);
    else if (cadence === 'annual') d = new Date(d.getFullYear() + 1, d.getMonth(), d.getDate());
    else d = new Date(d.getFullYear(), d.getMonth() + 1, d.getDate()); // monthly default
    guard++;
  }
  return d;
}

function _decorateBill(b) {
  var next = _rollForward(b.next_due, b.cadence);
  return {
    id: String(b.id),
    name: b.name,
    amount: Number(b.amount) || 0,
    currency: b.currency || 'SGD',
    cadence: b.cadence || 'monthly',
    category: b.category || '',
    next_due: next ? next.toISOString() : null,
    days_until: next ? daysBetween(now(), next) : null,
    relative: next ? relativeTime(next) : ''
  };
}

function getBillsSection() {
  var rows = isConfigured('sheet') ? storeReadAll(BILLS_TAB, BILL_HEADERS) : getMockData().bills;
  var live = isConfigured('sheet');
  var items = rows.map(_decorateBill).sort(function (a, b) {
    return String(a.next_due).localeCompare(String(b.next_due));
  });

  var monthlyTotal = 0, annualTotal = 0;
  items.forEach(function (b) {
    var amt = b.amount;
    if (b.cadence === 'monthly') { monthlyTotal += amt; annualTotal += amt * 12; }
    else if (b.cadence === 'weekly') { monthlyTotal += amt * 4.345; annualTotal += amt * 52; }
    else if (b.cadence === 'annual') { monthlyTotal += amt / 12; annualTotal += amt; }
  });

  return {
    live: live,
    data: {
      items: items,
      monthly_total: round2(monthlyTotal),
      annual_total: round2(annualTotal),
      next_bill: items[0] || null
    }
  };
}

function addBill(name, amount, opts) {
  if (!isConfigured('sheet')) throw new Error('Sheet not configured');
  opts = opts || {};
  var b = {
    id: genId('b'), name: String(name).trim(), amount: Number(amount) || 0,
    currency: opts.currency || 'SGD', cadence: opts.cadence || 'monthly',
    next_due: opts.next_due || addDays(now(), 30).toISOString(), category: opts.category || '',
    updated_at: now().toISOString()
  };
  storeAppend(BILLS_TAB, BILL_HEADERS, b);
  auditLog('bill.add', b.id, { name: b.name, amount: b.amount });
  return { ok: true, bill: _decorateBill(b) };
}
