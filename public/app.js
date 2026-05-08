// ---- Live reload ----
let lastHash = null;
async function checkReload() {
  try {
    const res = await fetch("/api/hash");
    const data = await res.json();
    if (lastHash && data.hash !== lastHash) location.reload();
    lastHash = data.hash;
  } catch (e) {}
}
checkReload();
setInterval(checkReload, 5000);

// ---- Clock ----
function updateClock() {
  const now = new Date();
  const day = now.toLocaleDateString("en-US", { weekday: "short" });
  const date = now.getDate();
  const month = now.toLocaleDateString("en-US", { month: "short" });
  const h = now.getHours();
  const m = String(now.getMinutes()).padStart(2, "0");
  const hour12 = h % 12 || 12;
  const ampm = h >= 12 ? "pm" : "am";
  document.getElementById("datetime-text").textContent =
    `${day}. ${date} ${month}, ${hour12}:${m}${ampm}`;
}

setInterval(updateClock, 1000);
updateClock();

// ---- Weather ----
let dailyForecast = {};
let hourlyData = [];

async function loadWeather() {
  try {
    const res = await fetch("/api/weather");
    const data = await res.json();
    if (data.error) {
      document.getElementById("weather-feels").textContent = "--°";
      document.getElementById("wx-desc").textContent = data.error;
      return;
    }

    const c = data.current;
    const today = data.daily[0];
    hourlyData = data.hourly || [];
    hourlyData._sunrise = c.sunrise;
    hourlyData._sunset = c.sunset;
    hourlyData._sunrise2 = data.daily[1]?.sunrise;
    hourlyData._sunset2 = data.daily[1]?.sunset;

    document.getElementById("weather-icon").src =
      `https://openweathermap.org/img/wn/${c.weather[0].icon}@2x.png`;
    const feelsF = Math.round(c.feels_like);
    const feelsC = Math.round((c.feels_like - 32) * 5 / 9);
    document.getElementById("weather-feels").innerHTML =
      `${feelsF}° <span class="celsius">${feelsC}°C</span>`;
    document.getElementById("wx-desc").textContent =
      c.weather[0].description;
    document.getElementById("wx-actual").textContent =
      `Actual ${Math.round(c.temp)}° · H ${Math.round(today.temp.max)}° / L ${Math.round(today.temp.min)}°`;

    document.getElementById("wx-wind").textContent =
      `${Math.round(c.wind_speed)} mph ${degToCompass(c.wind_deg)}`;
    document.getElementById("wx-gust").textContent =
      c.wind_gust ? `${Math.round(c.wind_gust)} mph` : "—";
    document.getElementById("wx-humidity").textContent = `${c.humidity}%`;
    document.getElementById("wx-uv").textContent = formatUV(c.uvi);

    const fmt = (ts) => new Date(ts * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    document.getElementById("wx-rise").textContent = fmt(c.sunrise);
    document.getElementById("wx-set").textContent = fmt(c.sunset);

    dailyForecast = {};
    for (const day of data.daily) {
      const key = new Date(day.dt * 1000).toLocaleDateString("en-CA");
      dailyForecast[key] = {
        icon: day.weather[0].icon,
        high: Math.round(day.temp.max),
        low: Math.round(day.temp.min),
      };
    }

    renderHourlyChart();
    renderCalendarGrid();
  } catch (e) {
    console.error("Weather error:", e);
  }
}

function formatUV(uvi) {
  const val = Math.round(uvi);
  if (val <= 2) return `${val} Low`;
  if (val <= 5) return `${val} Mod`;
  if (val <= 7) return `${val} High`;
  if (val <= 10) return `${val} V.High`;
  return `${val} Extreme`;
}

function degToCompass(deg) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

// ---- Hourly rain/temp chart ----
function renderHourlyChart() {
  const hours = hourlyData.slice(0, 24);
  if (hours.length === 0) return;

  const labelsEl = document.getElementById("hourly-labels");
  const tempsEl = document.getElementById("hourly-temps");
  const canvas = document.getElementById("rain-canvas");
  const ctx = canvas.getContext("2d");

  const chartDiv = document.getElementById("hourly-chart");
  canvas.width = chartDiv.offsetWidth * 2;
  canvas.height = chartDiv.offsetHeight * 2;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const barW = canvas.width / hours.length;
  const padTop = 90;
  const padBot = 50;
  const chartH = canvas.height - padTop - padBot;
  const rains = hours.map(h => (h.rain?.["1h"] || 0) + (h.snow?.["1h"] || 0));
  const maxRain = Math.max(10, ...rains);

  // Day/night background shading + sunrise/sunset lines
  const sunrises = [hourlyData._sunrise, hourlyData._sunrise2].filter(Boolean);
  const sunsets = [hourlyData._sunset, hourlyData._sunset2].filter(Boolean);
  const h0 = hours[0].dt;
  const hLast = hours[hours.length - 1].dt;

  function isDaytime(dt) {
    for (let s = 0; s < sunrises.length; s++) {
      const rise = sunrises[s];
      const set = sunsets[s];
      if (rise && set && dt >= rise && dt <= set) return true;
    }
    if (sunrises[1] && dt >= sunrises[1]) return true;
    return false;
  }

  for (let i = 0; i < hours.length; i++) {
    const isDay = isDaytime(hours[i].dt);
    ctx.fillStyle = isDay ? "rgba(245, 190, 60, 0.06)" : "rgba(30, 40, 80, 0.3)";
    ctx.fillRect(i * barW, 0, barW, canvas.height);

    const grad = ctx.createLinearGradient(0, 0, 0, 40);
    if (isDay) {
      grad.addColorStop(0, "rgba(245, 190, 60, 0.2)");
      grad.addColorStop(1, "rgba(245, 190, 60, 0)");
    } else {
      grad.addColorStop(0, "rgba(80, 100, 200, 0.2)");
      grad.addColorStop(1, "rgba(80, 100, 200, 0)");
    }
    ctx.fillStyle = grad;
    ctx.fillRect(i * barW, 0, barW, 40);
  }

  // Sunrise/sunset vertical lines
  const sunEvents = [];
  for (const ts of sunrises) sunEvents.push([ts, "☀", "rgba(245,190,60,0.6)"]);
  for (const ts of sunsets) sunEvents.push([ts, "☾", "rgba(120,140,200,0.6)"]);

  for (const [ts, label, color] of sunEvents) {
    if (ts >= h0 && ts <= hLast) {
      const frac = (ts - h0) / (hLast - h0);
      const x = frac * canvas.width;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = "32px -apple-system, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(label, x + 6, 28);
    }
  }

  // Rain bars
  let rainMaxIdx = 0;
  for (let i = 0; i < hours.length; i++) {
    const rain = rains[i];
    const pop = hours[i].pop || 0;
    const barH = (rain / maxRain) * chartH;
    const popH = pop * chartH;

    if (pop > 0) {
      ctx.fillStyle = `rgba(91, 155, 247, ${pop * 0.15})`;
      ctx.fillRect(i * barW + 1, canvas.height - popH, barW - 2, popH);
    }
    if (rain > 0) {
      ctx.fillStyle = "rgba(91, 155, 247, 0.7)";
      ctx.fillRect(i * barW + 2, canvas.height - barH, barW - 4, barH);
    }
    if (rains[i] > rains[rainMaxIdx]) rainMaxIdx = i;
  }

  // Rain peak label (mm to inches)
  if (rains[rainMaxIdx] > 0) {
    const peakInches = (rains[rainMaxIdx] / 25.4).toFixed(2);
    const peakX = rainMaxIdx * barW + barW / 2;
    const peakBarH = (rains[rainMaxIdx] / maxRain) * chartH;
    const peakY = canvas.height - peakBarH;
    ctx.fillStyle = "rgba(91, 155, 247, 0.9)";
    ctx.font = "bold 18px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${peakInches}"`, peakX, peakY - 6);
  }

  // Temperature line
  const temps = hours.map(h => h.temp);
  const rawMinT = Math.min(...temps);
  const rawMaxT = Math.max(...temps);
  const minRange = 20;
  const actualRange = rawMaxT - rawMinT || 1;
  const padding = Math.max(0, (minRange - actualRange) / 2);
  const minT = rawMinT - padding;
  const maxT = rawMaxT + padding;
  const range = maxT - minT;

  function tempY(t) {
    return canvas.height - padBot - ((t - minT) / range) * chartH;
  }

  ctx.beginPath();
  ctx.strokeStyle = "#f5a623";
  ctx.lineWidth = 3;
  for (let i = 0; i < hours.length; i++) {
    const x = i * barW + barW / 2;
    const y = tempY(temps[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  function shadowText(text, x, y, color) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  // Current temp label at start of line
  ctx.font = "bold 28px -apple-system, sans-serif";
  ctx.textAlign = "left";
  const startTempY = tempY(temps[0]);
  shadowText(`${Math.round(temps[0])}°`, 6, startTempY + 6, "#f5a623");
  ctx.textAlign = "center";

  // Find high and low points and label them
  let maxIdx = 0, minIdx = 0;
  for (let i = 1; i < hours.length; i++) {
    if (temps[i] > temps[maxIdx]) maxIdx = i;
    if (temps[i] < temps[minIdx]) minIdx = i;
  }

  ctx.font = "bold 32px -apple-system, sans-serif";
  ctx.textAlign = "center";

  if (maxIdx > 0) {
    const highX = maxIdx * barW + barW / 2;
    const highY = tempY(temps[maxIdx]);
    ctx.fillStyle = "#f5a623";
    ctx.beginPath();
    ctx.arc(highX, highY, 6, 0, Math.PI * 2);
    ctx.fill();
    shadowText(`${Math.round(temps[maxIdx])}°`, highX, highY - 14, "#f5a623");
  }

  if (minIdx > 0) {
    const lowX = minIdx * barW + barW / 2;
    const lowY = tempY(temps[minIdx]);
    ctx.fillStyle = "#8ab4f8";
    ctx.beginPath();
    ctx.arc(lowX, lowY, 6, 0, Math.PI * 2);
    ctx.fill();
    shadowText(`${Math.round(temps[minIdx])}°`, lowX, lowY + 34, "#8ab4f8");
  }

  // Wind line
  const winds = hours.map(h => h.wind_speed);
  const maxW = Math.max(...winds) || 1;

  ctx.beginPath();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 6]);
  for (let i = 0; i < hours.length; i++) {
    const x = i * barW + barW / 2;
    const y = canvas.height - padBot - (winds[i] / maxW) * chartH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Current wind label at start of line
  const startWindY = canvas.height - padBot - (winds[0] / maxW) * chartH;
  ctx.font = "bold 26px -apple-system, sans-serif";
  ctx.textAlign = "left";
  shadowText(`${Math.round(winds[0])}`, 6, startWindY + 5, "rgba(255,255,255,0.4)");
  ctx.textAlign = "center";

  // Wind peak label
  let windMaxIdx = 0;
  for (let i = 1; i < hours.length; i++) {
    if (winds[i] > winds[windMaxIdx]) windMaxIdx = i;
  }
  if (windMaxIdx > 0) {
    const wmX = windMaxIdx * barW + barW / 2;
    const wmY = canvas.height - padBot - (winds[windMaxIdx] / maxW) * chartH;
    ctx.font = "bold 24px -apple-system, sans-serif";
    shadowText(`${Math.round(winds[windMaxIdx])}mph`, wmX, wmY - 10, "rgba(255,255,255,0.4)");
  }

  // Labels (every 3 hours)
  labelsEl.innerHTML = "";
  for (let i = 0; i < hours.length; i++) {
    const d = new Date(hours[i].dt * 1000);
    const show = i % 3 === 0;
    const hr = d.getHours();
    const label = hr === 0 ? "12a" : hr < 12 ? `${hr}a` : hr === 12 ? "12p" : `${hr - 12}p`;

    if (show) {
      labelsEl.innerHTML += `<span>${label}</span>`;
    } else {
      labelsEl.innerHTML += `<span></span>`;
    }
  }
}

async function loadWeatherUsage() {
  try {
    const res = await fetch("/api/weather-usage");
    const data = await res.json();
    document.getElementById("api-usage").textContent = `API: ${data.calls}/${data.limit}`;
  } catch (e) {}
}

loadWeather().then(loadWeatherUsage);
setInterval(() => loadWeather().then(loadWeatherUsage), 15 * 60 * 1000);

// ---- NYC Alternate Side Parking ----
async function loadParking() {
  try {
    const res = await fetch("/api/parking");
    const data = await res.json();
    const badge = document.getElementById("parking-badge");
    if (data.error) {
      badge.textContent = "ASP: --";
      badge.className = "";
      return;
    }
    if (data.suspended) {
      badge.textContent = "ASP Suspended";
      badge.className = "suspended";
    } else {
      badge.textContent = "ASP In Effect";
      badge.className = "in-effect";
    }
  } catch (e) {
    console.error("Parking error:", e);
  }
}

loadParking();
setInterval(loadParking, 30 * 60 * 1000);

// ---- NYC Subway Status ----
async function loadSubway() {
  try {
    const res = await fetch("/api/subway");
    const data = await res.json();
    if (data.error || !data.lines) return;

    const container = document.getElementById("subway-status");
    const bad = data.lines.filter(l => l.status === "Service Change");
    container.innerHTML = bad.map(line => {
      const textColor = line.textColor || "#fff";
      return `<div class="subway-line" style="background:${line.color};color:${textColor}" title="${line.name}: ${line.status}">${line.name}</div>`;
    }).join("");
  } catch (e) {
    console.error("Subway error:", e);
  }
}

loadSubway();
setInterval(loadSubway, 5 * 60 * 1000);

// ---- Countdowns ----
function renderCountdowns() {
  const container = document.getElementById("countdowns");
  if (!calendarEvents.length) return;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const personal = calendarEvents
    .filter(ev => ev.calendarName === "Tex Personal")
    .filter(ev => {
      const evDate = new Date(ev.start);
      return evDate >= today;
    })
    .slice(0, 5);

  if (!personal.length) { container.innerHTML = ""; return; }

  container.innerHTML = personal.map(ev => {
    const evDate = new Date(ev.start);
    const diff = Math.ceil((evDate - today) / (1000 * 60 * 60 * 24));
    const dayStr = diff === 0 ? "Today" : diff === 1 ? "1 day" : `${diff} days`;
    return `<div class="countdown-item"><span class="countdown-days">${dayStr}</span><span class="countdown-label">${escapeHtml(ev.summary)}</span></div>`;
  }).join("");
}

// ---- NYC School Lunch ----
async function loadLunch() {
  try {
    const res = await fetch("/api/lunch");
    const data = await res.json();
    const el = document.getElementById("lunch-menu");
    if (data.error || !data.items?.length) {
      el.innerHTML = "";
      return;
    }
    el.textContent = `Lunch: ${data.items.join(" · ")}`;
  } catch (e) {
    console.error("Lunch error:", e);
  }
}

loadLunch();
setInterval(loadLunch, 60 * 60 * 1000);

// ---- Pollen ----
const pollenColors = { 0: "#666", 1: "#4caf50", 2: "#ffc107", 3: "#ff9800", 4: "#ff5722", 5: "#d32f2f" };

function pollenIcon(type, color) {
  const s = `style="width:20px;height:20px;vertical-align:-3px;fill:${color}"`;
  if (type === "tree") return `<svg ${s} viewBox="0 0 24 24"><circle cx="12" cy="8" r="6"/><rect x="11" y="14" width="2" height="8"/><rect x="8" y="20" width="8" height="2" rx="1"/></svg>`;
  if (type === "grass") return `<svg ${s} viewBox="0 0 24 24"><path d="M7 22V12C7 9 5 7 3 5" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M12 22V8C12 5 10 3 8 1" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M17 22V12C17 9 19 7 21 5" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`;
  return `<svg ${s} viewBox="0 0 24 24"><path d="M12 22V10" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M12 14C9 11 5 11 4 13" stroke="${color}" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M12 11C15 8 19 8 20 10" stroke="${color}" stroke-width="1.5" fill="none" stroke-linecap="round"/><circle cx="12" cy="5" r="2" fill="${color}"/><circle cx="9" cy="3.5" r="1.2" fill="${color}" opacity=".7"/><circle cx="15" cy="3.5" r="1.2" fill="${color}" opacity=".7"/><circle cx="10" cy="6.5" r="1" fill="${color}" opacity=".6"/><circle cx="14" cy="6.5" r="1" fill="${color}" opacity=".6"/></svg>`;
}

function pollenBars(index, color) {
  const total = 5;
  const barW = 4;
  const gap = 2;
  const maxH = 18;
  const w = total * (barW + gap) - gap;
  let bars = "";
  for (let i = 0; i < total; i++) {
    const h = Math.round(((i + 1) / total) * maxH);
    const y = maxH - h;
    const fill = i < index ? color : "rgba(255,255,255,0.12)";
    bars += `<rect x="${i * (barW + gap)}" y="${y}" width="${barW}" height="${h}" rx="1" fill="${fill}"/>`;
  }
  return `<svg style="width:${w}px;height:${maxH}px;vertical-align:-3px" viewBox="0 0 ${w} ${maxH}">${bars}</svg>`;
}

async function loadPollen() {
  try {
    const res = await fetch("/api/pollen");
    const data = await res.json();
    const el = document.getElementById("wx-pollen");
    if (data.error) {
      el.textContent = "N/A";
      return;
    }

    const parts = [];
    for (const type of ["tree", "grass", "weed"]) {
      const t = data[type];
      if (!t || t.index == null) continue;
      const color = pollenColors[t.index] || "#666";
      parts.push(`${pollenIcon(type, color)}<span style="margin-left:3px">${pollenBars(t.index, color)}</span>`);
    }
    el.innerHTML = parts.length ? parts.join('<span style="margin:0 6px"></span>') : "N/A";
  } catch (e) {
    console.error("Pollen error:", e);
  }
}

loadPollen();
setInterval(loadPollen, 60 * 60 * 1000);

// ---- Calendar (month grid) ----
let calendarEvents = [];
let historicalWeather = {};
let aspSuspensionDates = new Set();

async function loadAspCalendar() {
  try {
    const res = await fetch("/api/parking-calendar");
    const data = await res.json();
    aspSuspensionDates = new Set(data.dates || []);
  } catch (e) {}
}

async function loadCalendar() {
  try {
    if (aspSuspensionDates.size === 0) await loadAspCalendar();
    const res = await fetch("/api/calendar");
    const data = await res.json();
    calendarEvents = data.events || [];
    await loadHistoricalWeather();
    renderCalendarGrid();
    renderCountdowns();
  } catch (e) {
    console.error("Calendar error:", e);
  }
}

async function loadHistoricalWeather() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayDay = today.getDay();
  const gridStart = new Date(today);
  gridStart.setDate(gridStart.getDate() - todayDay - 7);

  const fetches = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    const key = d.toLocaleDateString("en-CA");
    if (!dailyForecast[key]) {
      fetches.push(
        fetch(`/api/weather-history?date=${key}`)
          .then(r => r.json())
          .then(data => { historicalWeather[key] = data; })
          .catch(() => {})
      );
    }
  }
  await Promise.all(fetches);
}

function renderCalendarGrid() {
  const grid = document.getElementById("cal-grid");
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const todayDay = today.getDay();
  const currentWeekStart = new Date(today);
  currentWeekStart.setDate(currentWeekStart.getDate() - todayDay);
  const gridStart = new Date(currentWeekStart);
  gridStart.setDate(gridStart.getDate() - 7);

  const totalWeeks = 8;
  const totalDays = totalWeeks * 7;

  let html = "";

  const eventsByDate = {};
  for (const ev of calendarEvents) {
    const isAllDay = !ev.start.includes("T");
    const key = isAllDay ? ev.start : new Date(ev.start).toLocaleDateString("en-CA");
    if (!eventsByDate[key]) eventsByDate[key] = [];
    eventsByDate[key].push(ev);
  }

  for (let i = 0; i < totalDays; i++) {
    const cellDate = new Date(gridStart);
    cellDate.setDate(cellDate.getDate() + i);
    const isToday = cellDate.getTime() === today.getTime();
    const isPast = cellDate < today;
    const isOther = isPast && cellDate < currentWeekStart;
    const key = cellDate.toLocaleDateString("en-CA");
    const dayEvents = eventsByDate[key] || [];

    let classes = "cal-cell";
    if (isToday) classes += " today";
    if (isOther) classes += " other-month";

    const maxShow = 3;
    const shown = dayEvents.slice(0, maxShow);
    const extra = dayEvents.length - maxShow;

    const forecast = dailyForecast[key];
    const hist = historicalWeather[key];
    let weatherHtml = "";
    if (forecast) {
      weatherHtml = `<div class="cal-weather"><img src="https://openweathermap.org/img/wn/${forecast.icon}.png" alt=""><span>${forecast.high}°</span><span class="cal-weather-lo">${forecast.low}°</span></div>`;
    } else if (hist && hist.type === "recorded") {
      weatherHtml = `<div class="cal-weather cal-weather-hist"><img src="https://openweathermap.org/img/wn/${hist.data.icon}.png" alt=""><span>${Math.round(hist.data.high)}°</span><span class="cal-weather-lo">${Math.round(hist.data.low)}°</span></div>`;
    } else if (hist && hist.type === "average") {
      weatherHtml = `<div class="cal-weather cal-weather-avg"><span class="cal-avg-label">avg</span><span>${hist.data.avg_high}°</span><span class="cal-weather-lo">${hist.data.avg_low}°</span></div>`;
    }

    const dayNum = cellDate.getDate();
    const dayLabel = dayNum === 1 ? cellDate.toLocaleDateString("en-US", { month: "short" }) : dayNum;
    const aspDot = aspSuspensionDates.has(key) ? '<span class="asp-dot" title="ASP Suspended"></span>' : '';

    html += `<div class="${classes}">
      <div class="cal-day-header"><span class="cal-day-num">${dayLabel}${aspDot}</span>${weatherHtml}</div>
      ${shown.map(ev => {
        const t = new Date(ev.start);
        const timeStr = t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
        const color = ev.color || "#5b9bf7";
        const isAllDay = !ev.start.includes("T");
        const time = isAllDay ? "" : timeStr + " ";
        const isPersonal = ev.calendarName === "Tex Personal";
        const bg = isPersonal ? "var(--rainbow-bg)" : hexToRgba(color, 0.35);
        const border = isPersonal ? "none" : `3px solid ${color}`;
        const textCol = isPersonal ? "#fff" : lighten(color);
        return `<div class="cal-event${isPersonal ? " rainbow" : ""}" title="${escapeAttr(ev.summary)}" style="background:${bg};color:${textCol};border-left:${border}">${time}${escapeHtml(ev.summary)}</div>`;
      }).join("")}
      ${extra > 0 ? `<div class="cal-more">+${extra} more</div>` : ""}
    </div>`;
  }

  grid.innerHTML = html;
}

loadCalendar();
setInterval(loadCalendar, 5 * 60 * 1000);

// ---- Photos ----
let photos = [];
let photoIndex = 0;
let photoInterval = 30;

async function loadPhotoList() {
  try {
    const res = await fetch("/api/photos");
    const data = await res.json();
    photos = data.photos;
    if (photos.length > 0 && !document.getElementById("photo-current").src.includes("/photos/")) {
      document.getElementById("photo-current").src = photos[0];
    }
  } catch (e) {
    console.error("Photos error:", e);
  }
}

function cyclePhoto() {
  if (photos.length < 2) return;

  const current = document.getElementById("photo-current");
  const next = document.getElementById("photo-next");

  photoIndex = (photoIndex + 1) % photos.length;
  next.src = photos[photoIndex];

  next.onload = () => {
    next.style.opacity = 1;
    current.style.opacity = 0;

    setTimeout(() => {
      current.src = next.src;
      current.style.opacity = 1;
      next.style.opacity = 0;
    }, 2200);
  };
}

async function initPhotos() {
  try {
    const configRes = await fetch("/api/config");
    const cfg = await configRes.json();
    photoInterval = cfg.photoInterval || 30;
  } catch (e) {}

  await loadPhotoList();
  setInterval(cyclePhoto, photoInterval * 1000);
  setInterval(loadPhotoList, 5 * 60 * 1000);
}

initPhotos();

// ---- Util ----
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function lighten(hex) {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + 120);
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + 120);
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + 120);
  return `rgb(${r},${g},${b})`;
}
