import React, { act } from "react";
import { createRoot } from "react-dom/client";
import AjoClientPendingScreen from "../screens/AjoClientPendingScreen";

// The screen looks up the business name through the ajo-portal function; hand it one business.
// Plain functions, not jest.fn(): CRA resets jest.fn implementations between tests.
jest.mock("../utils/supabase", () => ({
  supabase: {
    functions: { invoke: () => Promise.resolve({ data: { businesses: [{ id: "biz1", business_name: "Amaya & Co." }] } }) },
    auth: { signOut: () => Promise.resolve() },
  },
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host, root;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const show = async (ajoClient) => { await act(async () => { root.render(<AjoClientPendingScreen ajoClient={ajoClient} />); }); };

describe("registration fee on the 'awaiting approval' screen", () => {
  const base = { full_name: "Ada Obi", owner_id: "biz1", status: "pending_approval" };

  it("tells the client the fee and that it comes from their first deposit", async () => {
    await show({ ...base, registration_charge: 2000 });
    expect(host.textContent).toContain("Registration fee: ₦2,000");
    expect(host.textContent).toContain("first deposit");
    expect(host.textContent).toContain("Amaya & Co. confirms your final terms");
  });

  it("says plainly that there is no fee, rather than staying silent", async () => {
    await show({ ...base, registration_charge: 0 });
    expect(host.textContent).toContain("No registration fee");
  });

  it("shows nothing about a fee once the registration was declined", async () => {
    await show({ ...base, status: "rejected", registration_charge: 2000 });
    expect(host.textContent).toContain("Registration Declined");
    expect(host.textContent).not.toContain("Registration fee");
  });
});
