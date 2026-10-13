import React, { act } from "react";
import { createRoot } from "react-dom/client";
import WalletTierCard from "../components/WalletTierCard";
import { useWalletTier } from "../hooks/useWalletTier";
import { tierLimits } from "../utils/walletTier";

jest.mock("../hooks/useWalletTier", () => ({ useWalletTier: jest.fn(), uploadTier3Doc: jest.fn() }));
// the real sheet animates via requestAnimationFrame/timeouts; a plain stand-in is enough here
jest.mock("../components/WalletPanel", () => ({ BottomSheet: ({ open, title, children }) => (open ? <div role="dialog" aria-label={title}>{children}</div> : null) }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host, root;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); jest.clearAllMocks(); });

const render = (props) => act(() => { root.render(React.createElement(WalletTierCard, { userId: "u1", enabled: true, ...props })); });
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const type = (el, value) => act(() => {
  const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
});
const btn = (t) => [...host.querySelectorAll("button")].find((b) => b.textContent.trim() === t);
const by = (sel, i = 0) => host.querySelectorAll(sel)[i];

const api = (tier, over = {}) => {
  const next = tier < 3 ? tier + 1 : null;
  return {
    loading: false, hasWallet: true, tier, next, pending: false,
    limits: tierLimits(tier), nextLimits: next ? tierLimits(next) : null,
    t3: null,
    refresh: jest.fn(), upgradeToTier2: jest.fn().mockResolvedValue({ ok: true, tier: 2, changed: true }), submitTier3: jest.fn().mockResolvedValue({ ok: true, requested: true }),
    ...over,
  };
};
const use = (a) => useWalletTier.mockReturnValue(a);

