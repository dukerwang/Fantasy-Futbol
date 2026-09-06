'use client';

/**
 * Heritage — Seasons.
 *
 * A season's podium and cup winners, then the champion's Title-Winning XI on
 * the grass. The pitch is drawn attacking upward, rows in FORMATION_SLOTS
 * order, exactly as the squad pitch does (team/pitch.module.css).
 */

import CrestBadge from '@/components/crest/CrestBadge';
import Trophy from '@/components/trophies/Trophy';
import NavigationLink from '@/components/ui/NavigationLink';
import type { CrestConfig } from '@/components/crest/types';
import type { HonourKind } from '@/lib/honours/getClubHonours';
import type { SeasonXI, XIPlayer } from '@/lib/heritage/seasonXI';
import type { GranularPosition } from '@/types';
import HeritageNav from '../HeritageNav';
import styles from '../heritage.module.css';

interface Club {
  teamId: string;
  teamName: string;
  managerName: string | null;
  crestConfig: CrestConfig | null;
}

interface Props {
  leagueId: string;
  currentSeason: string;
  seasons: string[];
  selected: string | null;
  table: { rank: number; teamId: string; points: number }[];
  cups: { name: string; type: string | null; winnerId: string }[];
  xi: SeasonXI | null;
  clubs: Club[];
  viewerTeamId: string | null;
}

const pts = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const KIND_BY_TYPE: Record<string, HonourKind> = {
  primary_cup: 'champions_cup',
  secondary_cup: 'league_cup',
  consolation_cup: 'consolation_cup',
};

/**
 * Pitch zones, top (attack) to bottom (goal). A slot lands in the first zone
 * that lists it, so every one of the twelve tactical positions has a home.
 */
const ZONES: GranularPosition[][] = [
  ['LW', 'ST', 'RW'],
  ['AM'],
  ['CM'],
  ['DM'],
  ['LWB', 'RWB'],
  ['LB', 'CB', 'RB'],
  ['GK'],
];

