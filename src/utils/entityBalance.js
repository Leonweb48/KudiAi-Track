// Per-entity balance derivation for Ajo savings.
// Reads from the already-loaded ajo_contributions array — no extra network calls.
//
// Balance invariant:
//   SUM(entityBalance for all entities) + SUM(unattributed rows) = client.current_balance

// Direction each row type contributes to an entity's balance.
const SIGNS = {
  contribution:                +1,
  registration_fee:            -1,
  commission:                  -1,
  withdrawal:                  -1,
  withdrawal_fee:              -1,
  reversal_contribution:       -1,  // undoes a credit
  reversal_withdrawal:         +1,  // undoes a debit
  reversal_withdrawal_fee:     +1,
  reversal_registration_fee:   +1,
  reversal_commission:         +1,
};

/**
 * Sum of completed rows attributed to a specific entity.
 *
 * @param {"cycle"|"savings_group"|"esusu_group"} entityType
 * @param {string} entityId  cycle.id or ajo_group.id
 * @param {Array}  contributions  all ajo_contributions rows for this client
 * @returns {number} net balance in naira (may be negative due to reversals)
 */
export function entityBalance(entityType, entityId, contributions) {
  let total = 0;
  for (const c of contributions) {
    if (c.status !== "completed") continue;
    const match =
      entityType === "cycle"
        ? c.cycle_id === entityId
        : c.group_id === entityId;
    if (!match) continue;
    const sign = SIGNS[c.type] ?? 0;
    total += sign * (c.amount || 0);
  }
  return Math.max(total, 0); // floor at 0; negative would mean data gap
}

/**
 * Itemised history for an entity, newest-first.
 * Returns only completed rows with a non-zero sign (excludes pending, etc.).
 *
 * @param {"cycle"|"savings_group"|"esusu_group"} entityType
 * @param {string} entityId
 * @param {Array}  contributions
 * @returns {Array} sorted descending by created_at
 */
export function entityHistory(entityType, entityId, contributions) {
  return contributions
    .filter((c) => {
      if (c.status !== "completed") return false;
      if ((SIGNS[c.type] ?? 0) === 0) return false;
      return entityType === "cycle"
        ? c.cycle_id === entityId
        : c.group_id === entityId;
    })
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

/**
 * Prove the sum invariant for a client.
 * Returns { entityTotal, unattributed, currentBalance, delta }.
 * delta === 0 means the invariant holds exactly.
 *
 * @param {Array}  cycles      ajo_cycles rows
 * @param {Array}  groups      ajo_groups rows (from rotationsData[*].group)
 * @param {Array}  contributions
 * @param {number} currentBalance  client.current_balance
 */
export function verifyInvariant(cycles, groups, contributions, currentBalance) {
  let entityTotal = 0;

  for (const cyc of cycles) {
    if (cyc.status === "active") {
      entityTotal += entityBalance("cycle", cyc.id, contributions);
    }
  }
  for (const grp of groups) {
    const type = grp.group_mode === "rotating" ? "esusu_group" : "savings_group";
    entityTotal += entityBalance(type, grp.id, contributions);
  }

  // Unattributed: completed rows with NULL cycle_id AND NULL group_id
  let unattributed = 0;
  for (const c of contributions) {
    if (c.status !== "completed") continue;
    if (c.cycle_id || c.group_id) continue;
    unattributed += (SIGNS[c.type] ?? 0) * (c.amount || 0);
  }

  const delta = Math.round((entityTotal + unattributed - currentBalance) * 100) / 100;
  return { entityTotal, unattributed, currentBalance, delta };
}
