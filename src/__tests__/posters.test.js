import fs from "fs";
import path from "path";
import T from "../i18n/posters";
import { normalizePosterCode, parsePosterPath } from "../utils/posterJoin";
import { cleanBankName } from "../utils/bankLogos";

const LANGS = ["en", "pidgin", "ha", "ig", "yo"];

describe("business poster text", () => {
  test("every key has all five languages", () => {
    for (const [key, row] of Object.entries(T)) {
      for (const l of LANGS) expect([key, l, typeof row[l] === "string" && row[l].trim().length > 0]).toEqual([key, l, true]);
    }
  });

  test("every posters.* key the code uses exists", () => {
    const files = ["components/PosterStudio.jsx", "screens/BusinessPosterPage.jsx", "utils/posterRender.js",
      "screens/Home.jsx", "screens/Finance.jsx", "components/WalletPanel.jsx"];
    for (const f of files) {
      const src = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
      for (const m of src.matchAll(/"(posters\.[\w.]+)"/g)) {
        // the ajo tiles build their subtitle keys as `${key}Sub`
        expect([f, m[1], m[1] in T]).toEqual([f, m[1], true]);
        if (/^posters\.p\.ajo(Daily|Esusu|Card)$/.test(m[1])) expect(`${m[1]}Sub` in T).toBe(true);
      }
    }
  });

  test("{var} placeholders match English in every language", () => {
    const vars = (s) => (s.match(/\{\w+\}/g) || []).sort().join(",");
    for (const [key, row] of Object.entries(T)) {
      for (const l of LANGS) expect([key, l, vars(row[l])]).toEqual([key, l, vars(row.en)]);
    }
  });
});

describe("poster codes and links", () => {
  test("normalizePosterCode keeps only the server's alphabet, 8 characters", () => {
    expect(normalizePosterCode("k7rm-2qxa")).toBe("K7RM2QXA");
    expect(normalizePosterCode("K7RM2QX")).toBe("");      // too short
    expect(normalizePosterCode("K7RM2QXO")).toBe("");     // O is never issued
    expect(normalizePosterCode("K7RM2QX1")).toBe("");     // nor 1
    expect(normalizePosterCode(null)).toBe("");
  });

  test("parsePosterPath reads /pay/<code> and /join/<code> only", () => {
    expect(parsePosterPath("/pay/K7RM2QXA")).toEqual({ kind: "pay", code: "K7RM2QXA" });
    expect(parsePosterPath("/join/k7rm2qxa/")).toEqual({ kind: "join", code: "K7RM2QXA" });
    expect(parsePosterPath("/join/BAD")).toBeNull();
    expect(parsePosterPath("/wallet")).toBeNull();
    expect(parsePosterPath("/pay/K7RM2QXA/extra")).toBeNull();
  });

  test("cleanBankName still drops Flutterwave's 'formerly' aside after the move", () => {
    expect(cleanBankName("Flutterwave MFB (Formerly OK MFB)")).toBe("Flutterwave MFB");
    expect(cleanBankName("")).toBe("Flutterwave MFB");
  });
});
