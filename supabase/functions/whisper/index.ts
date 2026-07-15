import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function errJson(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // ── Authenticate caller (business owner or active staff only) ───────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return errJson("Unauthorised", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: { user }, error: authErr } = await sb.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authErr || !user) return errJson("Unauthorised", 401);

    // Business owners have a profiles row with full_name set during registration.
    // Active staff have a row in the staff table.
    const [{ data: ownerRow }, { data: staffRow }] = await Promise.all([
      sb.from("profiles").select("id").eq("id", user.id).not("full_name", "is", null).maybeSingle(),
      sb.from("staff").select("id").eq("user_id", user.id).eq("status", "active").maybeSingle(),
    ]);
    if (!ownerRow && !staffRow) return errJson("Forbidden", 403);

    // ── Transcribe ──────────────────────────────────────────────────────────
    const key = Deno.env.get("OPENAI_API_KEY");
    if (!key) throw new Error("OPENAI_API_KEY secret not set");

    const { audioBase64, mimeType, language } = await req.json();
    if (!audioBase64) throw new Error("audioBase64 is required");

    const mime = mimeType || "audio/webm";
    const ext  = mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "webm";

    const binary = atob(audioBase64);
    const bytes  = new Uint8Array(binary.length);
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
