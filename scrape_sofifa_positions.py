"""
Scrapes player positions from sofifa.com for Premier League players.
Outputs sofifa_positions.json in the project root.

Resumable: already-scraped players (with positions or confirmed empty after retry)
are skipped on re-run, so you can safely Ctrl-C and restart.

Usage:
    python3 scrape_sofifa_positions.py
"""

import asyncio
import json
import os
import re
from playwright.async_api import async_playwright

LEAGUE_ID = 13  # Premier League
BASE_URL = "https://sofifa.com"
OUTPUT_FILE = "sofifa_positions.json"
DELAY_MS = 2000          # ms between player page requests (stay under CF rate limit)
MAX_RETRIES = 2          # retries per player if Cloudflare blocks

BROWSER_ARGS = ["--disable-blink-features=AutomationControlled"]
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)


def load_existing() -> dict:
    """Load previously scraped results, keyed by sofifa_id."""
    if not os.path.exists(OUTPUT_FILE):
        return {}
    with open(OUTPUT_FILE) as f:
        data = json.load(f)
    # Only treat as "done" if positions were found (non-empty) OR the record
    # has a proper full_name (not the abbreviated short_name fallback).
    done = {}
    for p in data:
        has_pos = bool(p.get("positions"))
        has_full_name = p.get("full_name") and p["full_name"] != p.get("short_name")
        if has_pos or has_full_name:
            done[p["sofifa_id"]] = p
    return done


def is_cloudflare_page(title: str) -> bool:
    """Detect Cloudflare challenge / error pages."""
    lower = title.lower()
    return "just a moment" in lower or "attention required" in lower or "cloudflare" in lower


async def collect_player_urls(page) -> list[dict]:
    """Paginate through the PL player list and collect sofifa IDs + names."""
    players = []
    offset = 0
    while True:
        url = f"{BASE_URL}/players?lg={LEAGUE_ID}&offset={offset}"
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
                "sofifa_id": sofifa_id,
                "slug": slug,
                "short_name": short_name.strip(),
                "href": href,
            })
            found += 1

        print(f"  offset={offset}: {found} players (total so far: {len(players)})")
        if found == 0:
            break
        offset += 60
        await asyncio.sleep(DELAY_MS / 1000)

    return players


async def scrape_one(page, player: dict) -> dict:
    """Load a single player profile page and extract positions. Returns the result dict."""
    url = f"{BASE_URL}{player['href']}"
    await page.goto(url, wait_until="domcontentloaded", timeout=30000)

    title = await page.title()
    if is_cloudflare_page(title):
        raise RuntimeError(f"Cloudflare block on {player['sofifa_id']}")

    pos_els = await page.query_selector_all(".profile .pos")
    positions = [await el.inner_text() for el in pos_els]

    name_el = await page.query_selector(".profile h1")
    full_name = (await name_el.inner_text()).strip() if name_el else player["short_name"]

    return {**player, "full_name": full_name, "positions": positions}


async def main():
    # Load what we already have
    done = load_existing()
    print(f"Resuming: {len(done)} players already scraped successfully.")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=BROWSER_ARGS)
        context = await browser.new_context(user_agent=USER_AGENT)
        nav_page = await context.new_page()

        # Step 1: collect all PL player URLs
        print("Collecting PL player list...")
        all_players = await collect_player_urls(nav_page)
        await nav_page.close()

        to_scrape = [p for p in all_players if p["sofifa_id"] not in done]
        print(f"Found {len(all_players)} players total — {len(to_scrape)} left to scrape.\n")

        # Step 2: scrape sequentially (1 tab, slow) to avoid Cloudflare rate limits
        page = await context.new_page()
        results = list(done.values())

        for i, player in enumerate(to_scrape):
            success = False
            for attempt in range(1, MAX_RETRIES + 1):
                try:
                    result = await scrape_one(page, player)
                    results.append(result)
                    success = True
                    break
                except Exception as e:
                    print(f"  [{i+1}/{len(to_scrape)}] attempt {attempt} failed for {player['sofifa_id']}: {e}")
                    if attempt < MAX_RETRIES:
                        await asyncio.sleep(5)  # back off before retry

            if not success:
                results.append({**player, "full_name": player["short_name"], "positions": []})

            if (i + 1) % 10 == 0 or (i + 1) == len(to_scrape):
                print(f"  {i+1}/{len(to_scrape)} scraped")
                # Save incrementally so progress isn't lost on crash/interrupt
                with open(OUTPUT_FILE, "w") as f:
                    json.dump(results, f, indent=2)

            await asyncio.sleep(DELAY_MS / 1000)

        await browser.close()

    with open(OUTPUT_FILE, "w") as f:
        json.dump(results, f, indent=2)

    with_pos = [r for r in results if r.get("positions")]
    with_secondary = [r for r in results if len(r.get("positions", [])) > 1]
    print(f"\nDone. {len(with_pos)}/{len(results)} players have positions.")
    print(f"Players with multiple positions: {len(with_secondary)}")
    for r in with_secondary[:5]:
        print(f"  {r['full_name']}: {r['positions']}")


asyncio.run(main())
