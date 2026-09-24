import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { TextEncoder, TextDecoder } from "util";
import { ProcessingWithdrawalCard, PendingPayoutNotice, pendingPayoutRow } from "../components/WithdrawalStatus";

// WalletPanel pulls in the wallet UI's data layer; nothing here needs a real client
jest.mock("../utils/supabase", () => ({ supabase: { from: () => ({}), functions: { invoke: jest.fn() } } }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// WalletPanel's dependency chain (PDF helpers) wants these; jsdom does not provide them
globalThis.TextEncoder = globalThis.TextEncoder || TextEncoder;
globalThis.TextDecoder = globalThis.TextDecoder || TextDecoder;
// eslint-disable-next-line import/first
const { WalletTxRow } = require("../components/WalletPanel");

let host, root;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = (el) => act(() => { root.render(el); });

describe("ProcessingWithdrawalCard", () => {
  const req = { id: "r1", status: "approved", amount: 5000, payout_status: "pending", payout_amount_kobo: 480000, payout_date: "2026-09-28" };

  it("says approved and processing to wallet, when it should land, and how much", () => {
    render(<ProcessingWithdrawalCard request={req} />);
    expect(host.textContent).toContain("Approved · processing to wallet");
    expect(host.textContent).toContain("Expected in your wallet Mon 28 Sep");
    expect(host.textContent).toContain("4,800");                 // the payout amount (kobo → naira), not the requested 5,000
  });

  it("falls back to the requested amount when the payout amount is unknown", () => {
    render(<ProcessingWithdrawalCard request={{ ...req, payout_amount_kobo: undefined }} />);
    expect(host.textContent).toContain("5,000");
  });

  it("renders nothing for a request that is not approved", () => {
    render(<ProcessingWithdrawalCard request={{ ...req, status: "pending" }} />);
    expect(host.innerHTML).toBe("");
  });
});

describe("PendingPayoutNotice", () => {
  it("shows the total pending and the expected day", () => {
    render(<PendingPayoutNotice payouts={[{ id: "a", amount_kobo: 300000, scheduled_date: "2026-09-28" }, { id: "b", amount_kobo: 200000, scheduled_date: "2026-09-28" }]} />);
    expect(host.textContent).toContain("5,000");
    expect(host.textContent).toContain("is pending — expected Mon 28 Sep");
    expect(host.textContent).toContain("once it lands");
  });

  it("without a date it says next business day", () => {
    render(<PendingPayoutNotice payouts={[{ id: "a", amount_kobo: 100000 }]} />);
    expect(host.textContent).toContain("arriving on the next business day");
  });

  it("nothing pending → nothing shown", () => {
    render(<PendingPayoutNotice payouts={[]} />);
    expect(host.innerHTML).toBe("");
  });
});

describe("a pending payout in the wallet's transaction list", () => {
  const payout = { id: "p1", amount_kobo: 480000, created_at: "2026-09-25T10:00:00Z", scheduled_date: "2026-09-28" };

  it("is a credit row that has not landed yet", () => {
    expect(pendingPayoutRow(payout)).toEqual({ id: "payout-p1", source: "ajo_payout", direction: "credit", status: "pending", amount_kobo: 480000, created_at: "2026-09-25T10:00:00Z" });
  });

  it("shows as PENDING (money coming in), while a pending debit still says Processing", () => {
    render(<div><WalletTxRow row={pendingPayoutRow(payout)} /><WalletTxRow row={{ id: "w1", source: "withdrawal", direction: "debit", status: "pending", amount_kobo: 100000, created_at: "2026-09-25T10:00:00Z" }} /></div>);
    const texts = [...host.querySelectorAll("button")].map((b) => b.textContent);
    expect(texts[0]).toContain("Pending");
    expect(texts[0]).not.toContain("Processing");
    expect(texts[0]).toContain("+");                                // a credit
    expect(texts[1]).toContain("Processing");
    expect(texts[1]).not.toContain("Pending");
  });
});
