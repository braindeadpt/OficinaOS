# Installing OficinaOS — step by step

Windows guide. Takes ~10 minutes the first time.

## Requirements

| Requirement | Detail |
|---|---|
| **PC** | Windows 10/11 **64-bit** — the PC that stays on in the shop |
| **RAM** | 4 GB free |
| **Disk** | ~3 GB free (app + database + backups) |
| **Permissions** | Administrator, only while installing with `OficinaOS-Setup.exe` — without admin use the **portable install** |
| **Internet** | Only for the **first install** and for updates — afterwards it runs offline on the local network |
| **Other devices** | **Nothing** — just a browser |

## Usage scenarios

| Scenario | How it works |
|---|---|
| **1. A single PC** (simplest) | Install on the counter PC and use `http://localhost:4000` on that same PC |
| **2. Server PC + several devices** | The same PC runs the app; tablets, phones and other PCs open `http://<IP>:4000` in the browser — nothing to install. ⚠️ The app only works while that PC is on |
| **3. Dedicated machine** | A mini-PC or NAS with Docker always on runs the app; everyone connects by browser. Ideal so you don't depend on the counter PC |
| **4. Internet access** | Free Cloudflare Tunnel — automatic HTTPS, no router ports to open, works behind CGNAT. Guide: **[docs/remote-access.md](docs/remote-access.md)**. Also gives customers public links (tracking, quotes, warranty QR) |

## Recommended install — `OficinaOS-Setup.exe`

The simplest path for a counter PC: a normal Windows installer that
leaves OficinaOS running as a service — **no Docker, no console windows,
starts by itself with the PC**.

