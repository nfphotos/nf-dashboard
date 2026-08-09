// =====================================================================
//  NF Command Centre — Mac app shell
//
//  Wraps the same web frontend that runs on GitHub Pages / Android, so
//  there is one UI codebase and no drift between the phone and the Mac.
//
//  The web files are served over a loopback HTTP server rather than
//  loaded from file://, because the dashboard fetches data/*.json and
//  registers a service worker — both of which file:// forbids.
//  http://127.0.0.1 counts as a secure context, so both work.
// =====================================================================
const { app, BrowserWindow, Tray, Menu, shell, nativeImage, ipcMain } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

// =====================================================================
//  NF Photography Tools
//
//  Each tool ships as a self-contained .command that builds its own venv,
//  installs its own dependencies and asks for a folder via an AppleScript
//  dialog. We run those scripts unchanged rather than reimplementing the
//  Python invocation — they work, and duplicating their setup logic here
//  would be two things to keep in step.
//
//  What the app adds is one place to launch them from and live output,
//  instead of a Terminal window per tool.
// =====================================================================
const TOOLS_ROOT = path.join(os.homedir(), "Documents", "Claude", "NF Photography Tools");

const TOOLS = [
  { id: "cull",     name: "Auto-crop",       desc: "Tight subject crops into XMP sidecars",  script: "nf-cull/Crop Photos.command" },
  { id: "reel",     name: "POV reel",        desc: "Auto-culled 9:16 reel from raw clips",   script: "nf-reel/NF Reel.command" },
  { id: "overlays", name: "TVM overlays",    desc: "Burn in the TVM carousel overlays",      script: "nf-tvm-overlays/TVM Overlays.command" },
  { id: "carousel", name: "Carousel split",  desc: "16:10 into two seamless 4:5 halves",     script: "nf-carousel/Carousel Split.command" },
  { id: "ratio",    name: "Sort by ratio",   desc: "Group exports into aspect-ratio folders", script: "nf-sort-ratio/Sort by Ratio.command" },
  { id: "invoice",  name: "Invoice",         desc: "Branded invoice generator",              open: "nf-invoice/Invoice Generator.html" },
];

/** Only offer what's actually on disk — a button that can't work is worse
 *  than no button. */
function listTools() {
  return TOOLS.map(t => {
    const rel = t.script || t.open;
    const full = path.join(TOOLS_ROOT, rel);
    return { id: t.id, name: t.name, desc: t.desc, kind: t.script ? "run" : "open", available: fs.existsSync(full) };
  });
}

const running = new Map();   // id -> ChildProcess

function runTool(id, sender) {
  const tool = TOOLS.find(t => t.id === id);
  if (!tool) return { ok: false, error: "Unknown tool" };

  if (tool.open) {
    shell.openPath(path.join(TOOLS_ROOT, tool.open));
    return { ok: true, opened: true };
  }
  if (running.has(id)) return { ok: false, error: "Already running" };

  const full = path.join(TOOLS_ROOT, tool.script);
  if (!fs.existsSync(full)) return { ok: false, error: `Not found: ${tool.script}` };

  // bash, not `open` — `open` detaches into Terminal and we lose the output.
  const child = spawn("/bin/bash", [full], {
    cwd: path.dirname(full),
    env: { ...process.env, TERM: "dumb" },   // stop the scripts emitting colour escapes
  });
  running.set(id, child);

  const send = (stream, text) => {
    if (!sender.isDestroyed()) sender.send("tool:output", { id, stream, text });
  };
  child.stdout.on("data", d => send("out", d.toString()));
  child.stderr.on("data", d => send("err", d.toString()));
  child.on("close", code => {
    running.delete(id);
    if (!sender.isDestroyed()) sender.send("tool:done", { id, code });
  });
  child.on("error", e => {
    running.delete(id);
    if (!sender.isDestroyed()) sender.send("tool:done", { id, code: -1, error: e.message });
  });

  return { ok: true };
}

ipcMain.handle("tools:list", () => listTools());
ipcMain.handle("tools:run", (e, id) => runTool(id, e.sender));
ipcMain.handle("tools:stop", (e, id) => {
  const c = running.get(id);
  if (c) { c.kill("SIGTERM"); return { ok: true }; }
  return { ok: false };
});
ipcMain.handle("tools:reveal", () => { shell.openPath(TOOLS_ROOT); return { ok: true }; });

// In a packaged app the web files are copied into Resources/web.
// In development they are simply the repo root, one level up.
const WEB_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, "web")
  : path.join(__dirname, "..");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

let win = null;
let tray = null;
let baseUrl = null;

