import fs from "fs";
import path from "path";
import T from "../i18n/festive";
import { RECEIPT_THEMES, normalizeTheme, liveThemes } from "../utils/receiptThemes";
import { festiveParts } from "../components/shared/FestiveReceipt";

const LANGS = ["en", "pidgin", "ha", "ig", "yo"];
const IDS = Object.keys(RECEIPT_THEMES);

describe("festive receipt themes", () => {
  test("the app's theme ids match the table's CHECK", () => {
    const sql = fs.readFileSync(path.join(__dirname, "../../supabase/migrations/20270435000000_receipt_themes.sql"), "utf8");
    const listed = /CHECK \(id IN \(([^)]+)\)\)/.exec(sql)[1].match(/'(\w+)'/g).map((s) => s.slice(1, -1));
    expect([...listed].sort()).toEqual([...IDS].sort());
  });

  test("every theme has artwork in public/ and its name + greeting in all five languages", () => {
    for (const id of IDS) {
      expect(fs.existsSync(path.join(__dirname, "../../public", RECEIPT_THEMES[id].art))).toBe(true);
      for (const key of [`festive.theme.${id}`, `festive.msg.${id}`]) {
        for (const l of LANGS) expect([key, l, !!T[key]?.[l]?.trim()]).toEqual([key, l, true]);
      }
    }
  });

  test("every festive key has all five languages with the same {placeholders}", () => {
    const vars = (s) => (s.match(/\{\w+\}/g) || []).sort().join(",");
    for (const [key, row] of Object.entries(T)) {
      for (const l of LANGS) expect([key, l, vars(row[l] || "")]).toEqual([key, l, vars(row.en)]);
    }
  });

  test("normalizeTheme drops unknown ids and broken dates; liveThemes respects the window and order", () => {
    expect(normalizeTheme({ id: "halloween" })).toBeNull();
    expect(normalizeTheme({ id: "christmas", starts_at: "not a date" })).toBeNull();
    const now = Date.parse("2026-12-25T10:00:00Z");
    const rows = [
      { id: "new_year", sort: 2, starts_at: "2026-12-31T00:00:00Z" },                                 // not yet
      { id: "christmas", sort: 1, starts_at: "2026-12-24T00:00:00Z", ends_at: "2026-12-27T00:00:00Z" },
      { id: "valentine", sort: 6, ends_at: "2026-02-15T00:00:00Z" },                                  // over
      { id: "nigeria", sort: 5 },                                                                     // no window: on until switched off
    ].map(normalizeTheme);
    expect(liveThemes(rows, now).map((t) => t.id)).toEqual(["christmas", "nigeria"]);
  });
});

describe("festiveParts", () => {
  test("reads sender, recipient and a masked account from a wallet transfer receipt", () => {
    const p = festiveParts({
      hasRef: true, receiptRef: "KDT-202610-7HQ2MXKA",
      fields: [
        { label: "Recipient Details", value: "Amaya & Co. Technologies\nOPay  •  6588176876" },
        { label: "Paid by", value: "Adaeze Fresh Mart\nAdaeze Okafor" },
      ],
    });
    expect(p).toEqual({ senderName: "Adaeze Fresh Mart", recipientName: "Amaya & Co. Technologies",
      recipientLine: "OPay | 658****876", reference: "KDT-202610-7HQ2MXKA" });
  });

  test("a receipt without parties still has a reference", () => {
    expect(festiveParts({ hasRef: false, receiptRef: "PENDING", fields: [{ label: "Transaction No.", value: "FLW123" }] }))
      .toEqual({ senderName: "", recipientName: "", recipientLine: "", reference: "FLW123" });
  });
});
