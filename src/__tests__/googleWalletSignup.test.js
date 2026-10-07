import {
  GOOGLE_WALLET_KEY, saveGoogleWalletChoice, takeGoogleWalletChoice, hasGoogleWalletChoice, clearGoogleWalletChoice,
  finishGoogleWalletSignup,
} from "../utils/googleWalletSignup";

// "Open a KudiAI Wallet" with Google: the choice made before Google signs the person in, and what happens to the account
// once the session exists. A business, staff member or someone else's client must never be turned into a client.

const fakeSupabase = ({ profile = null, staffByUser = null, staffByEmail = null, client = null, register = { data: { ok: true } } } = {}) => {
  const calls = { invoke: [], updateUser: [] };
  const from = (table) => {
    const q = { table, eq: {} };
    const chain = {
      select: () => chain,
      eq: (col, val) => { q.eq[col] = val; return chain; },
      maybeSingle: () => {
        if (table === "profiles") return Promise.resolve({ data: profile });
        if (table === "staff") return Promise.resolve({ data: q.eq.user_id ? staffByUser : staffByEmail });
        if (table === "aso_clients") return Promise.resolve({ data: client });
        return Promise.resolve({ data: null });
      },
    };
    return chain;
  };
  return {
    calls,
    from,
    functions: { invoke: (name, opts) => { calls.invoke.push({ name, body: opts.body }); return Promise.resolve(register); } },
    auth: { updateUser: (attrs) => { calls.updateUser.push(attrs); return Promise.resolve({ data: { user: {} }, error: null }); } },
  };
};

const googleSession = (meta = { full_name: "Ada Obi" }) => ({
  access_token: "t",
  user: { id: "u1", email: "Ada@Example.com", app_metadata: { provider: "google" }, user_metadata: meta },
});
const choice = { business_id: "biz1", phone: "08031234567", at: Date.now() };

beforeEach(() => localStorage.clear());

describe("the choice kept on the device while Google signs the person in", () => {
  it("is saved, read once, then gone", () => {
    saveGoogleWalletChoice({ businessId: "biz1", phone: " 0803 " }, 1000);
    expect(hasGoogleWalletChoice()).toBe(true);
    expect(takeGoogleWalletChoice(2000)).toEqual({ business_id: "biz1", phone: "0803", at: 1000 });
    expect(hasGoogleWalletChoice()).toBe(false);
    expect(takeGoogleWalletChoice(2000)).toBeNull();
  });

  it("a choice from an abandoned sign-in over 30 minutes ago is ignored", () => {
    saveGoogleWalletChoice({ businessId: "biz1", phone: "" }, 0);
    expect(takeGoogleWalletChoice(31 * 60 * 1000)).toBeNull();
  });

  it("clearing and unreadable values leave nothing to act on", () => {
    saveGoogleWalletChoice({ businessId: "biz1" });
    clearGoogleWalletChoice();
    expect(takeGoogleWalletChoice()).toBeNull();
    localStorage.setItem(GOOGLE_WALLET_KEY, "{not json");
    expect(takeGoogleWalletChoice()).toBeNull();
    localStorage.setItem(GOOGLE_WALLET_KEY, JSON.stringify({ phone: "1", at: Date.now() }));   // no business
    expect(takeGoogleWalletChoice()).toBeNull();
  });
});

describe("finishing the sign-up once Google has signed the person in", () => {
  it("a new Google account is registered with the chosen business, under its Google name, and marked as a client", async () => {
    const sb = fakeSupabase();
    const out = await finishGoogleWalletSignup(sb, googleSession(), choice);
    expect(out.status).toBe("done");
    expect(sb.calls.invoke).toEqual([{ name: "ajo-portal", body: { action: "self-register", business_id: "biz1", full_name: "Ada Obi", phone: "08031234567" } }]);
    expect(sb.calls.updateUser).toEqual([{ data: { account_type: "ajo_client", full_name: "Ada Obi" } }]);
    expect(out.session.user.user_metadata.account_type).toBe("ajo_client");
  });

  it("without a Google name it uses the start of the email", async () => {
    const sb = fakeSupabase();
    await finishGoogleWalletSignup(sb, googleSession({}), choice);
    expect(sb.calls.invoke[0].body.full_name).toBe("ada");
  });

  it("an existing business keeps its business: nothing is registered", async () => {
    const sb = fakeSupabase({ profile: { business_name: "Ada Stores" } });
    expect((await finishGoogleWalletSignup(sb, googleSession(), choice)).status).toBe("skip");
    expect(sb.calls.invoke).toEqual([]);
    expect(sb.calls.updateUser).toEqual([]);
  });

  it("a staff member (by login or by email) is left alone", async () => {
    for (const sb of [fakeSupabase({ staffByUser: { id: "s1" } }), fakeSupabase({ staffByEmail: { id: "s1" } })]) {
      expect((await finishGoogleWalletSignup(sb, googleSession(), choice)).status).toBe("skip");
      expect(sb.calls.invoke).toEqual([]);
    }
  });

  it("an account already linked to its client record is just marked as a client again", async () => {
    const sb = fakeSupabase({ client: { id: "c1", client_user_id: "u1" } });
    const out = await finishGoogleWalletSignup(sb, googleSession(), choice);
    expect(out.status).toBe("done");
    expect(sb.calls.invoke).toEqual([]);
    expect(sb.calls.updateUser[0].data.account_type).toBe("ajo_client");
  });

  it("someone else's client record with this email is not taken over", async () => {
    const sb = fakeSupabase({ client: { id: "c1", client_user_id: "someone-else" } });
    expect((await finishGoogleWalletSignup(sb, googleSession(), choice)).status).toBe("skip");
    expect(sb.calls.invoke).toEqual([]);
    expect(sb.calls.updateUser).toEqual([]);
  });

  it("an email sign-in, or no choice, is never touched", async () => {
    const sb = fakeSupabase();
    const emailSess = { ...googleSession(), user: { ...googleSession().user, app_metadata: { provider: "email" } } };
    expect((await finishGoogleWalletSignup(sb, emailSess, choice)).status).toBe("skip");
    expect((await finishGoogleWalletSignup(sb, googleSession(), null)).status).toBe("skip");
    expect(sb.calls.invoke).toEqual([]);
  });

  it("a registration that doesn't go through is reported and the account is NOT marked as a client", async () => {
    for (const register of [{ data: null, error: new Error("boom") }, { data: { error: "Selected business not found" } }]) {
      const sb = fakeSupabase({ register });
      const out = await finishGoogleWalletSignup(sb, googleSession(), choice);
      expect(out.status).toBe("failed");
      expect(out.message).toMatch(/couldn't open your KudiAI Wallet/);
      expect(sb.calls.updateUser).toEqual([]);
    }
  });
});
