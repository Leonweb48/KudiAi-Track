// The campaign placements' behaviour (2026-10-02 upgrade): the pop-up's frequency cap / one-per-session / never over
// another dialog, the Stories row + full-screen viewer, and the shared media player.
const React = require("react"); const { act } = React;
const { createRoot } = require("react-dom/client");
const PopupSlot = require("../components/slots/PopupSlot").default;
const StoriesSlot = require("../components/slots/StoriesSlot").default;
const CampaignMedia = require("../components/slots/CampaignMedia").default;

// react-router-dom v7 is ESM-only; mocked the same way as the other screen tests
const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({ useNavigate: () => mockNavigate }), { virtual: true });

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
const flush = async () => { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); }); };
const render = async (el) => { await act(async () => { root.render(el); }); await flush(); };
const text = () => document.body.textContent;
const byText = (t, sel = "button") => [...document.querySelectorAll(sel)].find((b) => b.textContent.includes(t));
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };
const pointer = async (el, x) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: x, clientY: 10 }));
    el.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: x, clientY: 10 }));
  });
  await flush();
};

beforeAll(() => {
  // jsdom has no media playback
  window.HTMLMediaElement.prototype.play = function play() { return Promise.resolve(); };
  window.HTMLMediaElement.prototype.pause = function pause() {};
});
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove();
  document.querySelectorAll("[data-test-busy]").forEach((n) => n.remove());
  jest.useRealTimers();
});

describe("PopupSlot", () => {
  const promo = (over = {}) => ({ id: "p1", headline: "Big offer", body: "Save more", creative_url: "https://cdn/a.jpg", frequency_cap: "once_ever", cta_label: "Get it", cta_action_type: "deeplink", cta_action_value: "/bills", ...over });
  const show = async (campaigns, rec) => {
    jest.useFakeTimers("modern");
    await render(<PopupSlot campaigns={campaigns} loading={false} recordEvent={rec} />);
    await act(async () => { jest.advanceTimersByTime(4100); });
    await flush();
  };

  it("waits a few seconds, then shows once and counts the view", async () => {
    const rec = jest.fn();
    jest.useFakeTimers("modern");
    await render(<PopupSlot campaigns={[promo()]} loading={false} recordEvent={rec} />);
    expect(text()).not.toContain("Big offer");
    await act(async () => { jest.advanceTimersByTime(4100); });
    await flush();
    expect(text()).toContain("Big offer");
    expect(rec).toHaveBeenCalledWith("p1", "impression");
  });

  it("once_ever: not again — even in a new app session", async () => {
    await show([promo()], jest.fn());
    expect(text()).toContain("Big offer");
    act(() => root.unmount()); root = createRoot(host);
    sessionStorage.clear();                       // a new app session
    await show([promo()], jest.fn());
    expect(text()).not.toContain("Big offer");
  });

  it("at most one pop-up per app session, whatever the cap", async () => {
    await show([promo({ frequency_cap: "always" })], jest.fn());
    act(() => root.unmount()); root = createRoot(host);
    await show([promo({ id: "p2", headline: "Other offer", frequency_cap: "always" })], jest.fn());
    expect(text()).not.toContain("Other offer");
  });

  it("never over another open dialog — waits until it closes", async () => {
    const busy = document.createElement("div");
    busy.setAttribute("role", "dialog"); busy.setAttribute("aria-modal", "true"); busy.setAttribute("data-test-busy", "1");
    document.body.appendChild(busy);
    await show([promo()], jest.fn());
    expect(text()).not.toContain("Big offer");
    busy.remove();
    await act(async () => { jest.advanceTimersByTime(3100); });
    await flush();
    expect(text()).toContain("Big offer");
  });

  it("'Not now' closes it and records a dismiss", async () => {
    const rec = jest.fn();
    await show([promo()], rec);
    await click(byText("Not now"));
    await act(async () => { jest.advanceTimersByTime(400); });
    await flush();
    expect(text()).not.toContain("Big offer");
    expect(rec).toHaveBeenCalledWith("p1", "dismiss");
  });
});

