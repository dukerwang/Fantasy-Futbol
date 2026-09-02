#!/bin/bash
# Wrapper for launchd (~/Library/LaunchAgents/com.gaffa.transfermarkt-*.plist).
# Runs from a real machine/IP, unlike GitHub Actions' shared runners, which
# Transfermarkt blocks outright — see the two sync-transfermarkt*.yml workflows'
# comments for that history. loadEnvLocal() inside the script reads .env.local
# from the repo root, so no env setup needed here beyond cd'ing into place.
set -euo pipefail
cd "/Users/dukewang/Fantasy Futbol"
# --import registers scratch/ts-ext-resolver.mjs, which teaches plain Node the
# two things Next does for free: extensionless relative imports and the `@/`
# alias. Without it the script still gap-fills fine, but its final step —
# seeding auctions for anything it just priced above the threshold — dies on
# ERR_MODULE_NOT_FOUND inside a try/catch that only logs. That failed silently
# on every daily run, which is exactly the case the step exists for: a new
# arrival gets a value, and nobody gets an auction.
exec /opt/homebrew/bin/node --experimental-strip-types --no-warnings \
  --import ./scratch/register-ts.mjs \
  scripts/sync_transfermarkt_gaps.ts "$@"
