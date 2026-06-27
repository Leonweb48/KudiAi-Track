import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const key = Deno.env.get("OPENAI_API_KEY");
    if (!key) throw new Error("OPENAI_API_KEY secret not set");

    const { audioBase64, mimeType, language } = await req.json();
    if (!audioBase64) throw new Error("audioBase64 is required");

    const mime = mimeType || "audio/webm";
    const ext  = mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "webm";

    // Decode base64 → binary
    const binary    = atob(audioBase64);
    const bytes     = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mime }), `audio.${ext}`);
    form.append("model", "whisper-1");
    form.append("response_format", "text");
    if (language) form.append("language", language);

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method:  "POST",
      headers: { Authorization: `Bearer ${key}` },
      body:    form,
    });

    if (!res.ok) {
      let msg = `Whisper error ${res.status}`;
      try { const e = await res.json(); msg = e.error?.message || msg; } catch { /**/ }
      throw new Error(msg);
    }

    const text = await res.text();
    return new Response(JSON.stringify({ text: text.trim() }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
