// What KudiAI (chat assistant + daily brief) knows about the app itself, per portal. It is added to the data context so
// the assistant can answer "how do I…" and "what does it cost…" with what the app does TODAY. Ships with the app (OTA):
// update this file whenever a feature, price or rule a user could ask about changes. (utils/aiKnowledge.js is an old,
// unused FAQ — not this.)
import { canSellPlans } from "./platform";

const FEES = [
  "Stamp duty: ₦50 on bank transfers of ₦10,000 or more (a government charge we collect).",
  "If a bank transfer fails, the amount and the stamp duty come back to the wallet; the transfer fee is kept.",
];
const BUSINESS_FEES = [
  "Business bank transfer fee: ₦10 below ₦5,000; ₦25 from ₦5,000 to ₦9,999; ₦35 from ₦10,000 to ₦50,000; ₦60 above ₦50,000.",
  "Moving money between KudiAI wallets (for example paying a client's approved withdrawal into their wallet): a ₦10 charge fee each time, shown before the PIN.",
];
const CLIENT_FEES = [
  "Client bank transfer fee (no free transfers): ₦10 up to ₦5,000; ₦25 from ₦5,000.01 to ₦50,000; ₦50 above ₦50,000.",
  "Paying from the KudiAI wallet to another KudiAI wallet (savings contributions, circle contributions) has a ₦10 charge fee each time, shown before the PIN. Receiving money and deposits are free.",
];

const COMMON = [
  "Language: Settings (owner) or Me (client) -> Language changes the whole app to English, Pidgin, Hausa, Igbo or Yoruba. Receipts and PDF statements stay in English.",
  "Saved beneficiaries (optional): when sending money, tick 'Save as beneficiary' on the review step (a nickname can be added), or tap Save after the transfer. Saved accounts show at the top of Send; tap Manage to remove one. Nothing is saved unless the user chooses to.",
  "Wallet tiers: every wallet starts on Tier 1. Tier 2: add BVN and NIN, full name and home address in the wallet tier card. Tier 3: upload a valid ID (front, and back for cards), a utility bill from the last 3 months and a passport photo; our team reviews it and shows the reason if it is declined. The tier card shows the balance and daily limits for each tier.",
  "Bills: airtime, data, cable TV, electricity (the token is on the receipt), exam PINs and internet, paid from the wallet. Airtime and data only go to a number on its own network (ported numbers are blocked). Airtime and data earn cashback.",
  "Receipts: every receipt and statement has a reference and QR code anyone can check at kudiai.app/verify.",
  "Security: an app PIN to open the app and a transaction PIN to move money; 'Forgot PIN' resets it. Never share a PIN or OTP — KudiAI staff never ask for them.",
  "Notifications: the bell shows every alert; each kind (money, savings, stock, offers and more) can be switched off in notification settings.",
  "Help: the Help screen has answers and a support ticket form.",
  "Invite & Earn: Home banner, Settings (owner) or Me (client) -> Invite & Earn shows the user's invite code and link. A friend who signs up with it, opens a KudiAI wallet and spends at least N2,000 from it (transfers, bills, plan payments or savings contributions) within 7 days earns the inviter N500, N700 and N1,000 for the 1st, 2nd and 3rd friend in each 7-day campaign (up to N2,200), and the friend gets a N200 welcome bonus. Each qualified invite is checked by the KudiAI team first; once approved, rewards are paid into the KudiAI wallet (an open wallet is needed). Money sent to the friend does not count; the same BVN can't earn twice. Amounts can change.",
];

