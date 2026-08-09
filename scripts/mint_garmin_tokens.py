#!/usr/bin/env python3
"""
ONE-TIME LOCAL SETUP — run this on your Mac, never in CI.

Why this exists
---------------
Garmin put Cloudflare in front of their login endpoint in March 2026 and now
rate-limits *per account*. A cron job that logs in with an email + password
burns your account's login budget, and people are reporting 48-72 hour
lockouts of the whole Garmin account — the phone app included.

So: you log in ONCE here, interactively, on your own machine. That produces a
token file. GitHub Actions then uses the token and never touches the login
endpoint again.

Your password is typed by you, into this script, on your machine. It is never
stored, never printed, and never leaves this computer.

Run it:
    cd ~/Developer/nf-dashboard
    python3 -m venv .venv && source .venv/bin/activate
    pip install 'garminconnect==0.3.9' curl_cffi
    python scripts/mint_garmin_tokens.py
"""
import base64
import getpass
import pathlib
import sys

TOKENSTORE = pathlib.Path("~/.garminconnect").expanduser()


def main():
    try:
        from garminconnect import Garmin
    except ImportError:
        sys.exit(
            "garminconnect is not installed. Run:\n"
            "    pip install 'garminconnect==0.3.9' curl_cffi"
        )

    print("Garmin Connect — one-time token setup\n")
    email = input("Garmin email: ").strip()
    password = getpass.getpass("Garmin password (hidden): ")

    api = Garmin(
        email=email,
        password=password,
        # Garmin will ask for an MFA code by email/SMS if your account has it on.
        prompt_mfa=lambda: input("MFA code from Garmin: ").strip(),
    )

    print("\nLogging in…")
    api.login(str(TOKENSTORE))
    print(f"Logged in as: {api.get_full_name()}")

    token_file = TOKENSTORE / "garmin_tokens.json"
    if not token_file.exists():
        sys.exit(f"Expected a token file at {token_file} but it wasn't written.")

    # base64 so the secret survives copy/paste without newline mangling
    encoded = base64.b64encode(token_file.read_bytes()).decode()

    out = pathlib.Path("garmin_token_base64.txt").resolve()
    out.write_text(encoded)
    out.chmod(0o600)

    print(f"\n✅ Token minted → {token_file}")
    print(f"✅ Base64 copy for GitHub → {out}")
    print("\nNEXT STEP — add it as a repo secret, then delete the file:\n")
    print(f"    gh secret set GARMINTOKENS_BASE64 --repo nfphotos/nf-dashboard < {out}")
    print(f"    rm {out}\n")
    print("This token refreshes itself daily. If the sync ever starts failing")
    print("with an auth error, just run this script again.")


if __name__ == "__main__":
    main()
