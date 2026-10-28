import fs from "fs";
import path from "path";
import T from "../i18n/update";
import { normalizePolicy, updateVerdict, snoozed, snooze, SNOOZE_MS } from "../utils/appUpdate";

const LANGS = ["en", "pidgin", "ha", "ig", "yo"];

const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

describe("app update gate", () => {
  const policy = normalizePolicy({ min_build: 192, latest_build: 195, message: "  Please update  " });

  test("blocks below the minimum, offers below the latest, leaves the rest alone", () => {
    expect(policy).toEqual({ min: 192, latest: 195, message: "Please update" });
    expect(updateVerdict(190, policy)).toBe("required");
    expect(updateVerdict("191", policy)).toBe("required");     // Capacitor gives the build as a string
    expect(updateVerdict(192, policy)).toBe("available");
    expect(updateVerdict(195, policy)).toBe("ok");
    expect(updateVerdict(200, policy)).toBe("ok");
  });

  test("never blocks when the build or the policy is unknown, or the limits are off (0)", () => {
    expect(updateVerdict(0, policy)).toBe("ok");
    expect(updateVerdict("", policy)).toBe("ok");
    expect(updateVerdict(150, null)).toBe("ok");
    expect(updateVerdict(150, normalizePolicy({ min_build: 0, latest_build: 0 }))).toBe("ok");
    expect(normalizePolicy(null)).toBeNull();
    expect(normalizePolicy({ min_build: "x", latest_build: -3 })).toEqual({ min: 0, latest: 0, message: "" });
  });

  test("'Later' hides the bar for 3 days, and a newer build shows it again", () => {
    const store = memStore();
    const now = Date.parse("2026-10-28T10:00:00Z");
    expect(snoozed(195, now, store)).toBe(false);
    snooze(195, now, store);
    expect(snoozed(195, now + SNOOZE_MS - 1, store)).toBe(true);
    expect(snoozed(195, now + SNOOZE_MS + 1, store)).toBe(false);
    expect(snoozed(196, now + 1000, store)).toBe(false);
  });

  test("every update text has all five languages with the same {placeholders}", () => {
    const vars = (s) => (s.match(/\{\w+\}/g) || []).sort().join(",");
    for (const [key, row] of Object.entries(T)) {
      for (const l of LANGS) {
        expect([key, l, !!row[l]?.trim()]).toEqual([key, l, true]);
        expect([key, l, vars(row[l])]).toEqual([key, l, vars(row.en)]);
      }
    }
  });

  test("the table the gate reads exists with public read", () => {
    const sql = fs.readFileSync(path.join(__dirname, "../../supabase/migrations/20270437000000_app_update_policy.sql"), "utf8");
    expect(sql).toMatch(/GRANT SELECT \(id, min_build, latest_build, message, updated_at\) ON public\.app_update_policy TO anon, authenticated/);
  });
});
