import React, { act } from "react";
import { createRoot } from "react-dom/client";

// wallets → .select().eq().maybeSingle(); platform_config → .select().in(); wallet_tier_requests → .select().eq().eq().order().limit().maybeSingle()
const mockState = { wallet: null, cfg: [], pending: null, invoke: jest.fn(), uploads: [], uid: "u1" };
jest.mock("../utils/compressImage", () => ({ compressImage: async (f) => f }));
jest.mock("../utils/supabase", () => ({
  supabase: {
    from: (table) => ({
      select: () => {
        if (table === "platform_config") return { in: () => Promise.resolve({ data: mockState.cfg }) };
        if (table === "wallet_tier_requests") {
          const q = { eq: () => q, order: () => q, limit: () => q, maybeSingle: () => Promise.resolve({ data: mockState.pending, error: null }) };
          return q;
        }
        return { eq: () => ({ maybeSingle: () => Promise.resolve({ data: mockState.wallet }) }) };
      },
    }),
    functions: { invoke: (...a) => mockState.invoke(...a) },
    auth: { getUser: async () => ({ data: { user: mockState.uid ? { id: mockState.uid } : null } }) },
    storage: { from: (bucket) => ({ upload: async (path, body, opts) => { mockState.uploads.push({ bucket, path, opts }); return { error: null }; } }) },
  },
}));

import { useWalletTier, uploadTier3Doc } from "../hooks/useWalletTier";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host, root, latest;
function Harness({ userId, enabled }) { latest = useWalletTier(userId, enabled); return null; }
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); latest = undefined; mockState.invoke = jest.fn(); mockState.pending = null; mockState.uploads = []; mockState.uid = "u1"; });
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

  it("knows about a Tier 3 request that is waiting, and whether its documents are in", async () => {
    mockState.wallet = { tier: 2, flw_account_number: "5554443332" };
    mockState.pending = { id: "r1", status: "pending", documents: [{ kind: "id_front" }], submitted_at: "2026-10-13T09:00:00Z" };
    await mount({ userId: "u1", enabled: true });
    expect(latest.pending).toBe(true);
    expect(latest.t3).toMatchObject({ id: "r1", status: "pending", hasDocs: true, submittedAt: "2026-10-13T09:00:00Z" });
  });

  it("an old note-only request is pending but has no documents", async () => {
    mockState.wallet = { tier: 2, flw_account_number: "5554443332" };
    mockState.pending = { id: "r0", status: "pending", documents: [], created_at: "2026-10-01T09:00:00Z" };
    await mount({ userId: "u1", enabled: true });
    expect(latest.pending).toBe(true);
    expect(latest.t3.hasDocs).toBe(false);
  });

  it("a rejected request is not pending and carries the reason", async () => {
    mockState.wallet = { tier: 2, flw_account_number: "5554443332" };
    mockState.pending = { id: "r2", status: "rejected", documents: [{ kind: "id_front" }], review_note: "Bill is older than 3 months" };
    await mount({ userId: "u1", enabled: true });
    expect(latest.pending).toBe(false);
    expect(latest.t3.reviewNote).toBe("Bill is older than 3 months");
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

  it("submitTier3 sends the ID details and the uploaded document paths", async () => {
    mockState.wallet = { tier: 2, flw_account_number: "5554443332" };
    mockState.invoke = jest.fn().mockResolvedValue({ data: { ok: true, requested: true }, error: null });
    await mount({ userId: "u1", enabled: true });
    const form = { id_type: "passport", id_number: "A12345678", address: "12 Market Road, Onitsha", note: "", documents: [{ kind: "id_front", path: "u1/tier3/id_front-1.jpg" }] };
    await act(async () => { await latest.submitTier3(form); });
    expect(mockState.invoke).toHaveBeenCalledWith("flutterwave", { body: { action: "request-tier", target_tier: 3, ...form } });
  });

  describe("uploadTier3Doc", () => {
    const file = (name, type, size = 1000) => { const f = new File(["x"], name, { type }); Object.defineProperty(f, "size", { value: size }); return f; };
    it("puts a photo in the private bucket under the user's own tier3 folder, never overwriting", async () => {
      const r = await uploadTier3Doc("id_front", file("card.png", "image/png"));
      expect(mockState.uploads).toHaveLength(1);
      expect(mockState.uploads[0].bucket).toBe("kyc_documents");
      expect(mockState.uploads[0].path).toMatch(/^u1\/tier3\/id_front-\d+\.jpg$/);
      expect(mockState.uploads[0].opts).toMatchObject({ contentType: "image/jpeg", upsert: false });
      expect(r).toEqual({ kind: "id_front", path: mockState.uploads[0].path });
    });
    it("accepts a PDF only for the utility bill, up to 6 MB", async () => {
      await expect(uploadTier3Doc("id_front", file("id.pdf", "application/pdf"))).rejects.toThrow("Please use a photo");
      await expect(uploadTier3Doc("utility_bill", file("bill.pdf", "application/pdf", 7 * 1024 * 1024))).rejects.toThrow("over 6 MB");
      const r = await uploadTier3Doc("utility_bill", file("bill.pdf", "application/pdf"));
      expect(r.path).toMatch(/^u1\/tier3\/utility_bill-\d+\.pdf$/);
    });
    it("refuses other file types and a signed-out user", async () => {
      await expect(uploadTier3Doc("passport_photo", file("a.txt", "text/plain"))).rejects.toThrow("Please choose a photo");
      mockState.uid = null;
      await expect(uploadTier3Doc("passport_photo", file("a.jpg", "image/jpeg"))).rejects.toThrow("sign in again");
      expect(mockState.uploads).toHaveLength(0);
    });
  });

  it("surfaces the server's own message when an upgrade is refused", async () => {
    mockState.wallet = { tier: 1, flw_account_number: "5554443332" };
    mockState.invoke = jest.fn().mockResolvedValue({ data: { error: "Your BVN must be exactly 11 digits" }, error: null });
    await mount({ userId: "u1", enabled: true });
    await expect(act(async () => { await latest.upgradeToTier2({}); })).rejects.toThrow("Your BVN must be exactly 11 digits");
  });
});
