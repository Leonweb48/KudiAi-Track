import React, { act } from "react";
import { createRoot } from "react-dom/client";
import fs from "fs";
import path from "path";
import KycConsent from "../components/KycConsent";
import WalletIdFields from "../components/WalletIdFields";
import { KYC_CONSENT_TEXT, kycConsentGiven, setKycConsent } from "../utils/kycConsent";

// Plain variable read by the mock (CRA resets jest.fn implementations between tests)
let mockEnabled = false;
jest.mock("../hooks/usePlatformConfig", () => ({ usePlatformConfig: () => ({ kycEnabled: mockEnabled }) }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => { mockEnabled = false; setKycConsent(false); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const show = async (el) => { await act(async () => { root.render(el); }); };
const box = () => host.querySelector('input[type="checkbox"]');
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); };

describe("the identity-check consent box", () => {
  it("is invisible while identity checks are off — nothing changes on any screen", async () => {
    await show(<KycConsent />);
    expect(host.innerHTML).toBe("");
    expect(kycConsentGiven()).toBe(false);
  });

  it("appears when checks are on, is never pre-ticked, and says who checks what", async () => {
    mockEnabled = true;
    await show(<KycConsent />);
    expect(box()).not.toBeNull();
    expect(box().checked).toBe(false);
    expect(kycConsentGiven()).toBe(false);
    expect(host.textContent).toContain("Youverify");
    expect(host.textContent).toContain("BVN / NIN");
    expect(host.textContent).toContain("not my BVN or NIN");
  });

  it("ticking gives consent, unticking withdraws it", async () => {
    mockEnabled = true;
    await show(<KycConsent />);
    await click(box()); expect(kycConsentGiven()).toBe(true); expect(box().checked).toBe(true);
    await click(box()); expect(kycConsentGiven()).toBe(false); expect(box().checked).toBe(false);
  });

  it("a tick never carries over to another form: it is cleared the moment the box leaves the screen", async () => {
    mockEnabled = true;
    await show(<KycConsent />);
    await click(box()); expect(kycConsentGiven()).toBe(true);
    await show(<div>another screen</div>);
    expect(kycConsentGiven()).toBe(false);
    await show(<KycConsent />);
    expect(box().checked).toBe(false);
  });

  it("is part of the shared BVN / NIN fields only while checks are on", async () => {
    const noop = () => {};
    await show(<WalletIdFields bvn="" nin="" onBvn={noop} onNin={noop} />);
    expect(host.querySelectorAll("input").length).toBe(2);          // BVN + NIN only
    mockEnabled = true;
    await show(<div><WalletIdFields bvn="" nin="" onBvn={noop} onNin={noop} /></div>);
    expect(host.querySelectorAll("input").length).toBe(3);          // + the consent box
    expect(box()).not.toBeNull();
  });

  it("the consent wording names the partner and what is kept (the privacy policy must match it)", () => {
    expect(KYC_CONSENT_TEXT).toMatch(/NIBSS and NIMC/);
    expect(KYC_CONSENT_TEXT).toMatch(/Youverify/);
    expect(KYC_CONSENT_TEXT).toMatch(/Only the result and the name on the record are kept/);
  });

  it("only a real boolean true counts (a truthy string from somewhere else is not consent)", () => {
    setKycConsent("yes"); expect(kycConsentGiven()).toBe(false);
    setKycConsent(1); expect(kycConsentGiven()).toBe(false);
    setKycConsent(true); expect(kycConsentGiven()).toBe(true);
  });
});

// The server refuses a lookup unless the request carries consent === true, so every place that sends a BVN / NIN must send it. A wiring check, so a later
// refactor cannot quietly drop it (the customer would then hit "please tick the box" with no way to comply).
describe("every request that carries a BVN / NIN also carries the consent", () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
  it.each([
    ["hooks/useWallet.js", 'invoke("provision-account", { bvn, nin, consent: kycConsentGiven() })'],
    ["hooks/useWallet.js", 'invoke("provision-account", { bvn, nin, migrate: true, consent: kycConsentGiven() })'],
    ["hooks/useWalletMigrationGate.js", 'action: "provision-account", bvn, nin, migrate: true, consent: kycConsentGiven()'],
    ["components/WalletTierCard.jsx", "consent: kycConsentGiven()"],
    ["screens/Verification.jsx", 'action: "tier1_submit", nin, consent: kycConsentGiven()'],
  ])("%s sends consent", (file, snippet) => { expect(read(file)).toContain(snippet); });

  it.each([
    ["components/WalletIdFields.jsx"], ["components/WalletTierCard.jsx"], ["screens/Onboarding.jsx"], ["screens/Verification.jsx"],
  ])("%s shows the consent box", (file) => { expect(read(file)).toContain("<KycConsent"); });
});
