#!/bin/bash
# ---------------------------------------------------------------------
#  NF Command Centre — Google Calendar setup (double-click me)
#
#  Run this AFTER you've made the service account in the Google Cloud
#  console and downloaded its JSON key (see SETUP.md §2).
#  This script stores the key as a GitHub secret and wires up which
#  calendars to read.
# ---------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="nfphotos/nf-dashboard"
GH="$HOME/.local/bin/gh"

printf '\n\033[1m NF Command Centre — Google Calendar setup\033[0m\n\n'

if [ ! -x "$GH" ]; then
  echo "❌ Can't find the GitHub CLI at $GH"
  echo; read -r -p "Press return to close…"; exit 1
fi

# ---- locate the key --------------------------------------------------
echo "Drag the downloaded service-account .json file into this window,"
echo "then press return. (It's usually in ~/Downloads.)"
echo
read -r -p "Key file: " KEYPATH
# strip quotes/escapes that Terminal adds when you drag a file in
KEYPATH="${KEYPATH%\"}"; KEYPATH="${KEYPATH#\"}"
KEYPATH="${KEYPATH%\'}"; KEYPATH="${KEYPATH#\'}"
KEYPATH="$(printf '%s' "$KEYPATH" | sed 's/\\ / /g')"

if [ ! -f "$KEYPATH" ]; then
  echo "❌ No file at: $KEYPATH"
  echo; read -r -p "Press return to close…"; exit 1
fi

# ---- sanity-check it's the right kind of file ------------------------
SA_EMAIL="$(python3 -c "
import json,sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    print('BAD_JSON', e); raise SystemExit
if d.get('type') != 'service_account':
    print('NOT_SA'); raise SystemExit
print(d.get('client_email',''))
" "$KEYPATH")"

case "$SA_EMAIL" in
  BAD_JSON*) echo "❌ That file isn't valid JSON."; echo; read -r -p "Press return to close…"; exit 1 ;;
  NOT_SA)    echo "❌ That's a JSON file, but not a service-account key."
             echo "   You want the key downloaded from Service Accounts → Keys → Add key."
             echo; read -r -p "Press return to close…"; exit 1 ;;
esac

echo
echo "· Service account: $SA_EMAIL"
echo
printf '\033[1mBefore continuing, make sure you have SHARED your calendars with that\n'
printf 'address\033[0m (Calendar → Settings and sharing → Share with specific people\n'
echo "→ paste it → \"See all event details\")."
echo "Without that, the sync will authenticate fine and return zero events."
echo
read -r -p "Have you shared them? [y/N] " SHARED
case "$SHARED" in [yY]*) ;; *) echo "Do that first, then run this again."; echo; read -r -p "Press return to close…"; exit 0 ;; esac

# ---- which calendars -------------------------------------------------
echo
echo "Which calendars should it read?"
echo "  1) Personal only          — falzonnicholas01@gmail.com (green events only)"
echo "  2) Personal + Birkirkara  — adds birkirkarafcmedia@gmail.com (all events)"
echo "  3) Let me type them"
read -r -p "Choice [2]: " CHOICE
CHOICE="${CHOICE:-2}"
case "$CHOICE" in
  1) CALS="falzonnicholas01@gmail.com" ;;
  3) echo "Comma-separated. Add ':all' to a calendar to take every event, not just green ones."
     read -r -p "Calendars: " CALS ;;
  *) CALS="falzonnicholas01@gmail.com,birkirkarafcmedia@gmail.com:all" ;;
esac

# ---- store -----------------------------------------------------------
echo
echo "· Storing the key as a GitHub secret…"
"$GH" secret set GOOGLE_SERVICE_ACCOUNT_JSON --repo "$REPO" < "$KEYPATH"

echo "· Setting CALENDAR_IDS = $CALS"
"$GH" variable set CALENDAR_IDS --repo "$REPO" --body "$CALS"

# ---- prove it works --------------------------------------------------
echo
echo "· Running the sync now to check it works…"
"$GH" workflow run "Sync Calendar" --repo "$REPO"
echo "  (started — takes about 30 seconds)"
sleep 30
"$GH" run list --repo "$REPO" --workflow "Sync Calendar" --limit 1

# ---- clean up the credential ----------------------------------------
echo
printf '\033[1mThat .json is a live credential.\033[0m Anyone with it can read those calendars.\n'
read -r -p "Delete $KEYPATH now? [Y/n] " DEL
case "$DEL" in [nN]*) echo "· Left in place — delete it yourself when you're done." ;;
                   *) rm -f "$KEYPATH"; echo "· Deleted." ;; esac

printf '\n\033[1m✅ Done.\033[0m If the run says "success", your calendar is syncing daily.\n'
echo
read -r -p "Press return to close…"
