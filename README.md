# texboard

A personal dashboard for Raspberry Pi, designed for a vertical 1080x1920 monitor. No touch needed — just a display.

Built with Node.js, Express, and plain HTML/CSS/JS. No build step, no framework.

## What it shows

- **Clock** with date
- **Weather** — current conditions, feels-like, high/low, wind, humidity, UV, sunrise/sunset, pollen
- **Hourly chart** — temperature, rain, wind, day/night shading, sunrise/sunset markers
- **Calendar** — 8-week grid with color-coded events from Google Calendar or Apple Calendar (iCal)
- **Photo slideshow** — cycling backdrop with crossfade
- **NYC-specific** — alternate side parking status, subway alerts, school lunch menu, event countdowns

## Setup with Claude Code

The easiest way to get started is with [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Open your terminal and run:

```
claude "Clone https://github.com/texjer/texboard and set it up for me. I live in [YOUR CITY]. Help me get API keys and get it running."
```

Claude will clone the repo, install dependencies, configure your location, and walk you through getting the API keys you need.

## Manual setup

```bash
git clone https://github.com/texjer/texboard.git
cd texboard
cp config.example.json config.json
npm install
npm start
```

Then open `http://localhost:3333` in a browser. Click the **+** button in the top-right corner to open the admin panel, where you can paste your API keys, set your location, add calendar URLs, and upload photos — no file editing needed.

### API keys needed

| Service | Required? | Free tier | Get it |
|---------|-----------|-----------|--------|
| OpenWeatherMap One Call 3.0 | Yes | 1,000 calls/day | [openweathermap.org](https://openweathermap.org/api) |
| Google Calendar API | Optional | Unlimited | [Cloud Console](https://console.cloud.google.com/apis/credentials) |
| Google Pollen API | Optional | Free | [Cloud Console](https://console.cloud.google.com/apis/library/pollen.googleapis.com) |

All API keys work with a free Gmail account — no Google Workspace needed.

NYC data (parking, subway, lunch) is scraped from public sources — no keys needed.

### Calendar

The admin panel supports two calendar options:

- **Google Calendar** — connect with OAuth for real-time sync with calendar colors. Requires creating a project in Google Cloud Console (the admin panel has step-by-step instructions).
- **Apple Calendar** — paste an iCal URL. In the Calendar app, right-click a calendar > Share > Public Calendar, and copy the URL.

### Photos

Upload photos directly from the admin panel, or drop images into the `photos/` directory. They cycle as the hero backdrop every 30 seconds.

### Advanced: `.env.local`

Power users can still configure API keys via a `.env.local` file instead of the admin panel. The admin panel (SQLite) takes priority, with `.env.local` as a fallback. See `.env.example` for the format.

## Deploy to Raspberry Pi

```bash
bash setup-pi.sh   # first time only — installs Node, sets hostname, enables kiosk mode
bash deploy.sh     # syncs code + photos, restarts the service
```

The setup script sets the Pi's hostname to `texboard`, so it's automatically reachable at `http://texboard.local:3333` from any device on your network — no need to find the IP address. Open that URL on your phone or laptop to access the admin panel.

Override the default Pi host: `PI_HOST=pi@mypi.local bash deploy.sh`

If `texboard.local` doesn't resolve, check your router's admin page for the Pi's IP address, or run `ping texboard.local` from your computer.

## Development

```bash
npm run dev   # uses nodemon, watches server.js + config.json + public/
```

The frontend has live reload built in — it polls for file changes and reloads automatically.

## License

MIT
