import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { email, full_name } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });

  const firstName = full_name?.split(" ")[0] || "there";

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f0fdf4;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;padding:40px 16px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.10);max-width:520px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#14532d 0%,#16a34a 60%,#4ade80 100%);padding:48px 40px 36px;text-align:center;">
            <img src="https://kudiai.app/logo.png" alt="KudiAI Track" width="88"
              style="display:block;margin:0 auto 18px;border-radius:18px;box-shadow:0 4px 20px rgba(0,0,0,0.25);" />
            <h1 style="margin:0 0 6px;color:#ffffff;font-size:30px;font-weight:900;letter-spacing:-0.5px;">KudiAI Track</h1>
            <p style="margin:0;color:#bbf7d0;font-size:13px;letter-spacing:1px;text-transform:uppercase;">Smart Finance for Nigerian Traders</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 0;">
            <h2 style="margin:0 0 12px;color:#14532d;font-size:24px;font-weight:800;">Welcome, ${firstName}! 👋</h2>
            <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.7;">
              You've successfully joined KudiAI Track using Google. We're so excited to have you!
              KudiAI Track is your all-in-one business finance companion — built specifically for Nigerian traders and entrepreneurs like you.
            </p>

            <!-- Features -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr><td style="padding:4px;">
                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 14px;">
                  <span style="font-size:20px;">💬</span>
                  <span style="font-size:13px;color:#15803d;font-weight:600;margin-left:8px;">Voice-record transactions in Yoruba, Igbo &amp; Hausa</span>
                </div>
              </td></tr>
              <tr><td style="padding:4px;">
                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 14px;">
                  <span style="font-size:20px;">📊</span>
                  <span style="font-size:13px;color:#15803d;font-weight:600;margin-left:8px;">AI-powered profit &amp; sales insights</span>
                </div>
              </td></tr>
              <tr><td style="padding:4px;">
                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 14px;">
                  <span style="font-size:20px;">🤝</span>
                  <span style="font-size:13px;color:#15803d;font-weight:600;margin-left:8px;">Track credits, debts &amp; Aso savings</span>
                </div>
              </td></tr>
              <tr><td style="padding:4px;">
                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 14px;">
                  <span style="font-size:20px;">📄</span>
                  <span style="font-size:13px;color:#15803d;font-weight:600;margin-left:8px;">Export receipts &amp; statements as PDF</span>
                </div>
              </td></tr>
            </table>

            <!-- CTA -->
            <div style="text-align:center;margin-bottom:32px;">
              <a href="https://kudiai.app"
                style="display:inline-block;background:linear-gradient(135deg,#16a34a,#059669);color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:10px;">
                Open KudiAI Track →
              </a>
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:0 40px 28px;">
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 20px;" />
            <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;line-height:1.6;">
              You received this because you signed up for KudiAI Track with Google.<br/>
              &copy; 2026 KudiAI Track &nbsp;·&nbsp; Amaya Technologies &nbsp;·&nbsp; Nigeria
            </p>
          </td>
        </tr>

      </table>
      <p style="color:#6b7280;font-size:12px;margin-top:20px;text-align:center;">
        <em>Talk your money. Track your profit. Grow your business.</em>
      </p>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from: `"KudiAI Track" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: `Welcome to KudiAI Track, ${firstName}! 🎉`,
      html,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
