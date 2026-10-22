// eslint-disable-next-line import/first
const React = require("react"); const { act } = React;
// eslint-disable-next-line import/first
const { createRoot } = require("react-dom/client");
// eslint-disable-next-line import/first
const BankSelect = require("../components/shared/BankSelect").default;

// The type-to-search bank box (2026-10-22): owner/staff/client transfers and every bank-details form use it.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const BANKS = [
  { code: "058", name: "Guaranty Trust Bank" }, { code: "033", name: "United Bank For Africa" },
  { code: "100004", name: "OPay Digital Services Limited (OPay)" }, { code: "090267", name: "Kuda Microfinance Bank" },
  { code: "035", name: "Wema Bank" }, { code: "044", name: "Access Bank" }, { code: "999", name: "Abbey Mortgage Bank" },
];
let host, root, picks;
const flush = async () => { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); }); };
const render = async (value = "") => {
  await act(async () => { root.render(<BankSelect banks={BANKS} value={value} onChange={(code, b) => picks.push([code, b.name])} placeholder="Select bank" />); });
  await flush();
};
const box = () => host.querySelector('input[role="combobox"]');
const rows = () => [...host.querySelectorAll('[role="option"]')].map((r) => r.textContent.trim());
const typeIn = async (v) => { await act(async () => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(box(), v); box().dispatchEvent(new Event("input", { bubbles: true }));
}); await flush(); };
const focusBox = async () => { await act(async () => { box().focus(); }); await flush(); };

beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); picks = []; });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("type-to-search bank box", () => {
  it("is a text box in the form, closed until tapped; tapping shows common banks first", async () => {
    await render();
    expect(box()).toBeTruthy();
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    await focusBox();
    expect(host.textContent).toContain("Common");
    expect(rows()[0]).toMatch(/Access Bank|Guaranty|Kuda|OPay|United Bank/);
  });

  it("typing narrows the list: a word that starts with it first, short forms like gtb / uba work", async () => {
    await render(); await focusBox();
    await typeIn("op");
    expect(rows()).toEqual(["OPay Digital Services Limited (OPay)"]);
    await typeIn("gtb");
    expect(rows()).toEqual(["Guaranty Trust Bank"]);
    await typeIn("uba");
    expect(rows()).toEqual(["United Bank For Africa"]);
    await typeIn("ba");   // every name with a word starting "ba" ("Bank"); OPay's list name has none
    expect(rows().length).toBe(BANKS.length - 1);
    expect(rows()).not.toContain("OPay Digital Services Limited (OPay)");
    await typeIn("zzz");
    expect(host.textContent).toContain("No banks match");
  });

  it("tapping a bank picks it ONCE, closes the list and shows its name in the box", async () => {
    await render(); await focusBox(); await typeIn("kuda");
    const row = host.querySelector('[role="option"]');
    await act(async () => { row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); row.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    expect(picks).toEqual([["090267", "Kuda Microfinance Bank"]]);
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it("the keyboard works: arrow down + Enter picks; a chosen bank shows its name when closed", async () => {
    await render("035");
    expect(box().value).toBe("Wema Bank");
    await focusBox(); await typeIn("a");
    await act(async () => { box().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    await act(async () => { box().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await flush();
    expect(picks.length).toBe(1);
  });

  it("a tap outside closes the list without picking anything", async () => {
    await render(); await focusBox();
    await act(async () => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    await flush();
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(picks).toEqual([]);
  });
});
