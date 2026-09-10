# KudiAI → Flutterwave payout relay

Flutterwave only accepts **transfers** from a whitelisted IP. Supabase Edge
Functions have no fixed egress IP, so this ~60-line service — running somewhere
with **one static outbound IP** — forwards the payout call from that IP.

It's a dumb authenticated pass-through. No logic, no state, no stored bodies.
Only `POST /direct-transfers` (and transfer retry) are proxied.

---

## 1. Deploy it (pick one)

### Fly.io — static egress IP, ~$3.60/mo  *(recommended — one address to whitelist)*
```
cd flw-relay
fly auth login
fly launch --no-deploy --name kudi-flw-relay --region lhr
fly secrets set RELAY_KEY=$(openssl rand -hex 24) FLW_BASE_URL=https://f4bexperience.flutterwave.com
fly deploy
fly ips allocate-egress --region lhr    # prints the static EGRESS IPv4 — whitelist this
fly ips list
fly secrets list                        # (RELAY_KEY value you set above)
curl https://kudi-flw-relay.fly.dev/health      # -> ok
```
`allocate-egress` is the outbound IP; a normal `allocate-v4` is inbound-only and
won't help. The relay forces IPv4 (`dns.setDefaultResultOrder("ipv4first")`).

### Render.com — Starter plan $7/mo, ~3 fixed outbound IPs
1. Push this repo to GitHub.
2. Render → **New → Web Service** → connect the repo → **Root Directory** `flw-relay` → **Instance Type: Starter**.
3. Env vars: `RELAY_KEY` = a long random string, `FLW_BASE_URL` = `https://f4bexperience.flutterwave.com`.
4. After it's live: service → **Connect** tab → copy the **Outbound IP Addresses** (all of them).
5. `curl https://<your-service>.onrender.com/health` → `ok`.

### A $4–6/mo VPS (Hetzner / DigitalOcean / Vultr) — one IP, you manage the box
```
# on the server:
git clone <repo> && cd <repo>/flw-relay
npm i -g pm2 && RELAY_KEY=<random> FLW_BASE_URL=https://f4bexperience.flutterwave.com pm2 start server.js --name flw-relay
pm2 save && pm2 startup
# put nginx/caddy in front for TLS, or run behind Cloudflare
```
Whitelist the droplet's public IP.

---

## 2. Whitelist the IP(s) in Flutterwave

Dashboard → the IP-whitelist page you found → **Add IP address** → enter each IP
from step 1. (Fly = 1 address. Render = ~3. VPS = 1.)

---

## 3. Point the wallet at the relay

Set two Supabase secrets (Dashboard → Edge Functions → Secrets, or `supabase secrets set`):

```
FLW_RELAY_URL = https://kudi-flw-relay.fly.dev      (your relay's public URL, no trailing slash)
FLW_RELAY_KEY = <the RELAY_KEY you set on the relay>
```

The `flutterwave` edge function auto-detects these and routes **only** the payout
through the relay. Everything else (funding, verification, bank list) stays direct.
If the secrets are unset it calls Flutterwave directly (which is why sandbox worked).

---

## 4. Test

Do a small wallet transfer (₦100) in the app. It should complete instead of
"Please enable IP Whitelisting". Check the relay logs — one line
`relay POST /direct-transfers -> 200`.
