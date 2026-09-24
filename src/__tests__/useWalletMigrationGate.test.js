import React, { act } from "react";
import { createRoot } from "react-dom/client";

// A small fake of the supabase client: wallets → .select().eq().maybeSingle(); platform_config → .select().in()
const mockState = { wallet: null, cfg: [], walletErr: false, invoke: jest.fn() };
jest.mock("../utils/supabase", () => ({
  supabase: {
    from: (table) => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => (mockState.walletErr ? Promise.reject(new Error("offline")) : Promise.resolve({ data: mockState.wallet })) }),
        in: () => Promise.resolve({ data: mockState.cfg }),
      }),
    }),
    functions: { invoke: (...a) => mockState.invoke(...a) },
  },
}));

import { useWalletMigrationGate } from "../hooks/useWalletMigrationGate";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host, root, latest;
function Harness({ userId, enabled }) { latest = useWalletMigrationGate(userId, enabled); return null; }
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); latest = undefined; mockState.walletErr = false; mockState.invoke = jest.fn(); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const mount = async (props) => { await act(async () => { root.render(React.createElement(Harness, props)); }); await act(async () => {}); };

const legacyWallet = { flw_account: "legacy", flw_account_number: "1111111111", flw_virtual_account_id: "va1" };
const cfgBusiness = (extra = []) => [{ key: "flw_active_account", value: "business" }, { key: "flw_legacy_grace_until", value: "" }, ...extra];

describe("useWalletMigrationGate", () => {
  it("does nothing while disabled (wallet feature off, or a portal without wallets)", async () => {
    mockState.wallet = legacyWallet; mockState.cfg = cfgBusiness();
    await mount({ userId: "u1", enabled: false });
    expect(latest.checking).toBe(false);
    expect(latest.blocking).toBe(false);
  });

  it("blocks a wallet that still has an old number once the business account is active", async () => {
    mockState.wallet = legacyWallet; mockState.cfg = cfgBusiness();
    await mount({ userId: "u1", enabled: true });
    expect(latest.checking).toBe(false);
    expect(latest.accountState).toBe("migrate");
    expect(latest.blocking).toBe(true);
  });

  it("blocks a wallet whose old number has been retired, too", async () => {
    mockState.wallet = legacyWallet;
    mockState.cfg = [{ key: "flw_active_account", value: "business" }, { key: "flw_legacy_grace_until", value: "2020-01-01T00:00:00Z" }];
    await mount({ userId: "u1", enabled: true });
    expect(latest.accountState).toBe("retired");
    expect(latest.blocking).toBe(true);
  });

  it("does not block before the switch (old account still active)", async () => {
    mockState.wallet = legacyWallet; mockState.cfg = [{ key: "flw_active_account", value: "legacy" }];
    await mount({ userId: "u1", enabled: true });
    expect(latest.blocking).toBe(false);
  });

  it("does not block a wallet that is already on the business account", async () => {
    mockState.wallet = { ...legacyWallet, flw_account: "business" }; mockState.cfg = cfgBusiness();
    await mount({ userId: "u1", enabled: true });
    expect(latest.accountState).toBe("active");
    expect(latest.blocking).toBe(false);
  });

  it("does not block someone with no wallet number (they get the normal activation flow)", async () => {
    mockState.wallet = { flw_account: "legacy", flw_account_number: null, flw_virtual_account_id: null }; mockState.cfg = cfgBusiness();
    await mount({ userId: "u1", enabled: true });
    expect(latest.blocking).toBe(false);
    mockState.wallet = null;
    await mount({ userId: "u2", enabled: true });
    expect(latest.blocking).toBe(false);
  });

  it("flw_force_migration = 'false' turns the forcing off", async () => {
    mockState.wallet = legacyWallet; mockState.cfg = cfgBusiness([{ key: "flw_force_migration", value: "false" }]);
    await mount({ userId: "u1", enabled: true });
    expect(latest.accountState).toBe("migrate");
    expect(latest.blocking).toBe(false);
  });

  it("fails OPEN: a failed lookup never blocks anyone", async () => {
    mockState.walletErr = true; mockState.wallet = legacyWallet; mockState.cfg = cfgBusiness();
    await mount({ userId: "u1", enabled: true });
    expect(latest.checking).toBe(false);
    expect(latest.blocking).toBe(false);
  });

  it("migrateAccount asks the server to move the wallet, and holds the confirmation until released", async () => {
    mockState.wallet = legacyWallet; mockState.cfg = cfgBusiness();
    mockState.invoke = jest.fn().mockResolvedValue({ data: { ok: true, migrated: true, account: "business", account_number: "9990001112" }, error: null });
    await mount({ userId: "u1", enabled: true });
    let r;
    await act(async () => { r = await latest.migrateAccount("12345678901", ""); });
    expect(mockState.invoke).toHaveBeenCalledWith("flutterwave", { body: { action: "provision-account", bvn: "12345678901", nin: "", migrate: true } });
    expect(r.migrated).toBe(true);
    expect(latest.holding).toBe(true);
    await act(async () => { latest.release(); });
    expect(latest.holding).toBe(false);
  });

  it("migrateAccount surfaces the server's message on failure and does not hold", async () => {
    mockState.wallet = legacyWallet; mockState.cfg = cfgBusiness();
    mockState.invoke = jest.fn().mockResolvedValue({ data: { error: "Your BVN or NIN could not be verified." }, error: null });
    await mount({ userId: "u1", enabled: true });
    await expect(act(async () => { await latest.migrateAccount("12345678901", ""); })).rejects.toThrow("could not be verified");
    expect(latest.holding).toBe(false);
  });

  it("skip lets the user carry on for now", async () => {
    mockState.wallet = legacyWallet; mockState.cfg = cfgBusiness();
    await mount({ userId: "u1", enabled: true });
    expect(latest.blocking).toBe(true);
    await act(async () => { latest.skip(); });
    expect(latest.blocking).toBe(false);
  });
});
