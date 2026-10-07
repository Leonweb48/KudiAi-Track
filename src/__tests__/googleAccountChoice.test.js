import React, { act } from "react";
import { createRoot } from "react-dom/client";
import GoogleAccountChoice from "../screens/GoogleAccountChoice";
import { saveGoogleBusinessChoice, takeGoogleBusinessChoice, clearGoogleSignupChoices, saveGoogleWalletChoice, hasGoogleWalletChoice } from "../utils/googleWalletSignup";

// A brand-new Google account that signed in from the Sign in tab is asked what it's for before any setup.

// Plain functions, not jest.fn(): CRA resets jest.fn implementations between tests.
const mockCalls = { invoke: [], updateUser: [], signOut: 0 };
let mockRegister = { data: { ok: true } };
let mockUpdateError = null;
jest.mock("../utils/supabase", () => {
  const chain = () => {
    const c = { select: () => c, eq: () => c, maybeSingle: () => Promise.resolve({ data: null }) };
    return c;
  };
  return {
    supabase: {
      from: chain,
      functions: {
        invoke: (name, opts) => {
          mockCalls.invoke.push(opts.body);
          if (opts.body.action === "list-businesses") {
            return Promise.resolve({ data: { businesses: [
              { id: "fef18c36-867b-4740-926d-7399e6aa6596", business_name: "Amaya & Co.", registration_fee: 1000 },
              { id: "b2", business_name: "Mama Nkechi Ajo", registration_fee: 0 },
            ] } });
          }
          return Promise.resolve(mockRegister);
        },
      },
      auth: {
        updateUser: (attrs) => { mockCalls.updateUser.push(attrs); return Promise.resolve({ data: { user: {} }, error: mockUpdateError }); },
        signOut: () => { mockCalls.signOut++; return Promise.resolve(); },
      },
    },
  };
});
jest.mock("../components/AppLogo", () => () => null);
jest.mock("../screens/LegalScreen", () => () => null);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const session = { user: { id: "u1", email: "ada@example.com", app_metadata: { provider: "google" }, user_metadata: { full_name: "Ada Obi" } } };
let host, root, done;
beforeEach(async () => {
  mockCalls.invoke = []; mockCalls.updateUser = []; mockCalls.signOut = 0; mockRegister = { data: { ok: true } }; mockUpdateError = null;
  done = 0; localStorage.clear();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root.render(<GoogleAccountChoice session={session} onDone={() => { done++; }} />); });
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const click = async (re) => {
  const b = [...host.querySelectorAll("button")].find((e) => re.test(e.textContent.trim()));
  if (!b) throw new Error(`no button ${re}`);
  await act(async () => { b.click(); });
};

describe("a brand-new Google account chooses what it's for", () => {
  it("greets them by their Google name and offers both", () => {
    expect(host.textContent).toContain("Welcome, Ada");
    expect(host.textContent).toContain("ada@example.com");
    expect(host.textContent).toContain("Register a business");
    expect(host.textContent).toContain("Open a KudiAI Wallet");
  });

  it("Register a business records the choice and continues to business setup", async () => {
    await click(/^Register a business/);
    expect(mockCalls.updateUser).toEqual([{ data: { signup_choice: "business" } }]);
    expect(done).toBe(1);
    expect(mockCalls.invoke.find((b) => b.action === "self-register")).toBeUndefined();
  });

  it("if that can't be saved, it says so and stays on the screen", async () => {
    mockUpdateError = new Error("offline");
    await click(/^Register a business/);
    expect(done).toBe(0);
    expect(host.textContent).toContain("couldn't save that");
  });

  it("Open a KudiAI Wallet registers them with the chosen business and continues", async () => {
    await click(/^Open a KudiAI Wallet/);
    expect(host.textContent).toMatch(/business you're saving with/i);
    const open = () => [...host.querySelectorAll("button")].find((e) => e.textContent.trim() === "Open my KudiAI Wallet");
    expect(open().disabled).toBe(true);                       // terms not ticked yet
    await act(async () => { host.querySelector('[role="checkbox"]').click(); });
    await act(async () => { open().click(); });
    const reg = mockCalls.invoke.find((b) => b.action === "self-register");
    expect(reg).toEqual({ action: "self-register", business_id: "fef18c36-867b-4740-926d-7399e6aa6596", full_name: "Ada Obi", phone: "" });
    expect(mockCalls.updateUser).toEqual([{ data: { account_type: "ajo_client", full_name: "Ada Obi" } }]);
    expect(done).toBe(1);
  });

  it("a wallet registration that fails shows the message, doesn't continue and doesn't mark the account", async () => {
    mockRegister = { data: null, error: new Error("boom") };
    await click(/^Open a KudiAI Wallet/);
    await act(async () => { host.querySelector('[role="checkbox"]').click(); });
    await click(/^Open my KudiAI Wallet$/);
    expect(done).toBe(0);
    expect(host.textContent).toContain("couldn't open your KudiAI Wallet");
    expect(mockCalls.updateUser).toEqual([]);
  });

  it("'Not you?' signs them out", async () => {
    await click(/^Not you\?/);
    expect(mockCalls.signOut).toBe(1);
  });
});

describe("the Create account tab's business choice", () => {
  it("is honoured once, within 30 minutes", () => {
    saveGoogleBusinessChoice(1000);
    expect(takeGoogleBusinessChoice(2000)).toBe(true);
    expect(takeGoogleBusinessChoice(2000)).toBe(false);
    saveGoogleBusinessChoice(0);
    expect(takeGoogleBusinessChoice(31 * 60 * 1000)).toBe(false);
  });

  it("signing in from the Sign in tab forgets both choices", () => {
    saveGoogleBusinessChoice();
    saveGoogleWalletChoice({ businessId: "b2" });
    clearGoogleSignupChoices();
    expect(takeGoogleBusinessChoice()).toBe(false);
    expect(hasGoogleWalletChoice()).toBe(false);
  });
});
