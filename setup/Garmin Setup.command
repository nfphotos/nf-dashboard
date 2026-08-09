#!/bin/bash
# ---------------------------------------------------------------------
#  NF Command Centre — Garmin setup (double-click me)
#
#  Logs into Garmin ONCE, here on your Mac, and stores the resulting
#  token as a GitHub secret. Your password is typed by you, into this
#  terminal, and is never saved or uploaded — only the token is.
# ---------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="nfphotos/nf-dashboard"
GH="$HOME/.local/bin/gh"

printf '\n\033[1m NF Command Centre — Garmin setup\033[0m\n\n'

# ---- prerequisites ---------------------------------------------------
PY=""
for candidate in /opt/homebrew/bin/python3.13 /opt/homebrew/bin/python3.12 python3.13 python3.12; do
  if command -v "$candidate" >/dev/null 2>&1; then PY="$candidate"; break; fi
done
if [ -z "$PY" ]; then
  echo "❌ Need Python 3.12 or newer (garminconnect requires it)."
  echo "   Install with:  brew install python@3.12"
  echo; read -r -p "Press return to close…"; exit 1
fi
echo "· Using $($PY --version)"

if [ ! -x "$GH" ]; then
  echo "❌ Can't find the GitHub CLI at $GH"
  echo; read -r -p "Press return to close…"; exit 1
fi

# ---- python env ------------------------------------------------------
if [ ! -d .venv ]; then
  echo "· Creating a Python environment (first run only)…"
  "$PY" -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate

echo "· Installing the Garmin library…"
pip install --quiet --upgrade pip
pip install --quiet 'garminconnect==0.3.9' curl_cffi

# ---- mint the token --------------------------------------------------
printf '\n\033[1mGarmin will now ask you to log in.\033[0m\n'
echo "Your password is used once, in this window, to obtain a token."
echo "It is not saved and never leaves this Mac."
echo
python scripts/mint_garmin_tokens.py

# ---- store it --------------------------------------------------------
if [ ! -f garmin_token_base64.txt ]; then
  echo "❌ No token file was produced — login didn't complete."
  echo; read -r -p "Press return to close…"; exit 1
fi

echo
echo "· Storing the token as a GitHub secret…"
"$GH" secret set GARMINTOKENS_BASE64 --repo "$REPO" < garmin_token_base64.txt
rm -f garmin_token_base64.txt
echo "· Local copy deleted."

# ---- prove it works --------------------------------------------------
echo
echo "· Running the sync now to check it works…"
"$GH" workflow run "Sync Garmin" --repo "$REPO"
echo "  (started — takes about 30 seconds)"
sleep 30
"$GH" run list --repo "$REPO" --workflow "Sync Garmin" --limit 1

printf '\n\033[1m✅ Done.\033[0m If that says "success", real Garmin data is flowing.\n'
echo "   If it says failure, run:  $GH run view --repo $REPO --log-failed"
echo
read -r -p "Press return to close…"