// ---------------------------------------------------------------- server
function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (rel === "/" || rel === "") rel = "/index.html";

      // Contain every request inside WEB_ROOT — no traversal out of it.
      const filePath = path.join(WEB_ROOT, path.normalize(rel));
      if (!filePath.startsWith(WEB_ROOT)) {
        res.writeHead(403).end("Forbidden");
        return;
      }

      fs.readFile(filePath, (err, buf) => {
        if (err) {
          res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
          return;
        }
        const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
        // Data must never be stale in the window; the shell can cache.
        const cache = rel.startsWith("/data/") ? "no-store" : "no-cache";
        res.writeHead(200, { "Content-Type": type, "Cache-Control": cache }).end(buf);
      });
    });

    // Port 0 = let the OS pick a free one, so we never collide with
    // scripts/serve.py (4178) or anything else already running.
    server.listen(0, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
    server.on("error", reject);
  });
}

// ---------------------------------------------------------------- window
function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 380,
    minHeight: 600,
    backgroundColor: "#0A0A0A",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once("ready-to-show", () => win.show());
  win.loadURL(baseUrl);

  // Anything not on the loopback origin belongs in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(baseUrl)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // Closing the window leaves the app alive in the menu bar.
  win.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => (win = null));
}

function showWindow() {
  if (!win) createWindow();
  else {
    win.show();
    win.focus();
  }
}

// ------------------------------------------------------------ menu bar
function readJSON(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(WEB_ROOT, "data", name), "utf8"));
  } catch {
    return null;
  }
}

/** How old is the Garmin data? Stale data is worse than no data — it
 *  silently reads as today's numbers when it is weeks old. */
function ageInDays(isoDate) {
  if (!isoDate) return null;
  const then = new Date(isoDate + "T00:00:00");
  if (Number.isNaN(then.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today - then) / 86400000);
}

function nextFixture() {
  // sync_calendar.py writes { matches: [...] } — same key app.js reads.
  const cal = readJSON("calendar.json");
  const matches = (cal && cal.matches) || [];
  const now = new Date();
  return (
    matches
      .filter((m) => m.start && new Date(m.start) >= now)
      .sort((a, b) => new Date(a.start) - new Date(b.start))[0] || null
  );
}

function buildTrayMenu() {
  const garmin = readJSON("garmin.json");
  const daily = (garmin && garmin.daily) || {};
  const age = ageInDays(daily.date);
  const fixture = nextFixture();

  const items = [];

  if (daily.readiness != null) {
    items.push({ label: `Readiness  ${daily.readiness}`, enabled: false });
    const bits = [];
    if (daily.bodyBatteryHigh != null) bits.push(`Body Battery ${daily.bodyBatteryHigh}`);
    if (daily.sleepHours != null) bits.push(`Sleep ${daily.sleepHours}h`);
    if (daily.steps != null) bits.push(`${Number(daily.steps).toLocaleString()} steps`);
    if (bits.length) items.push({ label: `   ${bits.join("  ·  ")}`, enabled: false });
  } else {
    items.push({ label: "Readiness  —  no Garmin data", enabled: false });
  }

  // Surface staleness loudly rather than presenting old numbers as current.
  if (age != null && age > 1) {
    items.push({ label: `   ⚠︎ ${age} days old — Garmin sync not running`, enabled: false });
  }

  items.push({ type: "separator" });

  if (fixture) {
    const when = new Date(fixture.start).toLocaleString("en-GB", {
      weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });
    items.push({ label: "Next shoot", enabled: false });
    items.push({ label: `   ${fixture.title || fixture.summary || "Fixture"}`, enabled: false });
    items.push({ label: `   ${when}`, enabled: false });
  } else {
    items.push({ label: "Next shoot  —  nothing upcoming", enabled: false });
  }

  items.push(
    { type: "separator" },
    { label: "Open Command Centre", accelerator: "Command+O", click: showWindow },
    { label: "Refresh data", click: () => { refreshTray(); if (win) win.reload(); } },
    { type: "separator" },
    { label: "Quit", accelerator: "Command+Q", click: () => { app.isQuitting = true; app.quit(); } }
  );

  return Menu.buildFromTemplate(items);
}

function refreshTray() {
  if (!tray) return;
  const daily = (readJSON("garmin.json") || {}).daily || {};
  const age = ageInDays(daily.date);
  // Only claim a readiness number in the menu bar if it is actually current.
  const fresh = age != null && age <= 1 && daily.readiness != null;
  tray.setTitle(fresh ? ` ${daily.readiness}` : " —");
  tray.setToolTip(fresh ? `Readiness ${daily.readiness}` : "NF Command Centre — Garmin data is stale");
  tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  const icon = nativeImage
    .createFromPath(path.join(__dirname, "assets", "trayTemplate.png"));
  icon.setTemplateImage(true); // adapts to light/dark menu bar automatically
  tray = new Tray(icon);
  refreshTray();
  setInterval(refreshTray, 5 * 60 * 1000);
}

// ------------------------------------------------------------- lifecycle
app.whenReady().then(async () => {
  baseUrl = await startServer();
  createWindow();
  createTray();

  app.on("activate", () => showWindow());
});

// Menu-bar apps stay resident when every window is closed.
app.on("window-all-closed", () => {});
app.on("before-quit", () => (app.isQuitting = true));
