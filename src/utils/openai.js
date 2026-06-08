/**
 * OpenAI Whisper speech-to-text.
 * Requires REACT_APP_OPENAI_API_KEY in .env
 */
export async function whisperTranscribe(audioBlob, languageCode) {
  const key = process.env.REACT_APP_OPENAI_API_KEY;
  if (!key) throw new Error("Missing REACT_APP_OPENAI_API_KEY in .env");

  // Determine file extension from mime type
  const mime = audioBlob.type || "audio/webm";
  const ext  = mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "webm";

  const form = new FormData();
  form.append("file", audioBlob, `audio.${ext}`);
  form.append("model", "whisper-1");
  if (languageCode) form.append("language", languageCode);
  form.append("response_format", "text");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });

  if (!res.ok) {
    let msg = `Whisper error ${res.status}`;
    try { const e = await res.json(); msg = e.error?.message || msg; } catch {}
    throw new Error(msg);
  }

  const text = await res.text();
  return text.trim();
}
