# texboard

A custom Raspberry Pi dashboard replacing DAKboard/Magic Mirror. Displays on a vertical 1080p monitor (no touch — display only).

## Architecture

- **Server**: Node.js + Express (`server.js`), no build step
- **Frontend**: Plain HTML/CSS/JS in `public/` — no framework, no bundler
- **Database**: SQLite via better-sqlite3 (`texboard.db`) — caches daily weather for historical averages
- **Config**: `config.json` for non-secret settings, `.env.local` for API keys

## What it shows

- **Clock**: Date/time updated every second (format: "Sat. 18 Apr, 11:48pm")
- **Weather**: Feels-like temp (F + C), actual temp, high/low, wind/gusts, humidity, UV, sunrise/sunset, pollen
- **Hourly chart**: Canvas-drawn rain bars (blue), temperature line (orange), wind line (dashed white), day/night shading, sunrise/sunset markers
- **Calendar**: 8-week grid (Sun start) — previous week (dimmed) + current + 6 future. Color-coded Google Calendar events. Per-day weather icons (forecast for future, recorded/historical averages for past). ASP suspension dots.
- **Photos**: Cycling backdrop behind the top hero section, crossfade every 30s
- **NYC data**: Alternate side parking status, subway service alerts, school lunch menu
- **Countdowns**: Upcoming events from a personal calendar

## APIs

- **OpenWeatherMap One Call 3.0** — weather, hourly, daily forecast. Tracks daily call count (1000/day free limit)
- **Google Calendar API** — OAuth2 flow at `/auth/google`. Supports multiple calendars including shared ones
- **Google Pollen API** — tree/grass/weed pollen categories
- **NYC DOT** — alternate side parking status and suspension calendar (scraped, no key needed)
- **goodservice.io** — subway service status (free, no key needed)
- **NYC DOE** — school lunch menus (scraped from CSV, no key needed)

## Key files

```
server.js            — Express server, all API routes, OAuth, SQLite caching
public/index.html    — Dashboard HTML structure
public/style.css     — Dark theme, 1080x1920 vertical layout, CSS grid calendar
public/app.js        — Frontend: clock, weather, calendar grid, photo cycling, hourly chart
config.json          — Port, lat/lon, photo settings (see config.example.json)
.env.local           — API keys (see .env.example)
deploy.sh            — rsync to Pi + restart systemd service
setup-pi.sh          — Initial Pi setup (Node, systemd, kiosk)
```

## Development

```bash
cp config.example.json config.json   # edit with your lat/lon
cp .env.example .env.local           # add your API keys
npm install
npm run dev                          # nodemon watches server.js, config.json, public/
```

Frontend has live reload — polls `/api/hash` every 5s and reloads if file contents change. Server restart is only needed for `server.js` or `config.json` changes.

## Deployment

```bash
bash deploy.sh       # rsyncs to Pi, restarts systemd service, dashboard auto-reloads
```

Override defaults: `PI_HOST=pi@mypi.local bash deploy.sh`

## Pi Setup (Raspberry Pi OS with labwc/Wayland)

**Display compositor**: labwc (Wayland, not X11). Do NOT use X11-era config like `display_rotate` in boot config.

**Screen rotation**: Handled by kanshi (`~/.config/kanshi/config`):
```
profile {
  output HDMI-A-1 mode 1920x1080 position 0,0 transform 90
}
```

**Kiosk autostart** (`~/.config/labwc/autostart`):
```
/usr/bin/kanshi &
sleep 10
chromium --password-store=basic --noerrdialogs --disable-infobars --kiosk --no-first-run --disable-session-crashed-bubble --disable-restore-session-state http://localhost:3333 &
```

**Idle/screensaver prevention** (`~/.config/labwc/environment`):
```
IDLE_TIMEOUT=0
```

**Systemd service**: `/etc/systemd/system/texboard.service` — runs `node server.js`, auto-restarts

**Monitor on/off schedule** (crontab):
```
15 20 * * * WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/$(id -u) wlr-randr --output HDMI-A-1 --off
45 6 * * * WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/$(id -u) wlr-randr --output HDMI-A-1 --on --transform 90
```

**NOTE**: The Wayland display may be `wayland-0` or `wayland-1` depending on your setup. The `--transform 90` flag on the "on" command is required to maintain rotation.

**Manual monitor control via SSH**:
```bash
# Turn off
ssh user@texboard.local "WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/\$(id -u) wlr-randr --output HDMI-A-1 --off"
# Turn on
ssh user@texboard.local "WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/\$(id -u) wlr-randr --output HDMI-A-1 --on --transform 90"
```

## Pi troubleshooting notes

- Chromium binary is `chromium` (not `chromium-browser`) on newer Pi OS
- `--password-store=basic` prevents keyring popup (no keyboard attached)
- `--disable-session-crashed-bubble --disable-restore-session-state` prevents crash recovery dialogs
- All-day calendar events use the date string directly as the key (not `new Date()` parsing) to avoid UTC timezone bucketing shifting events to the wrong day

## Google Calendar OAuth

First-time setup: visit `http://localhost:3333/auth/google` in a browser to authenticate. Tokens are saved to `.google-tokens.json`. Supports multiple calendars including shared ones; configure specific calendar IDs in `config.json` under `calendars` array, or leave empty to show all.
