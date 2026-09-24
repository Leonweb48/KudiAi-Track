// Bank-grade layout for every money email.
//
//   ┌ white header: logo (left) · "Amaya & Co." (right)
//   ├ 4px accent bar (brand green = success, red = failure, amber = attention)
//   │  Title (24px bold)                       timestamp — WAT, with seconds
//   │  ┌ amount box (40px, centred) ┐
//   │  └ label under the amount     ┘
//   │  Reference (monospace, select-all) · method · parties · Balance After …
//   │  [ View Transaction → ]
//   │  🔒 Security notice
//   └ grey footer: support · legal entity · © · automated-message line
//
// CONTRACT: every string passed in must already be HTML-safe. In
// api/email-trigger.js that is automatic for anything taken from the payload `d`
// (escaped at the door); values from anywhere else must go through escapeHtml().
import { formatWAT } from "./wat.js";

export const naira = (n) =>
  "₦" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TONES = {
  success: { bar: "#3DA829", amountBg: "#f0fdf4", amountBorder: "#bbf7d0", amountFg: "#166534" },
  danger:  { bar: "#dc2626", amountBg: "#fef2f2", amountBorder: "#fecaca", amountFg: "#991b1b" },
  warning: { bar: "#d97706", amountBg: "#fffbeb", amountBorder: "#fde68a", amountFg: "#92400e" },
  neutral: { bar: "#0f1c45", amountBg: "#f1f5f9", amountBorder: "#e2e8f0", amountFg: "#0f172a" },
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * @param {object}  o
 * @param {string}  o.title        "Transaction Successful"
 * @param {string=} o.tone         success | danger | warning | neutral
 * @param {*}       o.timestamp    instant (ISO string / Date / ms) — rendered in WAT with seconds
 * @param {string=} o.amount       already formatted, e.g. naira(15000)
 * @param {string=} o.amountLabel  "Amount Received"
 * @param {string=} o.intro        one HTML-safe sentence under the timestamp
 * @param {Array}   o.rows         [label, value] or [label, value, { mono: true }] — value HTML-safe; falsy value => row skipped
 * @param {{label:string,url:string}=} o.button
 * @param {string=} o.note         extra HTML-safe paragraph (e.g. "reason")
 * @param {string=} o.preheader    inbox preview text
 * @param {boolean=} o.security    show the security notice (default true)
 */
export function bankEmail(o) {
  const tone = TONES[o.tone] || TONES.success;
  const year = new Date().getFullYear();

  const rows = (o.rows || []).filter((r) => r && r[1] !== undefined && r[1] !== null && r[1] !== "").map(([label, value, opt]) => {
    const mono = opt && opt.mono;
    const v = mono
      ? `<span style="font-family:'SFMono-Regular',Menlo,Consolas,'Courier New',monospace;font-size:13px;letter-spacing:.3px;-webkit-user-select:all;user-select:all;">${value}</span>`
      : value;
    return `<tr>
      <td style="padding:9px 0;font-size:13px;color:#64748b;vertical-align:top;width:42%;">${label}</td>
      <td style="padding:9px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right;vertical-align:top;word-break:break-word;">${v}</td>
    </tr>`;
  }).join(`<tr><td colspan="2" style="height:1px;background:#eef2f7;line-height:1px;font-size:1px;">&nbsp;</td></tr>`);

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta name="color-scheme" content="light"><title>${o.title}</title></head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:${FONT};">
${o.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${o.preheader}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f7;padding:28px 12px;"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">

  <tr><td style="padding:18px 28px;background:#ffffff;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="left" valign="middle"><img src="https://kudiai.app/logo.png" alt="KudiAI Track" width="34" height="34" style="display:block;border-radius:8px;"></td>
      <td align="right" valign="middle" style="font-size:13px;font-weight:700;color:#0f172a;letter-spacing:.2px;">Amaya &amp; Co.</td>
    </tr></table>
  </td></tr>
  <tr><td style="height:4px;line-height:4px;font-size:4px;background:${tone.bar};">&nbsp;</td></tr>

  <tr><td style="padding:28px 28px 8px;">
    <h1 style="margin:0;font-size:24px;line-height:1.25;font-weight:800;color:#0f172a;">${o.title}</h1>
    <p style="margin:6px 0 0;font-size:13px;color:#64748b;">${formatWAT(o.timestamp)}</p>
    ${o.intro ? `<p style="margin:16px 0 0;font-size:14px;line-height:1.65;color:#334155;">${o.intro}</p>` : ""}
  </td></tr>

  ${o.amount ? `<tr><td style="padding:16px 28px 4px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" style="background:${tone.amountBg};border:1px solid ${tone.amountBorder};border-radius:12px;padding:22px 12px;">
        <div style="font-size:40px;line-height:1.1;font-weight:800;color:${tone.amountFg};letter-spacing:-.5px;">${o.amount}</div>
        ${o.amountLabel ? `<div style="margin-top:6px;font-size:13px;color:#64748b;">${o.amountLabel}</div>` : ""}
      </td></tr></table>
  </td></tr>` : ""}

  ${rows ? `<tr><td style="padding:16px 28px 4px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">${rows}</table>
  </td></tr>` : ""}

  ${o.note ? `<tr><td style="padding:14px 28px 0;font-size:13px;line-height:1.65;color:#334155;">${o.note}</td></tr>` : ""}

  ${o.button ? `<tr><td align="center" style="padding:24px 28px 8px;">
    <a href="${o.button.url}" style="display:inline-block;background:${tone.bar === "#dc2626" ? "#0f1c45" : "#3DA829"};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:13px 34px;border-radius:10px;">${o.button.label}</a>
  </td></tr>` : ""}

  ${o.security === false ? "" : `<tr><td style="padding:20px 28px 26px;">
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;">
      <div style="font-size:12px;font-weight:800;color:#0f172a;margin-bottom:4px;">🔒 Security notice</div>
      <div style="font-size:12px;line-height:1.6;color:#475569;">KudiAI Track will never ask for your PIN, password, or OTP via email. If you didn't make this transaction, contact support immediately at <a href="mailto:support@kudiai.app" style="color:#0f1c45;font-weight:700;text-decoration:none;">support@kudiai.app</a>.</div>
    </div>
  </td></tr>`}

  <tr><td style="background:#f1f5f9;padding:18px 28px;text-align:center;border-top:1px solid #e2e8f0;">
    <div style="font-size:12px;color:#475569;"><a href="mailto:support@kudiai.app" style="color:#475569;text-decoration:none;">support@kudiai.app</a> &nbsp;|&nbsp; <a href="https://kudiai.app" style="color:#475569;text-decoration:none;">kudiai.app</a></div>
    <div style="margin-top:6px;font-size:11px;color:#64748b;">Amaya &amp; Co. Technologies</div>
    <div style="margin-top:2px;font-size:11px;color:#94a3b8;">&copy; ${year} &middot; All rights reserved</div>
    <div style="margin-top:6px;font-size:10px;color:#94a3b8;">This is an automated message</div>
  </td></tr>

</table></td></tr></table>
</body></html>`;
}

/** Deep link into the app for a transaction (consumed by the app's ?kt_dl= handler). */
export function transactionLink(id) {
  const dl = encodeURIComponent(JSON.stringify({ tab: "transactions", id: String(id || "") }));
  return `https://kudiai.app/?kt_dl=${dl}`;
}
