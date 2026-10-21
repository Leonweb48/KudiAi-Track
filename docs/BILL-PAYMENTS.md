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
  - **Why:** on the evening of 1 Oct ClubKonnect rejected our key for hours while the sweep, `electricity-query`, `verify` and the
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

### 3b. A wallet charge must never stay pending

The wallet is charged (`bill_spend`, pending) before the order is placed. The app settles or refunds it when the answer
comes; when it never does (app closed, line dropped, a retry under a new reference), the `bill-charge-sweep` (every 15
min) asks the provider by the charge's own reference after 30 minutes: delivered → settled, confirmed no order or
refused → refunded and the customer told, unclear → left alone (rule 1) with an admin alert after 48 hours.
Electricity charges are only settled there; the electricity sweep owns their refunds.
ClubKonnect's lookup answers `TRANSACTION_BEYOND_30_DAYS` for a RequestID it never received (2026-10-20: a morning
order whose purchase call the network dropped, while orders around it came back `ORDER_COMPLETED`). That counts as "no
order" only when our RequestID's own timestamp is under 25 days old; for an older order it stays unclear.
To check one order by hand: the **Bill order check** workflow (`bill-order-check.yml`) prints only the verdict.

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
- **No `CallBackURL`.** Since about 10 Oct 2026 ClubKonnect refuses every order that carries one
  (`CALLBACK_NOT_SUPPORTED`), and every airtime order failed until `ck()` stopped sending it (a32108b). We never used
  callbacks; orders are confirmed by lookup. The route check's dry runs show each service's normal bad-order answer.

### 9. The ClubKonnect API key

Pressing "Generate API Key" on clubkonnect.com, or changing the account password, kills the installed key at once, and
every bill fails with `INVALID_CREDENTIALS`. To recover:
1. Generate the key once.
2. Update the GitHub secret `CK_API_KEY`.
3. Run **ClubKonnect set API key** (`ck-set-key.yml`).
4. Run **ClubKonnect route check**: every service must say `valid`.

While the key is rejected, purchases are refused and refunded, and orders already placed stay held (rule 1). Nothing is
lost, but no bill sells until it is accepted again.

**Not every `INVALID_CREDENTIALS` is a reset.** On the evening of 1 Oct, ClubKonnect rejected our key for every
service for several hours, then accepted the **same** key again the next morning with nothing changed on our side.
Before generating a new key, run the route check again a little later. The key was genuinely reset on 28 Sept and on
the morning of 1 Oct.

### 10. Phone network detection

`src/shared/phoneNetwork.js` maps prefixes to networks. **0704 and 07025/07026 are MTN.** A missing prefix makes the
order go out on the wrong network, and ClubKonnect refuses it.

**Airtime and data only go to the number's own network** (owner's rule, 6 Oct 2026). When the prefix names a network
and a different one is selected, the bill form shows "This is an Airtel number, not MTN…" with a one-tap switch and
keeps Pay off. The bill server refuses the same order before it reaches a provider, so an old app or a direct call
can't get through. A number whose prefix isn't known is never blocked.
- Code: `networkMismatch` / `networkMismatchMessage` in `src/shared/phoneNetwork.js`. The bill server uses the synced
  copy in `_shared/app/` (`node scripts/sync-shared.mjs`).
- **The message must never contain "network" or other connection words** (rule 6). The app reads those as a dropped
  connection and holds the order instead of refunding it. A unit test checks the wording against `CK_NET_ERR`.
- On Data, typing a number that switches the network also reloads that network's plans and clears the chosen plan.
  Before this, the first network's plans stayed on screen.
- Ported numbers (moved to another network but keeping the old prefix) can't buy airtime or data until this rule changes.

### 11. Never log or print secrets

Tokens, PINs, meter/phone/account numbers, names and our ClubKonnect balance must never appear in:
- **Function logs:** pass provider replies through `forLog()`.
- **CI logs:** they are public. Diagnostic readouts print counts, booleans, statuses and field names only.
- **Workflow outputs**, admin alerts or notifications.

### 12. How changes reach customers

- **Bill server and database changes** apply immediately.
- **App code** reaches installed Android apps through the Capgo over-the-air update (`capgo-deploy.yml`). Native
  changes need a new APK.

