# Using OficinaOS on a phone or tablet

A simple guide for the team — no technical knowledge needed.
Takes 2 minutes and only needs doing once.

## Inside the shop (Wi-Fi)

You need 3 things that whoever installed the app gives you:

1. **The shop Wi-Fi** — the phone must be connected to the same network
   as the computer where the app is installed (doesn't work on mobile data)
2. **The address** — looks like `http://192.168.1.33:4000`
3. **Your username and password**

Then:

1. Open the browser — **Safari** on iPhone, **Chrome** on Android
2. Type the address in the top bar and go
3. Log in — ready to use

> 💡 The address is always the same. Save it to favorites or install the
> icon (next step) and you'll never need to type it again.

## Installing the icon on the home screen (recommended)

You get a proper icon and it opens full screen, like a normal app.

### iPhone / iPad

1. Open the address in **Safari**
2. Tap the **Share** button (the square with the up arrow)
3. Scroll and tap **"Add to Home Screen"**
4. Tap **Add** — the OficinaOS icon appears

### Android

1. Open the address in **Chrome**
2. Tap the **three dots (⋮)** in the top right corner
3. Tap **"Add to Home screen"**
4. Confirm — the icon appears

> If the shop has remote access enabled (next section), on Android
> Chrome may say **"Install app"** — even better, it installs as a real app.

## Outside the shop (at home, on the street)

Only works if the shop has **remote access** enabled — ask whoever
installed the app (the guide is in [remote-access.md](remote-access.md)).

1. Use the **internet address** you were given — looks like
   `https://oficina.shopname.pt` (starts with `https`, no numbers)
2. Log in with the **same** username and password
3. You can install the home-screen icon the same way

> ⚠️ **Important:** the app lives on the shop computer. If that computer
> is off, nobody gets in — inside or outside the shop.

## Something not working?

| What happens | What to do |
|---|---|
| Page doesn't open inside the shop | Confirm you're on the **shop Wi-Fi** (turn off mobile data and try again) |
| Page doesn't open outside the shop | Ask whether the **shop computer is on** and remote access is active |
| "Invalid address" or security error | You're using the wrong address — inside the shop it's the numbered one (`http://192.168...`), outside it's the `https://` with the shop name |
| Asked to log in again | Normal from time to time — sign in with your username |

---

### Note for installers (optional, no need to read)

There's also the possibility of building a **native Android APK** via
Capacitor for distribution outside the Play Store — technical details:
`capacitor.config.ts` + `VITE_API_BASE_URL` pointed at the public URL
(tunnel) or the LAN IP. In most cases the PWA is enough — especially
since on iOS there's no path without the App Store, and the icon
experience is equivalent.

> **Technical note (why HTTPS in the APK):** `androidScheme` stays on
> `https` on purpose. Login uses session cookies; in a WebView whose
> origin is `http://localhost` talking to `http://<shop-ip>`
> (cross-site), Android doesn't attach `SameSite=Lax` cookies to XHR
> requests — login would never persist. With the `https` scheme the
> origin is secure and the server can issue `SameSite=None; Secure`,
> which works. Consequence: **the APK requires `VITE_API_BASE_URL` on
> `https://`** (tunnel or VPS) — inside the shop, on `http://`, use the
> browser/PWA, which is same-origin and doesn't have this limit.
