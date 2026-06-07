export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, error: "No token provided" });

  const secret = process.env.RECAPTCHA_V2_SECRET_KEY || process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) return res.status(500).json({ success: false, error: "Server misconfigured" });

  try {
    const response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `secret=${secret}&response=${token}`,
    });
    const data = await response.json();

    // v2 has no score; v3 has a score (0.0–1.0). Only check score for v3.
    const scoreOk = data.score === undefined || data.score >= 0.5;

    if (data.success && scoreOk) {
      return res.json({ success: true });
    }

    return res.status(400).json({ success: false, error: "Bot activity detected" });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Verification failed" });
  }
}
