# Bill payment regression tests

These suites start the **real** bill server (`supabase/functions/clubkonnect/index.ts`, under Deno) and the **real**
fixed-IP relay (`flw-relay/server.js`) against fake ClubKonnect, VTpass and Supabase servers on local ports. They check
behaviour customers depend on; what each protects is in [docs/BILL-PAYMENTS.md](../../docs/BILL-PAYMENTS.md).

```
node tests/bills/run-all.mjs      # every suite, one after another (about 4 minutes)
node tests/bills/electricity.e2e.mjs
```

**Needs:** Node 22+ and Deno 2 on PATH. No secrets and no real providers are involved.

**Ports used:** 8000 (the function), 8793–8795, 18800–18802. Stop any local dev servers on them first.

**In CI:** `.github/workflows/bills-tests.yml` runs them, and the bill server deploy waits for it to pass.
