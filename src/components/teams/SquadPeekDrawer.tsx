'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import NavigationLink from '@/components/ui/NavigationLink';
import CrestBadge from '@/components/crest/CrestBadge';
import type { CrestConfig } from '@/components/crest/types';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import type { PeekPlayer, SquadPeek } from '@/lib/teams/squadPeekTypes';
import { clubHref } from '@/lib/teams/clubHref';
import styles from './SquadPeek.module.css';

/**
 * A club, read at a glance, without leaving the page you're on.
 *
 * The shape of the XI is the point. A list of 20 names tells you a rival has
 * four centre-backs; the pitch tells you three of them start, which is the fact
 * that decides whether it's worth asking for one.
 */

interface Props {
  leagueId: string;
  teamId: string;
  placeholderName: string | null;
  data: SquadPeek | null;
  error: string | null;
  onClose: () => void;
}

/* Same six-band pitch the matchup view uses, so a formation reads identically
   in both places. Anything unmapped falls to midfield rather than vanishing. */
type Zone = 'ATT' | 'AMZ' | 'CMZ' | 'DMZ' | 'WBZ' | 'DEF' | 'GK';
const ZONE_ORDER: Zone[] = ['ATT', 'AMZ', 'CMZ', 'DMZ', 'WBZ', 'DEF', 'GK'];
const SLOT_TO_ZONE: Record<string, Zone> = {
  LW: 'ATT', ST: 'ATT', RW: 'ATT',
  AM: 'AMZ',
  DM: 'DMZ',
  CM: 'CMZ',
  LWB: 'WBZ', RWB: 'WBZ',
  CB: 'DEF', LB: 'DEF', RB: 'DEF',
  GK: 'GK',
};
const SLOT_COLOR: Record<string, string> = {
  GK: 'var(--color-pos-gk)',
  LB: 'var(--color-pos-fb)', RB: 'var(--color-pos-fb)', CB: 'var(--color-pos-cb)',
  LWB: 'var(--color-pos-wb)', RWB: 'var(--color-pos-wb)',
  DM: 'var(--color-pos-dm)', CM: 'var(--color-pos-cm)', AM: 'var(--color-pos-am)',
  LW: 'var(--color-pos-lw)', RW: 'var(--color-pos-rw)', ST: 'var(--color-pos-st)',
};

const BENCH_LABEL: Record<string, string> = { DEF: 'Def', MID: 'Mid', ATT: 'Att', FLEX: 'Flex' };

