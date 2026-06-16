#!/usr/bin/env python3
"""
Pull daily health + recent activities from Garmin Connect and write
data/garmin.json + update data/meta.json.

Runs in GitHub Actions on a schedule. Credentials come from env/secrets:
  GARMIN_EMAIL, GARMIN_PASSWORD

Local test:  GARMIN_EMAIL=... GARMIN_PASSWORD=... python scripts/sync_garmin.py
"""
import os, json, datetime, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

def main():
    email = os.environ.get("GARMIN_EMAIL")
    pw = os.environ.get("GARMIN_PASSWORD")
    if not email or not pw:
        print("Missing GARMIN_EMAIL / GARMIN_PASSWORD — skipping.", file=sys.stderr)
        return 0

    from garminconnect import Garmin

    api = Garmin(email, pw)
    api.login()

    today = datetime.date.today().isoformat()

    def safe(fn, *a, default=None):
        try:
            return fn(*a)
        except Exception as e:  # noqa
            print(f"warn: {fn.__name__} failed: {e}", file=sys.stderr)
            return default

    stats = safe(api.get_stats, today, default={}) or {}
    bb = safe(api.get_body_battery, today, today, default=[]) or []
    sleep = safe(api.get_sleep_data, today, default={}) or {}
    hrv = safe(api.get_hrv_data, today, default={}) or {}

    # Body Battery high/low for the day
    bb_high = bb_low = None
    if bb and isinstance(bb, list) and bb[0].get("bodyBatteryValuesArray"):
        vals = [v[1] for v in bb[0]["bodyBatteryValuesArray"] if v[1] is not None]
        if vals:
            bb_high, bb_low = max(vals), min(vals)

    sleep_secs = (sleep.get("dailySleepDTO") or {}).get("sleepTimeSeconds")
    sleep_hours = round(sleep_secs / 3600, 1) if sleep_secs else None
    hrv_avg = (hrv.get("hrvSummary") or {}).get("lastNightAvg")

    # Simple readiness proxy: prefer Garmin's if present, else Body Battery high.
    readiness = (stats.get("trainingReadiness") or {}).get("score") if isinstance(
        stats.get("trainingReadiness"), dict) else None
    if readiness is None:
        readiness = bb_high

    daily = {
        "date": today,
        "readiness": readiness,
        "bodyBatteryHigh": bb_high,
        "bodyBatteryLow": bb_low,
        "sleepHours": sleep_hours,
        "steps": stats.get("totalSteps"),
        "hrv": hrv_avg,
        "restingHR": stats.get("restingHeartRate"),
        "stress": stats.get("averageStressLevel"),
        "vo2max": stats.get("vo2MaxValue") or stats.get("vO2MaxValue"),
        "trainingLoad": (stats.get("trainingLoad") or {}).get("acuteLoad")
            if isinstance(stats.get("trainingLoad"), dict) else stats.get("trainingLoad"),
    }

    activities = []
    for a in (safe(api.get_activities, 0, 5, default=[]) or []):
        dur = a.get("duration") or 0
        dist = a.get("distance") or 0
        activities.append({
            "name": a.get("activityName") or a.get("activityType", {}).get("typeKey", "Activity"),
            "distance": f"{dist/1000:.1f} km" if dist else "",
            "duration": f"{int(dur//60)}:{int(dur%60):02d}" if dur else "",
        })

    (DATA / "garmin.json").write_text(json.dumps(
        {"daily": daily, "activities": activities}, indent=2))
    (DATA / "meta.json").write_text(json.dumps(
        {"lastSync": datetime.datetime.utcnow().isoformat() + "Z"}, indent=2))
    print("garmin.json updated:", {k: v for k, v in daily.items() if v is not None})
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
