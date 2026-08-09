/* =====================================================================
   NF Command Centre — front-end renderer (vanilla JS, no build step)
   Reads JSON from /data, renders sections, handles tabs + local tasks.
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = new Intl.NumberFormat("en-GB");
const BRIEF = {};   // shared data for the "Today" briefing card

async function loadJSON(path, fallback) {
  try { const r = await fetch(path + "?t=" + Date.now()); if (!r.ok) throw 0; return await r.json(); }
  catch { return fallback; }
}

/* ---------- Tabs ---------- */
$$(".tab").forEach(t => t.addEventListener("click", () => {
  $$(".tab").forEach(x => x.classList.remove("active"));
  $$(".panel-group").forEach(x => x.classList.remove("active"));
  t.classList.add("active");
  $("#" + t.dataset.target).classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}));

/* ---------- Clock ---------- */
function setDate() {
  $("#now-date").textContent = new Date().toLocaleDateString("en-GB",
    { weekday: "short", day: "numeric", month: "short" }).toUpperCase();
}

/* ---------- Weather + golden hour (free Open-Meteo, no key) ---------- */
async function loadWeather() {
  const { lat, lon, timezone, name } = CONFIG.location;
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + `&current=temperature_2m,weather_code&daily=sunrise,sunset&timezone=${encodeURIComponent(timezone)}`;
    const d = await (await fetch(u)).json();
    $("#wx-temp").textContent = Math.round(d.current.temperature_2m) + "°";
    $("#wx-meta").textContent = name + " · " + wxText(d.current.weather_code);
    const sr = new Date(d.daily.sunrise[0]), ss = new Date(d.daily.sunset[0]);
    const t = x => x.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    $("#golden-times").textContent = `${t(sr)} / ${t(ss)}`;
  } catch { $("#wx-meta").textContent = CONFIG.location.name; }
}
function wxText(c){const m={0:"Clear",1:"Clear",2:"Cloudy",3:"Overcast",45:"Fog",61:"Rain",63:"Rain",
  65:"Heavy rain",71:"Snow",80:"Showers",95:"Storm"};return m[c]||"—";}

/* ---------- Fitness / Garmin ---------- */
function renderGarmin(g) {
  if (!g || !g.daily) return;
  const d = g.daily;
  const set = (id, v, suffix = "") => { const el = $("#" + id); if (el && v != null) el.textContent = v + suffix; };

  // Overview cards
  const bb = $("#ov-bodybattery");
  if (d.bodyBatteryHigh != null) bb.querySelector(".big").textContent = `${d.bodyBatteryHigh}/${d.bodyBatteryLow ?? "--"}`;
  if (d.sleepHours != null) $("#ov-sleep .big").textContent = d.sleepHours + "h";
  if (d.steps != null) $("#ov-steps .big").textContent = fmt.format(d.steps);
  if (d.hrv != null) $("#ov-hrv .big").textContent = d.hrv;

  set("f-rhr", d.restingHR);
  set("f-stress", d.stress);

  renderTrends(g.history);

  // Readiness ring + advice.
  // Stale data is worse than no data: an old number silently reads as today's.
  // (A broken sync served June's figures behind a green tick for eight weeks.)
  const daysOld = d.date ? Math.round((new Date().setHours(0,0,0,0) - new Date(d.date + "T00:00:00")) / 86400000) : null;
  const stale = daysOld == null || daysOld > 1;

  const score = d.readiness ?? d.bodyBatteryHigh ?? null;
  if (score != null && !stale) {
    $("#rb-ring").style.setProperty("--p", score);
    $("#rb-score").textContent = score;
    const { highThreshold: hi, lowThreshold: lo } = CONFIG.readiness;
    let title, advice, type;
    if (score >= hi) { title = "Primed"; type = "push"; advice = "Body Battery high — good day to push. Heavy compound session below."; }
    else if (score <= lo) { title = "Recover"; type = "recovery"; advice = "Low reserves. Keep it light: mobility, walk, easy accessories."; }
    else { title = "Steady"; type = "moderate"; advice = "Moderate readiness. Solid working session, leave a rep in the tank."; }
    $("#rb-title").textContent = title;
    $("#rb-advice").textContent = advice;
    // Say what the number actually is. The Instinct doesn't report Garmin's
    // Training Readiness, so this is usually Body Battery peak so far today.
    $("#rb-source").textContent = d.readinessSource === "bodyBattery"
      ? "Body Battery peak today · Instinct doesn't report Training Readiness"
      : "Garmin Training Readiness";
    BRIEF.readiness = { title, advice };
    renderWorkout(type);
  } else if (stale) {
    $("#rb-score").textContent = "—";
    $("#rb-title").textContent = "No fresh data";
    $("#rb-advice").textContent = daysOld == null
      ? "Garmin hasn't synced yet."
      : `Last Garmin sync was ${daysOld} days ago — not showing a stale number.`;
    $("#rb-source").textContent = "";
  }

}

/* ---------- 30-day trends -------------------------------------------
   One series per chart, so no legend — the card heading names it.
   Goal lines are neutral, not a second data colour, so the only hue on
   the plot is the series itself.
   Charts are drawn as inline SVG in a fixed viewBox and scaled by CSS;
   strokes use vector-effect so they stay 2px at any width.
--------------------------------------------------------------------- */
const CHART = { w: 320, h: 88, padT: 10, padB: 14 };

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function shortDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Shared scaffolding: scales, neutral goal line, hover targets, tooltip. */
function chartFrame(rows, { value, goal, fmtValue, label, labelKey }) {
  const { w, h, padT, padB } = CHART;
  const plotH = h - padT - padB;
  const vals = rows.map(value).filter(v => v != null);
  if (!vals.length) return null;

  // Include the goal so the line is never off-canvas.
  let lo = Math.min(...vals, goal ?? Infinity);
  let hi = Math.max(...vals, goal ?? -Infinity);
  if (hi === lo) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;

  const x = i => (i + 0.5) * (w / rows.length);
  const y = v => padT + plotH - ((v - lo) / (hi - lo)) * plotH;

  // Weekday charts pass labelKey ("Mon"); date charts fall back to the ISO date.
  const rowLabel = r => labelKey ? r[labelKey] : shortDate(r.date);

  const hover = rows.map((r, i) => {
    const v = value(r);
    if (v == null) return "";
    return `<rect class="ch-hit" x="${i * (w / rows.length)}" y="0" width="${w / rows.length}" height="${h}"
      data-label="${esc(rowLabel(r))}" data-value="${esc(fmtValue(v))}"></rect>`;
  }).join("");

  // Put the goal label on whichever end has the shorter marks, so it can't
  // land on top of the data. (It collided with the tall bars when pinned right.)
  const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
  const head = mean(rows.slice(0, 6).map(value).filter(v => v != null));
  const tail = mean(rows.slice(-6).map(value).filter(v => v != null));
  const labelLeft = head <= tail;

  const goalLine = goal == null ? "" :
    `<line class="ch-goal" x1="0" x2="${w}" y1="${y(goal)}" y2="${y(goal)}"></line>
     <text class="ch-goal-label" x="${labelLeft ? 2 : w - 2}" y="${y(goal) - 4}"
       text-anchor="${labelLeft ? "start" : "end"}">${esc(label)}</text>`;

  return { w, h, x, y, hover, goalLine, vals };
}

function barChart(el, rows, opts) {
  const f = chartFrame(rows, opts);
  if (!f) { el.innerHTML = '<p class="muted">No data yet.</p>'; return; }
  const bw = (f.w / rows.length) - 2;               // 2px surface gap between bars
  const base = CHART.h - CHART.padB;

  const bars = rows.map((r, i) => {
    const v = opts.value(r);
    if (v == null) return "";
    const yy = f.y(v);
    // Every bar the same. Dimming the below-goal days rendered each day as
    // pass/fail, which is the framing that turns a missed threshold into
    // "why bother" — the goal line already shows where the mark is.
    return `<rect class="ch-bar" x="${i * (f.w / rows.length) + 1}" y="${yy}"
      width="${bw}" height="${Math.max(1, base - yy)}" rx="2"></rect>`;
  }).join("");

  el.innerHTML = svgWrap(f, bars + f.goalLine + f.hover);
  attachTooltip(el);
}

