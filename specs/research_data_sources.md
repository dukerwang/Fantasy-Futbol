# Data Source Research Notes

## API-Football Free Tier (100 req/day)

### Confirmed Available Stats
The following stats ARE available on the free tier via `/fixtures/players`:

| Stat | API Field | Notes |
|------|-----------|-------|
| Minutes played | `games.minutes` | ✅ |
| Goals | `goals.total` | ✅ |
| Assists | `goals.assists` | ✅ |
| Shots total | `shots.total` | ✅ |
| Shots on target | `shots.on` | ✅ |
| Passes total | `passes.total` | ✅ |
| Pass accuracy % | `passes.accuracy` | ✅ (as string, e.g. "85") |
| Key passes | `passes.key` | ✅ |
| Tackles total | `tackles.total` | ✅ |
| Interceptions | `tackles.interceptions` | ✅ |
| Dribbles attempted | `dribbles.attempts` | ✅ |
| Dribbles succeeded | `dribbles.success` | ✅ |
| Yellow cards | `cards.yellow` | ✅ |
| Red cards | `cards.red` | ✅ |
| Penalty saved | `penalty.saved` | ✅ (GK) |
| Penalty missed | `penalty.missed` | ✅ |

### Stats NOT Available on Free Tier
- `big_chances_created` — NOT available on free tier (Pro feature)
- `tackles_won` vs `tackles_total` split — only `total` available
- `clearances` — not available in player stats endpoint
- `blocks` — sometimes available as `tackles.blocks`
- Own goals — NOT directly available (derive from team goals conceded)
- Player's team goals conceded — must be derived from fixture result

### Rate Limit Strategy (100 req/day)
- **GW Stats sync**: 10 matches/GW × 1 req each = 10 requests for full GW coverage ✅
- **Player sync**: 3-5 pages to sync all PL players = 3-5 requests ✅
- **Fixtures fetch**: 1 request for full season schedule ✅
- **Buffer remaining**: ~80+ requests/day buffer for ad-hoc queries

## Transfermarkt Market Values

### Strategy
Use the open-source `transfermarkt-api` (Docker image: `felipeall/transfermarkt-api`).

- Self-host on a free tier VM (e.g., Fly.io free tier, Railway $5/month)
- OR use GitHub Actions cron to scrape weekly and update the Supabase `players.market_value` column
- API endpoint: `GET /players/{player_id}/market_value`

### Frequency
- Update market values once per transfer window (Jan, Aug, Sept)
- Store `market_value_updated_at` to track freshness

### Fallback
If Transfermarkt scraping proves unreliable:
- Use FBRef's publicly accessible player value estimates
- OR allow manual commissioner override for market values

## FBRef (Scraping Fallback for Missing Stats)

FBRef provides `big chances created`, `clearances`, and other granular stats
via its match reports. These can be scraped using BeautifulSoup/Playwright
and cached in Supabase.

**Risk**: FBRef TOS discourages scraping but this is for personal/private use.

## Conclusion
- API-Football free tier covers ~85% of scoring stats
- `big_chances_created` must be set to 0 or scraped from FBRef
- Transfermarkt values require self-hosted wrapper or weekly GitHub Actions job
- The scoring system is viable on a $0 budget
