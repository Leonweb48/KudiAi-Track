import React, { act } from "react";
import { createRoot } from "react-dom/client";
import WalletMigrationGate from "../components/WalletMigrationGate";

jest.mock("../components/WalletPanel", () => ({ cleanBankName: (s) => String(s || "") }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host, root;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = (props) => act(() => { root.render(React.createElement(WalletMigrationGate, props)); });
const type = (input, value) => act(() => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const buttonByText = (t) => [...host.querySelectorAll("button")].find((b) => b.textContent.trim() === t);

const gateObj = (over = {}) => ({
  accountState: "migrate", graceUntilMs: null, graceDaysLeft: null, busy: false, holding: false,
  migrateAccount: jest.fn().mockResolvedValue({ ok: true, migrated: true, account: "business", account_number: "5554443332", account_bank: "Flutterwave MFB" }),
  refresh: jest.fn(), skip: jest.fn(), release: jest.fn(), ...over,
});

describe("WalletMigrationGate", () => {
  it("stops the user with a clear step, the form and a way to log out — and no way to skip yet", () => {
    render({ gate: gateObj(), onLogout: jest.fn() });
    expect(host.textContent).toContain("Action needed");
    expect(host.textContent).toContain("One quick step to keep your wallet working");
    expect(host.textContent).toContain("Get my new number");
    expect(host.querySelectorAll("input").length).toBe(2);              // BVN + NIN
    expect(buttonByText("Log out")).toBeTruthy();
    expect(buttonByText("Continue for now")).toBeUndefined();
  });

  it("no logout button when none is supplied", () => {
    render({ gate: gateObj() });
    expect(buttonByText("Log out")).toBeUndefined();
  });

  it("logging out calls the handler", async () => {
    const onLogout = jest.fn();
    render({ gate: gateObj(), onLogout });
    await click(buttonByText("Log out"));
    expect(onLogout).toHaveBeenCalled();
  });

  it("a failed attempt reveals 'Continue for now', which skips", async () => {
    const g = gateObj({ migrateAccount: jest.fn().mockRejectedValue(new Error("Your BVN or NIN could not be verified.")) });
    render({ gate: g });
    type(host.querySelectorAll("input")[0], "12345678901");
    await click(buttonByText("Get my new number"));
    expect(host.textContent).toContain("Your BVN or NIN could not be verified.");
    const skip = buttonByText("Continue for now");
    expect(skip).toBeTruthy();
    await click(skip);
    expect(g.skip).toHaveBeenCalled();
  });

  it("an answer that did not actually move the wallet also counts as a failed attempt", async () => {
    const g = gateObj({ migrateAccount: jest.fn().mockResolvedValue({ ok: true, migrated: false, account: "legacy", account_number: "1111" }) });
    render({ gate: g });
    type(host.querySelectorAll("input")[1], "10987654321");
    await click(buttonByText("Get my new number"));
    expect(buttonByText("Continue for now")).toBeTruthy();
  });

  it("validation errors (no ID entered) do not offer the way out — the user just hasn't tried yet", async () => {
    render({ gate: gateObj() });
    await click(buttonByText("Get my new number"));
    expect(host.textContent).toContain("Enter your BVN or your NIN");
    expect(buttonByText("Continue for now")).toBeUndefined();
  });

  it("success: shows the new number, hides the pressure copy and the logout link; Done releases the gate", async () => {
    const g = gateObj();
    const { rerender } = { rerender: (extra) => render({ gate: { ...g, ...extra }, onLogout: jest.fn() }) };
    render({ gate: g, onLogout: jest.fn() });
    type(host.querySelectorAll("input")[0], "12345678901");
    await click(buttonByText("Get my new number"));
    expect(g.migrateAccount).toHaveBeenCalledWith("12345678901", "");
    rerender({ holding: true, accountState: "active" });                    // what the app does once the move is confirmed
    expect(host.textContent).toContain("Your new account number is ready");
    expect(host.textContent).toContain("5554443332");
    expect(host.textContent).not.toContain("One quick step");
    expect(buttonByText("Log out")).toBeUndefined();
    await click(buttonByText("Done"));
    expect(g.release).toHaveBeenCalled();
  });

  it("retired wallets get the stronger wording", () => {
    render({ gate: gateObj({ accountState: "retired" }) });
    expect(host.textContent).toContain("Your old account number has stopped working");
  });
});
