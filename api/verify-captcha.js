export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { token } = req.body || {};
  if (!token || typeof token !== "string" || token.length > 4096) return res.status(400).json({ success: false, error: "No token provided" });

  // Must use the v2 secret key — v3 secret will always reject v2 tokens
  const secret = process.env.RECAPTCHA_V2_SECRET_KEY;
  if (!secret) {
    // Key not configured in Vercel env vars — fail open so users aren't blocked
    console.warn("RECAPTCHA_V2_SECRET_KEY not set");
    return res.json({ success: true });
  }

  try {
    const response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      // URL-encoded: a crafted token must not be able to add or override form fields (e.g. secret=, remoteip=)
      body: new URLSearchParams({ secret, response: token }).toString(),
    });
    const data = await response.json();

    if (data.success) {
      return res.json({ success: true });
    }

    return res.status(400).json({ success: false, error: "Bot activity detected", codes: data["error-codes"] });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Verification failed" });
  }
}