function lineChart(el, rows, opts) {
  const f = chartFrame(rows, opts);
  if (!f) { el.innerHTML = '<p class="muted">No data yet.</p>'; return; }

  const pts = rows.map((r, i) => [i, opts.value(r)]).filter(p => p[1] != null);
  const d = pts.map(([i, v], n) => `${n ? "L" : "M"}${f.x(i).toFixed(1)},${f.y(v).toFixed(1)}`).join("");
  const area = `${d}L${f.x(pts[pts.length - 1][0]).toFixed(1)},${CHART.h - CHART.padB}L${f.x(pts[0][0]).toFixed(1)},${CHART.h - CHART.padB}Z`;

  // Direct-label the latest point only — never a number on every point.
  const [li, lv] = pts[pts.length - 1];
  const marker = `<circle class="ch-dot" cx="${f.x(li)}" cy="${f.y(lv)}" r="3"></circle>
    <text class="ch-last" x="${f.x(li) - 6}" y="${f.y(lv) - 6}" text-anchor="end">${esc(opts.fmtValue(lv))}</text>`;

  el.innerHTML = svgWrap(f, `<path class="ch-area" d="${area}"></path><path class="ch-line" d="${d}"></path>` + f.goalLine + marker + f.hover);
  attachTooltip(el);
}

function svgWrap(f, inner) {
  return `<svg viewBox="0 0 ${f.w} ${f.h}" preserveAspectRatio="none" role="img">${inner}</svg>
    <div class="ch-tip" hidden></div>`;
}

function attachTooltip(el) {
  const tip = el.querySelector(".ch-tip");
  el.querySelectorAll(".ch-hit").forEach(hit => {
    const show = e => {
      tip.textContent = `${hit.dataset.label} · ${hit.dataset.value}`;
      tip.hidden = false;
      const box = el.getBoundingClientRect();
      const p = e.touches ? e.touches[0] : e;
      tip.style.left = Math.min(Math.max(p.clientX - box.left, 40), box.width - 40) + "px";
    };
    hit.addEventListener("mouseenter", show);
    hit.addEventListener("mousemove", show);
    hit.addEventListener("touchstart", show, { passive: true });
    hit.addEventListener("mouseleave", () => { tip.hidden = true; });
  });
}

/* =====================================================================
   PERSONAL BASELINE — the spine of the whole dashboard.

   No invented composite score. A review of 14 readiness/recovery scores
   across 10 manufacturers found none disclosed their weighting and none
   were validated, so adding a fifteenth on top of Garmin's noisy HRV
   would just be more unfalsifiable arithmetic.

   Instead: is today normal FOR HIM, or not. Median and IQR over a
   trailing window, and a metric only speaks when it leaves the band.
   ===================================================================== */
const BASELINE_DAYS = 60;

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, base = Math.floor(pos), rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

/** Median + interquartile band for a metric, excluding today. */
function baselineFor(history, key, excludeDate) {
  const vals = history
    .filter(h => h.date !== excludeDate && h[key] != null)
    .slice(-BASELINE_DAYS)
    .map(h => h[key])
    .sort((a, b) => a - b);
  if (vals.length < 14) return null;         // too little to call anything normal
  return { median: quantile(vals, 0.5), lo: quantile(vals, 0.25), hi: quantile(vals, 0.75), n: vals.length };
}

/* ---------- "What changed" — and, most days, nothing -----------------
   A dashboard that is quiet most of the time gets believed when it does
   speak. Scores pinned at one end for weeks, and insight cards that fire
   on ordinary days, are the two most-resented patterns in this market.
--------------------------------------------------------------------- */
const CHANGE_METRICS = [
  { key: "sleepHours",      label: "Sleep",        unit: "h",   fmt: v => `${v.toFixed(1)}h`, dp: 1 },
  { key: "restingHR",       label: "Resting HR",   unit: " bpm", fmt: v => `${Math.round(v)} bpm`, dp: 0 },
  { key: "steps",           label: "Steps",        unit: "",    fmt: v => fmt.format(Math.round(v)), dp: 0 },
  { key: "bodyBatteryPeak", label: "Body Battery", unit: "",    fmt: v => `${Math.round(v)}`, dp: 0 },
];

function renderWhatChanged(history) {
  const card = $("#changed-card");
  if (!card || !Array.isArray(history) || history.length < 20) return;

  const today = history[history.length - 1];
  if (!today) return;

  const notable = [];
  for (const m of CHANGE_METRICS) {
    const v = today[m.key];
    if (v == null) continue;
    const b = baselineFor(history, m.key, today.date);
    if (!b) continue;
    if (v < b.lo || v > b.hi) {
      const diff = v - b.median;
      notable.push({ ...m, v, median: b.median, diff, size: Math.abs(diff) / (b.hi - b.lo || 1) });
    }
  }

  if (!notable.length) {
    $("#wc-state").textContent = "nothing to flag";
    $("#wc-line").textContent =
      "Everything sitting inside your normal range for the last two months.";
    card.hidden = false;
    return;
  }

  notable.sort((a, b) => b.size - a.size);
  const say = notable.slice(0, 2).map(n => {
    const dir = n.diff > 0 ? "above" : "below";
    const mag = n.dp ? Math.abs(n.diff).toFixed(n.dp) : fmt.format(Math.round(Math.abs(n.diff)));
    return `${n.label} ${n.fmt(n.v)}, ${mag}${n.unit} ${dir} your usual ${n.fmt(n.median)}`;
  });

  $("#wc-state").textContent = `${notable.length} outside normal`;
  // Task-level and factual. No "you missed", no praise, no exclamation marks:
  // feedback that turns attention to the self degrades performance about a
  // third of the time (Kluger & DeNisi, 607 effect sizes).
  $("#wc-line").textContent = say.join(". ") + ".";
  card.hidden = false;
}

/* ---------- Sleep regularity ----------------------------------------
   The strongest-evidenced sleep construct available, and the one his data
   actually speaks to: regular sleepers had ~38% lower incident depression
   and ~33% lower anxiety than irregular ones (n=79,666, ~7.5y follow-up),
   and — the part that matters here — irregular sleepers who DID meet
   duration guidelines still carried ~48% higher depression risk. His 7.3h
   average doesn't buy him out of a three-hour wake swing.

   Proper SRI needs epoch-by-epoch data. Sleep-midpoint drift over 14 days
   is the honest proxy from what Garmin gives us, and it's the thing he can
   actually move. Observational evidence — association, not proof.
--------------------------------------------------------------------- */
function renderRegularity(history) {
  const card = $("#regularity-card");
  if (!card || !Array.isArray(history)) return;

  const nights = history.filter(h => h.bedMin != null && h.wakeMin != null).slice(-14);
  if (nights.length < 7) return;

  // Midpoint of each night, on the 18:00-anchored axis so a 00:30 bedtime
  // sits after 23:00 rather than 23.5 hours before it.
  const mids = nights.map(h => {
    const bed = (h.bedMin - 18 * 60 + 1440) % 1440;
    let wake = (h.wakeMin - 18 * 60 + 1440) % 1440;
    if (wake < bed) wake += 1440;
    return (bed + (wake - bed) / 2) % 1440;
  });

  const mean = mids.reduce((a, b) => a + b, 0) / mids.length;
  const sd = Math.sqrt(mids.reduce((s, m) => s + (m - mean) ** 2, 0) / mids.length);
  const hours = sd / 60;

  const band = hours <= 0.5 ? "very consistent"
    : hours <= 1 ? "consistent"
    : hours <= 1.5 ? "moderately variable"
    : "variable";

  $("#sr-value").textContent = `±${hours.toFixed(1)}h`;
  $("#sr-band").textContent = band;
  $("#sr-sub").textContent = `drift in your sleep midpoint · last ${nights.length} nights`;

  const wakes = nights.map(h => h.wakeMin).sort((a, b) => a - b);
  const spread = (wakes[wakes.length - 1] - wakes[0]) / 60;
  $("#sr-read").innerHTML =
    `Your bedtime barely moves, so this is almost entirely wake time — a ${spread.toFixed(1)}h range across these nights. ` +
    `Regularity tracks better with mood and long-term health than total hours do, and hitting 7-9h doesn't offset an irregular schedule. ` +
    `<em>Observational evidence — an association, not a proven cause.</em>`;

  card.hidden = false;
}

