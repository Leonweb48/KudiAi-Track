import React, { act } from "react";
import { createRoot } from "react-dom/client";
import IosInstallPrompt from "../components/IosInstallPrompt";
import { IOS_INSTALL_KEY, REMIND_EVERY_MS } from "../utils/iosInstall";

let mockNative = false;
let mockPath = "/";
// (react-router-dom v7 is ESM-only; the other screen tests mock it the same way)
jest.mock("react-router-dom", () => ({ useLocation: () => ({ pathname: mockPath }) }), { virtual: true });
jest.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => mockNative } }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  instagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 346.0.0.29.87",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
};
const T0 = Date.UTC(2026, 8, 29, 9);
let host, root;

function device(ua, { standalone = false, touch = 5 } = {}) {
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
  Object.defineProperty(window.navigator, "maxTouchPoints", { value: touch, configurable: true });
  Object.defineProperty(window.navigator, "standalone", { value: standalone, configurable: true });
}
async function open(path = "/") {
  mockPath = path;
  await act(async () => { root.render(<IosInstallPrompt />); });
}
async function remount(path) {
  await act(async () => root.unmount());
  root = createRoot(host);
  await open(path);
}
const wait = async (ms) => { await act(async () => { jest.advanceTimersByTime(ms); }); };
const prompt = () => host.querySelector('[data-testid="ios-install-prompt"]');
const text = () => prompt()?.textContent ?? "";
const button = (label) => [...host.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); };
const stored = () => JSON.parse(localStorage.getItem(IOS_INSTALL_KEY) || "null");

beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(T0);
  localStorage.clear(); mockNative = false;
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  device(UA.iphone);
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  try { await act(async () => root.unmount()); } catch { /* already unmounted */ }
  host.remove(); jest.useRealTimers();
});

describe("IosInstallPrompt", () => {
  it("iPhone: invites the person a few seconds after the app opens — not instantly", async () => {
    await open();
    expect(prompt()).toBeNull();
    await wait(4000);
    expect(text()).toContain("Install KudiAI Track on your iPhone");
    expect(button("Install")).toBeTruthy();
    expect(button("Not now")).toBeTruthy();
    expect(stored()).toMatchObject({ first: T0 + 4000, last: T0 + 4000, shown: 1 });
  });

  it("'Not now' closes it and it stays away until 2 days later, then comes back as a reminder", async () => {
    await open(); await wait(4000);
    await click(button("Not now"));
    expect(prompt()).toBeNull();
    expect(stored().choice).toBe("rejected");

    // reopened the same day, and the next day: nothing
    await remount(); await wait(5000);
    expect(prompt()).toBeNull();
    jest.setSystemTime(T0 + REMIND_EVERY_MS / 2);
    await remount(); await wait(5000);
    expect(prompt()).toBeNull();

    // two days after it was shown: the reminder
    jest.setSystemTime(T0 + 4000 + REMIND_EVERY_MS);
    await remount(); await wait(4000);
    expect(text()).toContain("KudiAI Track isn't on your Home Screen yet");
    expect(stored().shown).toBe(2);
  });

  it("'Install' shows the steps with Safari's Share button at the bottom, and Done closes it", async () => {
    await open(); await wait(4000);
    await click(button("Install"));
    expect(stored().choice).toBe("accepted");
    expect(text()).toContain("Add to Home Screen");
    expect(text()).toContain("Tap the Share button at the bottom of the screen.");
    expect(text()).toContain("Scroll down and tap “Add to Home Screen”.");
    expect(text()).toContain("Tap “Add” at the top right.");
    expect(host.querySelectorAll("ol li").length).toBe(3);
    await click(button("Done"));
    expect(prompt()).toBeNull();
  });

  it("iPad (which reports itself as a Mac with a touch screen): Share is at the top", async () => {
    device(UA.ipad, { touch: 5 });
    await open(); await wait(4000);
    expect(text()).toContain("Install KudiAI Track on your iPad");
    await click(button("Install"));
    expect(text()).toContain("Tap the Share button at the top of the screen.");
  });

  it("inside Instagram's browser (can't install): asks them to open the page in Safari first", async () => {
    device(UA.instagram);
    await open(); await wait(4000);
    expect(text()).toContain("Open this page in Safari first");
    expect(button("Install")).toBeUndefined();
    await click(button("Close"));
    expect(prompt()).toBeNull();
    expect(stored().choice).toBe("rejected");
  });

  it("tapping outside the sheet counts as 'Not now'", async () => {
    await open(); await wait(4000);
    await click(host.querySelector('button[aria-label="Close"]'));
    expect(prompt()).toBeNull();
    expect(stored().choice).toBe("rejected");
  });

  it("never: Android, a real Mac, the app opened from the Home Screen, the native app, or a public page", async () => {
    const cases = [
      () => device(UA.android),
      () => device(UA.ipad, { touch: 0 }),
      () => device(UA.iphone, { standalone: true }),
      () => { mockNative = true; },
    ];
    for (const setup of cases) {
      localStorage.clear(); device(UA.iphone); mockNative = false; setup();
      await remount(); await wait(10_000);
      expect(prompt()).toBeNull();
    }
    mockNative = false; device(UA.iphone);
    for (const path of ["/verify", "/privacy", "/terms", "/delete-account", "/payment-return"]) {
      localStorage.clear();
      await remount(path); await wait(10_000);
      expect(prompt()).toBeNull();
    }
  });

  it("a page left in the background isn't interrupted — it waits until the app is on screen", async () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await open(); await wait(10_000);
    expect(prompt()).toBeNull();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await wait(4000);
    expect(text()).toContain("Install KudiAI Track on your iPhone");
  });
});
