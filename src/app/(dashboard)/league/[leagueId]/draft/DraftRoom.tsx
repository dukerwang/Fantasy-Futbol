'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { League, Team, Player, DraftPick } from '@/types';
import styles from './draft.module.css';

const TIMER_SECONDS = 90;

/** Returns the draft_order slot (1-indexed) on the clock for a given pick. */
function snakeDraftOrder(pickNumber: number, numTeams: number): number {
  const round = Math.floor((pickNumber - 1) / numTeams);
  const posInRound = (pickNumber - 1) % numTeams;
  return round % 2 === 0 ? posInRound + 1 : numTeams - posInRound;
}

interface Props {
  leagueId: string;
  league: League;
  teams: Team[];
  initialPicks: DraftPick[];
  allPlayers: Player[];
  myUserId: string;
  myTeam: Team | null;
}

const POSITION_ORDER = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'] as const;

export default function DraftRoom({
  leagueId,
  league,
  teams,
  initialPicks,
  allPlayers,
  myUserId,
  myTeam,
}: Props) {
  const router = useRouter();
  const [picks, setPicks] = useState<DraftPick[]>(initialPicks);
  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState<string>('ALL');
  const [loadingPick, setLoadingPick] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [timerKey, setTimerKey] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(TIMER_SECONDS);
  const currentCellRef = useRef<HTMLTableCellElement>(null);

  const numTeams = teams.length;
  const totalPicks = numTeams * league.roster_size;
  const isDraftComplete = picks.length >= totalPicks || league.status === 'active';

  // Derived: which team is on the clock
  const currentPickNumber = picks.length + 1;
  const currentDraftOrderSlot = isDraftComplete
    ? null
    : snakeDraftOrder(currentPickNumber, numTeams);
  const currentTeam = isDraftComplete
    ? null
    : teams.find((t) => t.draft_order === currentDraftOrderSlot) ?? null;
  const isMyTurn = !isDraftComplete && currentTeam?.user_id === myUserId;
  const currentRound = isDraftComplete
    ? league.roster_size
    : Math.ceil(currentPickNumber / numTeams);

  // Realtime subscription
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`draft:${leagueId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'draft_picks',
          filter: `league_id=eq.${leagueId}`,
        },
        (payload) => {
          const newPick = payload.new as DraftPick;
          setPicks((prev) => {
            if (prev.some((p) => p.id === newPick.id)) return prev;
            return [...prev, newPick];
          });
          // Reset timer on each new pick
          setTimerKey((k) => k + 1);
          setSecondsLeft(TIMER_SECONDS);
          setPickError(null);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId]);

  // Countdown timer
  useEffect(() => {
    if (isDraftComplete) return;
    setSecondsLeft(TIMER_SECONDS);
    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(interval);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [timerKey, isDraftComplete]);

  // Scroll current pick cell into view
  useEffect(() => {
    currentCellRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }, [picks.length]);

  // Build a lookup: player_id → pick
  const pickedPlayerIds = useMemo(() => new Set(picks.map((p) => p.player_id)), [picks]);

  // Build picks lookup: [round][teamId] → DraftPick
  const pickGrid = useMemo(() => {
    const grid: Record<number, Record<string, DraftPick>> = {};
    for (const pick of picks) {
      if (!grid[pick.round]) grid[pick.round] = {};
      grid[pick.round][pick.team_id] = pick;
    }
    return grid;
  }, [picks]);

  // Build per-team pick lists for the roster panel
  const teamPicks = useMemo(() => {
    const map: Record<string, DraftPick[]> = {};
    for (const team of teams) map[team.id] = [];
    for (const pick of picks) {
      if (map[pick.team_id]) map[pick.team_id].push(pick);
    }
    return map;
  }, [picks, teams]);

  // Filtered available players
  const availablePlayers = useMemo(() => {
    return allPlayers.filter((p) => {
      if (pickedPlayerIds.has(p.id)) return false;
      if (posFilter !== 'ALL' && p.primary_position !== posFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (
          !(p.web_name ?? p.name).toLowerCase().includes(q) &&
          !p.pl_team.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [allPlayers, pickedPlayerIds, posFilter, search]);

  const makePick = useCallback(
    async (playerId: string) => {
      if (!isMyTurn || loadingPick) return;
      setLoadingPick(true);
      setPickError(null);

      const res = await fetch(`/api/leagues/${leagueId}/draft/pick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId }),
      });

      const json = await res.json();
      if (!res.ok) {
        setPickError(json.error ?? 'Pick failed');
        setLoadingPick(false);
        return;
      }

      // Realtime will handle adding to picks state; just reset UI
      setLoadingPick(false);
      if (json.status === 'active') router.refresh();
    },
    [isMyTurn, loadingPick, leagueId, router],
  );

  const timerPct = (secondsLeft / TIMER_SECONDS) * 100;
  const timerColor =
    timerPct > 50 ? 'var(--color-accent-green)' : timerPct > 25 ? 'var(--color-accent-yellow)' : 'var(--color-accent-red)';

  // Teams sorted by draft_order for the board columns
  const sortedTeams = [...teams].sort((a, b) => (a.draft_order ?? 0) - (b.draft_order ?? 0));

  return (
    <div className={styles.draftRoot}>
      {/* Banner */}
      <div className={`${styles.banner} ${isDraftComplete ? styles.bannerComplete : isMyTurn ? styles.bannerMyTurn : ''}`}>
        <div className={styles.bannerLeft}>
          {isDraftComplete ? (
            <span className={styles.bannerTitle}>Draft complete! League is now active.</span>
          ) : (
            <>
              <span className={styles.bannerOnClock}>On the clock:</span>
              <span className={styles.bannerTeam}>{currentTeam?.team_name ?? '—'}</span>
            </>
          )}
        </div>
        <div className={styles.bannerRight}>
          {!isDraftComplete && (
            <span className={styles.bannerRound}>
              Round {currentRound} · Pick {currentPickNumber} of {totalPicks}
            </span>
          )}
          {isDraftComplete && (
            <Link href="/my-team" className={styles.goToTeamBtn}>
              View My Team →
            </Link>
          )}
        </div>
      </div>

      {/* Timer */}
      {!isDraftComplete && (
        <div className={styles.timerBar}>
          <div
            className={styles.timerFill}
            style={{ width: `${timerPct}%`, background: timerColor }}
          />
          <span className={styles.timerLabel}>
            {String(Math.floor(secondsLeft / 60)).padStart(1, '0')}:
            {String(secondsLeft % 60).padStart(2, '0')}
          </span>
        </div>
      )}

      {/* 3-panel layout */}
      <div className={styles.panels}>
        {/* Left: Player Picker */}
        <aside className={styles.pickerPanel}>
          <h2 className={styles.panelTitle}>Players</h2>
          <input
            type="text"
            placeholder="Search name or club…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
          />
          <div className={styles.posFilters}>
            {(['ALL', ...POSITION_ORDER] as const).map((pos) => (
              <button
                key={pos}
                type="button"
                onClick={() => setPosFilter(pos)}
                className={`${styles.posBtn} ${posFilter === pos ? styles.posBtnActive : ''}`}
              >
                {pos}
              </button>
            ))}
          </div>

          {pickError && <p className={styles.pickError}>{pickError}</p>}

          <div className={styles.playerList}>
            {availablePlayers.slice(0, 100).map((player) => (
              <div key={player.id} className={styles.playerRow}>
                <div className={styles.playerInfo}>
                  <span className={`${styles.posBadge} ${styles[`pos${player.primary_position}`]}`}>
                    {player.primary_position}
                  </span>
                  <div>
                    <span className={styles.playerName}>{player.web_name ?? player.name}</span>
                    <span className={styles.playerClub}>{player.pl_team}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => makePick(player.id)}
                  disabled={!isMyTurn || loadingPick || isDraftComplete}
                  className={styles.pickBtn}
                >
                  Pick
                </button>
              </div>
            ))}
            {availablePlayers.length === 0 && (
              <p className={styles.emptyPicker}>No players match your search.</p>
            )}
            {availablePlayers.length > 100 && (
              <p className={styles.pickerMore}>
                Showing 100 of {availablePlayers.length}. Narrow your search.
              </p>
            )}
          </div>
        </aside>

        {/* Middle: Draft Board */}
        <main className={styles.boardPanel}>
          <h2 className={styles.panelTitle}>Draft Board</h2>
          <div className={styles.boardScroll}>
            <table className={styles.boardTable}>
              <thead>
                <tr>
                  <th className={styles.roundCell}>Rd</th>
                  {sortedTeams.map((team) => (
                    <th
                      key={team.id}
                      className={`${styles.teamHeaderCell} ${team.user_id === myUserId ? styles.myTeamCol : ''}`}
                    >
                      {team.team_name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: league.roster_size }, (_, ri) => {
                  const roundNum = ri + 1;
                  return (
                    <tr key={roundNum}>
                      <td className={styles.roundCell}>{roundNum}</td>
                      {sortedTeams.map((team) => {
                        const pick = pickGrid[roundNum]?.[team.id];
                        const isCurrentSlot =
                          !isDraftComplete &&
                          currentPickNumber === picks.length + 1 &&
                          roundNum === currentRound &&
                          team.draft_order === currentDraftOrderSlot;

                        return (
                          <td
                            key={team.id}
                            ref={isCurrentSlot ? currentCellRef : undefined}
                            className={`${styles.pickCell} ${
                              pick ? styles.pickCellFilled : ''
                            } ${isCurrentSlot ? styles.pickCellCurrent : ''} ${
                              team.user_id === myUserId ? styles.myTeamCol : ''
                            }`}
                          >
                            {pick ? (
                              <div className={styles.pickedPlayer}>
                                <span
                                  className={`${styles.posBadgeSm} ${styles[`pos${pick.player?.primary_position}`]}`}
                                >
                                  {pick.player?.primary_position}
                                </span>
                                <span className={styles.pickedName}>
                                  {pick.player?.web_name ?? pick.player?.name ?? '—'}
                                </span>
                              </div>
                            ) : isCurrentSlot ? (
                              <span className={styles.onClockDot} />
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </main>

        {/* Right: Team Rosters */}
        <aside className={styles.rosterPanel}>
          <h2 className={styles.panelTitle}>Rosters</h2>
          <div className={styles.rosterList}>
            {sortedTeams.map((team) => {
              const tp = teamPicks[team.id] ?? [];
              return (
                <div key={team.id} className={`${styles.rosterTeam} ${team.user_id === myUserId ? styles.rosterMyTeam : ''}`}>
                  <div className={styles.rosterTeamHeader}>
                    <span className={styles.rosterTeamName}>{team.team_name}</span>
                    <span className={styles.rosterCount}>
                      {tp.length}/{league.roster_size}
                    </span>
                  </div>
                  {tp.length > 0 && (
                    <ul className={styles.rosterPickList}>
                      {tp.map((pick) => (
                        <li key={pick.id} className={styles.rosterPickItem}>
                          <span
                            className={`${styles.posBadgeSm} ${styles[`pos${pick.player?.primary_position}`]}`}
                          >
                            {pick.player?.primary_position}
                          </span>
                          <span className={styles.rosterPickName}>
                            {pick.player?.web_name ?? pick.player?.name ?? '—'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
