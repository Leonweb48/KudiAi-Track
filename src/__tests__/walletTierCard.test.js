import React, { act } from "react";
import { createRoot } from "react-dom/client";
import WalletTierCard from "../components/WalletTierCard";
import { useWalletTier } from "../hooks/useWalletTier";
import { tierLimits } from "../utils/walletTier";

jest.mock("../hooks/useWalletTier", () => ({ useWalletTier: jest.fn() }));
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
    refresh: jest.fn(), upgradeToTier2: jest.fn().mockResolvedValue({ ok: true, tier: 2, changed: true }), requestTier3: jest.fn().mockResolvedValue({ ok: true, requested: true }),
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
    expect(t).toContain("A passport photograph");
    expect(t).toContain("A utility bill as proof of address");
    expect(btn("Request Tier 3")).toBeTruthy();
  });

  it("a Tier 3 request already waiting is shown instead of the button", () => {
    use(api(2, { pending: true }));
    render({});
    expect(host.textContent).toContain("Request received — our team will contact you.");
    expect(btn("Request Tier 3")).toBeUndefined();
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
      expect(a.upgradeToTier2).toHaveBeenCalledWith({ full_name: "Ada Obi", address: "12 Market Road, Onitsha", state: "Anambra", lga: "", bvn: "12345678901", nin: "10987654321" });
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

  describe("Tier 3 request", () => {
    it("lists the documents and sends the request with the optional note", async () => {
      const a = api(2);
      use(a); render({});
      await click(btn("Request Tier 3"));
      expect(by('[role="dialog"]').textContent).toContain("Have these ready");
      expect(by('[role="dialog"]').textContent).toContain("Voter's card");
      type(by('[role="dialog"] textarea'), "call after 4pm");
      await click(btn("Send request"));
      expect(a.requestTier3).toHaveBeenCalledWith("call after 4pm");
      expect(host.textContent).toContain("Request received");
    });

    it("shows the server's reason if the request fails", async () => {
      const a = api(2, { requestTier3: jest.fn().mockRejectedValue(new Error("Could not send your request. Please try again.")) });
      use(a); render({});
      await click(btn("Request Tier 3"));
      await click(btn("Send request"));
      expect(host.textContent).toContain("Could not send your request");
    });
  });
});
