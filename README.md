# texboard

A personal dashboard for Raspberry Pi, designed for a vertical 1080x1920 monitor. No touch needed — just a display.

Built with Node.js, Express, and plain HTML/CSS/JS. No build step, no framework.

## What it shows

- **Clock** with date
- **Weather** — current conditions, feels-like, high/low, wind, humidity, UV, sunrise/sunset, pollen
- **Hourly chart** — temperature, rain, wind, day/night shading, sunrise/sunset markers
- **Calendar** — 8-week grid with color-coded Google Calendar events and per-day weather icons
- **Photo slideshow** — cycling backdrop with crossfade
- **NYC-specific** — alternate side parking status, subway alerts, school lunch menu, event countdowns

## Quick start

```bash
git clone https://github.com/texjernigan/texboard.git
cd texboard
cp config.example.json config.json   # edit with your coordinates
cp .env.example .env.local           # add your API keys
npm install
npm start
```

Then open `http://localhost:3333` in a browser.

## API keys needed

| Service | Required? | Free tier |
|---------|-----------|-----------|
| [OpenWeatherMap One Call 3.0](https://openweathermap.org/api) | Yes | 1,000 calls/day |
| [Google Calendar API](https://console.cloud.google.com/apis/credentials) | Optional | Unlimited |
| [Google Pollen API](https://console.cloud.google.com/apis/library/pollen.googleapis.com) | Optional | Free |

NYC data (parking, subway, lunch) is scraped from public sources — no keys needed.

## Google Calendar setup

Create OAuth2 credentials in Google Cloud Console, add the client ID and secret to `.env.local`, then visit `http://localhost:3333/auth/google` to authenticate.

## Photos

Drop images into a `photos/` directory. They cycle as the hero backdrop every 30 seconds (configurable in `config.json`).

## Deploy to Raspberry Pi

```bash
bash deploy.sh
```

This rsyncs the project to the Pi, syncs photos (removing deleted ones), and restarts the systemd service.

Override the default Pi host: `PI_HOST=pi@mypi.local bash deploy.sh`

For first-time Pi setup, see `setup-pi.sh` and the notes in `CLAUDE.md`.

## Development

```bash
npm run dev   # uses nodemon, watches server.js + config.json + public/
```

The frontend has live reload built in — it polls for file changes and reloads automatically.

## License

MIT
