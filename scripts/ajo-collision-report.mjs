/**
 * Ajo Trust Model v2 — Part 2, Step 1
 * Collision report: identifies every aso_clients row where the two fee
 * systems conflict, and checks the ledger for actual double-charging.
 */
import { db, q } from './db.mjs';

const fmt = (n) => '₦' + parseFloat(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 });

// ── 1. Fetch all active clients ───────────────────────────────────────────────
const clients = await q(
  db.from('aso_clients')
    .select('id, full_name, withdrawal_fee_percent, commission_model, commission_percent, ajo_group_id, registration_charge')
    .is('archived_at', null)
);

// ── 2. Categorise ─────────────────────────────────────────────────────────────
const buckets = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
for (const c of clients) {
  const wfp   = parseFloat(c.withdrawal_fee_percent) || 0;
  const model = c.commission_model || 'none';
  if      (wfp > 0 && model === 'percent')       buckets[1].push(c);
  else if (wfp === 0 && model === 'percent')     buckets[2].push(c);
  else if (model === 'first_period' && wfp > 0)  buckets[3].push(c);
  else if (model === 'first_period' && wfp === 0) buckets[4].push(c);
  else if (wfp > 0 && model === 'none')          buckets[5].push(c);
  else                                           buckets[6].push(c);
}

// ── 3. Summary ────────────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════════════════════════');
console.log(' AJO FEE COLLISION REPORT — pre-migration analysis');
console.log('════════════════════════════════════════════════════════════');
console.log('\n── CASE COUNTS (active clients only) ──────────────────────');
console.log(`  Case 1  COLLISION wfp>0 + commission_model='percent'   : ${buckets[1].length}`);
console.log(`  Case 2  percent only (commission_percent path)          : ${buckets[2].length}`);
console.log(`  Case 3  COLLISION first_period + wfp>0                 : ${buckets[3].length}`);
console.log(`  Case 4  first_period only                              : ${buckets[4].length}`);
console.log(`  Case 5  wfp only → migrates to percent                 : ${buckets[5].length}`);
console.log(`  Case 6  no fee                                         : ${buckets[6].length}`);
console.log(`  ─────────────────────────────────────────────────────────`);
console.log(`  TOTAL active clients                                   : ${clients.length}`);

// ── 4. Collision client detail ────────────────────────────────────────────────
const collisionClients = [...buckets[1], ...buckets[3]];

if (collisionClients.length === 0) {
  console.log('\n✓ Zero collision clients — migration is clean for all cases.\n');
  process.exit(0);
}

console.log('\n── COLLISION CLIENT DETAIL ─────────────────────────────────');
for (const c of collisionClients) {
  const wfp    = parseFloat(c.withdrawal_fee_percent) || 0;
  const caseNo = buckets[1].includes(c) ? 1 : 3;
  const outcome = caseNo === 1
    ? `→ percent @ ${wfp}%  (wfp wins; commission_percent ${c.commission_percent ?? 'null'} discarded)`
    : `→ first_period       (wfp ${wfp}% zeroed)`;
  const groupTag = c.ajo_group_id ? ' [GROUP-LINKED]' : '';
  console.log(`\n  [Case ${caseNo}]${groupTag} ${c.full_name}`);
  console.log(`    id                : ${c.id}`);
  console.log(`    withdrawal_fee_%  : ${wfp}`);
  console.log(`    commission_model  : ${c.commission_model}`);
  console.log(`    commission_percent: ${c.commission_percent ?? 'null'}`);
  console.log(`    registration_fee  : ${fmt(c.registration_charge)}`);
  console.log(`    migration outcome : ${outcome}`);
}

// ── 5. Double-charge ledger check ─────────────────────────────────────────────
console.log('\n── DOUBLE-CHARGE LEDGER CHECK ──────────────────────────────');

const collisionIds = collisionClients.map(c => c.id);
const contribs = await q(
  db.from('ajo_contributions')
    .select('aso_client_id, type, amount')
    .in('aso_client_id', collisionIds)
    .in('type', ['withdrawal_fee', 'commission'])
);

let anyDoubleCharge = false;
for (const c of collisionClients) {
  const rows     = contribs.filter(r => r.aso_client_id === c.id);
  const wfRows   = rows.filter(r => r.type === 'withdrawal_fee');
  const commRows = rows.filter(r => r.type === 'commission');
  const wfTotal  = wfRows.reduce((s, r) => s + parseFloat(r.amount), 0);
  const commTotal = commRows.reduce((s, r) => s + parseFloat(r.amount), 0);

  const flag = wfRows.length > 0 && commRows.length > 0
    ? '⚠  DOUBLE-CHARGED — reversal decision required'
    : wfRows.length > 0  ? 'withdrawal_fee only (no commission)'
    : commRows.length > 0 ? 'commission only (no withdrawal_fee)'
    : 'no fee rows in ledger';

  if (wfRows.length > 0 && commRows.length > 0) anyDoubleCharge = true;

  console.log(`\n  ${c.full_name}`);
  console.log(`    withdrawal_fee rows : ${wfRows.length}  total ${fmt(wfTotal)}`);
  console.log(`    commission rows     : ${commRows.length}  total ${fmt(commTotal)}`);
  console.log(`    verdict             : ${flag}`);
}

if (!anyDoubleCharge) {
  console.log('\n✓ No actual double-charging found. Safe to migrate without reversals.');
} else {
  console.log('\n⚠  One or more clients carry both fee types. Each flagged above requires');
  console.log('   an explicit reversal decision before the migration runs.');
}

console.log('\n════════════════════════════════════════════════════════════\n');
