import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { TextEncoder, TextDecoder } from "util";

// WalletPanel pulls in the wallet UI's data layer; nothing here needs a real client
jest.mock("../utils/supabase", () => ({ supabase: { from: () => ({}), functions: { invoke: () => Promise.resolve({}) } } }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.TextEncoder = globalThis.TextEncoder || TextEncoder;
globalThis.TextDecoder = globalThis.TextDecoder || TextDecoder;
// eslint-disable-next-line import/first
const { WalletTxRow, WALLET_SOURCE } = require("../components/WalletPanel");

let host, root;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const row = (source, direction) => ({ id: source, source, direction, status: "completed", amount_kobo: 100000, created_at: "2026-09-25T10:00:00Z" });
const render = (r) => act(() => { root.render(<WalletTxRow row={r} />); });

describe("client-started esusu circles in the wallet", () => {
  it("has a label for every ledger source the circle functions write", () => {
    for (const s of ["peer_esusu_contribution", "peer_esusu_collection", "peer_esusu_payout", "peer_esusu_payout_sweep"]) {
      expect(WALLET_SOURCE[s]).toBeTruthy();
    }
  });

  it("a member's contribution reads as money out, not as the raw source name", () => {
    render(row("peer_esusu_contribution", "debit"));
    expect(host.textContent).toContain("Circle contribution");
    expect(host.textContent).not.toContain("peer_esusu");
    expect(host.textContent).toContain("−");   // the wallet's typographic minus
  });

  it("the creator receiving a member's share, and a winner receiving the pot, read as money in", () => {
    render(row("peer_esusu_collection", "credit"));
    expect(host.textContent).toContain("Circle contribution received");
    expect(host.textContent).toContain("+");
    act(() => root.unmount()); root = createRoot(host);
    render(row("peer_esusu_payout", "credit"));
    expect(host.textContent).toContain("Circle payout");
    expect(host.textContent).toContain("+");
  });

  it("the pot leaving the creator's wallet reads as money out", () => {
    render(row("peer_esusu_payout_sweep", "debit"));
    expect(host.textContent).toContain("Circle pot paid out");
    expect(host.textContent).not.toContain("peer_esusu");
  });
});
