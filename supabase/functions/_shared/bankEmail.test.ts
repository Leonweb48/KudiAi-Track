// deno test --no-lock --node-modules-dir=none supabase/functions/_shared/bankEmail.test.ts
import { appLink, bankEmail, cleanSubject, esc, formatWAT, htmlToText, nairaFromKobo } from "./bankEmail.ts";

function assert(cond: unknown, msg: string) { if (!cond) throw new Error("assertion failed: " + msg); }

Deno.test("formatWAT: the spec's own example (UTC -> WAT, seconds, zone label)", () => {
  assert(formatWAT("2026-09-18T20:14:32Z") === "18 Sep 2026, 09:14:32 PM WAT", formatWAT("2026-09-18T20:14:32Z"));
  assert(formatWAT("2026-12-31T23:30:00Z") === "1 Jan 2027, 12:30:00 AM WAT", "year rollover");
  assert(formatWAT("nope") === "—", "garbage input");
});

Deno.test("nairaFromKobo", () => {
  assert(nairaFromKobo(1500000) === "₦15,000.00", nairaFromKobo(1500000));
  assert(nairaFromKobo(50) === "₦0.50", nairaFromKobo(50));
});

Deno.test("esc + cleanSubject neutralise markup and header injection", () => {
  assert(esc(`<script>alert(1)</script>`) === "&lt;script&gt;alert(1)&lt;/script&gt;", "script tag");
  assert(esc(`"><img src=x onerror=alert(1)>`).indexOf("<") === -1, "img");
  assert(cleanSubject("Payment\r\nBcc: evil@example.com") === "Payment Bcc: evil@example.com", cleanSubject("Payment\r\nBcc: evil@example.com"));
});

Deno.test("a wallet email: stored reference, WAT time, balance, button, security notice — and no raw injected markup", () => {
  const originator = `<script>alert(1)</script> Chidi`;
  const html = bankEmail({
    title: "Payment Received", tone: "success", timestamp: "2026-09-18T20:14:32Z",
    amount: nairaFromKobo(1500000), amountLabel: "Amount Received",
    rows: [
      ["Transaction Reference", esc("KDT-202609-X7K2M9PQ"), { mono: true }],
      ["Payment Method", "Bank transfer"],
      ["From", esc(originator)],
      ["Fee", ""],                                // empty rows are skipped
      ["Balance After", nairaFromKobo(4750000)],
    ],
    button: { label: "View Transaction →", url: appLink({ tab: "wallet" }) },
  });
  assert(html.includes("18 Sep 2026, 09:14:32 PM WAT"), "WAT timestamp with seconds");
  assert(html.includes("KDT-202609-X7K2M9PQ"), "stored reference");
  assert(html.includes("₦15,000.00") && html.includes("₦47,500.00"), "amount and balance after");
  assert(html.includes("View Transaction →"), "button");
  assert(html.includes("Security notice") && html.includes("will never ask for your PIN, password, or OTP"), "security notice");
  assert(html.includes("support@kudiai.app") && html.includes("Amaya &amp; Co. Technologies"), "footer");
  assert(!html.includes("<script"), "no raw <script> from the payer's name");
  assert(html.includes("&lt;script&gt;"), "the payer's name is shown, escaped");
  assert(!html.includes(">Fee<"), "empty row skipped");
  const text = htmlToText(html);
  assert(text.includes("KDT-202609-X7K2M9PQ") && text.includes("Security notice"), "plain-text part");
});