describe("Stories", () => {
  const story = (id, headline, frames) => ({ id, headline, updated_at: "2026-10-02", cta_label: "Open bills", cta_action_type: "deeplink", cta_action_value: "/bills", stories: frames });
  const two = [
    story("s1", "Bills week", [{ url: "https://cdn/1.jpg", headline: "Frame one" }, { url: "https://cdn/2.jpg", headline: "Frame two" }]),
    story("s2", "Save more", [{ url: "https://cdn/3.jpg", headline: "Frame three" }]),
    story("empty", "No frames", []),
  ];

  it("shows a bubble per story with frames; nothing opens until tapped", async () => {
    await render(<StoriesSlot campaigns={two} loading={false} recordEvent={jest.fn()} />);
    expect(text()).toContain("Bills week");
    expect(text()).toContain("Save more");
    expect(text()).not.toContain("No frames");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("tap → full-screen viewer; taps move through frames and on to the next story; the end closes and marks it watched", async () => {
    const rec = jest.fn();
    await render(<StoriesSlot campaigns={two} loading={false} recordEvent={rec} />);
    await click(byText("Bills week"));
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(text()).toContain("Frame one");
    expect(rec).toHaveBeenCalledWith("s1", "view_start");
    const tapArea = dialog.querySelector(".touch-none");
    await pointer(tapArea, 300);                    // right side → next
    expect(text()).toContain("Frame two");
    await pointer(tapArea, 300);                    // → next story
    expect(text()).toContain("Frame three");
    expect(rec).toHaveBeenCalledWith("s1", "view_complete");
    await pointer(tapArea, -5);                     // left side → back
    expect(text()).toContain("Frame one");
  });

  it("the button records a click and closes the viewer", async () => {
    const rec = jest.fn();
    await render(<StoriesSlot campaigns={two} loading={false} recordEvent={rec} />);
    await click(byText("Bills week"));
    await click(byText("Open bills"));
    expect(rec).toHaveBeenCalledWith("s1", "click", { tileIndex: 0 });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(mockNavigate).toHaveBeenCalledWith("/bills");
  });

  it("the phone's Back button (popstate) closes the viewer", async () => {
    const rec = jest.fn();
    await render(<StoriesSlot campaigns={two} loading={false} recordEvent={rec} />);
    await click(byText("Bills week"));
    await act(async () => { window.dispatchEvent(new PopStateEvent("popstate")); });
    await flush();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(rec).toHaveBeenCalledWith("s1", "dismiss");
  });
});

describe("CampaignMedia", () => {
  const media = (props) => render(<div style={{ position: "relative", width: 320, height: 180 }}><CampaignMedia {...props} /></div>);
  it("picture", async () => {
    await media({ url: "https://cdn/a.jpg" });
    expect(host.querySelector("img").getAttribute("src")).toBe("https://cdn/a.jpg");
  });
  it("video plays muted inline", async () => {
    await media({ url: "https://cdn/a.mp4", poster_url: "https://cdn/p.jpg" });
    const v = host.querySelector("video");
    expect(v).not.toBeNull();
    expect(v.muted).toBe(true);
    expect(v.getAttribute("poster")).toBe("https://cdn/p.jpg");
  });
  it("YouTube shows its picture inline (no player until full screen)", async () => {
    await media({ url: "https://youtu.be/dQw4w9WgXcQ" });
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelector("img").getAttribute("src")).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  });
  it("YouTube full screen + playing → the privacy-friendly embed", async () => {
    await media({ url: "https://youtu.be/dQw4w9WgXcQ", mode: "fullscreen", playing: true });
    expect(host.querySelector("iframe").getAttribute("src")).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?autoplay=1/);
  });
  it("a picture that fails to load → the fallback, never a broken image", async () => {
    await media({ url: "https://cdn/missing.jpg", fallback: <span>FALLBACK</span> });
    await act(async () => { host.querySelector("img").dispatchEvent(new Event("error")); });
    await flush();
    expect(host.textContent).toContain("FALLBACK");
    expect(host.querySelector("img")).toBeNull();
  });
  it("no media → the fallback", async () => {
    await media({ url: "", fallback: <span>FALLBACK</span> });
    expect(host.textContent).toContain("FALLBACK");
  });
});