export default function SquadPeekDrawer({
  leagueId, teamId, placeholderName, data, error, onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Held in a ref so the mount effect below never re-runs (and never steals
  // focus back) just because a parent re-rendered with a new inline onClose.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Escape closes and the page behind is frozen — same contract as the
  // transfers Modal, so the two never feel like different apps.
  //
  // The body flag is how a dialog underneath knows to keep its hands off that
  // Escape. The drawer can open over an already-open modal (peeking at a
  // counterparty mid-offer), and both listen on `document`: without this the
  // one keypress would dismiss the drawer AND throw away the half-built offer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.dataset.squadPeekOpen = 'true';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      delete document.body.dataset.squadPeekOpen;
    };
  }, []);

  if (typeof document === 'undefined') return null;

  const title = data?.team.name ?? placeholderName ?? 'Club';

  return createPortal(
    <div className={styles.scrim} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} squad`}
        tabIndex={-1}
      >
        <header className={styles.header}>
          <CrestBadge
            config={(data?.team.crestConfig as CrestConfig) ?? undefined}
            teamName={title}
            size={44}
          />
          <div className={styles.headTitles}>
            <h2 className={styles.headName}>{title}</h2>
            <p className={styles.headMeta}>
              {data ? (
                <>
                  <span>{data.team.manager}</span>
                  {data.standing.rank != null && (
                    <>
                      <span className={styles.dot}>·</span>
                      <span className={styles.rank}>{ordinal(data.standing.rank)}</span>
                      <span>of {data.standing.ofTeams}</span>
                    </>
                  )}
                  <span className={styles.dot}>·</span>
                  <span>{data.standing.w}W {data.standing.d}D {data.standing.l}L</span>
                </>
              ) : (
                <span>Loading…</span>
              )}
            </p>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className={styles.body}>
          {error && <p className={styles.error}>{error}</p>}

          {!data && !error && <PeekSkeleton />}

          {data && (
            <>
              <div className={styles.figs}>
                <Fig k="Club Balance" v={`€${data.team.balance}m`} />
                <Fig k="Points For" v={data.standing.pointsFor.toLocaleString('en-GB')} />
                <Fig
                  k="Squad"
                  v={String(data.counts.squad)}
                  sub={data.counts.academy > 0 ? `+${data.counts.academy} academy` : undefined}
                />
              </div>

              {data.lineup ? (
                <section className={styles.section}>
                  <div className={styles.sectionHead}>
                    <h3 className={styles.sectionTitle}>{data.lineup.formation}</h3>
                    <span className={styles.sectionNote}>
                      {data.lineup.played ? 'as played' : 'as set'} · GW{data.lineup.gameweek}
                    </span>
                  </div>

                  <div className={styles.pitch}>
                    {ZONE_ORDER.map((zone) => {
                      const row = data.lineup!.starters.filter(
                        (s) => (SLOT_TO_ZONE[s.slot] ?? 'CMZ') === zone,
                      );
                      if (row.length === 0) return null;
                      return (
                        <div key={zone} className={`${styles.pitchRow} ${zone === 'WBZ' ? styles.pitchRowWBZ : ''}`}>
                          {row.map((s, i) => (
                            <Chip key={`${zone}-${i}`} slot={s.slot} player={s.player} />
                          ))}
                        </div>
                      );
                    })}
                  </div>

                  <div className={styles.bench}>
                    {data.lineup.bench.map((b) => (
                      <div key={b.slot} className={styles.benchSlot}>
                        <span className={styles.benchLabel}>{BENCH_LABEL[b.slot] ?? b.slot}</span>
                        <span className={styles.benchName}>
                          {b.player ? displayName(b.player) : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : (
                <p className={styles.empty}>
                  No lineup saved yet — this club hasn’t set a matchday side.
                </p>
              )}

              {data.groups.map((g) => (
                <section key={g.key} className={styles.section}>
                  <div className={styles.sectionHead}>
                    <h3 className={styles.sectionTitle}>{g.label}</h3>
                    <span className={styles.sectionNote}>{g.players.length}</span>
                  </div>
                  <ul className={styles.list}>
                    {g.players.map((p) => (
                      <li key={p.id} className={styles.listRow}>
                        <span
                          className={styles.pos}
                          style={{
                            color: SLOT_COLOR[p.pos] ?? 'var(--color-text-muted)',
                            background: `color-mix(in srgb, ${SLOT_COLOR[p.pos] ?? 'var(--color-text-muted)'} 14%, transparent)`,
                          }}
                        >
                          {p.pos}
                        </span>
                        <span className={styles.listName}>{displayName(p)}</span>
                        <span className={styles.listClub}>{p.plTeam ?? ''}</span>
                        <span className={styles.listPts}>{p.points}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
        </div>

        <footer className={styles.footer}>
          <NavigationLink
            href={clubHref(leagueId, teamId, data?.team.isMine ?? false)}
            className={styles.footBtn}
            onClick={onClose}
          >
            Open club
          </NavigationLink>
          {data && !data.team.isMine && (
            <NavigationLink
              href={`/league/${leagueId}/transfers/deals?proposeTeam=${teamId}`}
              className={`${styles.footBtn} ${styles.footBtnPrimary}`}
              onClick={onClose}
            >
              Propose a deal
            </NavigationLink>
          )}
        </footer>
      </aside>
    </div>,
    document.body,
  );
}

function Chip({ slot, player }: { slot: string; player: PeekPlayer | null }) {
  const color = SLOT_COLOR[slot] ?? 'var(--color-text-muted)';
  return (
    <div className={styles.chip} style={{ borderColor: `color-mix(in srgb, ${color} 45%, transparent)` }}>
      <span className={styles.chipSlot} style={{ color }}>{slot}</span>
      <span className={styles.chipName}>{player ? displayName(player) : '—'}</span>
    </div>
  );
}

function Fig({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className={styles.fig}>
      <span className={styles.figK}>{k}</span>
      <span className={styles.figV}>{v}</span>
      {sub && <span className={styles.figSub}>{sub}</span>}
    </div>
  );
}

function PeekSkeleton() {
  return (
    <div className={styles.skeleton} aria-hidden>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className={styles.skelRow} />
      ))}
    </div>
  );
}

function displayName(p: PeekPlayer): string {
  return getPlayerDisplayName({ name: p.name, web_name: p.webName }, 'initial_last');
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