1. Download **[OficinaOS-Setup](https://github.com/braindeadpt/OficinaOS/releases/latest)** (the `OficinaOS-Setup-*.exe` file in the latest release)
2. Double-click → if SmartScreen warns: **More info → Run anyway**
3. It asks for administrator **once** (services + firewall) and at the end the app opens in the browser
4. A **tray icon** appears next to the clock: open the app, check status, back up, stop/start

After installation:

- **On this PC:** `http://localhost:4000`
- **On other shop devices** (tablet, phone): `http://oficinaos.local:4000` — a stable name that works even if the PC changes IP. The **Help → QR code** page has a code you can scan with the camera to connect without typing anything
- **Updating:** when the app warns about a new version, the shop owner (admin) gets an **"Update"** button in the notice — it downloads only the app part (~100 MB instead of ~600 MB), backs up the database first and, if the new version doesn't boot, automatically restores the previous one. You can also update manually: download the new version's `OficinaOS-Setup` and run it over the top — your data stays
- **Automatic backups:** daily at 03:30 to `C:\ProgramData\OficinaOS\backups` (copy to a pen drive/external disk regularly)
- **Uninstall:** "Apps" in Windows Settings — it asks whether to delete the data too

Installer technical documentation: [installer/README.md](installer/README.md)

## Docker install (alternative)

For NAS, servers or existing Docker users.

### 1. Download

1. Download the installer: **[oficinaos-install.zip](https://github.com/braindeadpt/OficinaOS/releases/latest/download/oficinaos-install.zip)** — this link always downloads the latest version
2. Extract the ZIP to a folder, e.g. `C:\OficinaOS`

> Alternative: on the GitHub page, the green **Code → Download ZIP** button gives the full source (heavier — only use it if the installer fails).

### 2. Install

1. Inside the folder, **double-click `INSTALAR.bat`**
2. If Windows Defender SmartScreen warns: **More info → Run anyway**
3. The installer does everything by itself:
   - Installs **Docker Desktop** if missing (free, official)
   - Generates passwords and secrets automatically
   - **Downloads the ready-made image from GitHub** (seconds) — if that fails, downloads the source and builds locally (~5-10 min; kept in `oficinaos-src\app-source` so `INICIAR`/`PARAR`/`ATUALIZAR` work afterwards)
4. At the end, the browser opens automatically at `http://localhost:4000`

> **If Windows asks for a restart** during the Docker install (normal), restart the PC and run `INSTALAR.bat` again.

## 3. First access — "Create your workshop"

There is no default user or password. The first time the app opens (in any install mode: Setup.exe, Docker or portable), the **"Create your workshop"** screen appears: you type the shop name, your name, the username (or email) you'll sign in with and your password. The app creates the **owner** account and lands straight on the dashboard. Team accounts are created later in **Settings → Users**.

For security, this screen **only works on the PC where OficinaOS is installed** (`http://localhost:4000`) — the installer and `INICIAR.bat` already open the browser there. In the Docker install, the browser opens with a single-use setup link (`/setup?token=…`, also written in `PRIMEIRO-LOGIN.txt`); the code comes from the `SETUP_TOKEN` variable in `.env`. Once the shop is created, the screen ceases to exist and the normal login appears.

## 4. Daily use

| File | What for |
|---|---|
| `INICIAR.bat` | Start OficinaOS (double-click — opens the browser) |
| `PARAR.bat` | Stop (data is kept) |
| `ATUALIZAR.bat` | Update to the latest version |

**Other shop devices** (tablet, technician's phone, another PC): open `http://<PC-IP>:4000` — the exact address is in `PRIMEIRO-LOGIN.txt` (create the shop on the shop PC first). They don't need to install anything.

## Common problems

| Symptom | Solution |
|---|---|
| Windows firewall asks whether to allow access | Choose **Allow** (private network) |
| Blank page in the browser | `Ctrl+F5`; if it persists, confirm you used `http://` and not `https://` |
| "Invalid username or password" | Login is by **username** (`admin`), not email |
| The PC changed IP and other devices stopped connecting | Delete the `.env` file, run `INSTALAR.bat` again (generates fresh config; data is kept) |
| "Virtualization support not detected" / Docker won't start | `INSTALAR.bat` detects this and offers an alternative — see **Portable install** below |
| Full uninstall | `docker compose down -v` in the folder + delete the folder (⚠️ deletes the database) |

## Portable install (no admin, nothing to install)

`OficinaOS-Setup.exe` is the recommended path — but **portable mode** exists for situations where the installer doesn't fit:

- **No administrator** — you don't have the shop PC's admin password (Setup needs it for services and firewall; portable needs nothing)
- **You don't want to install anything** — nothing is registered in the system: no services, no entries in "Apps", just extract and run
- **Fallback** — the installer fails on that particular machine (antivirus or company policies blocking services), or you want to try the app with no commitment

Download [`oficinaos-portable.zip`](https://github.com/braindeadpt/OficinaOS/releases/latest/download/oficinaos-portable.zip), extract to a folder and run `INICIAR.bat`. The app is exactly the same — same code, same PostgreSQL database, same features — and the in-app **"Update"** button also works (downloads only the app part with SHA-256 verification, backup and automatic rollback).

Two practical differences vs Setup.exe:

- Autostart is an **optional scheduled task** (`INICIAR.bat` asks on first run) instead of a Windows service
- Since nobody opens the firewall for you, Windows asks **once** whether to allow the connection — choose **Allow** (private network) so shop tablets can connect

> If you came from the **"virtualization support not detected"** error on the Docker path (BIOS with VT-x/SVM disabled), portable also solves it — but Setup.exe is even simpler, because it doesn't need Docker either.

### Daily use (portable mode)

Inside `oficinaos-portable\`:

| File | What for |
|---|---|
| `INICIAR.bat` | Start everything (Postgres + app) — double-click, opens the browser |
| `PARAR.bat` | Stop (data is kept in `data\`) |
| `ATUALIZAR.bat` | Update to the latest version (preserves data and configuration) |
| `BACKUP.bat` | Manual database backup |
| `RESTAURAR.bat` | Restore the database from a backup |

- **Autostart**: on first run `INICIAR.bat` asks whether you want OficinaOS to start by itself when the PC boots (registers a scheduled task; to remove: `schtasks /delete /tn "OficinaOS" /f`)
- **If the app crashes**: it restarts by itself after 5 seconds (respawn wrapper)
- **Backups**: made automatically at every start to `app\uploads\backups\` (14-day retention) — the backup indicator in the app works the same

### Differences vs Setup.exe install

| | Setup.exe | Portable |
|---|---|---|
| Requires administrator | yes, during install | **no** |
| Download size | ~285 MB | ~470 MB once |
| Starts with the PC | automatic (Windows service) | automatic if you accept the scheduled task |
| Firewall rule for the LAN | created during install | Windows asks once — choose Allow |
| Automatic backups | daily at 03:30 (`ProgramData\OficinaOS\backups`) | at every start + `BACKUP.bat` |
| Updating | in-app "Update" button, or Setup over the top | in-app "Update" button, or `ATUALIZAR.bat` |
| Tray icon | yes | no |
| Access from other LAN devices | `http://oficinaos.local:4000` or IP | same |

### Restoring a backup (portable mode)

1. Double-click **`RESTAURAR.bat`** — lists backups in `app\uploads\backups\` newest first
2. Pick the backup number and confirm with `SIM` — ⚠️ **replaces all current data** with the backup's
3. The script stops the app, recreates the database and applies the dump; at the end it runs `INICIAR.bat`

> Backups on the same disk don't protect against failure, theft or ransomware — copy `app\uploads\backups\` to an external disk or pen drive regularly.

### Migrating between installations

The dumps are compressed plain `pg_dump` — the same format in both modes, so migrating is backing up on one side and restoring on the other.

**Portable → Docker:**
1. On portable: `BACKUP.bat` → copy the `oficinaos-*.sql.gz` from `app\uploads\backups\`
2. On Docker: place the file in the backups volume (`docker compose cp` or the mapped folder) and run the restore: `docker compose exec -T db-backup /scripts/run-restore.sh oficinaos-<stamp>.sql.gz`

**Docker → portable:**
1. On Docker: `docker compose exec -T db-backup /scripts/run-backup.sh` → copy the dump from the `backups` volume into `oficinaos-portable\app\uploads\backups\`
2. On portable: `RESTAURAR.bat` and pick that dump
3. Images/upload files live outside the DB: in Docker in the `uploads` volume, in portable in `app\uploads\` — copy that content too so you don't lose photos and receipts

### Uninstalling (portable mode)

Run `PARAR.bat` and delete the `oficinaos-portable` folder. ⚠️ `data\` contains the entire database — back up first if you want to keep it. If you enabled autostart, remove the task: `schtasks /delete /tn "OficinaOS" /f`.

Bundle technical documentation: [scripts/portable/README.md](scripts/portable/README.md)

## Updating to a new version

**In-app "Update" button** (`OficinaOS-Setup.exe` install or portable mode): when the new-version notice appears, the admin has an "Update" button — downloads only the app package (~100 MB instead of ~600 MB) with SHA-256 verification, backs up the database before touching anything, and automatically restores the previous version if the new one doesn't boot (`/health` fails or the migration breaks). The app is offline ~1-2 minutes during the swap.

> **Installs from v1.0.9:** that version didn't ship the updater yet — the button doesn't appear. It's a manual step **only once**: run the new version's `OficinaOS-Setup.exe` over the top (data in `ProgramData` stays) — from then on the button always works.
>
> Alternatively, without reinstalling, in an administrator PowerShell:
>
> ```powershell
> $base = "https://github.com/braindeadpt/OficinaOS/releases/latest/download"
> Invoke-WebRequest "$base/update-apply.ps1" -OutFile update-apply.ps1
> Invoke-WebRequest "$base/oficinaos-app-update.zip" -OutFile app-update.zip
> # optional: verify the .sha256 before running
> powershell -ExecutionPolicy Bypass -File .\update-apply.ps1 -Mode service `
>   -InstallRoot "C:\Program Files\OficinaOS" `
>   -ZipPath .\app-update.zip `
>   -StatusPath "C:\ProgramData\OficinaOS\update-status.json" `
>   -BackupScript "C:\Program Files\OficinaOS\tools\backup.ps1"
> ```

**Docker / manually:** double-click **`ATUALIZAR.bat`** — backs up the database, pulls the new image and restarts. Database migrations run by themselves on boot.

By hand, if you prefer:

```bat
:: with the pre-built image (recommended):
docker compose -f docker-compose.app.yml pull
docker compose -f docker-compose.app.yml up -d

:: or, if you installed in build mode (no ghcr image — ATUALIZAR.bat handles this itself):
docker compose -f oficinaos-src\app-source\docker-compose.yml up -d --build

:: or, in a development git checkout:
git pull
docker compose up -d --build
```

### Automatic updates (optional)

If you want the app to update itself, enable the `auto-update` profile in `.env`:

```ini
COMPOSE_PROFILES=auto-update
UPDATE_SCHEDULE=0 30 7 * * *   # 6-field cron — defaults to 07:30 daily
```

Then `docker compose -f docker-compose.app.yml up -d` to start Watchtower. Pick a time when **the PC is on and the shop closed** — updating implies a few seconds of restart. Only the app container is updated; the database and backups are never touched. If an update goes wrong, the daily dump (14-day retention) lets you restore.
