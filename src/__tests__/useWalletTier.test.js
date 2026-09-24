import React, { act } from "react";
import { createRoot } from "react-dom/client";

// wallets → .select().eq().maybeSingle(); platform_config → .select().in(); wallet_tier_requests → .select().eq().eq().eq().maybeSingle()
const mockState = { wallet: null, cfg: [], pending: null, invoke: jest.fn() };
jest.mock("../utils/supabase", () => ({
  supabase: {
    from: (table) => ({
      select: () => {
        if (table === "platform_config") return { in: () => Promise.resolve({ data: mockState.cfg }) };
        if (table === "wallet_tier_requests") return { eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: mockState.pending }) }) }) }) };
        return { eq: () => ({ maybeSingle: () => Promise.resolve({ data: mockState.wallet }) }) };
      },
    }),
    functions: { invoke: (...a) => mockState.invoke(...a) },
  },
}));

import { useWalletTier } from "../hooks/useWalletTier";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host, root, latest;
function Harness({ userId, enabled }) { latest = useWalletTier(userId, enabled); return null; }
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); latest = undefined; mockState.invoke = jest.fn(); mockState.pending = null; });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const mount = async (props) => { await act(async () => { root.render(React.createElement(Harness, props)); }); await act(async () => {}); };

describe("useWalletTier", () => {
  it("everyone starts at Tier 1 — including someone with no wallet row at all", async () => {
    mockState.wallet = null; mockState.cfg = [];
    await mount({ userId: "u1", enabled: true });
    expect(latest.loading).toBe(false);
    expect(latest.hasWallet).toBe(false);
    expect(latest.tier).toBe(1);
    expect(latest.next).toBe(2);
    expect(latest.limits).toEqual({ maxBalanceKobo: 30000000, dailyKobo: 10000000, perTransferKobo: 5000000 });
  });

  it("a wallet with no tier value yet is Tier 1", async () => {
    mockState.wallet = { flw_account_number: "5554443332" };
    await mount({ userId: "u1", enabled: true });
    expect(latest.hasWallet).toBe(true);
    expect(latest.tier).toBe(1);
  });

  it("reads the wallet's tier and the live limits, and knows what the next tier would allow", async () => {
    mockState.wallet = { tier: 2, flw_account_number: "5554443332" };
    mockState.cfg = [{ key: "wallet_tier2_daily_limit_kobo", value: "25000000" }, { key: "wallet_tier3_daily_limit_kobo", value: "900000000" }];
    await mount({ userId: "u1", enabled: true });
    expect(latest.tier).toBe(2);
    expect(latest.next).toBe(3);
    expect(latest.limits.dailyKobo).toBe(25000000);
    expect(latest.nextLimits.dailyKobo).toBe(900000000);
    expect(latest.nextLimits.maxBalanceKobo).toBeNull();          // Tier 3: unlimited
  });

  it("Tier 3 has no next tier", async () => {
    mockState.wallet = { tier: 3, flw_account_number: "5554443332" };
    await mount({ userId: "u1", enabled: true });
    expect(latest.next).toBeNull();
    expect(latest.nextLimits).toBeNull();
  });

  it("knows about a Tier 3 request that is waiting", async () => {
    mockState.wallet = { tier: 2, flw_account_number: "5554443332" }; mockState.pending = { id: "r1" };
    await mount({ userId: "u1", enabled: true });
    expect(latest.pending).toBe(true);
  });

  it("does nothing while disabled", async () => {
    mockState.wallet = { tier: 2, flw_account_number: "1" };
    await mount({ userId: "u1", enabled: false });
    expect(latest.loading).toBe(false);
    expect(latest.tier).toBe(1);
  });

  it("upgradeToTier2 calls the server with the form and refreshes the tier", async () => {
    mockState.wallet = { tier: 1, flw_account_number: "5554443332" };
    mockState.invoke = jest.fn().mockImplementation(async () => { mockState.wallet = { tier: 2, flw_account_number: "5554443332" }; return { data: { ok: true, tier: 2, changed: true }, error: null }; });
    await mount({ userId: "u1", enabled: true });
    await act(async () => { await latest.upgradeToTier2({ full_name: "Ada Obi", address: "12 Market Road", state: "Anambra", lga: "", bvn: "12345678901", nin: "10987654321" }); });
    expect(mockState.invoke).toHaveBeenCalledWith("flutterwave", { body: { action: "upgrade-tier", target_tier: 2, full_name: "Ada Obi", address: "12 Market Road", state: "Anambra", lga: "", bvn: "12345678901", nin: "10987654321" } });
    expect(latest.tier).toBe(2);
  });

  it("requestTier3 sends the note", async () => {
    mockState.wallet = { tier: 2, flw_account_number: "5554443332" };
    mockState.invoke = jest.fn().mockResolvedValue({ data: { ok: true, requested: true }, error: null });
    await mount({ userId: "u1", enabled: true });
    await act(async () => { await latest.requestTier3("call after 4pm"); });
    expect(mockState.invoke).toHaveBeenCalledWith("flutterwave", { body: { action: "request-tier", target_tier: 3, note: "call after 4pm" } });
  });

  it("surfaces the server's own message when an upgrade is refused", async () => {
    mockState.wallet = { tier: 1, flw_account_number: "5554443332" };
    mockState.invoke = jest.fn().mockResolvedValue({ data: { error: "Your BVN must be exactly 11 digits" }, error: null });
    await mount({ userId: "u1", enabled: true });
    await expect(act(async () => { await latest.upgradeToTier2({}); })).rejects.toThrow("Your BVN must be exactly 11 digits");
  });
});
