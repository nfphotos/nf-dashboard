# NF // Command Centre

A phone-first personal dashboard — fitness (Garmin Instinct 2 Tactical), sports-photography
work, social analytics, tasks and money — hosted free on GitHub Pages, installable to your
home screen as an app (PWA), and auto-updated daily by GitHub Actions.

> **No server needed.** GitHub Actions fetches your data on a schedule and commits it as JSON.
> The page reads that JSON. Tasks/finances you edit live in the browser (saved on your device).

---

## What's in here

```
index.html              the dashboard
assets/css/styles.css   tactical-dark theme
assets/js/config.js     ← YOU edit this (handles, goals, gym, location)
assets/js/app.js         renderer + tasks + weather/golden-hour
data/*.json              the data the page displays (some auto-synced)
scripts/sync_garmin.py   pulls Garmin → data/garmin.json
.github/workflows/       garmin sync + Pages deploy
manifest.webmanifest, sw.js   makes it an installable offline app
```

---

## 1. Put it on GitHub

```bash
cd personal-dashboard
git init && git add . && git commit -m "init dashboard"
gh repo create nf-dashboard --private --source=. --push    # or create on github.com
```

> Pages works on **private** repos with a paid plan, or use a **public** repo (the code here
> holds no secrets — those live in Actions Secrets). If unsure, make it public.

## 2. Turn on GitHub Pages

Repo → **Settings → Pages** → *Build and deployment* → **Source: GitHub Actions**.
The included `deploy-pages.yml` publishes on every push. Your URL will be
`https://<username>.github.io/nf-dashboard/`.

## 3. Add it to your phone

Open that URL in Safari/Chrome on your phone → **Share → Add to Home Screen**.
It now opens full-screen like a native app and works offline.

## 4. Connect Garmin (daily auto-sync)

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `GARMIN_EMAIL` | your Garmin Connect email |
| `GARMIN_PASSWORD` | your Garmin Connect password |

Then **Actions → Sync Garmin → Run workflow** to test it now. After that it runs every
morning (edit the `cron` in `.github/workflows/sync-garmin.yml` to change the time).

> Uses the community `garminconnect` library. If Garmin ever asks for MFA, run the script
> once locally to cache a session, or switch off MFA for this account. Your credentials are
> only ever stored as encrypted GitHub Secrets — never in the repo.

## 5. Personalise

Edit **`assets/js/config.js`**: your Instagram/YouTube handles, fitness goals, gym kit,
and location (default Malta — weather + golden hour come from free Open-Meteo, no key).

Edit the JSON in **`data/`** to seed content:
- `photography.json` — upcoming shoots + a gallery (drop in your own image URLs)
- `social.json` — follower counts + top posts
- `tasks.json` — starter to-do list (after that, tasks are edited on the phone)

---

## 6. Connect Google Calendar (green events = matches)

Your fixtures/shoots are colour-coded **green** (Basil = colorId 10) on Google Calendar.
Because only Google's API exposes event colour (an .ics feed can't), the sync uses a
**service account** — set up once, then fully automatic:

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create a project.
2. **APIs & Services → Library →** enable **Google Calendar API**.
3. **APIs & Services → Credentials → Create credentials → Service account.** Create it,
   then open it → **Keys → Add key → JSON** → download the key file.
4. Copy the service account's email (looks like `name@project.iam.gserviceaccount.com`).
5. In **Google Calendar** (web) → your calendar's **Settings → Share with specific people**
   → add that email with **"See all event details"**. (Repeat for any extra calendars.)
6. In GitHub: **Settings → Secrets and variables → Actions →** add secret
   `GOOGLE_SERVICE_ACCOUNT_JSON` = the full contents of the JSON key file.
   *(Optional: add a repo **variable** `CALENDAR_IDS` = comma-separated calendar IDs if you
   want more than your primary calendar.)*
7. **Actions → Sync Calendar → Run workflow** to test. It then runs every morning and
   commits `data/calendar.json`. Anything green shows up under **Work → Upcoming matches**.

> The dashboard already ships with your real fixtures hand-seeded, so it works before you
> finish this — the service account just makes it self-updating.

## Roadmap / not yet wired (say the word and I'll add)

- **Social auto-sync** — YouTube Data API (easy, key-based) and Instagram Graph API
  (needs a Business/Creator account + Facebook app). Mirrors the Garmin pattern.
- **Photography auto-feed** — pull "latest work" straight from your Instagram or a Lightroom/
  SmugMug gallery instead of hand-editing `photography.json`.
- **Push notifications** — morning briefing (readiness + shoots + renewals due) via web-push,
  email, or Telegram from the Action.
- **Ask-Claude command box** — needs a tiny free serverless helper (Cloudflare Worker) to hold
  the API key; deferred for v1.

## Notes / privacy
- Anything in a **public** repo is public — keep real income figures vague or make the repo private.
- Garmin's API is unofficial; occasional library updates may be needed if Garmin changes their login.
