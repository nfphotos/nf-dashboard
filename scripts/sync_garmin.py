#!/usr/bin/env python3
"""
Pull daily health + recent activities from Garmin Connect into data/garmin.json.

AUTH: token only. Never credentials.
------------------------------------
Since March 2026 Garmin rate-limits logins per *account*, and repeated
programmatic logins get the whole account locked for 48-72 hours. So this
script deliberately constructs Garmin() with no email/password: if the token
is bad it fails loudly instead of quietly falling back to a credential login
and burning the account's login budget.

Mint the token locally with scripts/mint_garmin_tokens.py, then store it as
the GARMINTOKENS_BASE64 repo secret.

Local test:
    GARMINTOKENS_BASE64=$(base64 -i ~/.garminconnect/garmin_tokens.json | tr -d '\\n') \\
        python scripts/sync_garmin.py
"""
import base64
import datetime
import json
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
TOKENSTORE = pathlib.Path("~/.garminconnect").expanduser()


def fail(msg):
    """Exit non-zero so the workflow goes red.

    The previous version returned 0 on missing credentials, so the daily job
    reported success for eight weeks while the dashboard served stale data.
    Never again: if this script cannot produce fresh data, it fails.
    """
    if os.environ.get("GITHUB_ACTIONS"):
        print(f"::error::{msg}")
    print(f"ERROR: {msg}", file=sys.stderr)
    raise SystemExit(1)


def restore_token():
    blob = os.environ.get("GARMINTOKENS_BASE64")
    if not blob:
        fail(
            "GARMINTOKENS_BASE64 is not set. Run scripts/mint_garmin_tokens.py "
            "locally, then: gh secret set GARMINTOKENS_BASE64 --repo nfphotos/nf-dashboard"
        )
    TOKENSTORE.mkdir(mode=0o700, parents=True, exist_ok=True)
    token_file = TOKENSTORE / "garmin_tokens.json"
    try:
        token_file.write_bytes(base64.b64decode(blob))
    except Exception as e:
        fail(f"GARMINTOKENS_BASE64 is not valid base64: {e}")
    token_file.chmod(0o600)
    return token_file


def connect():
    from garminconnect import (
        Garmin,
        GarminConnectAuthenticationError,
        GarminConnectConnectionError,
        GarminConnectTooManyRequestsError,
    )

    # No credentials, on purpose — see the module docstring.
    api = Garmin()
    try:
        api.login(str(TOKENSTORE))
    except GarminConnectTooManyRequestsError:
        fail(
            "Garmin returned 429 (rate limited). Do NOT re-run this repeatedly — "
            "that is how accounts get locked for 48-72 hours. Wait a day."
        )
    except (GarminConnectAuthenticationError, GarminConnectConnectionError) as e:
        fail(
            f"Garmin rejected the stored token ({e}). Re-run "
            "scripts/mint_garmin_tokens.py locally and update GARMINTOKENS_BASE64."
        )
    return api


def safe(fn, *args, default=None):
    """Individual metrics are allowed to be missing; auth is not."""
    try:
        return fn(*args)
    except Exception as e:
        print(f"warn: {getattr(fn, '__name__', fn)} failed: {e}", file=sys.stderr)
        return default


def first(seq):
    return seq[0] if isinstance(seq, list) and seq else None


def build_daily(api, today):
    stats = safe(api.get_stats, today, default={}) or {}
    bb = safe(api.get_body_battery, today, today, default=[]) or []
    sleep = safe(api.get_sleep_data, today, default={}) or {}
    hrv = safe(api.get_hrv_data, today, default={}) or {}
    max_metrics = safe(api.get_max_metrics, today, default=[]) or []
    training_status = safe(api.get_training_status, today, default={}) or {}

    # Training Readiness is a premium-watch feature; the Instinct line generally
    # does not report it. Absence here is normal, not an error.
    readiness_raw = safe(api.get_training_readiness, today, default=[]) or []
    readiness_rec = first(readiness_raw) if isinstance(readiness_raw, list) else readiness_raw
    readiness = (readiness_rec or {}).get("score") if isinstance(readiness_rec, dict) else None

    bb_high = bb_low = None
    bb_rec = first(bb)
    if isinstance(bb_rec, dict) and bb_rec.get("bodyBatteryValuesArray"):
        vals = [v[1] for v in bb_rec["bodyBatteryValuesArray"] if v and v[1] is not None]
        if vals:
            bb_high, bb_low = max(vals), min(vals)

    # On an Instinct, Body Battery peak is the honest stand-in for readiness.
    readiness_source = "garmin"
    if readiness is None and bb_high is not None:
        readiness, readiness_source = bb_high, "bodyBattery"

    sleep_secs = (sleep.get("dailySleepDTO") or {}).get("sleepTimeSeconds")
    hrv_avg = (hrv.get("hrvSummary") or {}).get("lastNightAvg") if isinstance(hrv, dict) else None

    vo2 = None
    mm = first(max_metrics)
    if isinstance(mm, dict):
        generic = mm.get("generic") or {}
        vo2 = generic.get("vo2MaxPreciseValue") or generic.get("vo2MaxValue")

    load = None
    if isinstance(training_status, dict):
        summary = training_status.get("mostRecentTrainingLoadBalance") or {}
        for metrics in (summary.get("metricsTrainingLoadBalanceDTOMap") or {}).values():
            if isinstance(metrics, dict) and metrics.get("monthlyLoadAerobicLow") is not None:
                load = sum(
                    v for k, v in metrics.items()
                    if k.startswith("monthlyLoad") and isinstance(v, (int, float))
                )
                break

    return {
        "date": today,
        "readiness": readiness,
        "readinessSource": readiness_source,
        "bodyBatteryHigh": bb_high,
        "bodyBatteryLow": bb_low,
        "sleepHours": round(sleep_secs / 3600, 1) if sleep_secs else None,
        "steps": stats.get("totalSteps"),
        "hrv": hrv_avg,
        "restingHR": stats.get("restingHeartRate"),
        "stress": stats.get("averageStressLevel"),
        "vo2max": round(vo2, 1) if isinstance(vo2, (int, float)) else None,
        "trainingLoad": round(load) if isinstance(load, (int, float)) else None,
    }


