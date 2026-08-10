#!/bin/bash
# ---------------------------------------------------------------------
#  NF Command Centre — diary passphrase (double-click me)
#
#  Sets the passphrase that encrypts your personal calendar before it is
#  published. You type it here; it goes straight into GitHub's encrypted
#  secret store. It is never written to a file and never leaves this Mac
#  except as an encrypted secret.
#
#  You'll type the same phrase once into the Diary tab on each device.
# ---------------------------------------------------------------------
set -uo pipefail
cd "$(dirname "$0")/.."
REPO="nfphotos/nf-dashboard"
GH="$HOME/.local/bin/gh"

printf '\n\033[1m NF Command Centre — diary passphrase\033[0m\n\n'

if [ ! -x "$GH" ]; then
  echo "❌ Can't find the GitHub CLI at $GH"
  echo; read -r -p "Press return to close…"; exit 1
fi

echo "Pick something you'll remember — a few unrelated words works well."
echo "It is shown as you type so you can check it, then cleared."
echo

read -r -p "Passphrase: " PASS
if [ -z "${PASS:-}" ]; then
  echo "❌ Nothing entered — no change made."
  echo; read -r -p "Press return to close…"; exit 1
fi

read -r -p "Type it again to confirm: " PASS2
if [ "$PASS" != "$PASS2" ]; then
  echo "❌ They don't match — no change made. Run this again."
  unset PASS PASS2
  echo; read -r -p "Press return to close…"; exit 1
fi

echo
echo "· Storing as a GitHub secret…"
# printf, not echo -n: no trailing newline, or the passphrase you type in the
# app would never match the one used to encrypt.
if ! printf '%s' "$PASS" | "$GH" secret set CALENDAR_PASSPHRASE --repo "$REPO"; then
  echo "❌ Could not set the secret. Is the GitHub CLI signed in? Try: $GH auth status"
  unset PASS PASS2
  echo; read -r -p "Press return to close…"; exit 1
fi
unset PASS PASS2
clear
printf '\033[1m✅ Passphrase stored.\033[0m\n\n'

# Prove it actually landed rather than trusting the exit code.
if "$GH" secret list --repo "$REPO" | grep -q CALENDAR_PASSPHRASE; then
  echo "· Confirmed present on $REPO"
else
  echo "⚠︎ Secret does not appear in the list — something went wrong."
  echo; read -r -p "Press return to close…"; exit 1
fi

echo
echo "· Encrypting and publishing your diary…"
"$GH" workflow run "Sync Calendar" --repo "$REPO" >/dev/null
sleep 30
"$GH" run list --repo "$REPO" --workflow "Sync Calendar" --limit 1

printf '\n\033[1mDone.\033[0m Open the Diary tab and enter the same phrase.\n'
echo "You'll need to enter it once on your phone too."
echo
read -r -p "Press return to close…"
