import { isBusinessOwnerAccount } from "../hooks/useStore";
import { buildAjoMemberContext, buildContext } from "../utils/buildContext";

// A savings client must never be treated as a business: no owner emails (daily business summary etc.) and the AI
// (chat + daily brief) must see them as a saver with their own wallet, plus an up-to-date guide to the app.

// Plain functions, not jest.fn(): CRA resets jest.fn implementations between tests.
let mockClientRows = [];
let mockError = null;
jest.mock("../utils/supabase", () => {
  const self = new Proxy({}, {
    get(_t, k) {
      if (k === "then") return (res, rej) => Promise.resolve({ data: mockClientRows, error: mockError }).then(res, rej);
      return () => self;
    },
  });
  return { supabase: { from: () => self, auth: { getSession: async () => ({ data: { session: null } }) } } };
});

describe("isBusinessOwnerAccount", () => {
  beforeEach(() => { mockClientRows = []; mockError = null; });

  test("a business owner login is an owner", async () => {
    expect(await isBusinessOwnerAccount({ id: "u1", user_metadata: {} })).toBe(true);
  });

  test("an account marked as a savings client is not", async () => {
    expect(await isBusinessOwnerAccount({ id: "u1", user_metadata: { account_type: "ajo_client" } })).toBe(false);
  });

  test("a login with a savings-client record is not, even without account_type", async () => {
    mockClientRows = [{ id: "c1" }];
    expect(await isBusinessOwnerAccount({ id: "u1", user_metadata: {} })).toBe(false);
  });

  test("when it can't tell (lookup fails) it sends nothing", async () => {
    mockError = { message: "network" };
    expect(await isBusinessOwnerAccount({ id: "u1", user_metadata: {} })).toBe(false);
    expect(await isBusinessOwnerAccount(null)).toBe(false);
  });
});

describe("AI context", () => {
  const client = { full_name: "Ada Obi", current_balance: 5000, total_saved: 8000, contribution_amount: 1000, status: "active" };

  test("client context says saver, shows the wallet and carries the client guide", () => {
    const ctx = buildAjoMemberContext(client, [], { business_name: "Amaya & Co." },
      { hasAccount: true, balanceNaira: 2500, tier: 2 });
    expect(ctx.split("\n")[0]).toMatch(/^AJO SAVINGS MEMBER PORTAL/);
    expect(ctx).toMatch(/not a business owner/);
    expect(ctx).toMatch(/KUDIAI WALLET: Balance ₦2,500(\.00)? \| Tier 2/);
    expect(ctx).toMatch(/SAVINGS BALANCE: ₦5,000/);   // one naira sign, not "₦₦"
    expect(ctx).not.toMatch(/₦₦/);
    expect(ctx).toMatch(/APP GUIDE/);
    expect(ctx).toMatch(/3 free bank transfers a day/);
    expect(ctx).toMatch(/Save as beneficiary/);
    expect(ctx).not.toMatch(/Refunds and discounts/);   // owner-only guide lines stay out
  });

  test("client wallet not opened yet / unknown", () => {
    expect(buildAjoMemberContext(client, [], {}, { hasAccount: false })).toMatch(/KUDIAI WALLET: not opened yet/);
    expect(buildAjoMemberContext(client, [], {}, null)).not.toMatch(/KUDIAI WALLET/);
  });

  test("owner context is labelled as a business owner and carries the owner guide", () => {
    const ctx = buildContext({ profile: { business_name: "Shop" } }, []);
    expect(ctx.split("\n")[0]).toMatch(/^BUSINESS OWNER PORTAL \| Business: Shop/);
    expect(ctx).toMatch(/Refunds and discounts/);
    expect(ctx).toMatch(/Offline: sales, expenses/);
    expect(ctx).not.toMatch(/3 free bank transfers a day/);
  });
});