# 90 rather than 30: the charts only draw the last 30, but the matchday
# comparison needs enough shoot days to be worth reading. Same number of API
# calls either way — the range endpoints take a start and an end.
HISTORY_DAYS = 90


def build_history(api, today):
    """Daily series for the Fitness tab.

    Nick doesn't record activities on the watch (confirmed 2026-08-09: zero in
    180 days), so VO2max/training status/activities are permanently empty for
    him. What the watch DOES record every day is steps, resting HR and sleep —
    so the trends are built from those.
    """
    end = datetime.date.fromisoformat(today)
    start = end - datetime.timedelta(days=HISTORY_DAYS - 1)
    s, e = start.isoformat(), end.isoformat()

    days = {}

    def slot(date):
        return days.setdefault(date, {"date": date})

    for row in safe(api.get_daily_steps, s, e, default=[]) or []:
        d = row.get("calendarDate")
        if d:
            slot(d)["steps"] = row.get("totalSteps")
            slot(d)["stepGoal"] = row.get("stepGoal")

    for row in safe(api.get_rhr_daily, s, e, default=[]) or []:
        d = row.get("calendarDate")
        if d and row.get("value") is not None:
            slot(d)["restingHR"] = round(row["value"])

    for row in safe(api.get_sleep_daily, s, e, default=[]) or []:
        d = row.get("calendarDate")
        vals = row.get("values") or {}
        secs = vals.get("totalSleepTimeInSeconds")
        if not d or not secs:
            continue
        slot(d)["sleepHours"] = round(secs / 3600, 1)

        # Bed and wake clock times, as minutes past local midnight. Nick's
        # bedtime turns out to be near-fixed (23:16-23:31 on weeknights) while
        # his wake time swings by 90 min — so the times matter more than the
        # duration for working out where the sleep is actually going.
        for key, field in (("bedMin", "localSleepStartTimeInMillis"),
                           ("wakeMin", "localSleepEndTimeInMillis")):
            ms = vals.get(field)
            if ms:
                t = datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc)
                slot(d)[key] = t.hour * 60 + t.minute

    # Daily Body Battery peak — "how charged did I actually get today".
    # The intraday array is only ~6 points a day for this watch, far too coarse
    # to draw as a curve, but its daily maximum is a genuine trend.
    #
    # This endpoint silently returns [] for ranges wider than about a month:
    # asking for 90 days at once yielded ZERO rows, which reads as "no data"
    # rather than "you asked for too much". Request it in 28-day chunks.
    chunk_start = start
    while chunk_start <= end:
        chunk_end = min(chunk_start + datetime.timedelta(days=27), end)
        for row in safe(api.get_body_battery, chunk_start.isoformat(),
                        chunk_end.isoformat(), default=[]) or []:
            d = row.get("date")
            vals = [v[1] for v in (row.get("bodyBatteryValuesArray") or []) if v and v[1] is not None]
            if d and vals:
                slot(d)["bodyBatteryPeak"] = max(vals)
        chunk_start = chunk_end + datetime.timedelta(days=1)

    return [days[k] for k in sorted(days)]




def build_activities(api):
    out = []
    for a in (safe(api.get_activities, 0, 6, default=[]) or []):
        dur = a.get("duration") or 0
        dist = a.get("distance") or 0
        out.append({
            "name": a.get("activityName")
                    or (a.get("activityType") or {}).get("typeKey", "Activity"),
            "distance": f"{dist / 1000:.1f} km" if dist else "",
            "duration": f"{int(dur // 60)}:{int(dur % 60):02d}" if dur else "",
            "date": (a.get("startTimeLocal") or "")[:10],
        })
    return out


def persist_rotated_token(token_file, original_b64):
    """Garmin rotates the refresh token. If we drop the new one, the stored
    secret goes stale and the sync eventually dies. Hand the rotated value to
    the workflow so it can update the secret."""
    rotated = base64.b64encode(token_file.read_bytes()).decode()
    if rotated == original_b64:
        return
    print("note: Garmin rotated the refresh token")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        pathlib.Path("/tmp/garmin_tokens.b64").write_text(rotated)
        with open(out, "a") as fh:
            fh.write("rotated=true\n")


def main():
    original_b64 = os.environ.get("GARMINTOKENS_BASE64", "")
    token_file = restore_token()
    api = connect()

    today = datetime.date.today().isoformat()
    daily = build_daily(api, today)

    # A payload where every metric is None means the fetch failed even though
    # auth worked — writing it would replace good data with an empty day.
    metrics = {k: v for k, v in daily.items()
               if k not in ("date", "readinessSource") and v is not None}
    if not metrics:
        fail("Authenticated, but Garmin returned no metrics at all for today.")

    payload = {
        "daily": daily,
        "activities": build_activities(api),
        "history": build_history(api, today),
    }
    (DATA / "garmin.json").write_text(json.dumps(payload, indent=2) + "\n")

    meta = {}
    try:
        meta = json.loads((DATA / "meta.json").read_text())
    except Exception:
        pass
    meta["lastSync"] = datetime.datetime.now(datetime.timezone.utc).isoformat(
        timespec="seconds").replace("+00:00", "Z")
    meta["garminDate"] = today
    (DATA / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")

    persist_rotated_token(token_file, original_b64)

    print(f"garmin.json updated for {today}: {metrics}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
