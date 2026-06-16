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
    dailySteps: 9000,
    sleepHours: 7.5,
    bodyweightKg: 78,        // current — for the trend later
    bodyweightTargetKg: 75
  },

  // Social growth targets (drives the goal bar + posting cadence ring)
  // >>> EDIT THESE <<<
  social: {
    followerGoal: 7500,      // target for @nfalzon_photos
    currentFollowers: 4820,  // updated by social.json when synced
    weeklyPostTarget: 4      // posts/reels per week you're aiming for
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
