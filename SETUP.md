# Going live — the checklist

Four things. Only steps 1 and 2 need you; the rest is installing the apps.

Nothing here puts a password anywhere near the repo. Both integrations use a
**token/key you generate**, stored as an encrypted GitHub Actions Secret.

---

## 1 · Garmin (≈5 min)

Garmin rate-limits logins **per account** since March 2026, and repeated
programmatic logins get the whole account locked for 48–72 hours — phone app
included. So we log in once, here, on your Mac, and CI only ever uses the token.

```bash
cd ~/Developer/nf-dashboard
/opt/homebrew/bin/python3.12 -m venv .venv
source .venv/bin/activate
pip install 'garminconnect==0.3.9' curl_cffi
python scripts/mint_garmin_tokens.py
```

It asks for your Garmin email, password and (if enabled) an MFA code. Your
password is never stored, printed, or sent anywhere — it's used once, in that
process, to get a token.

Then store the token and delete the local copy:

```bash
~/.local/bin/gh secret set GARMINTOKENS_BASE64 --repo nfphotos/nf-dashboard < garmin_token_base64.txt
rm garmin_token_base64.txt
```

The token refreshes itself daily. If the sync ever fails with an auth error,
re-run `mint_garmin_tokens.py` and set the secret again.

> **Note on your Instinct:** Training Readiness is a premium-watch feature the
> Instinct line generally doesn't report. The script falls back to Body Battery
> peak and records which source it used, so the number stays honest.

---

## 2 · Google Calendar (≈10 min, mostly clicking)

Only the Calendar API returns an event's **colour**, and your green = "I'm
shooting this" rule depends on colour. An `.ics` feed can't do it. So this needs
a service account — a robot Google account you share your calendar with.

**In the Google Cloud console** (console.cloud.google.com, signed in as
falzonnicholas01@gmail.com):

1. Create a project — call it `NF Dashboard`.
2. **APIs & Services → Library** → search "Google Calendar API" → **Enable**.
3. **IAM & Admin → Service Accounts → Create service account**.
   Name it `nf-dashboard-calendar`. Skip the optional role/access steps → **Done**.
4. Click the new account → **Keys → Add key → Create new key → JSON**.
   A `.json` file downloads. That's your key.
5. Copy the service account's **email** — it looks like
   `nf-dashboard-calendar@nf-dashboard-xxxxx.iam.gserviceaccount.com`.

**In Google Calendar** (calendar.google.com):

6. Hover your calendar → ⋮ → **Settings and sharing**.
7. **Share with specific people** → **Add people** → paste the service account
   email → permission **"See all event details"** → Send.
8. Repeat for the **birkirkarafcmedia@gmail.com** calendar (sign in to that
   account, or ask whoever owns it to share it with the same address).

**Back in the terminal** — point the path at wherever the key downloaded:

```bash
~/.local/bin/gh secret set GOOGLE_SERVICE_ACCOUNT_JSON --repo nfphotos/nf-dashboard < ~/Downloads/nf-dashboard-xxxxx.json
```

Then tell it which calendars to read:

```bash
~/.local/bin/gh variable set CALENDAR_IDS --repo nfphotos/nf-dashboard --body "falzonnicholas01@gmail.com,birkirkarafcmedia@gmail.com:all"
```

**Why the `:all` suffix:** your own calendar is filtered to green events only
(Basil/Sage = fixtures), which keeps band practice and admin out of the feed.
The Birkirkara media calendar has *uncoloured* events, so a green filter would
return nothing from it — `:all` takes every event on that one.

Once the key is stored, **delete the downloaded JSON.** It's a live credential.

---

## 3 · Run both syncs and check they're green

```bash
~/.local/bin/gh workflow run "Sync Garmin" --repo nfphotos/nf-dashboard
~/.local/bin/gh workflow run "Sync Calendar" --repo nfphotos/nf-dashboard
~/.local/bin/gh run list --repo nfphotos/nf-dashboard --limit 4
```

Both should say **success** — and this time it means something. Previously they
returned success while doing nothing; now a sync that can't sync exits red.

---

## 4 · Install the apps

**Android:** open <https://nfphotos.github.io/nf-dashboard/> in Chrome →
⋮ menu → **Install app** (or "Add to Home screen"). It gets its own icon, opens
full-screen with no browser chrome, and works offline.

**Mac:**

```bash
cd ~/Developer/nf-dashboard/desktop && npm start
```

For a real `.app` you can keep in your Dock and launch without a terminal:

```bash
cd ~/Developer/nf-dashboard/desktop && npm run dist
```

The built app lands in `desktop/release/` — drag it to Applications.

---

## Where things live

| | |
|---|---|
| Repo (local) | `~/Developer/nf-dashboard` — **not** in `~/Documents`, which is iCloud-synced and would thrash on `node_modules` |
| Live site | https://nfphotos.github.io/nf-dashboard/ |
| Mac app | `desktop/` (Electron, wraps the same web frontend) |
| Data | `data/*.json`, committed by the sync workflows |
| Secrets | GitHub → repo → Settings → Secrets and variables → Actions |