/* ---------- Evening check-in ----------------------------------------
   The watch cannot measure how he actually feels: across 39 people over
   three months, self-reported stress had no association with overnight
   HRV, and feeling energised went with LOWER HRV. A 56-study review found
   subjective and objective wellbeing measures generally don't correlate,
   with the subjective ones tracking load better. So this is an
   independent signal, not a soft copy of the Garmin data.

   Five verbally-anchored levels (reliability plateaus around 5-7 and raw
   numeric sliders do worse), two items only — item count is what kills
   completion, not prompt count — and the day replayed back first, which
   raised completion by ~28 points versus in-the-moment logging.
--------------------------------------------------------------------- */
const CHECKIN_KEY = "nf.checkins";
const SCALES = {
  energy: ["Drained", "Low", "OK", "Good", "Firing"],
  body:   ["Sore/rough", "Stiff", "Fine", "Strong", "Great"],
};

const loadCheckins = () => { try { return JSON.parse(localStorage.getItem(CHECKIN_KEY)) || {}; } catch { return {}; } };
const saveCheckins = c => localStorage.setItem(CHECKIN_KEY, JSON.stringify(c));

function renderCheckin(history, calendar) {
  const card = $("#checkin-card"); if (!card) return;
  const today = todayISO();
  const all = loadCheckins();
  const entry = all[today] || {};

  // Replay the day back before asking him to rate it.
  const day = (history || []).find(h => h.date === today);
  const fixture = ((calendar && calendar.past) || []).concat((calendar && calendar.matches) || [])
    .find(m => (m.start || "").slice(0, 10) === today);
  const ctx = [];
  if (fixture) ctx.push(fixture.title.trim());
  if (day?.steps != null) ctx.push(`${fmt.format(day.steps)} steps`);
  if (day?.sleepHours != null) ctx.push(`${day.sleepHours}h sleep`);
  $("#ci-context").textContent = ctx.length ? ctx.join(" · ") : "";

  card.querySelectorAll(".ci-scale").forEach(el => {
    const field = el.dataset.field;
    el.innerHTML = SCALES[field].map((label, i) =>
      `<button class="ci-opt ${entry[field] === i + 1 ? "on" : ""}" data-field="${field}" data-v="${i + 1}">${label}</button>`
    ).join("");
    el.querySelectorAll(".ci-opt").forEach(b => b.addEventListener("click", () => {
      const c = loadCheckins();
      c[today] = { ...(c[today] || {}), [b.dataset.field]: Number(b.dataset.v), at: Date.now() };
      saveCheckins(c);
      renderCheckin(history, calendar);
    }));
  });

  const note = $("#ci-note");
  note.value = entry.note || "";
  note.onchange = () => {
    const c = loadCheckins();
    c[today] = { ...(c[today] || {}), note: note.value.trim(), at: Date.now() };
    saveCheckins(c);
  };

  const done = entry.energy != null || entry.body != null;
  $("#ci-saved").textContent = done ? "Saved for today" : "Not logged yet";

  const logged = Object.keys(all).filter(d => {
    const age = (Date.now() - new Date(d + "T00:00:00Z")) / 864e5;
    return age >= 0 && age < 30;
  }).length;
  $("#ci-coverage").textContent = logged ? `${logged} of last 30 days` : "new";

  // Browser storage can be evicted with no warning, and losing months of
  // logs is a documented way projects like this die. One tap, whole file.
  $("#ci-export").onclick = () => {
    const blob = new Blob([JSON.stringify({
      checkins: loadCheckins(), gym: loadGym(), habits: loadH(),
      exported: new Date().toISOString(),
    }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `nf-dashboard-backup-${today}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
}

/* ---------- Stress & recovery ----------------------------------------
   The one stream that speaks to mental load rather than movement, and it
   was going unused. Garmin's bands are 0-25 rest, 26-50 low, 51-75
   medium, 76-100 high; the day-composition bar uses a sequential ramp of
   ONE hue so it reads as an intensity scale, not four categories.
   Deliberately no interpretation of what the numbers mean about his life
   — a wrist sensor is not a diagnosis.
--------------------------------------------------------------------- */
const STRESS_BANDS = [
  { key: "restMin", label: "Rest",   cls: "b1" },
  { key: "lowMin",  label: "Low",    cls: "b2" },
  { key: "medMin",  label: "Medium", cls: "b3" },
  { key: "highMin", label: "High",   cls: "b4" },
];

/* Rewritten after reading the validation literature. The first version of
   this card showed a daily "stress" headline and the line "Garmin rated 10 of
   11 days stressful". That should not have shipped:

   · Against subjective stress the Garmin score is close to useless —
     marginal R² 0.085, conditional R² 0.001 in n=781 (Stress & Health, 2025).
   · It tracks *positive* high-arousal states too; "excited" and "enthusiastic"
     score the same as distress. The paper's authors call the name misleading.
   · Nick's readings are inflated by things that aren't mood at all: he records
     no workouts, so nothing is excluded from scoring; he works on his feet
     carrying gear; and Maltese heat depresses HRV on its own.
   · Showing someone a daily verdict changes how they feel about the day even
     when the number is fake (Gavriloff 2018, sham feedback, N=63).

   So: no daily verdict, no "stressful" label, no band composition presented as
   fact. A 7-day rolling mean against his own baseline, the caveat inline, and
   collapsible so he can dismiss it for good. */
const STRESS_COLLAPSE_KEY = "nf.stressCollapsed";

function renderStress(history) {
  const card = $("#stress-card");
  if (!card || !Array.isArray(history)) return;

  const all = history.filter(h => h.stressAvg != null);
  if (all.length < 7) return;                  // never judge a short run

  // 7-day rolling mean — a single day is noise, not signal.
  const rolled = all.map((h, i) => {
    const w = all.slice(Math.max(0, i - 6), i + 1);
    return { date: h.date, avg: w.reduce((s, x) => s + x.stressAvg, 0) / w.length };
  }).slice(-TREND_DAYS);

  const baseline = all.reduce((s, h) => s + h.stressAvg, 0) / all.length;
  const recent = rolled[rolled.length - 1].avg;
  const delta = recent - baseline;

  $("#st-today").textContent = Math.abs(delta) < 1.5
    ? "in line with your baseline"
    : `${delta > 0 ? "+" : ""}${delta.toFixed(0)} vs your baseline`;

  lineChart($("#ch-stress"), rolled, {
    value: r => r.avg,
    fmtValue: v => v.toFixed(0),
  });

  // Hours at rest is the better-behaved half of this data — it's a duration,
  // not a proprietary score — so it stays, framed as recovery time.
  barChart($("#ch-rest"), all.slice(-TREND_DAYS), {
    value: h => h.restMin != null ? h.restMin / 60 : null,
    fmtValue: v => `${v.toFixed(1)}h`,
  });

  const avgRest = all.reduce((s, h) => s + (h.restMin || 0), 0) / all.length / 60;
  $("#st-read").innerHTML =
    `Averaging ${avgRest.toFixed(1)}h a day where your heart rate variability looks settled.` +
    (all.length < 25 ? ` Building history — ${all.length} days so far.` : "");

  // Collapsible, and it remembers. If this reads as pressure rather than
  // information, it should be possible to shut it permanently.
  const toggle = $("#st-toggle");
  const body = $("#st-body");
  const apply = collapsed => {
    body.hidden = collapsed;
    toggle.textContent = collapsed ? "show" : "hide";
    toggle.setAttribute("aria-expanded", String(!collapsed));
  };
  apply(localStorage.getItem(STRESS_COLLAPSE_KEY) === "1");
  toggle.onclick = () => {
    const next = !body.hidden;
    localStorage.setItem(STRESS_COLLAPSE_KEY, next ? "1" : "0");
    apply(next);
  };

  card.hidden = false;
}

/* ---------- Tonight: when to be asleep -------------------------------
   Deliberately NOT a prediction of how fresh he'll feel. Checked against
   88 night->morning pairs: correlation between sleep duration and the
   next day's Body Battery is +0.01, and with resting HR +0.04. There is
   no signal in his data to predict from, so this card does arithmetic
   and says so — target duration, counted back from when he actually has
   to be up. Recomputed on every load, so it is current whenever opened.
--------------------------------------------------------------------- */
function medianWake(history, weekdayIdx, limit = 8) {
  const vals = history
    .filter(h => h.wakeMin != null &&
      (new Date(h.date + "T00:00:00Z").getUTCDay() + 6) % 7 === weekdayIdx)
    .slice(-limit)
    .map(h => h.wakeMin)
    .sort((a, b) => a - b);
  if (!vals.length) return null;
  const m = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2;
}

function renderTonight(history, calendar) {
  const card = $("#tonight-card");
  if (!card || !Array.isArray(history) || history.length < 14) return;

  const target = CONFIG.goals?.sleepHours ?? 7.5;
  const ONSET = 15;                       // minutes to actually fall asleep

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tmwIdx = (tomorrow.getDay() + 6) % 7;
  const tmwISO = tomorrow.toISOString().slice(0, 10);

  // A fixed wake time in config beats the observed pattern: Mon-Wed he has to
  // be up at 05:00 for an early work start, which is earlier than Garmin's
  // recorded sleep-end (it logs when he actually stopped sleeping, not the alarm).
  const dayKey = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][tmwIdx];
  const fixed = (CONFIG.wakeTimes || {})[dayKey];
  const fixedMin = fixed ? Number(fixed.slice(0, 2)) * 60 + Number(fixed.slice(3, 5)) : null;

  const defaultWake = fixedMin ?? medianWake(history, tmwIdx);
  if (defaultWake == null) return;

  const round15 = m => (Math.round(m / 15) * 15) % 1440;
  const SLEEP_MIN = target * 60;

  // Either end can be the one he sets, and the other follows. Overrides are
  // keyed to tomorrow's date so they expire on their own — a late night on
  // Saturday shouldn't quietly become the new Monday plan.
  const OVERRIDE_KEY = "nf.tonight";
  const readOverride = () => {
    try {
      const o = JSON.parse(localStorage.getItem(OVERRIDE_KEY));
      return o && o.for === tmwISO ? o : null;
    } catch { return null; }
  };

  const fill = (sel, selected) => {
    sel.innerHTML = "";
    for (let m = 0; m < 1440; m += 15) {
      const o = document.createElement("option");
      o.value = m;
      o.textContent = clock(m);
      if (m === selected) o.selected = true;
      sel.appendChild(o);
    }
  };

  const lightsSel = $("#tn-lights"), wakeSel = $("#tn-wake");

  function paint(wake, lightsOut, source) {
    fill(wakeSel, round15(wake));
    fill(lightsSel, round15(lightsOut));

    const asleepBy = (lightsOut + ONSET) % 1440;
    const actual = ((wake - asleepBy) + 1440) % 1440;
    const h = Math.floor(actual / 60), mm = actual % 60;
    $("#tn-duration").textContent =
      `${h}h${mm ? ` ${mm}m` : ""} asleep · allowing ${ONSET} min to drop off`;

    $("#tn-reset").hidden = source === "default";

    const dayName = DAY_NAMES[tmwIdx];
    const why = [];
    if (source === "default") {
      why.push(fixedMin != null
        ? `${dayName} you're up at ${clock(defaultWake)} for work.`
        : `${dayName} you're typically up at ${clock(round15(defaultWake))}.`);
    } else {
      why.push(`Set by hand for tomorrow${source === "lights" ? " from bedtime" : ""}.`);
    }
    why.push(`Asleep by ${clock(round15(asleepBy))} gives you ${h}h${mm ? ` ${mm}m` : ""}.`);

    // Honest about the size of the ask rather than printing a time as if easy.
    const recent = history.filter(x => x.bedMin != null &&
      (new Date(x.date + "T00:00:00Z").getUTCDay() + 6) % 7 === tmwIdx).slice(-8);
    if (recent.length >= 3) {
      const usual = circMean(recent.map(x => x.bedMin));
      const shift = ((usual - asleepBy) + 1440) % 1440;
      if (shift > 20 && shift < 300) {
        why.push(`You normally fall asleep around ${clock(round15(usual))} on a ${dayName}, so that's ${Math.round(shift)} min earlier — worth moving in 20-min steps rather than all at once.`);
      }
    }

    const fixture = ((calendar && calendar.matches) || [])
      .find(m => (m.start || "").slice(0, 10) === tmwISO);
    if (fixture) why.push(`You're shooting ${fixture.title.trim()} tomorrow.`);
    if (debt > 1.5) why.push(`You're carrying ${debt.toFixed(1)}h of deficit against your own ${target}h target.`);

    $("#tn-why").textContent = why.join(" ");
  }

  // Sleep debt against his own target, last 7 nights.
  const last7 = history.slice(-7).filter(h => h.sleepHours != null);
  const debt = last7.reduce((s, h) => s + (target - h.sleepHours), 0);
  $("#tn-debt").textContent = last7.length < 7 ? "—"
    : debt > 0.5 ? `${debt.toFixed(1)}h behind this week`
    : debt < -0.5 ? `${Math.abs(debt).toFixed(1)}h ahead this week`
    : "on target this week";

  const defaultLights = ((defaultWake - SLEEP_MIN - ONSET) + 2880) % 1440;
  const saved = readOverride();
  paint(saved ? saved.wake : defaultWake,
        saved ? saved.lights : defaultLights,
        saved ? saved.source : "default");

  // Move the wake time -> bedtime follows. Move the bedtime -> wake follows.
  wakeSel.onchange = () => {
    const wake = Number(wakeSel.value);
    const lights = ((wake - SLEEP_MIN - ONSET) + 2880) % 1440;
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify({ for: tmwISO, wake, lights, source: "wake" }));
    paint(wake, lights, "wake");
  };
  lightsSel.onchange = () => {
    const lights = Number(lightsSel.value);
    const wake = (lights + ONSET + SLEEP_MIN) % 1440;
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify({ for: tmwISO, wake, lights, source: "lights" }));
    paint(wake, lights, "lights");
  };
  $("#tn-reset").onclick = () => {
    localStorage.removeItem(OVERRIDE_KEY);
    paint(defaultWake, defaultLights, "default");
  };

  card.hidden = false;
}

