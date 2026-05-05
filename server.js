const express = require("express");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const Database = require("better-sqlite3");
const { google } = require("googleapis");
const multer = require("multer");

loadEnv(".env.local");

if (!fs.existsSync("./config.json")) {
  console.error("Missing config.json — copy config.example.json to config.json and edit it.");
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync("./config.json", "utf-8"));
const app = express();

app.use(express.static("public"));
app.use(express.json());

// ---- SQLite setup ----
const db = new Database(path.resolve(__dirname, "texboard.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS daily_weather (
    date TEXT PRIMARY KEY,
    high REAL,
    low REAL,
    feels_high REAL,
    feels_low REAL,
    humidity REAL,
    wind_speed REAL,
    wind_deg REAL,
    uvi REAL,
    dew_point REAL,
    icon TEXT,
    description TEXT,
    sunrise INTEGER,
    sunset INTEGER,
    recorded_at TEXT DEFAULT (datetime('now'))
  )
`);

const upsertWeather = db.prepare(`
  INSERT OR REPLACE INTO daily_weather
    (date, high, low, feels_high, feels_low, humidity, wind_speed, wind_deg, uvi, dew_point, icon, description, sunrise, sunset)
  VALUES
    (@date, @high, @low, @feels_high, @feels_low, @humidity, @wind_speed, @wind_deg, @uvi, @dew_point, @icon, @description, @sunrise, @sunset)
`);

const getHistoricalAvg = db.prepare(`
  SELECT
    AVG(high) as avg_high,
    AVG(low) as avg_low,
    AVG(humidity) as avg_humidity,
    AVG(wind_speed) as avg_wind,
    AVG(uvi) as avg_uvi,
    COUNT(*) as years
  FROM daily_weather
  WHERE substr(date, 6) = @monthDay
`);

const getPastDay = db.prepare(`SELECT * FROM daily_weather WHERE date = @date`);

// ---- Settings table ----
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);

const getSettingStmt = db.prepare(`SELECT value FROM settings WHERE key = ?`);
const setSettingStmt = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
const deleteSettingStmt = db.prepare(`DELETE FROM settings WHERE key = ?`);
const getAllSettingsStmt = db.prepare(`SELECT key, value FROM settings`);

function getSetting(key, fallback) {
  const row = getSettingStmt.get(key);
  if (row) return row.value;
  return fallback !== undefined ? fallback : null;
}

function setSetting(key, value) {
  if (value === null || value === undefined || value === "") {
    deleteSettingStmt.run(key);
  } else {
    setSettingStmt.run(key, String(value));
  }
}

function cacheWeatherData(data) {
  if (!data.daily) return;
  for (const day of data.daily) {
    const d = new Date(day.dt * 1000);
    const dateStr = d.toLocaleDateString("en-CA");
    upsertWeather.run({
      date: dateStr,
      high: day.temp.max,
      low: day.temp.min,
      feels_high: day.feels_like.day,
      feels_low: day.feels_like.night,
      humidity: day.humidity,
      wind_speed: day.wind_speed,
      wind_deg: day.wind_deg,
      uvi: day.uvi,
      dew_point: day.dew_point,
      icon: day.weather[0].icon,
      description: day.weather[0].description,
      sunrise: day.sunrise,
      sunset: day.sunset,
    });
  }
}

// ---- API call tracking ----
const USAGE_FILE = path.resolve(__dirname, ".weather-usage.json");

function loadUsage() {
  try {
    const data = JSON.parse(fs.readFileSync(USAGE_FILE, "utf-8"));
    if (data.date === new Date().toDateString()) return data;
  } catch (e) {}
  return { count: 0, date: new Date().toDateString() };
}

function trackWeatherCall() {
  const usage = loadUsage();
  usage.count++;
  fs.writeFileSync(USAGE_FILE, JSON.stringify(usage));
}

// ---- Live reload ----
const crypto = require("crypto");

function getFilesHash() {
  const files = ["public/index.html", "public/style.css", "public/app.js"];
  let content = "";
  for (const f of files) {
    try { content += fs.readFileSync(f, "utf-8"); } catch (e) {}
  }
  return crypto.createHash("md5").update(content).digest("hex");
}

let currentHash = getFilesHash();
fs.watch("public", () => { currentHash = getFilesHash(); });

app.get("/api/hash", (req, res) => {
  res.json({ hash: currentHash });
});

// ---- Routes ----
app.get("/api/weather", async (req, res) => {
  const apiKey = getSetting("OPENWEATHERMAP_API_KEY", process.env.OPENWEATHERMAP_API_KEY);
  const lat = getSetting("weather_lat", config.weather.lat);
  const lon = getSetting("weather_lon", config.weather.lon);
  const units = getSetting("weather_units", config.weather.units);
  if (!apiKey) {
    return res.json({ error: "Weather API key not configured" });
  }

  try {
    trackWeatherCall();
    const data = await fetchJSON(
      `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&units=${units}&exclude=minutely,alerts&appid=${apiKey}`
    );
    cacheWeatherData(data);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/weather-usage", (req, res) => {
  const usage = loadUsage();
  res.json({ calls: usage.count, limit: 1000 });
});

app.get("/api/weather-history", (req, res) => {
  const { date } = req.query;
  if (!date) return res.json({ error: "date param required" });

  const exact = getPastDay.get({ date });
  if (exact) {
    return res.json({ type: "recorded", data: exact });
  }

  const monthDay = date.slice(5);
  const avg = getHistoricalAvg.get({ monthDay });
  if (avg && avg.years > 0) {
    return res.json({
      type: "average",
      data: {
        avg_high: Math.round(avg.avg_high),
        avg_low: Math.round(avg.avg_low),
        avg_humidity: Math.round(avg.avg_humidity),
        avg_wind: Math.round(avg.avg_wind),
        avg_uvi: Math.round(avg.avg_uvi),
        years: avg.years,
      },
    });
  }

  res.json({ type: "none" });
});

// ---- Google Calendar OAuth ----
const TOKEN_FILE = path.resolve(__dirname, ".google-tokens.json");
const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];

function getOAuth2Client() {
  const clientId = getSetting("GOOGLE_CLIENT_ID", process.env.GOOGLE_CLIENT_ID);
  const clientSecret = getSetting("GOOGLE_CLIENT_SECRET", process.env.GOOGLE_CLIENT_SECRET);
  if (!clientId || !clientSecret) return null;
  return new google.auth.OAuth2(clientId, clientSecret, `http://localhost:${config.port}/auth/google/callback`);
}

