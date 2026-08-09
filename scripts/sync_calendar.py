#!/usr/bin/env python3
"""
Pull GREEN-coloured events (matches / fixtures / shoots) from Google
Calendar and write data/calendar.json.

Nick colour-codes everything he's shooting as green (Basil = colorId 10;
Sage = colorId 2). Only the Calendar API returns colour, so this uses a
Google service account (an .ics feed can't filter by colour).

Env / GitHub secrets:
  GOOGLE_SERVICE_ACCOUNT_JSON   full service-account key JSON (as a string)
  CALENDAR_IDS                  optional, comma-separated calendar IDs to scan.
                                Append ":all" to a calendar to take EVERY event
                                from it instead of only the green ones — needed
                                for the Birkirkara media calendar, where events
                                are uncoloured and a green filter would silently
                                return nothing.

                                e.g. CALENDAR_IDS="me@gmail.com,birkirkarafcmedia@gmail.com:all"

Setup once: share each calendar with the service account's email
(Calendar settings → "Share with specific people" → Reader access).

Local test:
  export GOOGLE_SERVICE_ACCOUNT_JSON="$(cat key.json)"
  python scripts/sync_calendar.py
"""
import os, json, re, sys, datetime, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

DEFAULT_CALENDARS = ["falzonnicholas01@gmail.com"]
LOOKAHEAD_DAYS = 150

# --- How a fixture is identified -------------------------------------
#
# NOT by colour. The original design filtered on green colorIds (10 Basil,
# 2 Sage), but the API only returns colorId for events explicitly recoloured
# AWAY from their calendar's default. Every one of Nick's events inherits the
# calendar default, so all 69 upcoming events came back with no colorId and the
# green filter matched nothing. Verified against the live calendar 2026-08-09.
#
# Colour is still honoured when present — if he does recolour something green
# it counts — but the primary signal is the title, which is reliable:
# "Birkirkara vs Gzira", "Malta vs Andorra [UEFA Nations League]".
MATCH_COLOR_IDS = {"10", "2"}

# "Team vs Team" / "Team v Team". Whitespace-anchored so it can't fire on a
# word that merely contains "v" (e.g. "Ventureathlon").
FIXTURE_PATTERN = re.compile(r"\s+v(?:s\.?)?\s+", re.I)

# Tournaments and one-off shoots that carry no "X vs Y" in the title.
FIXTURE_KEYWORDS = (
    "super cup", "champions league", "nations league", "futsal",
    "fiba", "eurobasket", "tournament", "cup final", "friendly",
)

# His personal life also lives on this calendar — band and scouts. These win
# over the fixture rules above.
SKIP_RECURRING = True
SKIP_TITLE_KEYWORDS = (
    "band practice", "rehearsal", "band club", "troop", "scout",
    "cubs", "rover", "woodbadge", "parade",
)


def is_fixture(event):
    """Is this something Nick is shooting, rather than his own diary?"""
    title = (event.get("summary") or "").lower()

    if any(k in title for k in SKIP_TITLE_KEYWORDS):
        return False
    if SKIP_RECURRING and event.get("recurringEventId"):
        return False  # weekly practices etc.

    if event.get("colorId") in MATCH_COLOR_IDS:
        return True
    if FIXTURE_PATTERN.search(title):
        return True
    return any(k in title for k in FIXTURE_KEYWORDS)


def fail(msg):
    """Exit non-zero so the workflow goes red.

    This used to `return 0` when the secret was missing, so the daily job
    reported success for eight weeks while calendar.json stayed hand-seeded.
    A sync that cannot sync is a failure, and should look like one.
    """
    if os.environ.get("GITHUB_ACTIONS"):
        print(f"::error::{msg}")
    print(f"ERROR: {msg}", file=sys.stderr)
    raise SystemExit(1)


def main():
    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not raw:
        fail(
            "GOOGLE_SERVICE_ACCOUNT_JSON is not set. See SETUP.md — create a "
            "service account, share your calendars with it, then: "
            "gh secret set GOOGLE_SERVICE_ACCOUNT_JSON --repo nfphotos/nf-dashboard < key.json"
        )

    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    try:
        info = json.loads(raw)
    except json.JSONDecodeError as e:
        fail(f"GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: {e}")

    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/calendar.readonly"])
    svc = build("calendar", "v3", credentials=creds, cache_discovery=False)

    # "id" → green events only.  "id:all" → every event on that calendar.
    cal_specs = []
    for entry in os.environ.get("CALENDAR_IDS", ",".join(DEFAULT_CALENDARS)).split(","):
        entry = entry.strip()
        if not entry:
            continue
        if entry.endswith(":all"):
            cal_specs.append((entry[:-4].strip(), True))
        else:
            cal_specs.append((entry, False))

    now = datetime.datetime.now(datetime.timezone.utc)
    time_min = now.isoformat()
    time_max = (now + datetime.timedelta(days=LOOKAHEAD_DAYS)).isoformat()

    from googleapiclient.errors import HttpError

    matches = []
    per_calendar = {}
    for cal_id, take_all in cal_specs:
        found = 0
        page = None
        while True:
            try:
                resp = svc.events().list(
                    calendarId=cal_id, timeMin=time_min, timeMax=time_max,
                    singleEvents=True, orderBy="startTime", maxResults=250,
                    pageToken=page).execute()
            except HttpError as e:
                # Almost always "not shared with the service account yet".
                # Report it per-calendar instead of dying on the first one.
                print(f"warn: could not read {cal_id}: {e}", file=sys.stderr)
                per_calendar[cal_id] = "ERROR — is it shared with the service account?"
                break

            for e in resp.get("items", []):
                if not take_all and not is_fixture(e):
                    continue
                start = e.get("start", {})
                end = e.get("end", {})
                all_day = "date" in start
                matches.append({
                    "title": e.get("summary", "(untitled)"),
                    "start": start.get("dateTime") or start.get("date"),
                    "end": end.get("dateTime") or end.get("date"),
                    "allDay": all_day,
                    "location": e.get("location", ""),
                    "calendar": resp.get("summary", cal_id),
                    "colorId": e.get("colorId"),
                    "link": e.get("htmlLink", ""),
                })
                found += 1
            page = resp.get("nextPageToken")
            if not page:
                break
        per_calendar.setdefault(cal_id, f"{found} event(s){' — all events' if take_all else ' — fixtures only'}")

    # Every calendar erroring means the sync is broken, not that Nick has an
    # empty diary. Don't overwrite good data with an empty list in that case.
    if matches == [] and all("ERROR" in v for v in per_calendar.values()):
        fail(f"No calendar could be read: {per_calendar}")

    matches.sort(key=lambda m: m["start"])

    (DATA / "calendar.json").write_text(json.dumps({
        "_note": "Auto-generated by sync_calendar.py — green events from Google Calendar.",
        "updated": now.isoformat().replace("+00:00", "Z"),
        "sources": per_calendar,
        "matches": matches,
    }, indent=2) + "\n")
    print(f"calendar.json updated: {len(matches)} event(s) across {len(cal_specs)} calendar(s)")
    for cal_id, summary in per_calendar.items():
        print(f"  · {cal_id}: {summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
