import React, { act } from "react";
import fs from "fs";
import path from "path";
import { createRoot } from "react-dom/client";
import { normalizeCap, activeCap, msUntilNextChange, loadCaps, cachedCaps, _resetHolidayCapCache } from "../utils/holidayCaps";
import { HOLIDAY_CAP_PRESETS, HOLIDAY_CAP_IDS, badgePlacement } from "../utils/holidayCapPresets";
import AppLogo from "../components/AppLogo";

let mockResult;           // what the "server" answers
let mockCalls = 0;
jest.mock("../utils/supabase", () => {
  const chain = {
    select: () => chain, gt: () => chain, order: () => chain,
    limit: () => { mockCalls++; return Promise.resolve(typeof mockResult === "function" ? mockResult() : mockResult); },
  };
  return { supabase: { from: () => chain } };
});

const H = 3600 * 1000;
const T0 = Date.parse("2026-10-01T00:00:00+01:00");   // 1 Oct, midnight in Lagos
const row = (o = {}) => ({ id: "c1", title: "Independence Day", preset: "nigeria", starts_at: new Date(T0).toISOString(), ends_at: new Date(T0 + 24 * H).toISOString(), portals: ["owner", "public"], ...o });

beforeEach(() => { _resetHolidayCapCache(); localStorage.clear(); mockCalls = 0; mockResult = { data: [], error: null }; });

describe("normalizeCap — only rows the app can draw", () => {
  it("a good row becomes { id, title, preset, start, end, portals }", () => {
    expect(normalizeCap(row())).toEqual({ id: "c1", title: "Independence Day", preset: "nigeria", start: T0, end: T0 + 24 * H, portals: ["owner", "public"] });
  });
  it("unknown drawing, broken or backwards dates, or no known portal → dropped", () => {
    expect(normalizeCap(row({ preset: "fireworks" }))).toBeNull();
    expect(normalizeCap(row({ starts_at: "not a date" }))).toBeNull();
    expect(normalizeCap(row({ ends_at: new Date(T0).toISOString() }))).toBeNull();
    expect(normalizeCap(row({ portals: ["marketer"] }))).toBeNull();
    expect(normalizeCap(row({ portals: "owner" }))).toBeNull();
    expect(normalizeCap(null)).toBeNull();
  });
  it("unknown portal names are ignored, known ones kept", () => {
    expect(normalizeCap(row({ portals: ["owner", "hacker"] })).portals).toEqual(["owner"]);
  });
});

describe("activeCap — which cap a portal shows right now", () => {
  const caps = [normalizeCap(row())];
  it("live on its portals from the start time (inclusive) to the end time (exclusive)", () => {
    expect(activeCap(caps, "owner", T0)?.id).toBe("c1");
    expect(activeCap(caps, "public", T0 + 23 * H)?.id).toBe("c1");
    expect(activeCap(caps, "owner", T0 - 1)).toBeNull();
    expect(activeCap(caps, "owner", T0 + 24 * H)).toBeNull();
  });
  it("never on a portal the admin didn't pick", () => {
    expect(activeCap(caps, "staff", T0 + H)).toBeNull();
    expect(activeCap(caps, undefined, T0 + H)).toBeNull();
  });
  it("two overlapping caps → the one that started last", () => {
    const both = [normalizeCap(row()), normalizeCap(row({ id: "c2", preset: "celebration", starts_at: new Date(T0 + 2 * H).toISOString() }))];
    expect(activeCap(both, "owner", T0 + H)?.id).toBe("c1");
    expect(activeCap(both, "owner", T0 + 3 * H)?.id).toBe("c2");
  });
});

describe("msUntilNextChange — when the logo must change next", () => {
  const caps = [normalizeCap(row())];
  it("before the start → time to the start; during → time to the end; after → nothing", () => {
    expect(msUntilNextChange(caps, "owner", T0 - 5000)).toBe(5000);
    expect(msUntilNextChange(caps, "owner", T0 + 20 * H)).toBe(4 * H);
    expect(msUntilNextChange(caps, "owner", T0 + 25 * H)).toBeNull();
  });
  it("other portals' caps don't wake this logo; very far changes are capped to a safe timer", () => {
    expect(msUntilNextChange(caps, "staff", T0 - 5000)).toBeNull();
    const far = [normalizeCap(row({ starts_at: new Date(T0 + 60 * 24 * H).toISOString(), ends_at: new Date(T0 + 61 * 24 * H).toISOString() }))];
    expect(msUntilNextChange(far, "owner", T0)).toBe(2 ** 31 - 1);
  });
});

