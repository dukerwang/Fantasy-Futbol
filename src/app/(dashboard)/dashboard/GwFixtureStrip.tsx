'use client';

import { useState } from 'react';
import type { GwFixture } from '@/lib/fpl/fixtures';
import styles from './dashboard.module.css';

function formatFixtureScore(f: GwFixture): string {
  if (!f.started) return '–';
  return `${f.homeScore ?? 0}–${f.awayScore ?? 0}`;
}

function formatFixtureMeta(f: GwFixture) {
  if (f.started && !f.finished) return { text: `${f.minutes}′`, live: true };
  if (f.finished) return { text: 'FT', live: false };
  if (f.kickoff) {
    const d = new Date(f.kickoff);
    return {
      text: d.toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }),
      live: false,
    };
  }
  return { text: 'TBC', live: false };
}

interface FixtureDay {
  key: string;
  tabLabel: string;
  fixtures: GwFixture[];
}

function groupFixturesByDay(fixtures: GwFixture[]): FixtureDay[] {
  const days: FixtureDay[] = [];
  for (const f of fixtures) {
    const key = f.kickoff
      ? new Date(f.kickoff).toLocaleDateString('en-GB', { timeZone: 'Europe/London' })
      : 'tbc';
    let day = days.find((d) => d.key === key);
    if (!day) {
      const tabLabel = f.kickoff
        ? new Date(f.kickoff).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'Europe/London' })
        : 'TBC';
      day = { key, tabLabel, fixtures: [] };
      days.push(day);
    }
    day.fixtures.push(f);
  }
  return days;
}

export default function GwFixtureStrip({ fixtures }: { fixtures: GwFixture[] }) {
  const days = groupFixturesByDay(fixtures);
  const defaultIndex = days.findIndex((d) => d.fixtures.some((f) => !f.finished));
  const [selected, setSelected] = useState(defaultIndex === -1 ? days.length - 1 : defaultIndex);

  if (days.length === 0) return null;
  const activeDay = days[selected];

  return (
    <div className={styles.gwFixtures}>
      <div className={styles.fixtureDayTabs} role="tablist">
        {days.map((day, i) => (
          <button
            key={day.key}
            type="button"
            role="tab"
            aria-selected={i === selected}
            className={i === selected ? styles.fixtureDayTabActive : styles.fixtureDayTab}
            onClick={() => setSelected(i)}
          >
            {day.tabLabel}
          </button>
        ))}
      </div>
      <div className={styles.fixtureDayRow}>
        {activeDay.fixtures.map((f) => {
          const meta = formatFixtureMeta(f);
          return (
            <div key={f.id} className={styles.fixture}>
              <div className={styles.fixtureTopRow}>
                {f.homeBadge ? (
                  <img src={f.homeBadge} alt="" className={styles.fixtureCrest} />
                ) : (
                  <span className={styles.fixtureCrestPlaceholder} />
                )}
                <span className={styles.fixtureScore}>{formatFixtureScore(f)}</span>
                {f.awayBadge ? (
                  <img src={f.awayBadge} alt="" className={styles.fixtureCrest} />
                ) : (
                  <span className={styles.fixtureCrestPlaceholder} />
                )}
              </div>
              <div className={styles.fixtureBottomRow}>
                <span className={styles.fixtureShort}>{f.homeShort}</span>
                <span className={meta.live ? styles.fixtureLive : styles.fixtureMeta}>{meta.text}</span>
                <span className={styles.fixtureShort}>{f.awayShort}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
