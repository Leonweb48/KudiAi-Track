# Bill payments: how they work and the rules that keep them working

This is for anyone changing bill payment code: airtime, data, print PINs, cable, electricity, betting, WAEC/JAMB,
Smile, Spectranet. Every rule below exists because breaking it cost customers money or stopped sales, and each one
is enforced by a test that runs before every bill-server deploy.

**Read this before changing** `supabase/functions/clubkonnect/`, `supabase/functions/_shared/` (billGate, billProvider,
ckRoute, billCost, dataPricing, vtpass), `flw-relay/`, or the bill parts of `src/screens/BillPayments.jsx`.

**Run before you push:** `node tests/bills/run-all.mjs` and
`deno test --no-lock --node-modules-dir=none --allow-env supabase/functions/_shared/`.

GitHub runs the same tests (`.github/workflows/bills-tests.yml`), and `deploy-functions.yml` will not deploy if they
fail. If a test fails, fix the code, not the test, unless you are deliberately changing a rule. In that case, update
this document in the same commit and say why.

## How a bill payment flows

1. **The app takes payment.** This is one of: a wallet debit (`wallet_debit_for_bill`, reference `KDT-BILL-…`), a
   Paystack charge, or a coupon covering the whole price.
2. **The app calls the bill server** (`clubkonnect` edge function) with the same reference as `requestId`.
3. **The payment check** (`_shared/billGate.ts`) confirms the order is paid for. The same reference can't be reused for
   different goods.
