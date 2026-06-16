/* =====================================================================
   NF Command Centre — front-end renderer (vanilla JS, no build step)
   Reads JSON from /data, renders sections, handles tabs + local tasks.
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = new Intl.NumberFormat("en-GB");
const money = n => "€" + fmt.format(Math.round(n));

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
  set("f-vo2", d.vo2max);
  set("f-load", d.trainingLoad);

  // Readiness ring + advice
  const score = d.readiness ?? d.bodyBatteryHigh ?? null;
  if (score != null) {
    $("#rb-ring").style.setProperty("--p", score);
    $("#rb-score").textContent = score;
    const { highThreshold: hi, lowThreshold: lo } = CONFIG.readiness;
    let title, advice, type;
    if (score >= hi) { title = "Primed"; type = "push"; advice = "Body Battery high — good day to push. Heavy compound session below."; }
    else if (score <= lo) { title = "Recover"; type = "recovery"; advice = "Low reserves. Keep it light: mobility, walk, easy accessories."; }
    else { title = "Steady"; type = "moderate"; advice = "Moderate readiness. Solid working session, leave a rep in the tank."; }
    $("#rb-title").textContent = title;
    $("#rb-advice").textContent = advice;
    renderWorkout(type);
  }

  // Activities
  if (g.activities?.length) {
    $("#f-activities").innerHTML = g.activities.map(a => `
      <li><span class="lead">${a.name}</span>
      <span class="right">${a.distance ? a.distance + " · " : ""}${a.duration || ""}</span></li>`).join("");
  }
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

/* ---------- Photography ---------- */
function renderPhoto(p) {
  if (!p) return;
  if (p.upcoming?.length) {
    $("#w-upcoming").innerHTML = p.upcoming.map(s => `
      <li><span><span class="lead">${s.title}</span><br><span class="sub">${s.location || ""}</span></span>
      <span class="right">${s.date}${s.time ? "<br>" + s.time : ""}</span></li>`).join("");
    const n = p.upcoming[0];
    $("#ov-next-shoot .big-line").textContent = n.title;
    $("#ov-next-shoot small").textContent = `${n.date}${n.location ? " · " + n.location : ""}`;
  }
  if (p.gallery?.length) {
    $("#w-gallery").innerHTML = p.gallery.map(g =>
      `<a href="${g.link || g.src}" target="_blank" rel="noopener"><img loading="lazy" src="${g.src}" alt="${g.caption || ""}"></a>`).join("");
  }
}

/* ---------- Social ---------- */
function renderSocial(s) {
  if (!s?.accounts?.length) return;
  $("#s-cards").innerHTML = s.accounts.map(a => {
    const d = a.followerDelta ?? 0;
    const arrow = d > 0 ? `<span class="delta up">▲ ${fmt.format(d)}</span>` :
                  d < 0 ? `<span class="delta down">▼ ${fmt.format(Math.abs(d))}</span>` : "";
    return `<article class="card stat">
      <h3>${a.network}</h3>
      <div class="big">${fmt.format(a.followers)}</div>
      <small>followers ${arrow}</small></article>`;
  }).join("");
  if (s.topPosts?.length) {
    $("#s-top").innerHTML = s.topPosts.map(p => `
      <li><span><span class="lead">${p.title}</span><br><span class="sub">${p.network}</span></span>
      <span class="right">${fmt.format(p.metricValue)} ${p.metric}</span></li>`).join("");
  }
}

/* ---------- Finances ---------- */
function renderMoney(f) {
  if (!f) return;
  const subs = f.subscriptions || [];
  const monthly = subs.reduce((t, s) => t + (s.cycle === "yearly" ? s.amount / 12 : s.amount), 0);
  $("#m-subs-total").textContent = money(monthly);
  $("#m-subs-count").textContent = subs.length + " active";
  const income = (f.income || []).reduce((t, x) => t + x.amount, 0);
  const expense = (f.expenses || []).reduce((t, x) => t + x.amount, 0) + monthly;
  $("#m-in").textContent = money(income);
  $("#m-out").textContent = money(expense);
  const net = income - expense;
  const netEl = $("#m-net"); netEl.textContent = (net < 0 ? "-" : "") + money(Math.abs(net));
  netEl.className = "big " + (net >= 0 ? "pos" : "neg");

  // sort subs by next renewal
  const sorted = [...subs].sort((a, b) => (a.nextRenewal || "").localeCompare(b.nextRenewal || ""));
  $("#m-subs").innerHTML = sorted.map(s => {
    const soon = daysUntil(s.nextRenewal) <= 7;
    return `<li><span><span class="lead">${s.name}</span><br>
      <span class="sub">${s.cycle}${soon ? " · renews soon" : ""}</span></span>
      <span class="right" style="${soon ? 'color:var(--accent-2)' : ''}">${money(s.amount)}<br>${s.nextRenewal || ""}</span></li>`;
  }).join("");
  if (sorted[0]) {
    $("#ov-renewal .big-line").textContent = sorted[0].name;
    $("#ov-renewal small").textContent = `${money(sorted[0].amount)} · ${sorted[0].nextRenewal}`;
  }
}
function daysUntil(d){ if(!d) return 999; return Math.ceil((new Date(d)-new Date())/864e5); }

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

/* ---------- Boot ---------- */
async function boot() {
  setDate(); loadWeather(); seedTasks();
  const [g, p, s, f, meta] = await Promise.all([
    loadJSON("data/garmin.json", null),
    loadJSON("data/photography.json", null),
    loadJSON("data/social.json", null),
    loadJSON("data/finances.json", null),
    loadJSON("data/meta.json", null),
  ]);
  renderGarmin(g); renderPhoto(p); renderSocial(s); renderMoney(f);
  if (meta?.lastSync) $("#last-sync").textContent = "Last sync: " +
    new Date(meta.lastSync).toLocaleString("en-GB", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" });
}
boot();
