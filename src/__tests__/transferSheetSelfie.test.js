import { TextEncoder, TextDecoder } from "util";
// jsPDF (pulled in transitively via WalletPanel -> TransactionDetailModal -> printVouchers) needs TextEncoder, which jsdom doesn't provide
globalThis.TextEncoder = globalThis.TextEncoder || TextEncoder;
globalThis.TextDecoder = globalThis.TextDecoder || TextDecoder;
// eslint-disable-next-line import/first
const React = require("react"); const { act } = React;
// eslint-disable-next-line import/first
const { createRoot } = require("react-dom/client");
// eslint-disable-next-line import/first
const { TransferSheet } = require("../components/WalletPanel");

let mockSubmit, mockThreshold;
jest.mock("../utils/securitySelfie", () => ({ submitSecuritySelfie: (...a) => mockSubmit(...a) }));
jest.mock("../hooks/usePlatformConfig", () => ({ usePlatformConfig: () => ({ largeTransferSelfieThresholdKobo: mockThreshold }) }));
// Stub the heavy sub-components this test isn't about — each already has (or, for TransactionPinModal, pre-dates)
// its own concerns; this file only exercises TransferSheet's OWN new selfie-step logic.
jest.mock("../components/shared/BankSelect", () => (props) => (
  <button type="button" onClick={() => props.onChange("058", { code: "058", name: "GTBank" })}>MockPickBank</button>
));
jest.mock("../components/TransactionPinModal", () => (props) => (
  <div>
    <button type="button" onClick={() => props.onApprove("1234")}>MockApprovePin</button>
    <button type="button" onClick={props.onCancel}>MockCancelPin</button>
  </div>
));
jest.mock("../components/SelfieCapture", () => (props) => (
  <div>
    <button type="button" onClick={() => props.onCapture("data:image/jpeg;base64,FAKE")}>MockCapture</button>
    {props.value && <span>captured-thumbnail</span>}
  </div>
));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
const button = (text) => [...host.querySelectorAll("button")].find((b) => b.textContent.includes(text));
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };
const type = async (el, value) => { await act(async () => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true }));
}); await flush(); };

function mockApi(overrides = {}) {
  return {
    resolveAccount: jest.fn(async () => ({ account_name: "John Doe" })),
    transfer: jest.fn(async () => ({ fee_kobo: 0, withdrawal_id: "wd-1" })),
    scheduleTransfer: jest.fn(async () => ({})),
    withdrawals: [], ledger: [], requests: [], refresh: jest.fn(), receiptFor: jest.fn(),
    ...overrides,
  };
}

// Drives from the "to" step through to "review", then approves the PIN — the point at which the selfie
// step should (or shouldn't) appear, depending on the amount vs. the configured threshold.
async function reachPinApproved(api, amountNaira) {
  await act(async () => {
    root.render(<TransferSheet open balanceKobo={999999999900} maxKobo={999999999900} banks={[]} api={api} ownerId="u1" onDone={() => {}} />);
  });
  const acctInput = host.querySelector('input[inputmode="numeric"]');
  await type(acctInput, "0123456789");
  await click(button("MockPickBank"));
  await flush();   // the auto-verify effect resolves the account name
  await click(button("Continue"));
  const amountInput = host.querySelector('input[inputmode="decimal"]') || [...host.querySelectorAll("input")].find((i) => i !== acctInput);
  await type(amountInput, String(amountNaira));
  await click(button("Continue"));
  await click(button("Transfer"));
  await click(button("MockApprovePin"));
}

beforeEach(() => {
  mockSubmit = jest.fn(async () => ({ ok: true }));
  mockThreshold = 10_000_000;   // ₦100,000 in kobo, matching the real default
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("TransferSheet — large-transfer security selfie", () => {
  it("a transfer under the threshold goes straight through — no selfie step", async () => {
    const api = mockApi();
    await reachPinApproved(api, "50000");   // ₦50,000 < ₦100,000 threshold
    expect(host.textContent).toMatch(/sent/i);
    expect(api.transfer).toHaveBeenCalledTimes(1);
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("a transfer at or above the threshold asks for a selfie before the money moves", async () => {
    const api = mockApi();
    await reachPinApproved(api, "100000");   // exactly the threshold
    expect(host.textContent).toMatch(/one more step/i);
    expect(api.transfer).not.toHaveBeenCalled();   // not yet — waiting on the selfie
    await click(button("MockCapture"));
    expect(mockSubmit).toHaveBeenCalledWith("large_transfer", "data:image/jpeg;base64,FAKE", expect.objectContaining({
      amountKobo: 100000 * 100, recipientName: "John Doe", bankName: "GTBank", acctLast4: "0123456789",
    }));
    expect(api.transfer).toHaveBeenCalledTimes(1);   // only now, after a successful capture
    expect(host.textContent).toMatch(/sent/i);
  });

  it("a failed selfie submit never lets the transfer through", async () => {
    mockSubmit = jest.fn(async () => ({ ok: false, error: "Couldn't save the photo — please try again." }));
    const api = mockApi();
    await reachPinApproved(api, "200000");
    await click(button("MockCapture"));
    expect(host.textContent).toMatch(/couldn.t save the photo/i);
    expect(api.transfer).not.toHaveBeenCalled();
  });

  it("the threshold is off (0) — even a huge transfer skips the selfie step", async () => {
    mockThreshold = 0;
    const api = mockApi();
    await reachPinApproved(api, "5000000");
    expect(host.textContent).toMatch(/sent/i);
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("cancelling out of the selfie step never sends the transfer", async () => {
    const api = mockApi();
    await reachPinApproved(api, "150000");
    expect(host.textContent).toMatch(/one more step/i);
    await click(button("Cancel"));
    expect(api.transfer).not.toHaveBeenCalled();
    expect(host.textContent).toMatch(/confirm transfer|transfer ₦/i);   // back on the review step
  });
});
