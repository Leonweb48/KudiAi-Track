// Flutterwave's customer API is strict, and stricter than what we store. Verified against the live BUSINESS account on
// 2026-09-24 (each of these came back HTTP 400 "Request is not valid"):
//   name.first / name.last  2–50 characters, ONLY letters, spaces, commas, periods, apostrophes and hyphens, and not
//                           made of symbols alone — so "Amaya & Co.", "Store2", "J" and a 51-letter surname all fail
//   phone.number            7–10 digits (the country code goes in its own field) — an 11-digit number fails
//   email                   ^[a-zA-Z0-9_+&*-]+(?:\.[a-zA-Z0-9_+&*-]+)*@(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$
// Business names ("Ada & Sons 2 Ltd") were being sent as the customer name, so wallet activation failed with "Could not
// create wallet profile". These helpers turn whatever is on the profile into something the API accepts — the customer
// name is only a label; the BVN/NIN is what identifies the person.

const NAME_OK = /[A-Za-z]/;

function namePart(s: string): string {
  let t = s.replace(/[^A-Za-z ,.'-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 50).trim();
  if (!NAME_OK.test(t)) return "";
  if (t.length < 2) t += ".";                    // "J" -> "J." (a period is allowed and satisfies the 2-char minimum)
  return t;
}

/** Split a display name into the { first, last } Flutterwave accepts. Falls back when a part would be empty. */
export function customerName(fullName: string, fallbackLast = "Owner"): { first: string; last: string } {
  const flat = String(fullName ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")          // é -> e
    .replace(/&/g, " and ");                                    // "Amaya & Co." -> "Amaya and Co."
  const tokens = flat.replace(/[^A-Za-z ,.'-]/g, " ").split(/\s+/).filter(Boolean);
  return {
    first: namePart(tokens[0] ?? "") || "KudiAI",
    last: namePart(tokens.slice(1).join(" ")) || fallbackLast,
  };
}

/** Nigerian phone -> { country_code, number } with a 7–10 digit number, or null when there is nothing usable. */
export function customerPhone(raw: string): { country_code: string; number: string } | null {
  let d = String(raw ?? "").replace(/\D/g, "").replace(/^234/, "").replace(/^0+/, "");
  if (d.length > 10) d = d.slice(-10);
  return d.length >= 7 ? { country_code: "234", number: d } : null;
}

const EMAIL_OK = /^[a-zA-Z0-9_+&*-]+(?:\.[a-zA-Z0-9_+&*-]+)*@(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/;

/** The email if Flutterwave will take it, otherwise the fallback. */
export function customerEmail(email: string | null | undefined, fallback: string): string {
  const e = String(email ?? "").trim();
  return EMAIL_OK.test(e) ? e : fallback;
}