4. **The provider router** (`_shared/billProvider.ts`, `_shared/ckRoute.ts`) sends the order to ClubKonnect (or
   VTpass when it's live).
5. **The answer is settled:** delivered, failed (the app refunds), or held (the app confirms via `verify` and is given
   what was delivered).
6. **The app records the order.** Electricity tokens that arrive late are finished by the background sweep.

## The rules

### 1. Never call an order failed unless the provider refused it or confirmed it doesn't exist

A reply without the expected data is not a failure. That covers no PINs, no token, no card details, an unknown status,
`ON_HOLD`, and `DUPLICATE`/`TXN_HISTORY` on a retry. Look the order up by its RequestID first. Then:
- **No such order, or failed/refunded:** fail it, and the customer is refunded.
- **Anything else:** hold it, and the app confirms it.

- Code: `ckFailedOrHeld`, `settleEpinOrder`, `cardDetailsLater`, the lookups in `ckRoute.buyWithFallback`.
- **Why:** on 1 Oct 2026, three Print Airtime orders were shown as "failed" while ClubKonnect had issued all 41
  PINs. They were recovered by hand.
- **A lookup ClubKonnect refused to run is not an answer.** That covers our key being rejected (`INVALID_CREDENTIALS`
  and similar) or its own "network error" / "service unavailable" words: hold the order. In a *purchase* reply, the
  same words are a refusal (nothing was bought), and the customer is refunded.
  - Code: `ckLookupUnusable`. `ckOrderDead` is for lookups, `ckSaysFailed` for purchase replies.
  - **Why:** on the evening of 1 Oct the key stopped working while the sweep, `electricity-query`, `verify` and the
    print-PIN settle all read `INVALID_CREDENTIALS` as "order failed". Any order they looked up would have been
    refunded, even a delivered one.

### 2. "Refunded", "cancelled" and "failed" mean the order is dead, and the customer must be refunded

ClubKonnect's `ORDER_REFUNDED` (statuscode `899`), `CANCEL…`, `REVERS…` and the `FAIL_PATTERNS` all count as dead.

- Code: `ckOrderDead`, used by the purchase handlers, `electricity-query`, `verify` and the router's lookups.
- **Why:** an electricity order the electricity company couldn't vend was refunded to *our* ClubKonnect wallet on
  26 Sept. We showed "Token loading…" for days while the customer's ₦2,976 was gone.

### 3. Electricity is asynchronous, and the background sweep finishes it

- **Order of events:** the purchase waits at most about 23 s for the token, then returns PENDING. The app asks
  `electricity-query` for about 90 s. After that, **`electricity-sweep` (pg_cron `electricity-token-sweep`, every
  2 min)** finishes the order:
  - **Token found:** saved on the order, and the customer is notified.
  - **Dead:** refunded and marked failed, and the customer is notified.
- **Don't remove the cron.** Don't rename the "Token loading..." marker either: the app writes it, and the sweep looks
  for it.
- **The sweep refunds a wallet only through the order's own linked debit** (`wallet_ledger.related_txn_id`). It never
  guesses by amount or time. Anything else becomes an admin "manual refund" alert.
- **Reference lookups:** a reference starting `KDT-BILL-` is looked up as `RequestID`, anything else as `OrderID`.

### 4. Every purchase needs proof of payment, and a coupon can be that proof

- **What counts as proof:** a wallet debit for the reference, a Paystack charge verified with Paystack, or a coupon
  covering the whole price.
- **Plan-priced bills** (Data, Print Data) get their price on the server from `planFace` (cached catalogue, owner
  selling price, print discount).
- **100% coupons** cover any plan-priced bill (`couponCoversAnyPrice`).
- **Why:** four Data orders paid fully by coupon were refused as "no payment" in September, because the check needed a
  price that Data doesn't carry.
- **Limit:** cashback and points that cover a *whole* order can't be proven on the server, so such an order is refused.
  When they cover part of it, the wallet debit for the rest is the proof.

### 5. One reference is one order, and retries reuse it

ClubKonnect treats a repeated RequestID as the same order, so retries never buy twice. Never generate a new RequestID
when retrying. A "duplicate" answer means the order exists (rule 1).

### 6. Held and failed answers have fixed wording, because the app decides by the words

- **Held** must use `PENDING_STATUS` ("Provider gateway timeout — confirming your order"). The app's `CK_NET_ERR`
  regex in `BillPayments.jsx` matches it, so the app holds the order and calls `verify`.
- **Network failures** surface as "ClubKonnect connection failed (…)", which the app also holds.
- **Real failures must not match `CK_NET_ERR`**, otherwise the app won't refund. Example: "The bill payment service is
  temporarily unavailable…" is a failure, and the customer is refunded.

### 7. ClubKonnect answers every refused or invalid order with an IIS 503 "service unavailable" page

That page is a refusal, not an outage. Never health-check purchases with orders that are meant to be refused. That
paused all sales for about 36 h (28–30 Sept). The only health checks are the made-up-account canary and real lookups.

### 8. All ClubKonnect calls go through `ck()`, via the fixed-IP relay

- **Whitelist:** ClubKonnect accepts our account's calls only from the address whitelisted on clubkonnect.com,
  **209.71.82.233** (the Fly.io relay, `flw-relay`). Keep it that way.
- **Switch:** `platform_config.ck_via_relay = true` sends calls through the relay. `false` goes direct, which only
  works if the whitelist is set to `0.0.0.0`.
- **Relay errors** carry `X-Relay-Error`. `ck()` treats them as network errors (retry, then hold), never as refusals.
- **Never call ClubKonnect directly** from new code.

### 9. The ClubKonnect API key

Pressing "Generate API Key" on clubkonnect.com, or changing the account password, kills the installed key at once, and
every bill fails with `INVALID_CREDENTIALS`. To recover:
1. Generate the key once.
2. Update the GitHub secret `CK_API_KEY`.
3. Run **ClubKonnect set API key** (`ck-set-key.yml`).
4. Run **ClubKonnect route check**: every service must say `valid`.

While the key is rejected, purchases are refused and refunded, and orders already placed stay held (rule 1). Nothing is
lost, but no bill sells until the new key is in. It has been reset three times (28 Sept, and twice on 1 Oct), so
check who uses the clubkonnect.com login.

### 10. Phone network detection

`src/utils/phoneNetwork.js` maps prefixes to networks. **0704 and 07025/07026 are MTN.** A missing prefix makes the
order go out on the wrong network, and ClubKonnect refuses it.

### 11. Never log or print secrets

Tokens, PINs, meter/phone/account numbers, names and our ClubKonnect balance must never appear in:
- **Function logs:** pass provider replies through `forLog()`.
- **CI logs:** they are public. Diagnostic readouts print counts, booleans, statuses and field names only.
- **Workflow outputs**, admin alerts or notifications.

### 12. How changes reach customers

- **Bill server and database changes** apply immediately.
- **App code** reaches installed Android apps through the Capgo over-the-air update (`capgo-deploy.yml`). Native
  changes need a new APK.

## Tools (GitHub → Actions; all free unless stated)

| Workflow | What it does |
|---|---|
| ClubKonnect route check | Is our key accepted (directly and via the relay), is the purchase service up |
| Bill preflight check | The app's pre-payment check for every category |
| ClubKonnect order probe | ClubKonnect's record of recent electricity orders or failed print orders (shapes only) |
| Electricity sweep (by hand) | Preview (default) or run the electricity sweep, with a longer look-back |
| ClubKonnect print-PIN recovery | Preview, then deliver PINs for print orders we wrongly failed |
| ClubKonnect set API key | Install `CK_API_KEY` into all 11 services |
| ClubKonnect live server test | **Costs ₦50.** One real airtime order: the only proof that purchases work |

Production data is read through read-only `RAISE NOTICE` migrations (`supabase/migrations/*readout*`), following rule 11.

## Tests (`tests/bills/`)

| Suite | Protects |
|---|---|
| `unclear-replies` | Rule 1: lookups before failing; clear refusals still fail; WAEC card details |
| `print-pins`, `print-pin-recovery` | Rules 1 and 11: print orders and their recovery, lookups refused for our key |
| `electricity` | Rules 1, 2, 3 and 11: refunds, the ~23 s wait, the sweep, lookups refused for our key, no secrets in logs |
| `route-fallback`, `provider-switch` | Rules 5, 6 and 7: V1/V3 routing, ClubKonnect ⇄ VTpass |
| `fixed-ip-relay`, `relay-server` | Rule 8 |
| `supabase/functions/_shared/*.test.ts` | Rule 4 and the pure logic behind the rest |