/* ---------- Sleep by weekday -----------------------------------------
   Clock times need circular means: the average of 23:50 and 00:10 is
   00:00, not 12:00. A plain arithmetic mean put "bedtime" at 16:00 and
   reported a 17-hour standard deviation.
--------------------------------------------------------------------- */
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function circMean(minutes) {
  if (!minutes.length) return null;
  const ang = minutes.map(m => (m / 1440) * 2 * Math.PI);
  const x = ang.reduce((s, a) => s + Math.cos(a), 0) / ang.length;
  const y = ang.reduce((s, a) => s + Math.sin(a), 0) / ang.length;
  return ((Math.atan2(y, x) / (2 * Math.PI)) * 1440 + 1440) % 1440;
}

const clock = m => m == null ? "—"
  : `${String(Math.floor(Math.round(m) / 60) % 24).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}`;

function renderWeekday(history) {
  const card = $("#weekday-card");
  if (!card || !Array.isArray(history) || history.length < 21) return;

  const buckets = DAY_NAMES.map(() => ({ dur: [], bed: [], wake: [] }));
  history.forEach(h => {
    if (h.sleepHours == null) return;
    // getUTCDay on a UTC-parsed date: 0=Sun, so shift to Mon-first.
    const idx = (new Date(h.date + "T00:00:00Z").getUTCDay() + 6) % 7;
    buckets[idx].dur.push(h.sleepHours);
    if (h.bedMin != null) buckets[idx].bed.push(h.bedMin);
    if (h.wakeMin != null) buckets[idx].wake.push(h.wakeMin);
  });

  const rows = DAY_NAMES.map((name, i) => ({
    date: name,                                   // chartFrame labels off .date
    day: name,
    n: buckets[i].dur.length,
    sleepHours: buckets[i].dur.length
      ? buckets[i].dur.reduce((a, b) => a + b, 0) / buckets[i].dur.length : null,
    bed: circMean(buckets[i].bed),
    wake: circMean(buckets[i].wake),
  }));
  if (rows.every(r => r.sleepHours == null)) return;

  const goal = CONFIG.goals?.sleepHours ?? null;
  barChart($("#ch-weekday"), rows, {
    value: r => r.sleepHours,
    goal,
    fmtValue: v => `${v.toFixed(1)}h`,
    label: goal ? `${goal}h target` : "",
    labelKey: "day",
  });

  $("#wd-table").innerHTML =
    `<table class="md wd"><tr><th></th>${rows.map(r => `<th>${r.day}</th>`).join("")}</tr>` +
    `<tr><th>Asleep</th>${rows.map(r => `<td>${clock(r.bed)}</td>`).join("")}</tr>` +
    `<tr><th>Woke</th>${rows.map(r => `<td>${clock(r.wake)}</td>`).join("")}</tr></table>`;

  const withSleep = rows.filter(r => r.sleepHours != null);
  const best = withSleep.reduce((a, b) => b.sleepHours > a.sleepHours ? b : a);
  const worst = withSleep.reduce((a, b) => b.sleepHours < a.sleepHours ? b : a);
  $("#wd-spread").textContent = `${(best.sleepHours - worst.sleepHours).toFixed(1)}h spread`;

  // Is the variation coming from bedtime or wake time?
  // Measure spread on an axis anchored at 18:00, so a 00:08 bedtime sits just
  // after 23:53 rather than 23h45m "before" it. Raw min/max on clock minutes
  // reported a 23.7h bedtime range and silently suppressed this sentence.
  const fromEvening = m => (m - 18 * 60 + 1440) % 1440;
  const toClock = s => (s + 18 * 60) % 1440;
  const spreadOf = a => {
    const s = a.map(fromEvening).sort((p, q) => p - q);
    return { range: s[s.length - 1] - s[0], first: toClock(s[0]), last: toClock(s[s.length - 1]) };
  };

  const beds = rows.map(r => r.bed).filter(v => v != null);
  const wakes = rows.map(r => r.wake).filter(v => v != null);
  let read = `${worst.day} is your shortest night at ${worst.sleepHours.toFixed(1)}h; ${best.day} your longest at ${best.sleepHours.toFixed(1)}h.`;
  if (beds.length === 7 && wakes.length === 7) {
    const b = spreadOf(beds), w = spreadOf(wakes);
    if (w.range > b.range) {
      read += ` Your bedtime barely moves (${clock(b.first)}–${clock(b.last)}, ${(b.range / 60).toFixed(1)}h of drift) — it's the <em>wake</em> time that swings, by ${(w.range / 60).toFixed(1)}h.`;
    }
  }
  $("#wd-read").innerHTML = read;
  card.hidden = false;
}