function loadTokens() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
  } catch (e) {
    return null;
  }
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

app.get("/auth/google", (req, res) => {
  const oauth2 = getOAuth2Client();
  if (!oauth2) return res.send("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local first.");
  const url = oauth2.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES });
  res.redirect(url);
});

app.get("/auth/google/callback", async (req, res) => {
  const oauth2 = getOAuth2Client();
  if (!oauth2) return res.send("OAuth not configured.");
  try {
    const { tokens } = await oauth2.getToken(req.query.code);
    saveTokens(tokens);
    res.send("<h2>Authenticated! You can close this tab.</h2><script>setTimeout(()=>window.close(),2000)</script>");
  } catch (err) {
    res.status(500).send("Auth failed: " + err.message);
  }
});

app.get("/auth/status", (req, res) => {
  const tokens = loadTokens();
  res.json({ authenticated: !!tokens });
});

app.get("/api/calendars", async (req, res) => {
  const oauth2 = getOAuth2Client();
  const tokens = loadTokens();
  if (!oauth2 || !tokens) return res.json({ error: "Not authenticated", calendars: [] });

  oauth2.setCredentials(tokens);
  oauth2.on("tokens", (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    saveTokens(merged);
  });

  try {
    const cal = google.calendar({ version: "v3", auth: oauth2 });
    const list = await cal.calendarList.list();
    res.json({ calendars: list.data.items.map(c => ({
      id: c.id,
      summary: c.summary,
      primary: c.primary || false,
      backgroundColor: c.backgroundColor,
      foregroundColor: c.foregroundColor,
    })) });
  } catch (err) {
    res.status(500).json({ error: err.message, calendars: [] });
  }
});

app.get("/api/calendar", async (req, res) => {
  const oauth2 = getOAuth2Client();
  const tokens = loadTokens();
  if (!oauth2 || !tokens) {
    return res.json({ error: "Not authenticated — visit /auth/google to connect", events: [] });
  }

  oauth2.setCredentials(tokens);
  oauth2.on("tokens", (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    saveTokens(merged);
  });

  try {
    const cal = google.calendar({ version: "v3", auth: oauth2 });
    const now = new Date();
    const horizon = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    const calList = await cal.calendarList.list();
    const calIds = (config.calendars || []).length > 0
      ? config.calendars
      : calList.data.items.map(c => c.id);

    const colorMap = {};
    for (const c of calList.data.items) {
      colorMap[c.id] = { bg: c.backgroundColor, fg: c.foregroundColor, name: c.summary };
    }

    const allEvents = [];
    await Promise.all(calIds.map(async (calId) => {
      try {
        const events = await cal.events.list({
          calendarId: calId,
          timeMin: now.toISOString(),
          timeMax: horizon.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 100,
        });
        for (const ev of (events.data.items || [])) {
          allEvents.push({
            summary: ev.summary || "(No title)",
            start: ev.start.dateTime || ev.start.date,
            end: ev.end?.dateTime || ev.end?.date || null,
            location: ev.location || null,
            calendar: calId,
            calendarName: colorMap[calId]?.name || "",
            color: colorMap[calId]?.bg || "#5b9bf7",
          });
        }
      } catch (e) {
        console.error(`Calendar ${calId} error:`, e.message);
      }
    }));

    allEvents.sort((a, b) => new Date(a.start) - new Date(b.start));
    res.json({ events: allEvents, colorMap });
  } catch (err) {
    res.status(500).json({ error: err.message, events: [] });
  }
});

