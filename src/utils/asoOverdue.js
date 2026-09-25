/**
 * "Overdue" means overdue on something ACTIVE.
 *
 * A client's next_contribution_date can pass while every savings card they had is settled, their savings group has
 * not started / is closed, or their esusu has no running round — nothing is actually due then, so they must not be
 * counted (or emailed) as overdue. The rule lives in SQL (ajo_client_overdue_eligible); the app asks for it once per
 * load and stamps the answer on each client row as `overdue_eligible`. Every overdue check ANDs this in.
 *
 * Fail-safe: an unknown answer (RPC failed / not deployed yet / row added locally) is treated as eligible, i.e. the
 * old date-only behaviour — a lookup hiccup must never hide a genuinely overdue client.
 */
export const overdueEligible = (client) => client?.overdue_eligible !== false;

/**
 * Returns `rows` with `overdue_eligible` set on each client. `fetchEligibleIds(ids)` must resolve to the
 * `{ data, error }` of the ajo_overdue_eligible_clients RPC (a list of client ids). Never throws.
 */
export async function attachOverdueEligibility(rows, fetchEligibleIds) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  try {
    const { data, error } = await fetchEligibleIds(rows.map((r) => r.id));
    if (error || !Array.isArray(data)) return rows;
    // PostgREST returns a scalar set as ["uuid", …]; tolerate [{ ajo_overdue_eligible_clients: "uuid" }, …] too.
    const ok = new Set(data.map((x) => (x && typeof x === "object" ? Object.values(x)[0] : x)));
    return rows.map((r) => ({ ...r, overdue_eligible: ok.has(r.id) }));
  } catch {
    return rows;
  }
}