/* ---------- Matchday impact ------------------------------------------
   The one thing this app can do that nothing else can: it holds both the
   fixture list and the body data. Compare shoot days, the day after, and
   ordinary days. Presented as a table on purpose — four metrics across
   three groups is a comparison to read, not a shape to see.
--------------------------------------------------------------------- */
const METRICS = [
  { key: "sleepHours",      label: "Sleep",         fmt: v => `${v.toFixed(1)}h`,             better: "high" },
  { key: "steps",           label: "Steps",         fmt: v => fmt.format(Math.round(v)),      better: "high" },
  { key: "restingHR",       label: "Resting HR",    fmt: v => `${Math.round(v)}`,             better: "low"  },
  { key: "bodyBatteryPeak", label: "Body Battery",  fmt: v => `${Math.round(v)}`,             better: "high" },
];

// All UTC. Parsing as local midnight and formatting with toISOString() shifts
// back by Malta's offset and returns the SAME date — which silently made every
// "day after" collide with its own matchday and emptied the group.
const nextDay = iso => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

function renderMatchday(history, calendar) {
  const card = $("#matchday-card");
  if (!card || !Array.isArray(history) || !history.length) return;

  const past = (calendar && calendar.past) || [];
  if (!past.length) return;

  const byDate = Object.fromEntries(history.map(h => [h.date, h]));
  const matchDays = new Set(past.map(m => (m.start || "").slice(0, 10)).filter(Boolean));
  const afterDays = new Set([...matchDays].map(nextDay));

  const groups = [
    { name: "Matchday",  rows: [...matchDays].filter(d => byDate[d]).map(d => byDate[d]) },
    { name: "Day after", rows: [...afterDays].filter(d => byDate[d] && !matchDays.has(d)).map(d => byDate[d]) },
    { name: "Ordinary",  rows: history.filter(h => !matchDays.has(h.date) && !afterDays.has(h.date)) },
  ];

  // Too few shoots to say anything honest yet.
  if (groups[0].rows.length < 4) return;

  const mean = (rows, key) => {
    const v = rows.map(r => r[key]).filter(x => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };

  const head = `<tr><th></th>${groups.map(g => `<th>${g.name}<small>${g.rows.length}d</small></th>`).join("")}</tr>`;
  const body = METRICS.map(m => {
    const vals = groups.map(g => mean(g.rows, m.key));
    if (vals.every(v => v == null)) return "";
    // Mark the worst of the three, so the eye lands on the cost.
    const present = vals.filter(v => v != null);
    const worst = m.better === "low" ? Math.max(...present) : Math.min(...present);
    return `<tr><th>${m.label}</th>${vals.map(v =>
      v == null ? "<td>—</td>"
        : `<td class="${v === worst ? "md-worst" : ""}">${m.fmt(v)}</td>`).join("")}</tr>`;
  }).join("");

  $("#md-table").innerHTML = `<table class="md">${head}${body}</table>`;
  $("#md-n").textContent = `${groups[0].rows.length} shoots · last 90 days`;

  // Plain-language read-out, generated from the numbers rather than asserted.
  const say = [];
  const mSleep = mean(groups[0].rows, "sleepHours"), oSleep = mean(groups[2].rows, "sleepHours");
  const aHR = mean(groups[1].rows, "restingHR"), oHR = mean(groups[2].rows, "restingHR");
  const aBB = mean(groups[1].rows, "bodyBatteryPeak"), oBB = mean(groups[2].rows, "bodyBatteryPeak");

  if (mSleep != null && oSleep != null && mSleep >= oSleep) {
    say.push(`Shoot days don't cost you sleep — you average ${mSleep.toFixed(1)}h on them, ${(mSleep - oSleep).toFixed(1)}h more than an ordinary day.`);
  }
  if (aHR != null && oHR != null && aHR > oHR + 0.5) {
    say.push(`The day <em>after</em> is where it shows: resting HR ${Math.round(aHR)} vs ${Math.round(oHR)}${aBB != null && oBB != null && aBB < oBB ? `, Body Battery ${Math.round(aBB)} vs ${Math.round(oBB)}` : ""}.`);
  }
  $("#md-read").innerHTML = say.join(" ");
  card.hidden = false;
}

/* ---------- Session logger -------------------------------------------
   He doesn't record activities on the watch, so nothing else captures
   what he actually trains. Two taps, stored locally, no nagging.
--------------------------------------------------------------------- */
const SESSION_TYPES = [
  { id: "push",   label: "Push",         icon: "🏋️" },
  { id: "pull",   label: "Pull",         icon: "🧗" },
  { id: "legs",   label: "Legs",         icon: "🦵" },
  { id: "full",   label: "Full body",    icon: "💪" },
  { id: "cardio", label: "Run / walk",   icon: "🏃" },
  { id: "mobility", label: "Mobility",   icon: "🧘" },
];
const SESSION_KEY = "nf.sessions";
const GYM_KEY = "nf.gym";

/* Exercise library, built around the garage gym in CONFIG.gym:
   barbell + squat rack + dumbbells. He can also type anything not listed. */
const EXERCISES = [
  { name: "Back squat",        kit: "barbell" },
  { name: "Front squat",       kit: "barbell" },
  { name: "Deadlift",          kit: "barbell" },
  { name: "Romanian deadlift", kit: "barbell" },
  { name: "Bench press",       kit: "barbell" },
  { name: "Overhead press",    kit: "barbell" },
  { name: "Barbell row",       kit: "barbell" },
  { name: "Hip thrust",        kit: "barbell" },
  { name: "Goblet squat",      kit: "dumbbells" },
  { name: "DB bench press",    kit: "dumbbells" },
  { name: "DB shoulder press", kit: "dumbbells" },
  { name: "DB row",            kit: "dumbbells" },
  { name: "DB curl",           kit: "dumbbells" },
  { name: "Lateral raise",     kit: "dumbbells" },
  { name: "Bulgarian split squat", kit: "dumbbells" },
  { name: "Walking lunge",     kit: "dumbbells" },
  { name: "Farmer carry",      kit: "dumbbells" },
  { name: "Push-up",           kit: "bodyweight" },
  { name: "Plank",             kit: "bodyweight" },
  { name: "Calf raise",        kit: "bodyweight" },
];

const loadGym = () => { try { return JSON.parse(localStorage.getItem(GYM_KEY)) || []; } catch { return []; } };
const saveGym = e => localStorage.setItem(GYM_KEY, JSON.stringify(e.slice(-1000)));
const todayISO = () => new Date().toISOString().slice(0, 10);

/** Last time he did this lift — the whole point of writing it down. */
function lastTime(name) {
  const prior = loadGym()
    .filter(e => e.name.toLowerCase() === name.toLowerCase() && e.date !== todayISO())
    .sort((a, b) => a.at - b.at);
  return prior[prior.length - 1] || null;
}

const setsLine = e => `${e.sets}×${e.reps}${e.kg ? ` @ ${e.kg}kg` : ""}`;

function renderGym() {
  const card = $("#gym-card"); if (!card) return;
  const all = loadGym();
  const today = all.filter(e => e.date === todayISO());

  $("#gym-today").innerHTML = today.length
    ? today.map(e => {
        const prev = lastTime(e.name);
        const vol = e.kg ? e.sets * e.reps * e.kg : null;
        return `<div class="gym-row">
          <div><strong>${esc(e.name)}</strong>
            <small>${setsLine(e)}${vol ? ` · ${fmt.format(Math.round(vol))} kg volume` : ""}</small></div>
          <div class="gym-row-right">
            ${prev ? `<small class="gym-prev">last ${setsLine(prev)}</small>` : ""}
            <button class="mini-x" data-at="${e.at}" aria-label="Remove">✕</button>
          </div>
        </div>`;
      }).join("")
    : '<p class="muted">Nothing logged today. Tap below as you go.</p>';

  $("#gym-today").querySelectorAll(".mini-x").forEach(b =>
    b.addEventListener("click", () => { saveGym(loadGym().filter(x => x.at !== Number(b.dataset.at))); renderGym(); }));

  // Recent sessions, grouped by day
  const days = [...new Set(all.map(e => e.date))].filter(d => d !== todayISO()).sort().reverse().slice(0, 5);
  $("#session-log").innerHTML = days.length
    ? days.map(d => {
        const items = all.filter(e => e.date === d);
        return `<li><span class="lead">${shortDate(d)}</span>
          <span class="right">${items.length} exercise${items.length > 1 ? "s" : ""}</span></li>`;
      }).join("")
    : "";

  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const daysThisWeek = new Set(all.filter(e => new Date(e.date + "T00:00:00") >= weekAgo).map(e => e.date)).size;
  $("#log-week").textContent = daysThisWeek === 0 ? "none this week"
    : `${daysThisWeek} session${daysThisWeek > 1 ? "s" : ""} this week`;
}

function openPicker() {
  $("#gym-picker").hidden = false;
  $("#gym-entry").hidden = true;
  $("#gym-search").value = "";
  renderPickerList("");
  $("#gym-search").focus();
}

function renderPickerList(q) {
  const term = q.trim().toLowerCase();
  const recent = [...new Set(loadGym().slice().reverse().map(e => e.name))].slice(0, 4);
  const matches = EXERCISES.filter(e => !term || e.name.toLowerCase().includes(term));

  const chip = (name, cls = "") => `<button class="gym-chip ${cls}" data-name="${esc(name)}">${esc(name)}</button>`;
  let html = "";
  if (!term && recent.length) html += `<div class="gym-group">Recent</div>` + recent.map(n => chip(n, "recent")).join("");
  html += (matches.length ? `<div class="gym-group">Exercises</div>` + matches.map(e => chip(e.name)).join("") : "");
  if (term && !matches.some(m => m.name.toLowerCase() === term)) {
    html += `<div class="gym-group">Custom</div>` + chip(q.trim(), "custom");
  }
  $("#gym-list").innerHTML = html;
  $("#gym-list").querySelectorAll(".gym-chip").forEach(b =>
    b.addEventListener("click", () => openEntry(b.dataset.name)));
}

function openEntry(name) {
  $("#gym-picker").hidden = true;
  $("#gym-entry").hidden = false;
  $("#gym-entry").dataset.name = name;
  $("#gym-entry-name").textContent = name;

  const prev = lastTime(name);
  $("#gym-last").textContent = prev
    ? `Last time (${shortDate(prev.date)}): ${setsLine(prev)}`
    : "First time logging this one.";
  // Pre-fill from last time so a repeat set is one tap.
  if (prev) { $("#gym-sets").value = prev.sets; $("#gym-reps").value = prev.reps; $("#gym-kg").value = prev.kg ?? ""; }
}

function saveEntry() {
  const name = $("#gym-entry").dataset.name;
  const sets = Number($("#gym-sets").value), reps = Number($("#gym-reps").value);
  const kgRaw = $("#gym-kg").value;
  if (!name || !sets || !reps) return;
  const all = loadGym();
  all.push({ name, sets, reps, kg: kgRaw === "" ? null : Number(kgRaw), date: todayISO(), at: Date.now() });
  saveGym(all);
  markHabitDone("move");
  $("#gym-entry").hidden = true;
  renderGym();
}

const loadSessions = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || []; } catch { return []; } };
const saveSessions = s => localStorage.setItem(SESSION_KEY, JSON.stringify(s.slice(-200)));