### 13. Bigisub is the backup for airtime and data (2026-10-21)

- **Order of providers:** ClubKonnect first, then VTpass if it is live, then Bigisub. Only for airtime and data, and only
  while `platform_config.bill_provider_bigisub` is `true`. It is off until the live test passes.
- **When an order moves to Bigisub:** only after ClubKonnect confirms it placed nothing (rule 1). That means an
  empty-wallet refusal, refused keys, or an error page whose lookup finds no order. A refusal about the number never
  moves the order.
- **Data:** a plan buys only on the provider that listed it. When ClubKonnect's wallet is under ₦1,500, the app lists
  Bigisub's plans (ids `bg:…`). Our cost is Bigisub's corporate price; without an owner price we sell at Bigisub's
  public price.
- **Bigisub takes no reference from us and has no duplicate protection.**
  - Its transaction id is stored on the claim row (`bill_provider_attempts.bg_tranx_id`), together with what we sent
    (`bg_meta`). `verify` reads the order's status by that id, and requeries while it is processing; a failed requery
    refunds Bigisub's wallet by itself.
  - When the purchase reply is lost, the order is looked for in its history: number, service, and from 1 minute before
    to 15 minutes after sending.
  - Exactly one match means found. No match or several matches means **held** (rule 1).
  - `verify` calls it `NOT_FOUND` only when the order is still missing from the history 30 minutes after sending.
- **Cheapest plan wins (data):** the ClubKonnect list is priced as usual, then any plan Bigisub sells with the same size
  and the same days for at least ₦5 less (and no more than the customer price, and within Bigisub's balance) is swapped
  for Bigisub's plan at the **same customer price** (`pickCheaperPlans` in `_shared/planMatch.ts`). The swapped plan
  buys on Bigisub only.
- **Exam PINs:** WAEC result checker buys on Bigisub first (₦5,200 to us vs ClubKonnect's ₦5,350). The customer price
  stays the higher of the two. If Bigisub refuses before placing anything, the order falls back to ClubKonnect. NECO and
  NABTEB are sold through Bigisub only; when Bigisub is off or empty they show as unavailable and nobody is charged. WAEC
  registration and JAMB never go to Bigisub. Bigisub returns the PINs only in the purchase reply: if that reply is lost,
  the order is found in its history but stays **pending** with an admin alert, so support can fetch the PINs.
- **Failover must be on** (`bill_provider_failover=true`, migration 20270378) for any of this to move an order.
- **Secrets:** every purchase needs the account's 4-digit PIN (`BIGISUB_PIN`) as well as the token (`BIGISUB_TOKEN`).
  Both are installed only by the **Bigisub keys** workflow, from repository secrets.

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
| Bill charge sweep (by hand) | Wallet bill charges still pending after 30 min: delivered → settled, no order → refunded (dry run by default; also runs every 15 min) |
| Client bills audit | Client-portal bills since a date, each checked with ClubKonnect (statuses only) |
| Bill order check | One or more of our RequestIDs checked with the provider: the verdict, plus ClubKonnect's record with numbers masked |
| Bigisub keys | Install the token and PIN, the free check, turn the backup on or off, **live-test-50 costs ₦50** |

Production data is read through read-only `RAISE NOTICE` migrations (`supabase/migrations/*readout*`), following rule 11.

## Tests (`tests/bills/`)

| Suite | Protects |
|---|---|
| `unclear-replies` | Rule 1: lookups before failing; clear refusals still fail; WAEC card details |
| `print-pins`, `print-pin-recovery` | Rules 1 and 11: print orders and their recovery, lookups refused for our key |
| `electricity` | Rules 1, 2, 3 and 11: refunds, the ~23 s wait, the sweep, lookups refused for our key, no secrets in logs |
| `route-fallback`, `provider-switch` | Rules 5, 6, 7 and 10: V1/V3 routing, ClubKonnect ⇄ VTpass, wrong-network refusals |
| `bigisub` | Rule 13: Bigisub backs up airtime and data only when ClubKonnect placed nothing; lost replies are found in its history or held; its plans buy only there |
| `fixed-ip-relay`, `relay-server` | Rule 8 |
| `supabase/functions/_shared/*.test.ts` | Rule 4 and the pure logic behind the rest |