const OWNER = [
  "Recording: Cash In / Cash Out by typing or by voice in any Nigerian language. Credit sales track who owes and their repayments.",
  "Refunds and discounts: swipe a sale in Sales -> Refund (needs the transaction PIN; returned items can go back into stock). A discount can be added in a sale's details.",
  "Profit uses each item's cost price at the time of the sale; set cost prices in Stock so profit is accurate.",
  "Stock: products, restocks, adjustments and low-stock alerts (stock and credit alerts are in-app only, not email).",
  "Offline: sales, expenses, credit sales, restocks/stock changes and profile edits work with no internet and sync by themselves when the connection is back (the bar under the header shows what is waiting). Bills, wallet transfers and Ajo money actions need internet. The wallet shows the last known balance offline.",
  "Wallet: the business gets its own account number that customers can pay into; send to any Nigerian bank.",
  ...FEES,
  ...BUSINESS_FEES,
  canSellPlans()
    ? "Business plans and wallet fees: on the Free plan, money paid INTO the wallet by bank transfer (top-ups and customers' payments) has a 1.5% deposit fee (max ₦500) and every bank transfer out has the transfer fee. On Standard and Premium there is NO deposit fee; every bank transfer out has the transfer fee (there are no free transfers on any plan). The deposit fee shows on the deposit in wallet history."
    : "On the Free plan, money paid into a business wallet by bank transfer has a small deposit fee (shown in Wallet and on the deposit in history); paid plans have no deposit fee. Every bank transfer out has the transfer fee on all plans. Plans are not sold in the Android app — never tell the user to buy or upgrade a plan in the app.",
  canSellPlans()
    ? "Paid plans (Standard, Premium) last 30 days (monthly) or 365 days (yearly) and do NOT renew by themselves. Reminders come 3 days and 1 day before the end date. After it, the features keep working for 3 more days, then the account moves to the Free plan; all records stay. Renew from Settings -> Plan -> 'Renew' (paid from the KudiAI Wallet); renewing early adds the new period after the current end date, so no days are lost."
    : "Paid plans do NOT renew by themselves: reminders come 3 days and 1 day before the end date; after it the features keep working for 3 more days, then the account moves to the Free plan (records stay). Renewing is done on the kudiai.app website, not in the Android app.",
  "Savings card fees: a percentage of withdrawals from the card (each client's own %, or the business default % set on the Ajo screen) or no fee. Withdrawals from an esusu or a savings group have no fee. A card's commission counts the withdrawal fees already taken on it, so a card is never charged twice. First-period cards (collector keeps the first period) are no longer offered for new cards; cards already open keep their terms.",
  "Ajo/Esusu: add clients, savings cards, groups and esusu rotations; approving a client's withdrawal pays it straight into the client's KudiAI wallet (the business wallet must have enough). A withdrawal the owner records directly is a CASH payout: nothing moves between wallets, and the savings money stays in the owner's wallet to cover the cash. Reversing a wallet-paid contribution sends the money back to the client's wallet.",
  "Also: invoices, staff with set permissions, branches, loyalty points/cashback for repeat customers, reports and PDF exports, and Statements & monthly reports (sent on the 1st of each month).",
  "Settings: daily brief on/off, dark mode, language, delete account (the wallet must be empty first).",
];

const CLIENT = [
  "Wallet: the client has their own KudiAI wallet with an account number; top it up by bank transfer from any bank (free). Contributions are paid from the wallet into their savings.",
  ...FEES,
  ...CLIENT_FEES,
  "Savings: see the balance, next due date and history; ask for a withdrawal — when the business approves it the money is paid into the client's wallet. Fees are listed under Me -> My Fees. A statement is sent on the 1st of every month (Statements).",
  "Savings cards: the client can open more than one card; the collector's fee is a percentage of card withdrawals set by the business (shown on the card). Withdrawals from an esusu or a savings group have no fee.",
  "Esusu payouts made by the business go into the client's savings balance, not straight to the wallet; to move the money to the wallet, request a withdrawal and the business approves it.",
  "Savings circles: the client can start or join a circle with friends; the organiser can set a fee per payout.",
  "Offline: the app opens with the last saved balance and history; payments, transfers and bills need internet.",
  "If something looks wrong with a payment, open it in History and report a problem, or use the support form in Help.",
];

const HEAD = "APP GUIDE (how KudiAI Track works today. Use it only when the user asks how to do something or what something costs. Never invent features, prices or limits that are not listed here; if unsure, point them to Help):";

/** The app guide for a portal: "owner" (default) or "ajo_member". */
export function appGuide(portal = "owner") {
  const lines = portal === "ajo_member" ? [...CLIENT, ...COMMON] : [...OWNER, ...COMMON];
  return [HEAD, ...lines.map(l => `  - ${l}`)].join("\n");
}
