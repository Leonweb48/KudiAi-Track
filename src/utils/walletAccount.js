// Which of the platform's two Flutterwave accounts a wallet's number lives on, and whether that number can still
// receive deposits. Mirrors the server (supabase/functions/_shared/flwAccounts.ts → graceStatus, and the webhook's
// hold on deposits to a retired legacy number).
//
//   none     no account number yet — the normal activation flow
//   active   the number is on the account the platform uses now (or on the business account after a rollback)
//   migrate  the number is on the LEGACY account, the business account is active and the grace period is still
//            running: the old number keeps working and a new one is available
//   retired  as `migrate`, but the deadline has passed: the old number no longer credits the wallet
//
// A missing or unreadable deadline never retires anything — same rule as the server.

const DAY_MS = 86_400_000;

/**
 * @param {{ hasAccount: boolean, walletAccount?: string|null, activeAccount?: string|null,
 *           graceUntil?: string|null, now?: number }} p
 * @returns {{ state: "none"|"active"|"migrate"|"retired", graceUntilMs: number|null, daysLeft: number|null }}
 */
export function walletAccountState({ hasAccount, walletAccount, activeAccount, graceUntil, now = Date.now() }) {
  const parsed = graceUntil ? Date.parse(graceUntil) : NaN;
  const graceUntilMs = Number.isFinite(parsed) ? parsed : null;

  if (!hasAccount) return { state: "none", graceUntilMs, daysLeft: null };

  const onLegacy = walletAccount !== "business";
  const businessActive = String(activeAccount || "").toLowerCase() === "business";
  if (!onLegacy || !businessActive) return { state: "active", graceUntilMs, daysLeft: null };

  if (graceUntilMs !== null && now > graceUntilMs) return { state: "retired", graceUntilMs, daysLeft: 0 };
  return {
    state: "migrate",
    graceUntilMs,
    daysLeft: graceUntilMs === null ? null : Math.max(0, Math.ceil((graceUntilMs - now) / DAY_MS)),
  };
}
