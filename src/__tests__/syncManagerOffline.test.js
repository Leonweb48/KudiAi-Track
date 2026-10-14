// Offline queue sync for stock movements and profile edits (2026-10-14).
import { syncPending } from "../utils/syncManager";
import { getPendingOps, markOpSynced } from "../utils/offlineDb";

jest.mock("../utils/offlineDb", () => ({ getPendingOps: jest.fn(), markOpSynced: jest.fn(async () => {}) }));

// A tiny stand-in for the Supabase client: records calls, answers from `db`.
function fakeSupabase(db, { insertError } = {}) {
  const calls = [];
  const from = (table) => {
    const q = { table, filters: {} };
    const api = {
      insert: (row) => { calls.push(["insert", table, row]); return Promise.resolve({ error: insertError || null }); },
      select: () => api,
      update: (upd) => { q.upd = upd; return api; },
      eq: (col, v) => {
        q.filters[col] = v;
        if (q.upd) { calls.push(["update", table, q.upd, { ...q.filters }]); if (table === "products") db.products[v].quantity = q.upd.quantity; return Promise.resolve({ error: null }); }
        return api;
      },
      maybeSingle: () => Promise.resolve({ data: table === "products" ? db.products[q.filters.id] || null : null, error: null }),
    };
    return api;
  };
  return { from, calls };
}

describe("syncing queued stock movements", () => {
  it("applies an offline sale's deduction to the product's CURRENT quantity, once", async () => {
    const db = { products: { p1: { quantity: 8 } } };          // someone else sold 2 meanwhile (was 10)
    getPendingOps.mockResolvedValue([{ local_id: "m1", table: "stock_movements", data: { id: "m1", product_id: "p1", type: "sale", quantity: -3, unit_price: 500 } }]);
    const sb = fakeSupabase(db);
    const r = await syncPending(sb, "owner1");
    expect(r).toMatchObject({ synced: 1, failed: 0 });
    expect(db.products.p1.quantity).toBe(5);
    expect(markOpSynced).toHaveBeenCalledWith("m1", "m1");
  });

  it("a movement already saved (retry after a lost reply) changes nothing", async () => {
    const db = { products: { p1: { quantity: 8 } } };
    getPendingOps.mockResolvedValue([{ local_id: "m1", table: "stock_movements", data: { id: "m1", product_id: "p1", type: "sale", quantity: -3 } }]);
    const sb = fakeSupabase(db, { insertError: { code: "23505", message: "duplicate key" } });
    const r = await syncPending(sb, "owner1");
    expect(r.synced).toBe(1);
    expect(db.products.p1.quantity).toBe(8);
  });

  it("never goes below zero; a restock also sets the cost price", async () => {
    const db = { products: { p1: { quantity: 1 }, p2: { quantity: 0 } } };
    getPendingOps.mockResolvedValue([
      { local_id: "m1", table: "stock_movements", data: { id: "m1", product_id: "p1", type: "sale", quantity: -5 } },
      { local_id: "m2", table: "stock_movements", data: { id: "m2", product_id: "p2", type: "restock", quantity: 12, unit_price: 250 } },
    ]);
    const sb = fakeSupabase(db);
    await syncPending(sb, "owner1");
    expect(db.products.p1.quantity).toBe(0);
    const restock = sb.calls.find((c) => c[0] === "update" && c[3].id === "p2");
    expect(restock[2]).toMatchObject({ quantity: 12, cost_price: 250, needs_costing: false });
  });
});

describe("syncing a queued profile edit", () => {
  it("sends the saved fields to the owner's profile", async () => {
    getPendingOps.mockResolvedValue([{ local_id: "profile-owner1", table: "profile_update", user_id: "owner1", data: { business_name: "Ada Stores", phone: "0803" } }]);
    const sb = fakeSupabase({ products: {} });
    const r = await syncPending(sb, "owner1");
    expect(r.synced).toBe(1);
    expect(sb.calls).toContainEqual(["update", "profiles", { business_name: "Ada Stores", phone: "0803" }, { id: "owner1" }]);
  });
});