describe("WalletTierCard", () => {
  it("renders nothing when the wallet feature is off", () => {
    use(api(1));
    render({ enabled: false });
    expect(host.innerHTML).toBe("");
  });

  it("Tier 1: shows the tier, its limits and the nudge to Tier 2 with what it needs", () => {
    use(api(1));
    render({});
    const t = host.textContent;
    expect(t).toContain("Tier 1");
    expect(t).toContain("Basic");
    expect(t).toContain("₦300,000");            // max balance
    expect(t).toContain("₦100,000");            // daily limit
    expect(t).toContain("Upgrade to Tier 2");
    expect(t).toContain("₦500,000");            // what Tier 2 raises it to
    expect(t).toContain("₦200,000");
    expect(t).toContain("Your residential address");
    expect(t).toContain("Both your BVN and your NIN");
    expect(btn("Upgrade to Tier 2")).toBeTruthy();
  });

  it("Tier 2: shows Tier 2 limits and the nudge to Tier 3 with its document requirements", () => {
    use(api(2));
    render({});
    const t = host.textContent;
    expect(t).toContain("Tier 2");
    expect(t).toContain("Verified");
    expect(t).toContain("Upgrade to Tier 3");
    expect(t).toContain("Unlimited");
    expect(t).toContain("₦5,000,000");
    expect(t).toContain("A recent passport photograph");
    expect(t).toContain("from the last 3 months");
    expect(btn("Upgrade to Tier 3")).toBeTruthy();
  });

  it("documents under review are shown instead of the button", () => {
    use(api(2, { pending: true, t3: { id: "r1", status: "pending", hasDocs: true, submittedAt: "2026-10-13T09:00:00Z", reviewNote: "" } }));
    render({});
    expect(host.textContent).toContain("Documents under review");
    expect(btn("Upgrade to Tier 3")).toBeUndefined();
  });

  it("an old request without documents asks for them", () => {
    use(api(2, { pending: true, t3: { id: "r0", status: "pending", hasDocs: false, reviewNote: "" } }));
    render({});
    expect(host.textContent).toContain("waiting for your documents");
    expect(btn("Upload documents")).toBeTruthy();
  });

  it("a rejected request shows the reason and lets them try again", () => {
    use(api(2, { t3: { id: "r2", status: "rejected", hasDocs: true, reviewNote: "The utility bill is older than 3 months" } }));
    render({});
    expect(host.textContent).toContain("wasn't approved");
    expect(host.textContent).toContain("The utility bill is older than 3 months");
    expect(btn("Try again")).toBeTruthy();
  });

  it("Tier 3: highest tier, nothing left to upgrade to", () => {
    use(api(3));
    render({});
    expect(host.textContent).toContain("Tier 3");
    expect(host.textContent).toContain("Fully Verified");
    expect(host.textContent).toContain("You're on the highest tier");
    expect(host.textContent).not.toContain("Upgrade to");
  });

  it("no wallet yet: still shows Tier 1, no upgrade offer, and points at opening the wallet", async () => {
    use(api(1, { hasWallet: false }));
    const onOpenWallet = jest.fn();
    render({ onOpenWallet });
    expect(host.textContent).toContain("Tier 1");
    expect(host.textContent).toContain("Open your wallet");
    expect(host.textContent).not.toContain("Upgrade to Tier 2");
    await click(btn("Open my wallet"));
    expect(onOpenWallet).toHaveBeenCalled();
  });

  it("shows a placeholder while loading", () => {
    use(api(1, { loading: true }));
    render({});
    expect(host.querySelector(".animate-pulse")).toBeTruthy();
    expect(host.textContent).not.toContain("Tier");
  });

  describe("Tier 2 upgrade form", () => {
    const submit = () => click(by('[role="dialog"] button'));
    const open = async (a = api(1), prefill) => { use(a); render({ prefill }); await click(btn("Upgrade to Tier 2")); return a; };
    const fill = async ({ name = "Ada Obi", address = "12 Market Road, Onitsha", state = "Anambra", bvn = "12345678901", nin = "10987654321" } = {}) => {
      const inputs = host.querySelectorAll('[role="dialog"] input');
      const [nameI, addrI, bvnI, ninI] = [inputs[0], inputs[1], inputs[2], inputs[3]];
      type(nameI, name); type(addrI, address);
      if (state) type(by('[role="dialog"] select'), state);
      type(bvnI, bvn); type(ninI, nin);
    };

    it("opens with the fields and pre-fills what we already know", async () => {
      await open(api(1), { fullName: "Ada Obi", address: "12 Market Road", state: "Anambra", lga: "" });
      const inputs = host.querySelectorAll('[role="dialog"] input');
      expect(inputs).toHaveLength(4);                              // name, address, BVN, NIN
      expect(inputs[0].value).toBe("Ada Obi");
      expect(inputs[1].value).toBe("12 Market Road");
      expect(by('[role="dialog"] select').value).toBe("Anambra");
    });

    it("checks every field before it calls the server", async () => {
      const a = await open();
      await fill({ name: "Ada" });
      await submit();
      expect(host.textContent).toContain("Enter your full name");
      await fill({ address: "Onitsha" });
      await submit();
      expect(host.textContent).toContain("Enter your full residential address");
      await fill({ bvn: "12345" });
      await submit();
      expect(host.textContent).toContain("Your BVN must be exactly 11 digits");
      await fill({ nin: "" });
      await submit();
      expect(host.textContent).toContain("Your NIN must be exactly 11 digits");
      await fill({ bvn: "12345678901", nin: "12345678901" });
      await submit();
      expect(host.textContent).toContain("different numbers");
      expect(a.upgradeToTier2).not.toHaveBeenCalled();
    });

    it("strips non-digits from the BVN and NIN fields", async () => {
      await open();
      await fill({ bvn: "12ab345-678901234", nin: "1a0b9c8" });
      const inputs = host.querySelectorAll('[role="dialog"] input');
      expect(inputs[2].value).toBe("12345678901");
      expect(inputs[3].value).toBe("1098");
    });

    it("a complete form goes to the server and ends on a confirmation", async () => {
      const a = await open();
      await fill();
      await submit();
      expect(a.upgradeToTier2).toHaveBeenCalledWith({ full_name: "Ada Obi", address: "12 Market Road, Onitsha", state: "Anambra", lga: "", bvn: "12345678901", nin: "10987654321", selfie: "", consent: false });
      expect(host.textContent).toContain("You're now on Tier 2");
    });

    it("shows the server's reason when it refuses, and stays open to retry", async () => {
      const a = await open(api(1, { upgradeToTier2: jest.fn().mockRejectedValue(new Error("Open your wallet first, then upgrade")) }));
      await fill();
      await submit();
      expect(host.textContent).toContain("Open your wallet first, then upgrade");
      expect(host.textContent).not.toContain("You're now on Tier 2");
      expect(a.upgradeToTier2).toHaveBeenCalledTimes(1);
    });
  });

  describe("Tier 3 upgrade (documents + samples)", () => {
    // the flow is a full-screen portal on document.body, not inside the card
    const page = () => document.querySelector('[aria-label="Upgrade to Tier 3"]');
    const pbtn = (t) => [...page().querySelectorAll("button")].find((b) => b.textContent.trim() === t);
    const pickFile = (input, file) => act(async () => {
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    beforeAll(() => { global.URL.createObjectURL = jest.fn(() => "blob:preview"); });

    const start = async (a = api(2)) => {
      use(a); render({ prefill: { address: "" } });
      await click(btn("Upgrade to Tier 3"));
      return a;
    };

    it("starts with what is needed and a sample of each document", async () => {
      await start();
      expect(page().textContent).toContain("What you'll need");
      expect(page().textContent).toContain("Utility bill (proof of address)");
      const samples = [...page().querySelectorAll("img")].map((i) => i.getAttribute("src"));
      expect(samples).toEqual(expect.arrayContaining(["/kyc-samples/id-front.svg", "/kyc-samples/utility-bill.svg", "/kyc-samples/passport-photo.svg"]));
    });

    it("checks the ID details before the uploads", async () => {
      await start();
      await click(pbtn("Start"));
      await click(pbtn("Continue"));
      expect(page().textContent).toContain("Choose the type of ID");
      await click(pbtn("International passport"));
      type(page().querySelector("#t3-idno"), "12345");
      await click(pbtn("Continue"));
      expect(page().textContent).toContain("a letter and 8 digits");
      type(page().querySelector("#t3-idno"), "A12345678");
      await click(pbtn("Continue"));
      expect(page().textContent).toContain("as it appears on your utility bill");
    });

    it("uploads every document, then submits for review with the paths", async () => {
      const { uploadTier3Doc } = jest.requireMock("../hooks/useWalletTier");
      uploadTier3Doc.mockImplementation(async (kind) => ({ kind, path: `u1/tier3/${kind}-1.jpg` }));
      const a = await start(api(2, { submitTier3: jest.fn().mockResolvedValue({ ok: true, requested: true }) }));
      await click(pbtn("Start"));
      await click(pbtn("National ID card"));
      type(page().querySelector("#t3-idno"), "12345678901");
      type(page().querySelector("#t3-addr"), "12 Market Road, Onitsha");
      await click(pbtn("Continue"));
      // a National ID card needs the back too: 4 documents
      const choose = [...page().querySelectorAll("input[type=file]:not([capture])")];
      expect(choose).toHaveLength(4);
      await click(pbtn("Continue"));
      expect(page().textContent).toContain("Upload every document");
      for (const input of choose) await pickFile(input, new File(["x"], "doc.jpg", { type: "image/jpeg" }));
      expect(uploadTier3Doc).toHaveBeenCalledTimes(4);
      await click(pbtn("Continue"));
      expect(pbtn("Submit for review").disabled).toBe(true);           // must confirm the documents first
      await click(page().querySelector("input[type=checkbox]"));
      await click(pbtn("Submit for review"));
      expect(a.submitTier3).toHaveBeenCalledWith({
        id_type: "national_id", id_number: "12345678901", address: "12 Market Road, Onitsha", note: "",
        documents: ["id_front", "id_back", "utility_bill", "passport_photo"].map((k) => ({ kind: k, path: `u1/tier3/${k}-1.jpg` })),
      });
      expect(page().textContent).toContain("Documents submitted");
    });

    it("shows an upload error on that document and keeps Continue blocked", async () => {
      const { uploadTier3Doc } = jest.requireMock("../hooks/useWalletTier");
      uploadTier3Doc.mockRejectedValue(new Error("Upload failed — check your connection and try again."));
      await start();
      await click(pbtn("Start"));
      await click(pbtn("International passport"));
      type(page().querySelector("#t3-idno"), "A12345678");
      type(page().querySelector("#t3-addr"), "12 Market Road, Onitsha");
      await click(pbtn("Continue"));
      const choose = [...page().querySelectorAll("input[type=file]:not([capture])")];
      expect(choose).toHaveLength(3);                                    // passport: no back
      await pickFile(choose[0], new File(["x"], "doc.jpg", { type: "image/jpeg" }));
      expect(page().textContent).toContain("Upload failed");
      await click(pbtn("Continue"));
      expect(page().textContent).toContain("Upload every document");
    });
  });
});
