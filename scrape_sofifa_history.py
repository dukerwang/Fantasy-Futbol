"""
Scrapes player positions from sofifa.com for the current and past 2 seasons (Premier League).
Outputs sofifa_positions_history.json.

Usage:
    python3 scrape_sofifa_history.py
"""

import asyncio
import json
import os
import re
from playwright.async_api import async_playwright

LEAGUE_ID = 13  # Premier League
BASE_URL = "https://sofifa.com"
OUTPUT_FILE = "sofifa_positions_history.json"
DELAY_MS = 2000
MAX_RETRIES = 2

# Legacy mappings to map old Sofifa positions to our current granular set
LEGACY_POS_MAP = {
    "RWB": "RB",
    "LWB": "LB",
    "LF": "LW",
    "RF": "RW",
    "CF": "ST"
}

ROSTER_VERSIONS = {
    "2023-24": "?r=230054&set=true",  # FIFA 23
    "2024-25": "?r=240052&set=true",  # FC 24
    "2025-26": "?r=250036&set=true"   # FC 25 (Latest or specific snapshot)
}

BROWSER_ARGS = ["--disable-blink-features=AutomationControlled"]
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

def load_existing() -> dict:
    if not os.path.exists(OUTPUT_FILE):
        return {}
    with open(OUTPUT_FILE) as f:
        data = json.load(f)
    return {p["sofifa_id_version"]: p for p in data if p.get("positions")}

def is_cloudflare_page(title: str) -> bool:
    lower = title.lower()
    return "just a moment" in lower or "attention required" in lower or "cloudflare" in lower

async def collect_player_urls(page, season, version_query) -> list[dict]:
    players = []
    offset = 0
    while True:
        url = f"{BASE_URL}/players{version_query}&lg={LEAGUE_ID}&offset={offset}"
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        rows = await page.query_selector_all("table tbody tr")
        if not rows:
            break

        found = 0
        for row in rows:
            link_el = await row.query_selector('td a[href*="/player/"]')
            if not link_el:
                continue
            href = await link_el.get_attribute("href")
            m = re.match(r"/player/(\d+)/([^/]+)/", href)
            if not m:
                continue
            sofifa_id = int(m.group(1))
            slug = m.group(2)
            short_name = await link_el.inner_text()
            players.append({
                "sofifa_id_version": f"{sofifa_id}_{season}",
                "sofifa_id": sofifa_id,
                "season": season,
                "slug": slug,
                "short_name": short_name.strip(),
                "href": href,
            })
            found += 1

        print(f"  [{season}] offset={offset}: {found} players (total so far: {len(players)})")
        if found == 0:
            break
        offset += 60
        await asyncio.sleep(DELAY_MS / 1000)

    return players

async def scrape_one(page, player: dict, version_query: str) -> dict:
    url = f"{BASE_URL}{player['href']}{version_query}"
    await page.goto(url, wait_until="domcontentloaded", timeout=30000)

    title = await page.title()
    if is_cloudflare_page(title):
        raise RuntimeError(f"Cloudflare block on {player['sofifa_id']}")

    pos_els = await page.query_selector_all(".profile .pos")
    raw_positions = [await el.inner_text() for el in pos_els]
    
    # Map legacy positions immediately
    mapped_positions = []
    for p in raw_positions:
        clean_p = p.strip()
        mapped_positions.append(LEGACY_POS_MAP.get(clean_p, clean_p))

    name_el = await page.query_selector(".profile h1")
    full_name = (await name_el.inner_text()).strip() if name_el else player["short_name"]

    return {**player, "full_name": full_name, "positions": list(dict.fromkeys(mapped_positions))}

async def main():
    done = load_existing()
    print(f"Resuming: {len(done)} player/season records already scraped successfully.")

    results = list(done.values())

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=BROWSER_ARGS)
        context = await browser.new_context(user_agent=USER_AGENT)
        
        for season, version_query in ROSTER_VERSIONS.items():
            print(f"\n=============================")
            print(f"Processing Season: {season}")
            print(f"=============================")
            
            nav_page = await context.new_page()
            all_players = await collect_player_urls(nav_page, season, version_query)
            await nav_page.close()

            to_scrape = [p for p in all_players if p["sofifa_id_version"] not in done]
            print(f"Found {len(all_players)} players total — {len(to_scrape)} left to scrape.\n")

            page = await context.new_page()

            for i, player in enumerate(to_scrape):
                success = False
                for attempt in range(1, MAX_RETRIES + 1):
                    try:
                        result = await scrape_one(page, player, version_query)
                        results.append(result)
                        success = True
                        break
                    except Exception as e:
                        print(f"  [{i+1}/{len(to_scrape)}] attempt {attempt} failed for {player['sofifa_id']}: {e}")
                        if attempt < MAX_RETRIES:
                            await asyncio.sleep(5)

                if not success:
                    results.append({**player, "full_name": player["short_name"], "positions": []})

                if (i + 1) % 10 == 0 or (i + 1) == len(to_scrape):
                    print(f"  {i+1}/{len(to_scrape)} scraped")
                    with open(OUTPUT_FILE, "w") as f:
                        json.dump(results, f, indent=2)

                await asyncio.sleep(DELAY_MS / 1000)

            await page.close()
            
        await browser.close()
        
    print("\nDone scraping all 3 seasons.")

if __name__ == "__main__":
    asyncio.run(main())
