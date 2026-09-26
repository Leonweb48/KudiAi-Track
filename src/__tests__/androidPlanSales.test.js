import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { isNativeApp, canSellPlans, bettingVisible } from "../utils/platform";
import { upgradeLabel, planRequiredLabel, planAvailableText } from "../utils/plans";
import SubscriptionPlan from "../screens/SubscriptionPlan";
import UpsellInlineSlot from "../components/slots/UpsellInlineSlot";

// Plain functions, not jest.fn(): CRA resets jest.fn implementations between tests.
let mockRpcCalls = [];
let mockRpcError = null;
jest.mock("../utils/supabase", () => {
  const chain = () => { const o = { select: () => o, eq: () => o, maybeSingle: () => Promise.resolve({ data: { full_name: "Ada", business_name: "Ada Stores" } }), order: () => o, then: (r) => r({ data: [], error: null }) }; return o; };
  return {
    supabase: {
      from: () => chain(),
      rpc: (name, args) => { mockRpcCalls.push({ name, args }); return Promise.resolve({ data: null, error: mockRpcError }); },
      auth: { getSession: () => Promise.resolve({ data: {} }) },
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel: () => {},
    },
  };
});
jest.mock("../utils/emailTrigger", () => ({ sendEmailTrigger: () => Promise.resolve() }));
jest.mock("react-router-dom", () => ({ useNavigate: () => () => {} }), { virtual: true });

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const setNative = (on) => { if (on) window.Capacitor = { isNativePlatform: () => true }; else delete window.Capacitor; };
afterEach(() => { setNative(false); mockRpcCalls = []; mockRpcError = null; });

describe("what the Android (Play) build may sell", () => {
  it("the web sells plans and shows Betting; the native app does neither", () => {
    setNative(false);
    expect([isNativeApp(), canSellPlans(), bettingVisible({})]).toEqual([false, true, true]);
    setNative(true);
    expect([isNativeApp(), canSellPlans(), bettingVisible({})]).toEqual([true, false, false]);
  });

  it("Betting comes back in the app only when platform_config.android_betting_enabled = 'true'", () => {
    setNative(true);
    expect(bettingVisible({ android_betting_enabled: "true" })).toBe(true);
    expect(bettingVisible({ android_betting_enabled: "false" })).toBe(false);
    expect(bettingVisible(null)).toBe(false);
  });

  it("locked-feature wording on Android is neutral: no plan name, no price, no 'upgrade'", () => {
    setNative(true);
    expect(upgradeLabel("aso")).toBe("");
    expect(planRequiredLabel("aso")).toBe("Not included in your plan");
    expect(planAvailableText("aso")).toBe("This feature is not included in your current plan.");
    for (const s of [planRequiredLabel("aso"), planAvailableText("aso")]) expect(s).not.toMatch(/upgrade|₦|price|website|subscribe/i);
  });

  it("the web keeps the selling wording", () => {
    setNative(false);
    expect(upgradeLabel("aso")).toMatch(/Upgrade/);
    expect(planRequiredLabel("aso")).toMatch(/Required/);
  });
});

describe("new account on the Android app", () => {
  let host, root;
  beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });
  const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
  const session = { user: { id: "u1", email: "ada@example.com" } };

  it("shows only the free start: no prices, no coupon box, no billing toggle", async () => {
    setNative(true);
    await act(async () => { root.render(<SubscriptionPlan session={session} onComplete={() => {}} />); });
    await flush();
    expect(host.textContent).toContain("Welcome to KudiAI Track");
    expect(host.textContent).toContain("Continue");
    expect(host.textContent).not.toMatch(/₦|coupon|Monthly|Yearly|Subscribe|Choose your plan/i);
  });

  it("Continue activates the free plan and completes sign-up — without ever calling the wallet payment", async () => {
    setNative(true);
    const done = [];
    await act(async () => { root.render(<SubscriptionPlan session={session} onComplete={(slug) => done.push(slug)} />); });
    await flush();
    const btn = [...host.querySelectorAll("button")].find((b) => b.textContent.includes("Continue"));
    await act(async () => { btn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    expect(mockRpcCalls.map((c) => c.name)).toEqual(["activate_free_subscription"]);
    expect(mockRpcCalls.some((c) => c.name === "wallet_pay_subscription")).toBe(false);
    expect(done.length).toBe(1);
  });

  it("a failed activation shows the error and stays on the screen", async () => {
    setNative(true);
    mockRpcError = { message: "network down" };
    const done = [];
    await act(async () => { root.render(<SubscriptionPlan session={session} onComplete={(slug) => done.push(slug)} />); });
    await flush();
    const btn = [...host.querySelectorAll("button")].find((b) => b.textContent.includes("Continue"));
    await act(async () => { btn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    expect(host.textContent).toContain("network down");
    expect(done).toEqual([]);
  });

  it("the plan-selling campaign slide renders nothing on Android", async () => {
    setNative(true);
    const campaigns = [{ id: "c1", headline: "Upgrade your plan", cta_action_type: "route", cta_action_value: "/upgrade" }];
    await act(async () => { root.render(<UpsellInlineSlot campaigns={campaigns} loading={false} recordEvent={() => {}} />); });
    expect(host.textContent).toBe("");
  });
});
