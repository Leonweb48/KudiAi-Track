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

// Saving a transfer recipient as a beneficiary is optional (2026-10-14) — owners and Ajo clients share this screen.
let mockSaved, mockRemote, mockDeleted, mockRemoteDeleted;
jest.mock("../utils/billBeneficiaries", () => ({
  getBeneficiaries: () => mockSaved,
  saveBeneficiary: (...a) => mockSaved.push({ args: a }),
  upsertRemote: (...a) => { mockRemote.push(a); return Promise.resolve(); },
  syncLocalToRemote: () => Promise.resolve(),
  fetchAllRemote: () => Promise.resolve(mockSaved.filter((b) => b.cat)),
  benDisplayName: (b) => b.nickname || b.verifyName || b.accountNo,
  benSubLabel: (b) => `${b.bankName} · ${b.accountNo}`,
  deleteBeneficiaryMatch: (...a) => mockDeleted.push(a),
  deleteRemote: (...a) => { mockRemoteDeleted.push(a); return Promise.resolve(); },
}));
jest.mock("../hooks/usePlatformConfig", () => ({ usePlatformConfig: () => ({ largeTransferSelfieThresholdKobo: 0, securitySelfieEnabled: false }) }));
jest.mock("../components/shared/BankSelect", () => (props) => (
  <button type="button" onClick={() => props.onChange("058", { code: "058", name: "GTBank" })}>MockPickBank</button>
));
jest.mock("../components/TransactionPinModal", () => (props) => (
  <div><button type="button" onClick={() => props.onApprove("1234")}>MockApprovePin</button></div>
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
const api = () => ({
  resolveAccount: jest.fn(async () => ({ account_name: "John Doe" })),
  transfer: jest.fn(async () => ({ fee_kobo: 0, withdrawal_id: "wd-1" })),
  scheduleTransfer: jest.fn(async () => ({})),
  withdrawals: [], ledger: [], requests: [], refresh: jest.fn(), receiptFor: jest.fn(),
});

// The save-as-beneficiary choice is on the AMOUNT step (2026-10-22: it replaced "record as a business expense" and
// "repeat this transfer"); `beforeReview` runs there, then the sheet moves on to the review step.
async function toReview(beforeReview = async () => {}) {
  await act(async () => {
    root.render(<TransferSheet open balanceKobo={99999900} maxKobo={99999900} banks={[]} api={api()} ownerId="u1" onDone={() => {}} />);
  });
  const acct = host.querySelector('input[inputmode="numeric"]');
  await type(acct, "0123456789");
  await click(button("MockPickBank"));
  await flush();
  await click(button("Continue"));
  await type(host.querySelector('input[inputmode="decimal"]'), "5000");
  await beforeReview();
  await click(button("Continue"));
}
const saveTick = () => [...host.querySelectorAll("label")].find((l) => l.textContent.includes("Save as beneficiary"))?.querySelector("input");

beforeEach(() => {
  mockSaved = []; mockRemote = []; mockDeleted = []; mockRemoteDeleted = [];
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("saving a transfer recipient is optional", () => {
  it("the amount step suggests saving a new recipient — and no longer offers 'business expense' or 'repeat'", async () => {
    await toReview(async () => {
      expect(saveTick()).toBeTruthy();
      expect(host.textContent).toContain("no typing the account again");
      expect(host.textContent).not.toMatch(/business expense|Repeat this transfer/i);
    });
    expect(saveTick()).toBeFalsy();   // asked once, on the amount step — not again on review
  });

  it("is off by default — a transfer does not save the account", async () => {
    await toReview(async () => { expect(saveTick().checked).toBe(false); });
    await click(button("Transfer"));
    await click(button("MockApprovePin"));
    expect(host.textContent).toMatch(/sent/i);
    expect(mockSaved.filter((x) => x.args)).toHaveLength(0);
    expect(mockRemote).toHaveLength(0);
    // …but it can still be saved from the success screen
    await click(button("as a beneficiary"));
    expect(mockSaved.filter((x) => x.args)).toHaveLength(1);
    expect(host.textContent).toContain("Saved as a beneficiary");
  });

  it("ticked with a nickname → saved with that nickname, here and on the server", async () => {
    await toReview(async () => {
      await click(saveTick());
      const nick = [...host.querySelectorAll("input")].find((i) => (i.placeholder || "").startsWith("Nickname"));
      await type(nick, "Mama Ngozi");
    });
    expect(host.textContent).toContain("Mama Ngozi will be saved as a beneficiary");
    await click(button("Transfer"));
    await click(button("MockApprovePin"));
    const saved = mockSaved.find((x) => x.args);
    expect(saved.args[0]).toBe("bank_transfer");
    expect(saved.args[1]).toMatchObject({ accountNo: "0123456789", bankCode: "058", nickname: "Mama Ngozi" });
    expect(mockRemote[0][3]).toMatchObject({ nickname: "Mama Ngozi" });
    expect(host.textContent).toContain("Saved as a beneficiary");
  });

  it("a saved beneficiary can be removed", async () => {
    mockSaved = [{ id: "9b2c", cat: "bank_transfer", accountNo: "0987654321", bankCode: "044", bankName: "Access Bank", verifyName: "Ada Obi" }];
    await act(async () => {
      root.render(<TransferSheet open balanceKobo={99999900} maxKobo={99999900} banks={[]} api={api()} ownerId="u1" onDone={() => {}} />);
    });
    await flush();
    expect(host.textContent).toContain("Saved beneficiaries");
    await click(button("Manage"));
    await click([...host.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || "").startsWith("Remove")));
    expect(mockDeleted).toHaveLength(1);
    expect(mockRemoteDeleted[0][1]).toBe("9b2c");
    expect(host.textContent).not.toContain("Ada Obi");
  });
});
