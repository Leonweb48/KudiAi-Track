import { TextEncoder, TextDecoder } from "util";
// jsPDF (pulled in transitively via WalletPanel -> TransactionDetailModal -> printVouchers) needs TextEncoder
globalThis.TextEncoder = globalThis.TextEncoder || TextEncoder;
globalThis.TextDecoder = globalThis.TextDecoder || TextDecoder;
// eslint-disable-next-line import/first
const React = require("react"); const { act } = React;
// eslint-disable-next-line import/first
const { createRoot } = require("react-dom/client");
// eslint-disable-next-line import/first
const { TransferSheet } = require("../components/WalletPanel");

// The transfer screen's "copied account number", bank suggestions and bank network strength (2026-10-02).
let mockClipboard = "", mockSaved = [];
// plain functions, not jest.fn: CRA resets jest.fn implementations before every test
jest.mock("../utils/clipboard", () => ({ readClipboardText: async () => mockClipboard }));
jest.mock("../utils/billBeneficiaries", () => ({
  ...jest.requireActual("../utils/billBeneficiaries"),
  getBeneficiaries: () => mockSaved,
}));
jest.mock("../hooks/usePlatformConfig", () => ({ usePlatformConfig: () => ({ largeTransferSelfieThresholdKobo: 10_000_000, securitySelfieEnabled: false }) }));
// The picker is its own component; here it shows what it was given (selected code + network map) and can pick GTBank.
jest.mock("../components/shared/BankSelect", () => (props) => (
  <div>
    <span data-testid="picker">{`value=${props.value || "-"} network=${JSON.stringify(props.network || {})}`}</span>
    <button type="button" onClick={() => props.onChange("058", { code: "058", name: "Guaranty Trust Bank" })}>MockPickBank</button>
  </div>
));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
const flush = async () => { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); }); };
const wait = async (ms) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); await flush(); };
const text = () => host.textContent;
const button = (t) => [...host.querySelectorAll("button")].find((b) => b.textContent.includes(t));
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };
const acctInput = () => host.querySelector('input[inputmode="numeric"]');
const type = async (el, value) => { await act(async () => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true }));
}); await flush(); };
const paste = async (el, t) => { await act(async () => {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  ev.clipboardData = { getData: () => t };
  el.dispatchEvent(ev);
}); await flush(); };

const BANKS = [
  { code: "058", name: "Guaranty Trust Bank" }, { code: "100004", name: "OPay" }, { code: "090267", name: "Kuda Microfinance Bank" },
];
function mockApi(overrides = {}) {
  return {
    resolveAccount: jest.fn(async () => ({ account_name: "John Doe" })),
    suggestBanks: jest.fn(async () => ({ ok: true, matches: [{ code: "100004", bank_name: "OPay", account_name: "ADA OKAFOR" }] })),
    bankNetwork: jest.fn(async () => ({ ok: true, banks: {}, overall: "unknown" })),
    transfer: jest.fn(), scheduleTransfer: jest.fn(),
    withdrawals: [], ledger: [], requests: [], refresh: jest.fn(), receiptFor: jest.fn(),
    ...overrides,
  };
}
const render = async (api) => {
  await act(async () => { root.render(<TransferSheet open balanceKobo={9_999_900} maxKobo={9_999_900} banks={BANKS} api={api} onDone={() => {}} />); });
  await flush();
};

beforeEach(() => {
  mockClipboard = ""; mockSaved = [];
  try { sessionStorage.clear(); } catch { /* ignore */ }
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("bank suggestions for a typed account number", () => {
  it("no bank chosen → asks the server, shows where the account is, and picking it fills bank + name without a second check", async () => {
    const api = mockApi();
    await render(api);
    await type(acctInput(), "8031234567");
    expect(text()).toContain("Finding the bank");
    await wait(450);
    expect(api.suggestBanks).toHaveBeenCalledWith("8031234567");
    expect(text()).toContain("ADA OKAFOR");
    expect(text()).toContain("OPay");
    await click(button("ADA OKAFOR"));
    expect(host.querySelector('[data-testid="picker"]').textContent).toContain("value=100004");
    expect(text()).toContain("Account name");
    expect(api.resolveAccount).not.toHaveBeenCalled();   // the server already checked this name at this bank
  });

  it("nothing found → says so and leaves the bank picker", async () => {
    const api = mockApi({ suggestBanks: jest.fn(async () => ({ ok: true, matches: [] })) });
    await render(api);
    await type(acctInput(), "0123456789");
    await wait(450);
    expect(text()).toContain("couldn't match a bank");
  });

  it("a bank already chosen → no suggestion lookup, the normal name check runs", async () => {
    const api = mockApi();
    await render(api);
    await click(button("MockPickBank"));
    await type(acctInput(), "0123456789");
    await wait(450);
    expect(api.suggestBanks).not.toHaveBeenCalled();
    expect(api.resolveAccount).toHaveBeenCalledWith("058", "0123456789");
  });

  it("a saved recipient with that number → its bank is picked straight away, no lookup", async () => {
    mockSaved = [{ id: "b1", cat: "bank_transfer", accountNo: "2200001236", bankCode: "090267", bankName: "Kuda Microfinance Bank" }];
    const api = mockApi();
    await render(api);
    await type(acctInput(), "2200001236");
    await wait(450);
    expect(api.suggestBanks).not.toHaveBeenCalled();
    expect(api.resolveAccount).toHaveBeenCalledWith("090267", "2200001236");
  });
});

describe("copied / pasted account numbers", () => {
  it("pasting a whole message fills the number AND the bank it names", async () => {
    const api = mockApi();
    await render(api);
    await paste(acctInput(), "Pls send to 0123456789 GTBank, Adaeze");
    expect(acctInput().value).toBe("0123456789");
    expect(host.querySelector('[data-testid="picker"]').textContent).toContain("value=058");
    expect(api.resolveAccount).toHaveBeenCalledWith("058", "0123456789");
  });

  it("an account number on the clipboard is offered when the screen opens — once", async () => {
    mockClipboard = "Acct: 0123456789 GTBank";
    const api = mockApi();
    await render(api);
    expect(text()).toContain("Use the account number you copied?");
    expect(text()).toContain("0123456789");
    await click(button("Use"));
    expect(acctInput().value).toBe("0123456789");
    expect(api.resolveAccount).toHaveBeenCalledWith("058", "0123456789");

    // closed and opened again with the same thing copied → not offered again
    await act(async () => { root.render(<TransferSheet open={false} balanceKobo={1} maxKobo={1} banks={BANKS} api={api} onDone={() => {}} />); });
    await render(api);
    expect(text()).not.toContain("Use the account number you copied?");
  });

  it("nothing usable on the clipboard → no offer", async () => {
    mockClipboard = "hello there";
    await render(mockApi());
    expect(text()).not.toContain("Use the account number you copied?");
  });
});

describe("bank network strength", () => {
  it("passes the per-bank status to the picker and warns about a poor bank and poor transfers overall", async () => {
    const api = mockApi({ bankNetwork: jest.fn(async () => ({ ok: true, banks: { "058": { status: "poor", samples: 6 } }, overall: "poor" })) });
    await render(api);
    expect(host.querySelector('[data-testid="picker"]').textContent).toContain('"058":"poor"');
    expect(text()).toContain("Bank transfers are having problems right now");
    await click(button("MockPickBank"));
    expect(text()).toContain("are failing often right now");
  });

  it("unknown → no warnings", async () => {
    await render(mockApi());
    await click(button("MockPickBank"));
    expect(text()).not.toContain("failing often");
    expect(text()).not.toContain("having problems");
  });
});
