export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const secret = req.headers["x-trigger-secret"];
  if (!secret || secret !== process.env.REACT_APP_EMAIL_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: "text required" });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "TTS not configured" });

  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        model:           "tts-1",
        voice:           "nova",
        input:           String(text).slice(0, 4096),
        response_format: "mp3",
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({ error: `OpenAI error: ${err}` });
    }

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    return res.json({ audio_base64: base64, mime_type: "audio/mp3" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
