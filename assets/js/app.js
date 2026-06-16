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
    BRIEF.readiness = { title, advice };
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
   ENGINE: streaks · briefing · social cadence · content pipeline · gear
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
  const h = loadH(); const cur = h[id] || { last: null, streak: 0 }; const today = dayStr();
  if (cur.last === today) { cur.streak = Math.max(0, cur.streak - 1); cur.last = null; }
  else { const y = dayStr(new Date(Date.now() - 864e5)); cur.streak = (cur.last === y ? cur.streak + 1 : 1); cur.last = today; }
  h[id] = cur; saveH(h); renderStreaks(); renderBriefing(); syncDoneBtn();
}
const markHabitDone = id => { if (!habitDoneToday(id)) toggleHabit(id); };
function renderStreaks() {
  const h = loadH();
  $("#streaks").innerHTML = (CONFIG.habits || []).map(hb => {
    const s = h[hb.id] || { streak: 0 }; const done = habitDoneToday(hb.id);
    return `<button class="streak ${done ? "done" : ""}" data-habit="${hb.id}">
      <span class="s-icon">${hb.icon}</span><span class="s-label">${hb.label}</span>
      <span class="s-count">${s.streak || 0}🔥</span>
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

/* ---- Mark workout done -> feeds "move" streak ---- */
function syncDoneBtn() {
  const b = $("#f-done-btn"); if (!b) return;
  if (habitDoneToday("move")) { b.textContent = "Logged ✓ today"; b.classList.add("done"); }
  else { b.textContent = "Mark session done 💪"; b.classList.remove("done"); }
}
$("#f-done-btn").addEventListener("click", () => markHabitDone("move"));

/* ---- Social: growth goal + weekly cadence ---- */
function renderSocialGoal(s) {
  const biz = s?.accounts?.find(a => /photo/i.test(a.network));
  const cur = biz?.followers ?? CONFIG.social.currentFollowers;
  const goal = CONFIG.social.followerGoal;
  const pct = Math.min(100, Math.round(cur / goal * 100));
  $("#s-goal-fill").style.width = pct + "%";
  $("#s-goal-text").textContent = `${fmt.format(cur)} / ${fmt.format(goal)} followers · ${pct}%`;
  $("#s-goal-handle").textContent = CONFIG.socials.instagramBusiness;
}
const wpKey = () => "nf-posts-" + weekKey();
const weekPosts = () => +(localStorage.getItem(wpKey()) || 0);
const setWeekPosts = n => localStorage.setItem(wpKey(), Math.max(0, n));
function renderCadence() {
  const target = CONFIG.social.weeklyPostTarget, done = weekPosts(), total = Math.max(target, done);
  let html = "";
  for (let i = 0; i < total; i++) html += `<button class="dot ${i < done ? "on" : ""} ${i >= target ? "extra" : ""}" data-i="${i}"></button>`;
  $("#s-cadence").innerHTML = html + `<span class="cadence-text">${done}/${target} this week</span>`;
}
$("#s-cadence").addEventListener("click", e => {
  const d = e.target.closest("[data-i]"); if (!d) return;
  const i = +d.dataset.i, cur = weekPosts(), next = (cur === i + 1) ? i : i + 1;
  if (next > cur) markHabitDone("post");
  setWeekPosts(next); renderCadence(); renderStreaks(); renderBriefing();
});

/* ---- Content pipeline ---- */
const PIPE_KEY = "nf-pipe-v1";
const STAGES = ["Idea", "Shot", "Edit", "Posted"];
const loadPipe = () => { try { return JSON.parse(localStorage.getItem(PIPE_KEY)) } catch { return null } };
const savePipe = p => localStorage.setItem(PIPE_KEY, JSON.stringify(p));
function seedPipe() {
  if (loadPipe()) return;
  savePipe([
    { id: Date.now(), text: "Birkirkara friendly — match reel", stage: 0 },
    { id: Date.now() + 1, text: "Behind-the-scenes carousel", stage: 1 }
  ]);
}
function renderPipeline() {
  const p = loadPipe() || [];
  $("#pipeline").innerHTML = p.length ? p.map(c => `
    <div class="pipe-card stage-${c.stage}" data-id="${c.id}">
      <span class="pipe-text">${c.text}</span>
      <span class="pipe-stage">${STAGES[c.stage]}</span>
      <button class="pipe-del" data-del="${c.id}">✕</button>
    </div>`).join("") : '<p class="muted">No ideas yet. Add one above.</p>';
}
$("#pipe-form").addEventListener("submit", e => {
  e.preventDefault(); const v = $("#pipe-input").value.trim(); if (!v) return;
  const p = loadPipe() || []; p.unshift({ id: Date.now(), text: v, stage: 0 }); savePipe(p);
  $("#pipe-input").value = ""; renderPipeline();
});
$("#pipeline").addEventListener("click", e => {
  let p = loadPipe() || [];
  const del = e.target.closest("[data-del]");
  if (del) { savePipe(p.filter(c => c.id != del.dataset.del)); return renderPipeline(); }
  const card = e.target.closest("[data-id]"); if (!card) return;
  const c = p.find(x => x.id == card.dataset.id); if (!c || c.stage >= 3) return;
  c.stage++;
  if (c.stage === 3) { markHabitDone("post"); setWeekPosts(weekPosts() + 1); renderCadence(); renderStreaks(); renderBriefing(); }
  savePipe(p); renderPipeline();
});

/* ---- Gear & kit ---- */
const GCHK = "nf-gear-check-v1";
function renderGear(gear) {
  if (!gear) return;
  const done = new Set(JSON.parse(localStorage.getItem(GCHK) || "[]"));
  $("#gear-checklist").innerHTML = (gear.checklist || []).map((c, i) => `
    <li class="${done.has(i) ? "done" : ""}" data-gi="${i}">
      <span style="display:flex;align-items:center"><span class="box">${done.has(i) ? "✓" : ""}</span>
      <span class="lead">${c}</span></span></li>`).join("");
  $("#gear-inventory").innerHTML = (gear.inventory || []).map(x =>
    `<li><span class="lead">${x.item}</span><span class="right">${x.detail || ""}</span></li>`).join("") || '<li class="muted">—</li>';
  $("#gear-maint").innerHTML = (gear.maintenance || []).map(x =>
    `<li><span><span class="lead">${x.task}</span> ${x.type === "wishlist" ? '<span class="tag wish">wishlist</span>' : ""}</span>
    <span class="right">${x.due || ""}</span></li>`).join("") || '<li class="muted">—</li>';
}
$("#gear-checklist").addEventListener("click", e => {
  const li = e.target.closest("[data-gi]"); if (!li) return;
  const done = new Set(JSON.parse(localStorage.getItem(GCHK) || "[]")); const i = +li.dataset.gi;
  done.has(i) ? done.delete(i) : done.add(i);
  localStorage.setItem(GCHK, JSON.stringify([...done]));
  li.classList.toggle("done"); li.querySelector(".box").textContent = done.has(i) ? "✓" : "";
});
$("#gear-reset").addEventListener("click", () => { localStorage.removeItem(GCHK); renderGear(window._gear); });

/* ---------- Boot ---------- */
async function boot() {
  setDate(); loadWeather(); seedTasks(); seedPipe();
  // Engine pieces that don't need network data
  renderStreaks(); renderCadence(); renderPipeline(); syncDoneBtn();

  const [g, p, s, cal, gear, meta] = await Promise.all([
    loadJSON("data/garmin.json", null),
    loadJSON("data/photography.json", null),
    loadJSON("data/social.json", null),
    loadJSON("data/calendar.json", null),
    loadJSON("data/gear.json", null),
    loadJSON("data/meta.json", null),
  ]);
  renderGarmin(g); renderPhoto(p); renderSocial(s); renderCalendar(cal);
  renderSocialGoal(s);
  window._gear = gear; renderGear(gear);
  renderBriefing();   // after readiness + fixture are populated
  if (meta?.lastSync) $("#last-sync").textContent = "Last sync: " +
    new Date(meta.lastSync).toLocaleString("en-GB", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" });
}
boot();
