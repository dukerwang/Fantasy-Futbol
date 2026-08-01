#!/bin/bash
# Wrapper for launchd (~/Library/LaunchAgents/com.gaffa.transfermarkt-*.plist).
# Runs from a real machine/IP, unlike GitHub Actions' shared runners, which
# Transfermarkt blocks outright — see the two sync-transfermarkt*.yml workflows'
# comments for that history. loadEnvLocal() inside the script reads .env.local
# from the repo root, so no env setup needed here beyond cd'ing into place.
set -euo pipefail
cd "/Users/dukewang/Fantasy Futbol"
exec /opt/homebrew/bin/node --experimental-strip-types scripts/sync_transfermarkt_gaps.ts "$@"
