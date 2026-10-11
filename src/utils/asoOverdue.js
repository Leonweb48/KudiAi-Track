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

/**
 * WHEN counting starts (owner's rule 2026-10-11): a client starts counting — due, expected, missed, overdue — only when
 * they open a savings card or join a running esusu round / active savings group, and counting starts THEN, not at
 * registration. SQL ajo_client_counting_since is the rule; the app stamps it on each row as `counting_since` (a
 * YYYY-MM-DD date) alongside `overdue_eligible`. Both are annotations, never columns (updateAsoClient strips them).
 *
 * `fetchCounting(ids)` must resolve to the `{ data, error }` of the ajo_clients_counting_since RPC
 * ([{ client_id, counting_since }], clients not counting are absent). On failure (e.g. not deployed yet) this falls
 * back to the older eligibility RPC via `fetchEligibleIds`, so counting works exactly as before. Never throws.
 */
export async function attachCounting(rows, fetchCounting, fetchEligibleIds) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  try {
    const { data, error } = await fetchCounting(rows.map((r) => r.id));
    if (error || !Array.isArray(data)) return fetchEligibleIds ? attachOverdueEligibility(rows, fetchEligibleIds) : rows;
    const since = new Map(data.map((x) => [x.client_id, x.counting_since]));
    return rows.map((r) => ({ ...r, overdue_eligible: since.has(r.id), counting_since: since.get(r.id) || null }));
  } catch {
    return fetchEligibleIds ? attachOverdueEligibility(rows, fetchEligibleIds) : rows;
  }
}

/** True when the client is counting at all (unknown = counting, the old behaviour). */
export const isCounting = (client) => overdueEligible(client);

/** The date counting started from: counting_since when known, else the registration date (old behaviour). */
export function countingStart(client) {
  if (!isCounting(client)) return null;
  const reg = client?.registration_date ? String(client.registration_date).slice(0, 10) : null;
  const since = client?.counting_since ? String(client.counting_since).slice(0, 10) : null;
  if (since && reg) return since > reg ? since : reg;
  return since || reg;
}

/** The date the client is really next due: never before counting started. null = not counting / no date. */
export function effectiveNextDue(client) {
  if (!isCounting(client)) return null;
  const next = client?.next_contribution_date ? String(client.next_contribution_date).slice(0, 10) : null;
  const since = client?.counting_since ? String(client.counting_since).slice(0, 10) : null;
  if (!next) return since;
  return since && since > next ? since : next;
}