app.get("/api/pollen", async (req, res) => {
  const apiKey = getSetting("GOOGLE_POLLEN", process.env.GOOGLE_POLLEN);
  const lat = getSetting("weather_lat", config.weather.lat);
  const lon = getSetting("weather_lon", config.weather.lon);
  if (!apiKey) {
    return res.json({ error: "Google Pollen API key not configured" });
  }

  try {
    const data = await fetchJSON(
      `https://pollen.googleapis.com/v1/forecast:lookup?key=${apiKey}&location.latitude=${lat}&location.longitude=${lon}&days=1`
    );
    const day = data.dailyInfo?.[0];
    if (day?.pollenTypeInfo) {
      const byType = {};
      for (const p of day.pollenTypeInfo) {
        byType[p.code.toLowerCase()] = {
          index: p.indexInfo?.value ?? null,
          category: p.indexInfo?.category ?? null,
        };
      }
      res.json({
        tree: byType.tree || null,
        grass: byType.grass || null,
        weed: byType.weed || null,
      });
    } else {
      res.json({ tree: null, grass: null, weed: null });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- NYC Alternate Side Parking ----
app.get("/api/parking", async (req, res) => {
  try {
    const html = await fetchText("https://www.nyc.gov/html/dot/html/motorist/alternate-side-parking.shtml");
    const cleaned = html.replace(/<!--[\s\S]*?-->/g, "");
    const match = cleaned.match(/ASP Status<\/strong>:\s*(.+?)(?:<br|\.?\s*The next)/i);
    if (match) {
      const status = match[1].replace(/<[^>]+>/g, "").trim();
      const suspended = /suspend/i.test(status);
      res.json({ status, suspended });
    } else {
      const today = new Date();
      const day = today.getDay();
      const inEffect = day >= 1 && day <= 6;
      res.json({ status: inEffect ? "In effect" : "Not in effect (Sunday)", suspended: !inEffect });
    }
  } catch (err) {
    res.json({ error: err.message });
  }
});

let aspDatesCache = null;
app.get("/api/parking-calendar", async (req, res) => {
  if (aspDatesCache) return res.json(aspDatesCache);
  try {
    const html = await fetchText("https://www.nyc.gov/html/dot/html/motorist/alternate-side-parking.shtml");
    const year = new Date().getFullYear();
    const tableMatch = html.match(new RegExp(`id="year${year}"[\\s\\S]*?<\\/table>`));
    if (!tableMatch) return res.json({ dates: [] });
    const cells = [...tableMatch[0].matchAll(/<td>([^<]+)<\/td>/g)].map(m => m[1]);
    const dates = [];
    for (let i = 0; i < cells.length; i += 2) {
      const dateStr = cells[i]?.trim();
      if (!dateStr) continue;
      const parsed = new Date(`${dateStr}, ${year}`);
      if (!isNaN(parsed)) {
        dates.push(parsed.toLocaleDateString("en-CA"));
      }
    }
    aspDatesCache = { dates: [...new Set(dates)] };
    setTimeout(() => { aspDatesCache = null; }, 24 * 60 * 60 * 1000);
    res.json(aspDatesCache);
  } catch (err) {
    res.json({ dates: [], error: err.message });
  }
});

// ---- NYC Subway Status ----
app.get("/api/subway", async (req, res) => {
  try {
    const data = await fetchJSON("https://goodservice.io/api/routes");
    const routes = data.routes || {};
    const lines = Object.values(routes)
      .filter(r => r.visible && r.scheduled)
      .map(r => ({ name: r.name, color: r.color, textColor: r.text_color, status: r.status }));
    res.json({ lines });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// ---- NYC School Lunch Menu ----
app.get("/api/lunch", async (req, res) => {
  try {
    const now = new Date();
    const month = now.toLocaleString("en-US", { month: "long" }).toLowerCase();
    const year = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
    const schoolYear = `${year}-${year + 1}`;
    const url = `https://www.schools.nyc.gov/docs/default-source/school-menus/${schoolYear}/${month}/pre-k---8-lunch-menu.csv`;

    const csv = await fetchText(url);
    if (!csv || csv.includes("BlobNotFound")) {
      return res.json({ error: "Menu not available" });
    }

    const today = now.toLocaleDateString("en-US", { month: "long", day: "numeric" });
    const lines = csv.split("\n");
    for (const line of lines) {
      if (line.toLowerCase().includes(today.toLowerCase())) {
        const match = line.match(/\{(.+)\}/);
        if (match) {
          const items = match[1]
            .split("|")
            .map(s => s.replace(/\(VE?\)/g, "").replace(/\s+/g, " ").trim())
            .filter(s => s && !s.startsWith("Salad Bar") && !s.includes("Bar") && !s.includes("Milk") && !s.includes("Condiments") && !s.includes("Fresh Fruit") && !s.startsWith("With "));
          return res.json({ date: today, items });
        }
      }
    }
    res.json({ error: "No menu for today" });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.get("/api/photos", (req, res) => {
  const dir = config.photos.directory;
  if (!fs.existsSync(dir)) {
    return res.json({ photos: [] });
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.(jpe?g|png|gif|webp|bmp)$/i.test(f))
    .map((f) => `/photos/${f}`);
  res.json({ photos: files });
});

app.use("/photos", express.static(path.resolve(config.photos.directory)));

app.get("/api/config", (req, res) => {
  res.json({
    photoInterval: config.photos.intervalSeconds,
  });
});

// ---- Helpers ----
function fetchJSON(url) {
  return fetchText(url).then((t) => JSON.parse(t));
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client
      .get(url, (resp) => {
        if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
          fetchText(resp.headers.location).then(resolve, reject);
          return;
        }
        let data = "";
        resp.on("data", (chunk) => (data += chunk));
        resp.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

function loadEnv(filepath) {
  if (!fs.existsSync(filepath)) return;
  const lines = fs.readFileSync(filepath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

// ---- Admin API ----
const SETTING_KEYS = [
  "OPENWEATHERMAP_API_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_POLLEN",
  "weather_lat",
  "weather_lon",
  "weather_units",
  "calendar_type",
  "apple_ical_urls",
];

function maskKey(val) {
  if (!val || val.length <= 4) return val ? "••••" : "";
  return "••••" + val.slice(-4);
}

const SECRET_KEYS = new Set(["OPENWEATHERMAP_API_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_POLLEN"]);

app.get("/api/settings", (req, res) => {
  const settings = {};
  for (const key of SETTING_KEYS) {
    const val = getSetting(key);
    if (SECRET_KEYS.has(key)) {
      settings[key] = { value: maskKey(val), hasValue: !!val };
    } else {
      settings[key] = { value: val || "", hasValue: !!val };
    }
  }
  settings._fallbacks = {
    weather_lat: config.weather.lat,
    weather_lon: config.weather.lon,
    weather_units: config.weather.units,
  };
  const googleAuth = !!loadTokens();
  const calType = getSetting("calendar_type", "google");
  let hasCalendar = false;
  if (calType === "google") {
    hasCalendar = googleAuth;
  } else {
    try {
      const urls = JSON.parse(getSetting("apple_ical_urls", "[]"));
      hasCalendar = urls.some(e => e.url);
    } catch (e) {}
  }
  settings._status = {
    weather: !!(getSetting("OPENWEATHERMAP_API_KEY", process.env.OPENWEATHERMAP_API_KEY)),
    google: googleAuth,
    calendar: hasCalendar,
    pollen: !!(getSetting("GOOGLE_POLLEN", process.env.GOOGLE_POLLEN)),
  };
  res.json(settings);
});

app.post("/api/settings", (req, res) => {
  const updates = req.body;
  let count = 0;
  for (const key of SETTING_KEYS) {
    if (!(key in updates)) continue;
    const val = updates[key];
    if (val && val.startsWith("••••")) continue;
    setSetting(key, val);
    count++;
  }
  res.json({ saved: count });
});

app.get("/api/setup-status", (req, res) => {
  const hasWeatherKey = !!(getSetting("OPENWEATHERMAP_API_KEY", process.env.OPENWEATHERMAP_API_KEY));
  res.json({ needsSetup: !hasWeatherKey });
});

// ---- Photo upload ----
const photosDir = path.resolve(config.photos.directory);
if (!fs.existsSync(photosDir)) {
  fs.mkdirSync(photosDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: photosDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, "_");
      const name = `${base}-${Date.now()}${ext}`;
      cb(null, name);
    },
  }),
  fileFilter: (req, file, cb) => {
    cb(null, /\.(jpe?g|png|gif|webp|bmp)$/i.test(file.originalname));
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

app.post("/api/photos/upload", upload.array("photos", 20), (req, res) => {
  const uploaded = (req.files || []).map(f => f.filename);
  res.json({ uploaded });
});

app.delete("/api/photos/:filename", (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(photosDir, filename);
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: "Not found" });
  }
  fs.unlinkSync(filepath);
  res.json({ deleted: filename });
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`texboard running at http://localhost:${config.port}`);
});
