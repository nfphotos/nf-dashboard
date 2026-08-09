// =====================================================================
//  PERSONAL CONFIG  —  edit this file, then commit & push.
//  Nothing secret goes here (it's public). Secrets live in GitHub
//  Actions Secrets only. See README.md.
// =====================================================================
window.CONFIG = {
  owner: "Nick",
  // Location for weather + golden hour (Malta by default)
  location: { name: "Malta", lat: 35.9, lon: 14.5, timezone: "Europe/Malta" },

  // Your social handles — used for display + the (optional) sync scripts.
  socials: {
    instagramBusiness: "@nfalzon_photos",  // sports-photography account
    instagramPersonal: "@falzon_mt"        // personal account
  },

  // Fitness goals (drives readiness messaging + progress where shown)
  // >>> EDIT THESE to your real targets <<<
  goals: {
    weeklyRuns: 3,
    // 7,000, not 9,000 or 10,000. Two reasons, both evidence-led:
    //   · The dose-response literature puts the inflection around 7,000/day —
    //     ≥7,000 vs <7,000 is where the association with lower depression risk
    //     sits (RR 0.69, 33 studies, 96,173 adults), and it plateaus by ~7,500.
    //   · A goal you miss 77% of the time is worse than no goal: repeated
    //     failure against a threshold predicts abandonment, not effort.
    // Nick's 90-day average is 6,874 — so this is a target he'll meet about
    // half the time, which is the range where goals actually motivate.
    dailySteps: 7000,
    sleepHours: 7.5,
    bodyweightKg: 78,        // current — for the trend later
    bodyweightTargetKg: 75
  },

  // Wake times you don't get to choose. "HH:MM" 24h, or null to let the
  // dashboard use your own observed Garmin wake time for that weekday.
  // Mon-Wed are 05:00 for the early work start.
  wakeTimes: {
    mon: "05:00", tue: "05:00", wed: "05:00",
    thu: null, fri: null, sat: null, sun: null
  },

  // Daily habits shown as streaks on the Overview. id must be unique.
  habits: [
    { id: "move",  label: "Move / steps", icon: "🏃" },
    { id: "sleep", label: "Sleep well",   icon: "😴" },
    { id: "post",  label: "Create / post", icon: "🎬" }
  ],

  // Garage gym inventory — used to generate workouts
  gym: { dumbbells: true, squatRack: true, barbell: true, pullupBar: false },

  // How readiness maps to the training call (Body Battery + sleep based)
  readiness: {
    highThreshold: 70,   // >= this => push / heavy day
    lowThreshold: 35     // <= this => recovery / mobility
  },

  // Google Calendar: green events = matches/fixtures you're shooting.
  // Colour IDs 10 (Basil) and 2 (Sage) are treated as green.
  // (Calendar IDs + the actual fetch live in scripts/sync_calendar.py.)
  calendar: {
    matchColorIds: ["10", "2"],
    showUpcoming: 12
  }
};
