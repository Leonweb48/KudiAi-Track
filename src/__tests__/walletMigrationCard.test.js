import React, { act } from "react";
import { createRoot } from "react-dom/client";
import WalletMigrationCard from "../components/WalletMigrationCard";

// WalletPanel pulls in the whole wallet UI (and supabase); the card only needs its bank-name cleaner.
jest.mock("../components/WalletPanel", () => ({ cleanBankName: (s) => String(s || "").replace(/ \(.*\)$/, "") }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host, root;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = (props) => act(() => { root.render(React.createElement(WalletMigrationCard, props)); });
const type = (input, value) => act(() => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

const GRACE = Date.parse("2026-10-08T12:00:00Z");
const api = (over = {}) => ({ accountState: "migrate", graceUntilMs: GRACE, graceDaysLeft: 5, busy: false, migrateAccount: jest.fn().mockResolvedValue({ account_number: "9998887776", account_bank: "Wema Bank (NG)" }), ...over });

describe("WalletMigrationCard", () => {
  it("renders nothing for wallets that are already on the current account, or have none", () => {
    for (const accountState of ["active", "none", undefined]) {
      render({ api: api({ accountState }) });
      expect(host.innerHTML).toBe("");
    }
  });

  it("migrate: says the old number keeps working, with the deadline and days left", () => {
    render({ api: api(), testMode: false });
    expect(host.textContent).toContain("Your wallet has a new account number");
    expect(host.textContent).toContain("keeps working until 8 October");
    expect(host.textContent).toContain("5 days left");
    expect(host.textContent).toContain("Get my new number");
  });

  it("retired: says the old number has stopped working", () => {
    render({ api: api({ accountState: "retired", graceUntilMs: GRACE - 9 * 86400000, graceDaysLeft: 0 }) });
    expect(host.textContent).toContain("Your old account number has stopped working");
    expect(host.textContent).toContain("no longer reach your wallet");
  });

  it("without a deadline it never invents a date", () => {
    render({ api: api({ graceUntilMs: null, graceDaysLeft: null }) });
    expect(host.textContent).toContain("keeps working for a short while");
    expect(host.textContent).not.toMatch(/until \d/);
  });

  it("refuses a BVN that is not 11 digits and does not call the server", async () => {
    const a = api();
    render({ api: a, testMode: false });
    type(host.querySelector("input"), "12345");
    await click(host.querySelector("button"));
    expect(host.textContent).toContain("Enter your 11-digit BVN");
    expect(a.migrateAccount).not.toHaveBeenCalled();
  });

  it("strips non-digits from the BVN field and caps it at 11", () => {
    render({ api: api(), testMode: false });
    const input = host.querySelector("input");
    type(input, "12ab345-678901234");
    expect(input.value).toBe("12345678901");
  });

  it("sends the BVN, then shows the new number", async () => {
    const a = api();
    render({ api: a, testMode: false });
    type(host.querySelector("input"), "12345678901");
    await click(host.querySelector("button"));
    expect(a.migrateAccount).toHaveBeenCalledWith("12345678901");
    expect(host.textContent).toContain("Your new account number is ready");
    expect(host.textContent).toContain("9998887776");
    expect(host.textContent).toContain("Wema Bank");
    expect(host.textContent).toContain("Your old number keeps working until 8 October");
  });

  it("keeps showing the confirmation after the wallet flips to active, until dismissed", async () => {
    const a = api();
    render({ api: a, testMode: false });
    type(host.querySelector("input"), "12345678901");
    await click(host.querySelector("button"));
    render({ api: { ...a, accountState: "active" } });          // the refresh landed
    expect(host.textContent).toContain("9998887776");
    await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Done"));
    expect(host.innerHTML).toBe("");
  });

  it("shows the server's message when it fails, and lets them try again", async () => {
    const a = api({ migrateAccount: jest.fn().mockRejectedValue(new Error("Your BVN could not be verified.")) });
    render({ api: a, testMode: false });
    type(host.querySelector("input"), "12345678901");
    await click(host.querySelector("button"));
    expect(host.textContent).toContain("Your BVN could not be verified.");
    expect(host.querySelector("button").disabled).toBe(false);
  });

  it("test mode needs no BVN", async () => {
    const a = api();
    render({ api: a, testMode: true });
    expect(host.querySelector("input")).toBeNull();
    await click(host.querySelector("button"));
    expect(a.migrateAccount).toHaveBeenCalledWith("");
  });
});