function logSession(typeId) {
  const s = loadSessions();
  s.push({ date: new Date().toISOString().slice(0, 10), type: typeId, at: Date.now() });
  saveSessions(s);
  markHabitDone("move");          // keeps the existing Move streak honest
  renderSessions();
}

function removeSession(at) {
  saveSessions(loadSessions().filter(x => x.at !== at));
  renderSessions();
}

/** The exercise-level log replaced the type-only buttons; this now just
    wires the gym card up. */
function renderSessions() {
  if (!$("#gym-card")) return;
  renderGym();

  $("#gym-add-btn").onclick = openPicker;
  $("#gym-search").oninput = e => renderPickerList(e.target.value);
  $("#gym-search").onkeydown = e => {
    if (e.key === "Enter" && e.target.value.trim()) { e.preventDefault(); openEntry(e.target.value.trim()); }
  };
  $("#gym-entry-close").onclick = () => { $("#gym-entry").hidden = true; };
  $("#gym-save").onclick = saveEntry;
}

const TREND_DAYS = 30;

function renderTrends(fullHistory) {
  if (!Array.isArray(fullHistory) || !fullHistory.length) return;

  // History is 90 days (the matchday comparison needs the depth), but these
  // charts are labelled "30d" and 90 bars in a 320-unit viewBox is a smear.
  // Slice here rather than shortening the underlying data.
  const history = fullHistory.slice(-TREND_DAYS);

  const avg = key => {
    const v = history.map(h => h[key]).filter(x => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const pill = (id, text) => { const el = $("#" + id); if (el && text) el.textContent = text; };

  const sleepGoal = CONFIG.goals?.sleepHours ?? null;
  // His own target wins over the one Garmin ships (9,000). A self-chosen goal
  // outperforms an assigned one on adherence, and the watch's default is the
  // number he was missing three days in four.
  const stepGoal = CONFIG.goals?.dailySteps ?? history.find(h => h.stepGoal)?.stepGoal ?? null;

  const aSleep = avg("sleepHours"), aSteps = avg("steps"), aRhr = avg("restingHR"), aBb = avg("bodyBatteryPeak");
  pill("f-sleep-avg", aSleep && `${aSleep.toFixed(1)}h avg · 30d`);
  pill("f-steps-avg", aSteps && `${fmt.format(Math.round(aSteps))} avg · 30d`);
  pill("f-rhr-avg", aRhr && `${Math.round(aRhr)} bpm avg · 30d`);
  pill("f-bb-avg", aBb && `${Math.round(aBb)} avg · 30d`);

  barChart($("#ch-sleep"), history, {
    value: h => h.sleepHours, goal: sleepGoal,
    fmtValue: v => `${v}h`, label: sleepGoal ? `${sleepGoal}h target` : "",
  });
  barChart($("#ch-steps"), history, {
    value: h => h.steps, goal: stepGoal,
    fmtValue: v => fmt.format(v), label: stepGoal ? `${fmt.format(stepGoal)} goal` : "",
  });
  lineChart($("#ch-rhr"), history, {
    value: h => h.restingHR, fmtValue: v => `${v} bpm`,
  });
  lineChart($("#ch-bb"), history, {
    value: h => h.bodyBatteryPeak, fmtValue: v => `${v}`,
  });
}

function renderWorkout(type) {
  const gym = CONFIG.gym;
  const sq = gym.squatRack && gym.barbell;
  const plans = {
    push: `STRENGTH — heavy day\n` +
      (sq ? `• Back squat 5×5 (work up to a top set)\n` : `• Goblet squat 5×8\n`) +
      `• DB bench / floor press 4×8\n• DB row 4×10/side\n• DB walking lunge 3×12\n• Finisher: 100 KB/DB swings`,
    moderate: `WORKING SESSION\n` +
      (sq ? `• Front squat 4×6\n` : `• DB squat 4×10\n`) +
      `• DB shoulder press 4×10\n• Romanian DL (DB) 3×12\n• DB curls + tricep ext superset 3×12\n• 10 min easy zone-2`,
    recovery: `RECOVERY / MOBILITY\n• 20–30 min zone-2 walk or row\n• Hip + thoracic mobility flow 10 min\n` +
      `• Light DB carries 3×40m\n• Stretch + breathe — keep HR low`
  };
  $("#f-workout").textContent = plans[type] || plans.moderate;
  $("#f-session-pill").textContent = type;
}

/* ---------- Calendar (Google Calendar — green events = matches/fixtures) ---------- */
function fmtEventDate(iso, allDay) {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  if (allDay) return day;
  const t = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${day}<br>${t}`;
}
function renderCalendar(c) {
  const items = (c?.matches || [])
    .filter(m => new Date(m.end || m.start) >= new Date())  // upcoming only
    .sort((a, b) => new Date(a.start) - new Date(b.start));
  const ul = $("#w-upcoming");
  if (!items.length) { ul.innerHTML = '<li class="muted">No upcoming green events on your calendar.</li>'; return; }

  ul.innerHTML = items.slice(0, 12).map(m => {
    const isMatch = /\bvs\b|trophy|final|cup|tournament|league|futsal|rugby|waterpolo|championship/i.test(m.title);
    return `<li class="match-row ${m.allDay ? "allday" : ""}">
      <span><span class="lead">${m.title}${isMatch ? '<span class="tag match">fixture</span>' : ''}</span>
      ${m.location ? `<br><span class="sub">${m.location}</span>` : ""}</span>
      <span class="right">${fmtEventDate(m.start, m.allDay)}</span></li>`;
  }).join("");

  const n = items[0];
  $("#ov-next-shoot .big-line").textContent = n.title;
  $("#ov-next-shoot small").innerHTML = `${fmtEventDate(n.start, n.allDay).replace("<br>", " · ")}${n.location ? " · " + n.location : ""}`;
  BRIEF.nextFixture = { title: n.title, when: fmtEventDate(n.start, n.allDay).replace("<br>", " · ") };

  const after = items[1];
  if (after) {
    $("#ov-next2 .big-line").textContent = after.title;
    $("#ov-next2 small").innerHTML = `${fmtEventDate(after.start, after.allDay).replace("<br>", " · ")}${after.location ? " · " + after.location : ""}`;
  } else {
    $("#ov-next2 .big-line").textContent = "—";
    $("#ov-next2 small").textContent = "nothing else scheduled";
  }
}

/* ---------- Photography (gallery only — fixtures come from calendar) ---------- */
function renderPhoto(p) {
  if (p?.gallery?.length) {
    $("#w-gallery").innerHTML = p.gallery.map(g =>
      `<a href="${g.link || g.src}" target="_blank" rel="noopener"><img loading="lazy" src="${g.src}" alt="${g.caption || ""}"></a>`).join("");
  }
}

/* ---------- Tasks (local, persists on device) ---------- */
const TKEY = "nf-tasks-v1";
function loadTasks(){ try{ return JSON.parse(localStorage.getItem(TKEY))||[] }catch{ return [] } }
function saveTasks(t){ localStorage.setItem(TKEY, JSON.stringify(t)); }
function renderTasks() {
  const tasks = loadTasks();
  const ul = $("#t-list");
  if (!tasks.length){ ul.innerHTML = '<li class="muted">All clear. Add something above.</li>'; return; }
  ul.innerHTML = tasks.map((t, i) => `
    <li class="${t.done ? 'done' : ''}" data-i="${i}">
      <span style="display:flex;align-items:center"><span class="box">${t.done ? '✓' : ''}</span>
      <span class="lead">${t.text}</span></span>
      <button class="del" data-del="${i}">✕</button></li>`).join("");
}
$("#task-form").addEventListener("submit", e => {
  e.preventDefault();
  const v = $("#task-input").value.trim(); if (!v) return;
  const t = loadTasks(); t.push({ text: v, done: false }); saveTasks(t);
  $("#task-input").value = ""; renderTasks();
});
$("#t-list").addEventListener("click", e => {
  const t = loadTasks();
  if (e.target.dataset.del != null) { t.splice(+e.target.dataset.del, 1); }
  else { const li = e.target.closest("li[data-i]"); if (!li) return; t[+li.dataset.i].done = !t[+li.dataset.i].done; }
  saveTasks(t); renderTasks();
});

/* ---------- Seed sample tasks once ---------- */
async function seedTasks() {
  if (localStorage.getItem(TKEY)) return renderTasks();
  const seed = await loadJSON("data/tasks.json", { tasks: [] });
  saveTasks(seed.tasks || []); renderTasks();
}

/* =====================================================================
   ENGINE: streaks · briefing · progress · editable gear
   ===================================================================== */
function dayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function weekKey(d = new Date()) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return `${x.getUTCFullYear()}-W${Math.ceil((((x - ys) / 864e5) + 1) / 7)}`;
}

/* ---- Habit streaks ---- */
const HKEY = "nf-habits-v1";
const loadH = () => { try { return JSON.parse(localStorage.getItem(HKEY)) || {} } catch { return {} } };
const saveH = h => localStorage.setItem(HKEY, JSON.stringify(h));
const habitDoneToday = id => loadH()[id]?.last === dayStr();
function toggleHabit(id) {
  const h = loadH(); const cur = h[id] || { last: null, streak: 0, best: 0, log: {} };
  cur.log = cur.log || {}; const today = dayStr();
  if (cur.last === today) { cur.streak = Math.max(0, cur.streak - 1); cur.last = null; delete cur.log[today]; }
  else { const y = dayStr(new Date(Date.now() - 864e5)); cur.streak = (cur.last === y ? cur.streak + 1 : 1); cur.last = today; cur.log[today] = true; }
  cur.best = Math.max(cur.best || 0, cur.streak);
  h[id] = cur; saveH(h); renderStreaks(); renderBriefing(); syncDoneBtn(); renderProgress();
}
const markHabitDone = id => { if (!habitDoneToday(id)) toggleHabit(id); };
/** Coverage, not chains.
 *
 *  A streak that resets to zero punishes the one missed day and makes the
 *  next one feel pointless — rigid daily targets produced FEWER gym visits
 *  than flexible ones in a 2021 Management Science trial, during and after.
 *  A count over a window degrades gracefully: miss a day and you go from
 *  22/30 to 22/30, not from 47 to 0. */
const COVERAGE_WINDOW = 30;

function coverageCount(habitId) {
  const log = (loadH()[habitId] || {}).log || {};
  let n = 0;
  for (let i = 0; i < COVERAGE_WINDOW; i++) {
    if (log[dayStr(new Date(Date.now() - i * 864e5))]) n++;
  }
  return n;
}

function renderStreaks() {
  $("#streaks").innerHTML = (CONFIG.habits || []).map(hb => {
    const done = habitDoneToday(hb.id);
    const n = coverageCount(hb.id);
    return `<button class="streak ${done ? "done" : ""}" data-habit="${hb.id}">
      <span class="s-icon">${hb.icon}</span><span class="s-label">${hb.label}</span>
      <span class="s-count">${n}<small>/${COVERAGE_WINDOW}</small></span>
      <span class="s-tick">${done ? "✓ today" : "tap to log"}</span></button>`;
  }).join("");
}
$("#streaks").addEventListener("click", e => {
  const b = e.target.closest("[data-habit]"); if (b) toggleHabit(b.dataset.habit);
});

/* ---- Today briefing ---- */
function renderBriefing() {
  $("#brief-date").textContent = new Date().toLocaleDateString("en-GB", { weekday: "long" });
  const items = [];
  if (BRIEF.readiness) items.push(`<li><span class="bi">🔋</span> <b>${BRIEF.readiness.title}</b> — ${BRIEF.readiness.advice}</li>`);
  if (BRIEF.nextFixture) items.push(`<li><span class="bi">📸</span> Next: <b>${BRIEF.nextFixture.title}</b> · ${BRIEF.nextFixture.when}</li>`);
  const task = loadTasks().find(t => !t.done);
  if (task) items.push(`<li><span class="bi">✅</span> Top task: <b>${task.text}</b></li>`);
  const remaining = (CONFIG.habits || []).filter(h => !habitDoneToday(h.id));
  items.push(remaining.length
    ? `<li><span class="bi">🔥</span> Habits left: ${remaining.map(h => h.label).join(", ")}</li>`
    : `<li><span class="bi">🎉</span> All habits done — chain intact.</li>`);
  $("#brief-list").innerHTML = items.join("");
}

/* ---- The old single "mark done" button is replaced by the session logger,
       which records WHAT was done rather than just that something was. ---- */
function syncDoneBtn() { /* element removed — kept as a no-op for callers */ }

/* =====================================================================
   GOALS & PROGRESS — bodyweight trend, lift PRs, streak history
   ===================================================================== */
function renderProgress() {
  renderBW(); renderPR(); renderProgressStreaks();
}

/* ---- Bodyweight ---- */
const BW_KEY = "nf-bw-v1";
const loadBW = () => { try { return JSON.parse(localStorage.getItem(BW_KEY)) || [] } catch { return [] } };
const saveBW = a => localStorage.setItem(BW_KEY, JSON.stringify(a));
function renderBW() {
  if (!$("#bw-current")) return;
  const arr = loadBW().slice().sort((a, b) => a.date < b.date ? 1 : -1);  // newest first
  const cur = arr[0]?.kg ?? CONFIG.goals.bodyweightKg;
  const target = CONFIG.goals.bodyweightTargetKg;
  const togo = +(cur - target).toFixed(1);
  $("#bw-current").textContent = cur + "kg";
  $("#bw-target").textContent = "target " + target + "kg";
  const tg = $("#bw-togo");
  tg.textContent = togo === 0 ? "on target 🎯" : `${Math.abs(togo)}kg to ${togo > 0 ? "lose" : "gain"}`;
  tg.className = "pill " + (Math.abs(togo) <= 1 ? "good" : "");
  $("#bw-log").innerHTML = arr.length ? arr.slice(0, 7).map((e, i) => {
    const prev = arr[i + 1];
    const diff = prev ? +(e.kg - prev.kg).toFixed(1) : null;
    const d = diff == null ? "" : `<span class="${diff <= 0 ? "pos" : "neg"}">${diff > 0 ? "+" : ""}${diff}</span>`;
    return `<li><span class="lead">${e.kg}kg ${d}</span>
      <span class="right">${new Date(e.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></li>`;
  }).join("") : '<li class="muted">No entries yet — log your weight above.</li>';
}
$("#bw-form").addEventListener("submit", e => {
  e.preventDefault();
  const v = parseFloat($("#bw-input").value); if (!v) return;
  const arr = loadBW().filter(x => x.date !== dayStr());  // one entry per day
  arr.push({ date: dayStr(), kg: v }); saveBW(arr);
  $("#bw-input").value = ""; renderBW();
});

/* ---- Lift PRs ---- */
const PR_KEY = "nf-pr-v1";
const loadPR = () => { try { return JSON.parse(localStorage.getItem(PR_KEY)) || [] } catch { return [] } };
const savePR = a => localStorage.setItem(PR_KEY, JSON.stringify(a));
function renderPR() {
  if (!$("#pr-list")) return;
  const arr = loadPR();
  $("#pr-list").innerHTML = arr.length ? arr.map(p =>
    `<li data-id="${p.id}"><span class="lead">${p.text}</span>
     <button class="del" data-del="${p.id}">✕</button></li>`).join("")
    : '<li class="muted">Add your key lifts, e.g. "Back squat 100kg".</li>';
}
$("#pr-form").addEventListener("submit", e => {
  e.preventDefault();
  const v = $("#pr-input").value.trim(); if (!v) return;
  const arr = loadPR(); arr.push({ id: Date.now(), text: v }); savePR(arr);
  $("#pr-input").value = ""; renderPR();
});
$("#pr-list").addEventListener("click", e => {
  const del = e.target.closest("[data-del]"); if (!del) return;
  savePR(loadPR().filter(p => p.id != del.dataset.del)); renderPR();
});

/* ---- Streak history / this week ---- */
function renderProgressStreaks() {
  if (!$("#progress-streaks")) return;
  const h = loadH();
  $("#progress-streaks").innerHTML = (CONFIG.habits || []).map(hb => {
    const s = h[hb.id] || { streak: 0, best: 0, log: {} };
    const wk = Object.keys(s.log || {}).filter(d => weekKey(new Date(d)) === weekKey()).length;
    return `<div class="prog-row">
      <span>${hb.icon} ${hb.label}</span>
      <span class="right">${s.streak || 0}🔥 · best ${s.best || 0} · ${wk}/7 wk</span></div>`;
  }).join("");
}

/* ---- Gear & kit ---- */
const GCHK = "nf-gear-check-v1";
const INV_KEY = "nf-gear-inv-v1";
const loadInv = () => { try { return JSON.parse(localStorage.getItem(INV_KEY)) } catch { return null } };
const saveInv = a => localStorage.setItem(INV_KEY, JSON.stringify(a));

function renderGear(gear) {
  if (!gear) return;
  // Seed editable inventory from gear.json once
  if (!loadInv()) saveInv((gear.inventory || []).map((x, i) => ({ id: Date.now() + i, item: x.item, detail: x.detail || "" })));
  const done = new Set(JSON.parse(localStorage.getItem(GCHK) || "[]"));
  $("#gear-checklist").innerHTML = (gear.checklist || []).map((c, i) => `
    <li class="${done.has(i) ? "done" : ""}" data-gi="${i}">
      <span style="display:flex;align-items:center"><span class="box">${done.has(i) ? "✓" : ""}</span>
      <span class="lead">${c}</span></span></li>`).join("");
  renderInventory();
  $("#gear-maint").innerHTML = (gear.maintenance || []).map(x =>
    `<li><span><span class="lead">${x.task}</span> ${x.type === "wishlist" ? '<span class="tag wish">wishlist</span>' : ""}</span>
    <span class="right">${x.due || ""}</span></li>`).join("") || '<li class="muted">—</li>';
}
function renderInventory() {
  const inv = loadInv() || [];
  $("#gear-inventory").innerHTML = inv.length ? inv.map(x =>
    `<li data-id="${x.id}"><span class="lead">${x.item}</span>
     <span class="right">${x.detail || ""}</span>
     <button class="del" data-del="${x.id}">✕</button></li>`).join("")
    : '<li class="muted">No gear yet — add a piece above.</li>';
}
$("#gear-checklist").addEventListener("click", e => {
  const li = e.target.closest("[data-gi]"); if (!li) return;
  const done = new Set(JSON.parse(localStorage.getItem(GCHK) || "[]")); const i = +li.dataset.gi;
  done.has(i) ? done.delete(i) : done.add(i);
  localStorage.setItem(GCHK, JSON.stringify([...done]));
  li.classList.toggle("done"); li.querySelector(".box").textContent = done.has(i) ? "✓" : "";
});
$("#gear-reset").addEventListener("click", () => { localStorage.removeItem(GCHK); renderGear(window._gear); });
// Add / remove gear. Type "Item — detail" (dash optional) to set a detail.
$("#gear-inv-form").addEventListener("submit", e => {
  e.preventDefault();
  const raw = $("#gear-inv-input").value.trim(); if (!raw) return;
  const parts = raw.split(/\s+[—-]\s+/);
  const inv = loadInv() || [];
  inv.push({ id: Date.now(), item: parts[0].trim(), detail: (parts[1] || "").trim() });
  saveInv(inv); $("#gear-inv-input").value = ""; renderInventory();
});
$("#gear-inventory").addEventListener("click", e => {
  const del = e.target.closest("[data-del]"); if (!del) return;
  saveInv((loadInv() || []).filter(x => x.id != del.dataset.del)); renderInventory();
});

/* ---------- Boot ---------- */
async function boot() {
  setDate(); loadWeather(); seedTasks();
  // Engine pieces that don't need network data
  renderStreaks(); renderProgress(); syncDoneBtn();

  const [g, p, cal, gear, meta] = await Promise.all([
    loadJSON("data/garmin.json", null),
    loadJSON("data/photography.json", null),
    loadJSON("data/calendar.json", null),
    loadJSON("data/gear.json", null),
    loadJSON("data/meta.json", null),
  ]);
  renderGarmin(g); renderPhoto(p); renderCalendar(cal);
  window._gear = gear; renderGear(gear);
  renderSessions();
  renderStress(g?.history);
  renderWhatChanged(g?.history);
  renderRegularity(g?.history);
  renderCheckin(g?.history, cal);
  renderTonight(g?.history, cal);
  renderWeekday(g?.history);
  renderMatchday(g?.history, cal);   // needs both feeds — fixtures AND body data
  renderBriefing();   // after readiness + fixture are populated
  if (meta?.lastSync) $("#last-sync").textContent = "Last sync: " +
    new Date(meta.lastSync).toLocaleString("en-GB", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" });
}
boot();
