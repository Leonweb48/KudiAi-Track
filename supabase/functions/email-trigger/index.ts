// email-trigger — RETIRED (2026-09-25).
//
// This function forwarded any `event` + `data` from ANY logged-in user to the admin email pipeline using the trusted
// server secret, so a free account could send arbitrary emails from the company domain to arbitrary recipients.
// Nothing in the app or the admin portal calls it (the app uses the Vercel route /api/email-trigger, which escapes and
// is being tightened separately). It is kept as a stub only because the deploy workflow deploys it by name and this
// project has no way to un-deploy it from CI; it answers 410 Gone to everyone and never touches the secret.

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  return new Response(JSON.stringify({ error: "This endpoint has been retired." }), {
    status: 410,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