export default function SeasonsView({
  leagueId, currentSeason, seasons, selected, table, cups, xi, clubs, viewerTeamId,
}: Props) {
  const byId = new Map(clubs.map((c) => [c.teamId, c]));
  const champion = table.find((t) => t.rank === 1);
  const championClub = champion ? byId.get(champion.teamId) : null;

  const rows = xi
    ? ZONES.map((zone) => xi.starters.filter((p) => zone.includes(p.slot))).filter((r) => r.length)
    : [];

  const Node = ({ p }: { p: XIPlayer }) => (
    <div className={styles.node}>
      <div className={styles.nodeFrame}>
        <svg viewBox="0 0 52 60" width="52" height="60" aria-hidden="true">
          <circle cx="26" cy="24" r="11" fill="rgba(255,255,255,.42)" />
          <path d="M6 60 C 8 42 18 37 26 37 C 34 37 44 42 46 60 Z" fill="rgba(255,255,255,.42)" />
        </svg>
      </div>
      <div className={styles.nodeLine}>
        <span className={styles.nodeChip} data-pos={p.slot}>{p.slot}</span>
        <span className={styles.nodePts}>{pts(p.points)}</span>
      </div>
      <span className={styles.nodeName}>{p.name}</span>
    </div>
  );

  return (
    <div className={styles.page}>
      <div className={styles.mast}>
        <div className={styles.mastTx}>
          <h1 className={styles.title}>Seasons</h1>
          <p className={styles.subtitle}>
            {seasons.length
              ? `${seasons.length} completed, newest first`
              : `${currentSeason} in progress — nothing archived yet`}
          </p>
        </div>
        {seasons.length > 1 && (
          <div className={styles.pills}>
            {seasons.map((s) => (
              <NavigationLink
                key={s}
                href={`/league/${leagueId}/heritage/seasons?season=${s}`}
                className={s === selected ? styles.pillOn : styles.pill}
              >
                {s}
              </NavigationLink>
            ))}
          </div>
        )}
      </div>

      <HeritageNav leagueId={leagueId} active="Seasons" />

      {!selected ? (
        <p className={styles.empty}>
          No season has been archived yet. {currentSeason} is the league&rsquo;s first, and it lands
          here when it ends.
        </p>
      ) : (
        <>
          <div className={styles.block}>
            <div className={styles.sect}>
              <h2 className={styles.sectT}>Season {selected}</h2>
              {championClub && <span className={styles.sectHint}>{championClub.teamName}, champions</span>}
            </div>
            <div className={styles.box}>
              {cups.length > 0 && (
                <div className={styles.cupRow}>
                  {cups.map((c) => {
                    const kind = c.type ? KIND_BY_TYPE[c.type] : undefined;
                    const w = byId.get(c.winnerId);
                    return (
                      <div key={c.name} className={styles.cupWin}>
                        {kind && <Trophy kind={kind} size="pip" height={30} className={styles.pip} />}
                        <div>
                          <div className={styles.boardMgr}>{c.name}</div>
                          <div className={styles.cupWinner}>{w?.teamName ?? 'Unknown'}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {table.slice(0, 3).map((row) => {
                const c = byId.get(row.teamId);
                const medal = row.rank === 1 ? styles.gold : row.rank === 2 ? styles.silver : styles.bronze;
                return (
                  <div
                    key={row.teamId}
                    className={row.teamId === viewerTeamId ? styles.boardRowMine : styles.boardRow}
                  >
                    <span className={`${styles.boardRank} ${medal}`}>{row.rank}</span>
                    {c && (
                      <CrestBadge config={c.crestConfig} size={38} teamName={c.teamName} teamId={c.teamId} interactive={false} />
                    )}
                    <div className={styles.boardId}>
                      <div className={row.rank === 1 ? styles.boardNameMine : styles.boardName}>
                        {c?.teamName ?? 'Unknown'}
                      </div>
                      <div className={styles.boardMgr}>{c?.managerName ?? '—'}</div>
                    </div>
                    <span />
                    <div className={styles.boardCount}>
                      <div className={styles.figV}>{pts(row.points)}</div>
                      <div className={styles.figS}>points</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className={styles.block}>
            <div className={styles.sect}>
              <h2 className={styles.sectT}>Title-Winning XI</h2>
              <span className={styles.sectHint}>
                {xi ? `Most-used player in each position · ${xi.formation}` : 'Derived from archived lineups'}
              </span>
            </div>
            {xi ? (
              <div className={`${styles.box} ${styles.xiBox}`}>
                <div className={styles.pitch}>
                  {rows.map((row, i) => (
                    <div key={i} className={styles.pitchRow}>
                      {row.map((p) => <Node key={p.playerId} p={p} />)}
                    </div>
                  ))}
                </div>
                <div className={styles.xiRail}>
                  <div className={styles.xiFigs}>
                    <div className={styles.fig}>
                      <div className={styles.figV}>{pts(xi.pointsFromXI)}</div>
                      <div className={styles.figS}>Points from the XI</div>
                    </div>
                    <div className={styles.fig}>
                      <div className={styles.figV}>{xi.playersUsed}</div>
                      <div className={styles.figS}>Players used</div>
                    </div>
                  </div>
                  <div className={styles.xiSquadHd}>
                    <span className={styles.recordLabel}>Squad</span>
                    <span className={styles.xiCols}>
                      <span>Starts</span>
                      <span>Points</span>
                    </span>
                  </div>
                  {xi.squad.length ? (
                    xi.squad.map((p) => (
                      <div key={p.playerId} className={styles.xiRow}>
                        <span className={styles.nodeChip} data-pos={p.slot}>{p.slot}</span>
                        <span className={styles.xiName}>{p.name}</span>
                        <span className={styles.xiNum}>{p.appearances}</span>
                        <span className={styles.xiPts}>{pts(p.points)}</span>
                      </div>
                    ))
                  ) : (
                    <p className={styles.cabinetEmpty}>The same eleven started every week.</p>
                  )}
                </div>
              </div>
            ) : (
              <p className={styles.empty}>
                No lineups were archived for {selected}, so the winning side cannot be reconstructed.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
