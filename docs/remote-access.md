# Using OficinaOS outside the shop (remote access)

Step-by-step guide to enable internet access — for the team to use
their phones outside the shop and for the **customer links** (tracking,
quotes, warranty) to work anywhere.

It's **free**, takes about **15 minutes** and only needs doing **once**.

## What you'll need

| Thing | What it is | Cost |
|---|---|---|
| **Cloudflare account** | The service that securely connects the internet to the shop PC | Free |
| **A domain** | The shop's "name" on the internet, e.g. `minhaloja.pt` — buy at Cloudflare, Porkbun, Namecheap… | ~€10/year |
| **OficinaOS installed** | The app already running on the shop PC with Docker | — |

> **How it works (in plain language):** the shop PC connects to
> Cloudflare and stays "listening". When someone opens the shop's address
> on the internet, Cloudflare passes the request through that channel to
> the PC. **You don't need to open router ports** or a fixed IP — it works
> even with Portuguese carriers' mobile internet (CGNAT).

## Step 1 — Cloudflare account and domain

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Sign up**,
   create the free account
2. **Add a domain** → type your domain
3. Cloudflare asks you to change the "nameservers" where you bought the
   domain — it shows exactly which ones and where to change them (guided step)
4. Wait until it turns green "Active" (can take minutes to hours)

## Step 2 — Create the tunnel

1. Enter [one.dash.cloudflare.com](https://one.dash.cloudflare.com)
   (the "Zero Trust" dashboard — same account)
2. In the menu: **Networks → Tunnels → Add a tunnel** → choose **Cloudflared**
3. Name the tunnel, e.g. `oficina` → **Save**
4. Cloudflare shows instructions for several systems — pick **Docker**.
   A long command appears; the only thing you need is the **token**: the
   string starting with `eyJ` (copy it — it's the tunnel "key")
5. Continue to **Public Hostname** and create the public address:
   - **Subdomain:** `oficina` (or `app`, as you prefer)
   - **Domain:** your domain
   - **Service:** Type `HTTP` · URL `app:4000`
   - ⚠️ it really is `app:4000` — that's the Docker container's internal name, not the PC's IP
6. Save. The tunnel is created.

## Step 3 — Connect it in the app

Open the **`.env`** file in the folder where you installed OficinaOS
(Notepad or VS Code) and add/edit these lines:

```bash
TUNNEL_TOKEN=eyJhIjoixxxxx…        # paste the token from step 2
EXTRA_TRUSTED_ORIGINS=https://oficina.minhaloja.pt   # your public address
TRUST_PROXY=true                   # the tunnel is a proxy — without this
                                   # rate limits apply to all visitors
                                   # collectively
```

> `APP_URL` stays as is (`http://192.168…:4000`) — so the shop keeps
> working **even if the internet fails**, with remote access on top.

Restart with the tunnel:

- **If you installed with INSTALAR.bat** (most people) — also set in `.env`:

  ```bash
  COMPOSE_PROFILES=tunnel
  ```

  then open `INICIAR.bat` (or run `docker compose -f docker-compose.app.yml up -d`).

- **If you installed from source:**

  ```bash
  docker compose --profile tunnel up -d
  ```

**Test:** open `https://oficina.minhaloja.pt` on your phone — if the login
appears, it's done. ✅

## Step 4 — Enable customer links

**Settings → Shop → Tracking base URL** → type
`https://oficina.minhaloja.pt` → Save.

## Quick questions

**If the shop internet fails, does the shop stop?**
No. Inside the shop everyone keeps using `http://192.168…:4000` —
only remote access pauses until the internet returns.

**If the shop PC turns off?**
Remote access stops with it. When the PC turns on, Docker and the tunnel
start by themselves and everything returns.

**Is it safe?**
Yes: encrypted HTTPS, zero open router ports, and login attempt limits
keep working per visitor. If you want an extra barrier, **Cloudflare
Access** (free, same dashboard → Access → Applications) can ask for
email + code before login — remember to leave the public paths out
(`/tracking*`, `/pre-check*`) so customers don't hit the barrier.

**Maximum-security alternative:** if you prefer that **everyone** uses
the HTTPS address (including inside the shop), set
`APP_URL=https://oficina.minhaloja.pt` instead of the IP — safer
(hardened cookies), but the shop then needs internet to log in.
Recommended only if the shop internet is very stable.

**Does it cost anything?**
The tunnel is free. The only cost is the domain (~€10/year).