describe("loadCaps — the schedule from the server, with a copy kept on the phone", () => {
  it("fetches, keeps a copy, and doesn't ask again for 5 minutes", async () => {
    mockResult = { data: [row()], error: null };
    expect((await loadCaps()).map((c) => c.id)).toEqual(["c1"]);
    expect(cachedCaps().map((c) => c.id)).toEqual(["c1"]);
    await loadCaps();
    expect(mockCalls).toBe(1);
  });
  it("logos loading at the same moment share one request", async () => {
    mockResult = { data: [row()], error: null };
    await Promise.all([loadCaps(), loadCaps(), loadCaps()]);
    expect(mockCalls).toBe(1);
  });
  it("offline / server error → the saved copy", async () => {
    mockResult = { data: [row()], error: null };
    await loadCaps();
    _resetHolidayCapCache();
    mockResult = { data: null, error: { message: "offline" } };
    expect((await loadCaps()).map((c) => c.id)).toEqual(["c1"]);
  });
  it("rows the app can't draw are dropped", async () => {
    mockResult = { data: [row(), row({ id: "bad", preset: "nope" })], error: null };
    expect((await loadCaps()).map((c) => c.id)).toEqual(["c1"]);
  });
});

describe("the animations", () => {
  it("every preset is a self-hosted Lottie animation (Noto Emoji Animation) that the table's CHECK allows", () => {
    expect(HOLIDAY_CAP_IDS.slice(0, 8)).toEqual(["nigeria", "christmas", "new_year", "eid", "easter", "workers", "valentine", "celebration"]);
    // the newest CHECK on holiday_caps.preset (migration 20270438 replaced the original list)
    const sql = fs.readFileSync(path.join(__dirname, "../../supabase/migrations/20270438000000_holiday_caps_more_presets.sql"), "utf8");
    const allowed = /CHECK \(preset IN \(([^)]+)\)\)/.exec(sql)[1].match(/'(\w+)'/g).map((x) => x.slice(1, -1));
    expect([...allowed].sort()).toEqual([...HOLIDAY_CAP_IDS].sort());
    for (const [id, p] of Object.entries(HOLIDAY_CAP_PRESETS)) {
      expect(id).toMatch(/^[a-z_]+$/);
      expect(p.label).toBeTruthy();
      expect(p.anim).toBe(`/holiday-caps/${id}.json`);
      const j = JSON.parse(fs.readFileSync(path.join(__dirname, "../../public", p.anim), "utf8"));
      expect(Array.isArray(j.layers) && j.layers.length > 0 && j.op > j.ip && j.fr > 0).toBe(true);
      expect((j.assets || []).some((a) => a.p)).toBe(false);   // no external image files to fetch
      if (p.still != null) expect(p.still >= 0 && p.still < 1).toBe(true);
    }
    expect(fs.existsSync(path.join(__dirname, "../../public/holiday-caps/CREDITS.txt"))).toBe(true);
  });

  it("the badge sits over the logo's top-right corner and scales with the logo", () => {
    expect(badgePlacement(32)).toEqual({ width: 20, height: 20, left: 21, top: -9 });
    expect(badgePlacement(48)).toEqual({ width: 30, height: 30, left: 32, top: -13 });
  });
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// this Jest (27) takes the time via setSystemTime, not useFakeTimers({ now })
const fakeClock = (t) => { jest.useFakeTimers("modern"); jest.setSystemTime(t); };
describe("AppLogo — the cap on the real logo", () => {
  let host, root;
  beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); jest.useRealTimers(); });
  const cap = () => host.querySelector('[data-testid="holiday-cap"]');

  it("shows the live cap on its portal, and none without a portal or on another portal", async () => {
    fakeClock(T0 + H);
    mockResult = { data: [row()], error: null };
    await act(async () => { root.render(<><AppLogo portal="owner" /><AppLogo /><AppLogo portal="staff" /></>); });
    await act(async () => { await Promise.resolve(); });
    const caps = host.querySelectorAll('[data-testid="holiday-cap"]');
    expect(caps.length).toBe(1);
    expect(caps[0].dataset.preset).toBe("nigeria");
    expect(caps[0].getAttribute("aria-hidden")).toBe("true");
    expect([caps[0].style.width, caps[0].style.left, caps[0].style.top]).toEqual(["20px", "21px", "-9px"]);   // the animation itself loads afterwards
  });

  it("appears exactly at the start time and goes away exactly at the end time", async () => {
    fakeClock(T0 - 10_000);
    mockResult = { data: [row()], error: null };
    await act(async () => { root.render(<AppLogo portal="public" />); });
    await act(async () => { await Promise.resolve(); });
    expect(cap()).toBeNull();
    await act(async () => { jest.advanceTimersByTime(10_500); });
    expect(cap()?.dataset.preset).toBe("nigeria");
    await act(async () => { jest.advanceTimersByTime(24 * H); });
    expect(cap()).toBeNull();
  });

  it("shows straight away from the copy saved on the phone, before the server answers", async () => {
    fakeClock(T0 + H);
    localStorage.setItem("kt_holiday_caps", JSON.stringify([row({ preset: "christmas" })]));
    mockResult = () => new Promise(() => {});   // server never answers
    await act(async () => { root.render(<AppLogo portal="owner" />); });
    expect(cap()?.dataset.preset).toBe("christmas");
  });
});
