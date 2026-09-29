import {
  IOS_INSTALL_KEY, REMIND_EVERY_MS, installPromptDue, iosInstallTarget, markInstallChoice, markInstallShown, readInstallState,
} from "./iosInstall";

const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.46 Mobile/15E148 Safari/604.1",
  iphoneInstagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 346.0.0.29.87",
  iphoneFacebook: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0]",
  ipadOld: "Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1",
  ipadAsMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
};
const nav = (ua, extra = {}) => ({ userAgent: ua, maxTouchPoints: 5, ...extra });
const win = (standalone = false) => ({ matchMedia: (q) => ({ matches: standalone && q === "(display-mode: standalone)" }) });

function memoryStorage(initial) {
  const m = new Map(initial ? [[IOS_INSTALL_KEY, initial]] : []);
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), raw: () => m.get(IOS_INSTALL_KEY) };
}

describe("iosInstallTarget", () => {
  test("iPhone Safari that hasn't installed the app", () => {
    expect(iosInstallTarget(nav(UA.iphoneSafari), win())).toEqual({ device: "iphone", browser: "safari" });
  });
  test("iPhone Chrome, and in-app browsers that can't install (Instagram, Facebook)", () => {
    expect(iosInstallTarget(nav(UA.iphoneChrome), win())).toEqual({ device: "iphone", browser: "chrome" });
    expect(iosInstallTarget(nav(UA.iphoneInstagram), win()).browser).toBe("inapp");
    expect(iosInstallTarget(nav(UA.iphoneFacebook), win()).browser).toBe("inapp");
  });
  test("iPads — including iPadOS reporting itself as a Mac with a touch screen", () => {
    expect(iosInstallTarget(nav(UA.ipadOld), win())).toEqual({ device: "ipad", browser: "safari" });
    expect(iosInstallTarget(nav(UA.ipadAsMac, { maxTouchPoints: 5 }), win())).toEqual({ device: "ipad", browser: "safari" });
  });
  test("never: a real Mac, Android, or the app already opened from the Home Screen", () => {
    expect(iosInstallTarget(nav(UA.ipadAsMac, { maxTouchPoints: 0 }), win())).toBeNull();
    expect(iosInstallTarget(nav(UA.android), win())).toBeNull();
    expect(iosInstallTarget(nav(UA.iphoneSafari, { standalone: true }), win())).toBeNull();
    expect(iosInstallTarget(nav(UA.iphoneSafari), win(true))).toBeNull();
    expect(iosInstallTarget(null, win())).toBeNull();
  });
  test("a browser without matchMedia still works", () => {
    expect(iosInstallTarget(nav(UA.iphoneSafari), {})).toEqual({ device: "iphone", browser: "safari" });
  });
});

describe("schedule: once, then every 2 days until installed", () => {
  const now = Date.UTC(2026, 8, 29, 10);
  test("never shown on this device → the first prompt", () => {
    expect(installPromptDue(null, now)).toBe("first");
  });
  test("shown less than 2 days ago → not again yet", () => {
    expect(installPromptDue({ last: now - REMIND_EVERY_MS + 60_000 }, now)).toBeNull();
    expect(installPromptDue({ last: now }, now)).toBeNull();
  });
  test("2 days or more since it was shown → a reminder", () => {
    expect(installPromptDue({ last: now - REMIND_EVERY_MS }, now)).toBe("reminder");
    expect(installPromptDue({ last: now - 9 * REMIND_EVERY_MS }, now)).toBe("reminder");
  });
  test("a stored time in the future (clock changed) doesn't silence it forever", () => {
    expect(installPromptDue({ last: now + 5 * REMIND_EVERY_MS }, now)).toBe("reminder");
  });
});

describe("remembering what happened", () => {
  const t0 = Date.UTC(2026, 8, 29, 10);
  test("shown, then 'Not now' → comes back 2 days after it was shown", () => {
    const st = memoryStorage();
    let s = markInstallShown(st, t0, readInstallState(st));
    s = markInstallChoice(st, "rejected", s, t0 + 5000);
    const back = readInstallState(st);
    expect(back).toMatchObject({ first: t0, last: t0, shown: 1, choice: "rejected" });
    expect(installPromptDue(back, t0 + REMIND_EVERY_MS - 1)).toBeNull();
    expect(installPromptDue(back, t0 + REMIND_EVERY_MS)).toBe("reminder");
    // the reminder is shown: the count grows, the first time is kept, the clock restarts
    const s2 = markInstallShown(st, t0 + REMIND_EVERY_MS, readInstallState(st));
    expect(s2).toMatchObject({ first: t0, last: t0 + REMIND_EVERY_MS, shown: 2, choice: "rejected" });
  });
  test("'Install' is remembered, but it still reminds if the app isn't on the Home Screen 2 days later", () => {
    const st = memoryStorage();
    const s = markInstallChoice(st, "accepted", markInstallShown(st, t0, null), t0 + 1000);
    expect(s.choice).toBe("accepted");
    expect(installPromptDue(readInstallState(st), t0 + REMIND_EVERY_MS)).toBe("reminder");
  });
  test("unreadable or missing storage never crashes — it just counts as never shown", () => {
    expect(readInstallState(memoryStorage("{nope"))).toBeNull();
    expect(readInstallState(memoryStorage(JSON.stringify({ last: "x" })))).toBeNull();
    expect(readInstallState(null)).toBeNull();
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readInstallState(broken)).toBeNull();
    expect(() => markInstallShown(broken, t0, null)).not.toThrow();
    expect(() => markInstallChoice(broken, "rejected", null, t0)).not.toThrow();
  });
});
