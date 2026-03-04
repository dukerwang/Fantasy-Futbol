'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { List } from 'react-window';
import { createClient } from '@/lib/supabase/client';
import { formatPlayerName } from '@/types';
import type { League, Team, Player, DraftPick } from '@/types';
import PlayerDetailsModal from '@/components/players/PlayerDetailsModal';
import styles from './draft.module.css';

const TIMER_SECONDS = 90;
const QUEUE_STORAGE_KEY = (leagueId: string, teamId: string) =>
  `draft-queue:${leagueId}:${teamId}`;

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

// PlayerRow props passed via rowProps (react-window v2)
interface PlayerRowCustomProps {
  players: Player[];
  queue: string[];
  myTurn: boolean;
  picking: boolean;
  draftDone: boolean;
  onToggleQueue: (id: string) => void;
  onMakePick: (id: string) => void;
  onSelectPlayer: (p: Player) => void;
}

function PlayerRow({
  index,
  style,
  players,
  queue,
  myTurn,
  picking,
  draftDone,
  onToggleQueue,
  onMakePick,
  onSelectPlayer,
}: { index: number; style: React.CSSProperties; ariaAttributes: Record<string, unknown> } & PlayerRowCustomProps) {
  const player = players[index];
  if (!player) return null;
  const isQueued = queue.includes(player.id);

  return (
    <div
      style={style}
      className={styles.playerRow}
      onClick={() => onSelectPlayer(player)}
    >
      <div className={styles.playerInfo}>
        <span className={`${styles.posBadge} ${styles[`pos${player.primary_position}`]}`}>
          {player.primary_position}
        </span>
        <div>
          <span className={styles.playerName}>{formatPlayerName(player)}</span>
          <span className={styles.playerClub}>{player.pl_team}</span>
        </div>
      </div>
      <div className={styles.playerActions}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleQueue(player.id);
          }}
          className={`${styles.queueBtn} ${isQueued ? styles.queueBtnActive : ''}`}
          title={isQueued ? 'Remove from queue' : 'Add to queue'}
        >
          {isQueued ? '\u2605' : '\u2606'}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onMakePick(player.id);
          }}
          disabled={!myTurn || picking || draftDone}
          className={styles.pickBtn}
        >
          Pick
        </button>
      </div>
    </div>
  );
}

// Animation variants for draft board picks
const pickVariants = {
  hidden: { opacity: 0, scale: 0.5 },
  visible: { opacity: 1, scale: 1, transition: { type: 'spring' as const, stiffness: 300, damping: 24 } },
};

const rosterItemVariants = {
  hidden: { opacity: 0, x: 20 },
  visible: { opacity: 1, x: 0, transition: { type: 'spring' as const, stiffness: 250, damping: 20 } },
};

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
  const [animatedPickIds, setAnimatedPickIds] = useState<Set<string>>(
    () => new Set(initialPicks.map((p) => p.id))
  );
  const [optimisticPick, setOptimisticPick] = useState<DraftPick | null>(null);

  // Sync server props to client state when polling via router.refresh() fetches new data
  useEffect(() => {
    setPicks((prev) => {
      // Merge: keep any picks not yet in server data (optimistic), add new server picks
      const serverIds = new Set(initialPicks.map((p) => p.id));
      // If server has caught up to our optimistic pick, drop the optimistic
      if (optimisticPick && serverIds.has(optimisticPick.id)) {
        setOptimisticPick(null);
      }
      // Prefer server data as the source of truth
      if (initialPicks.length >= prev.length) return initialPicks;
      return prev;
    });
  }, [initialPicks, optimisticPick]);

  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState<string>('ALL');
  const [loadingPick, setLoadingPick] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(TIMER_SECONDS);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [mobileView, setMobileView] = useState<'board' | 'picks'>('picks');
  const [showQueue, setShowQueue] = useState(false);
  const currentCellRef = useRef<HTMLTableCellElement>(null);
  const boardScrollRef = useRef<HTMLDivElement>(null);
  const playerListRef = useRef<HTMLDivElement>(null);
  const autoPickTriggeredRef = useRef(false);

  // Draft Queue (persisted in localStorage)
  const [draftQueue, setDraftQueue] = useState<string[]>([]);
  useEffect(() => {
    if (!myTeam) return;
    try {
      const stored = localStorage.getItem(QUEUE_STORAGE_KEY(leagueId, myTeam.id));
      if (stored) setDraftQueue(JSON.parse(stored));
    } catch { /* ignore */ }
  }, [leagueId, myTeam]);

  const saveDraftQueue = useCallback(
    (queue: string[]) => {
      setDraftQueue(queue);
      if (myTeam) {
        localStorage.setItem(QUEUE_STORAGE_KEY(leagueId, myTeam.id), JSON.stringify(queue));
      }
    },
    [leagueId, myTeam],
  );

  const toggleQueue = useCallback(
    (playerId: string) => {
      saveDraftQueue(
        draftQueue.includes(playerId)
          ? draftQueue.filter((id) => id !== playerId)
          : [...draftQueue, playerId],
      );
    },
    [draftQueue, saveDraftQueue],
  );

  const moveQueueItem = useCallback(
    (playerId: string, direction: 'up' | 'down') => {
      const idx = draftQueue.indexOf(playerId);
      if (idx === -1) return;
      const newQueue = [...draftQueue];
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= newQueue.length) return;
      [newQueue[idx], newQueue[swapIdx]] = [newQueue[swapIdx], newQueue[idx]];
      saveDraftQueue(newQueue);
    },
    [draftQueue, saveDraftQueue],
  );

  const numTeams = teams.length;
  const totalPicks = numTeams * league.roster_size;
  const effectivePicks = optimisticPick
    ? [...picks.filter((p) => p.id !== optimisticPick.id), optimisticPick]
    : picks;
  const isDraftComplete = effectivePicks.length >= totalPicks || league.status === 'active';

  // Derived: which team is on the clock
  const currentPickNumber = effectivePicks.length + 1;
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

  // Supabase Broadcast subscription (replaces postgres_changes)
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`draft:${leagueId}`)
      // Primary: listen for broadcast events (instant, no RLS issues)
      .on('broadcast', { event: 'new_pick' }, (payload) => {
        const newPick = payload.payload as DraftPick;
        setPicks((prev) => {
          if (prev.some((p) => p.id === newPick.id)) return prev;
          return [...prev, newPick].sort((a, b) => a.pick - b.pick);
        });
        // Track that this pick was added via broadcast (already shown, no need to animate again)
        setAnimatedPickIds((prev) => new Set(prev).add(newPick.id));
        // Clear optimistic pick if broadcast confirms it
        setOptimisticPick((prev) => (prev?.player_id === newPick.player_id ? null : prev));
        setPickError(null);
      })
      // Fallback: postgres_changes still active as safety net
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
            return [...prev, newPick].sort((a, b) => a.pick - b.pick);
          });
          setAnimatedPickIds((prev) => new Set(prev).add(newPick.id));
          setOptimisticPick((prev) => (prev?.player_id === newPick.player_id ? null : prev));
          setPickError(null);
        },
      )
      // Draft completion broadcast
      .on('broadcast', { event: 'draft_complete' }, () => {
        router.refresh();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId, router]);

  // Reduced polling frequency since we now have reliable broadcast (15s instead of 5s)
  useEffect(() => {
    if (isDraftComplete) return;
    const interval = setInterval(() => {
      router.refresh();
    }, 15000);
    return () => clearInterval(interval);
  }, [isDraftComplete, router]);

  // Sound effects
  const tickAudioRef = useRef<HTMLAudioElement | null>(null);
  const pickAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Preload audio (gracefully fail if files don't exist)
    tickAudioRef.current = new Audio('/sounds/tick.mp3');
    tickAudioRef.current.volume = 0.3;
    pickAudioRef.current = new Audio('/sounds/pick.mp3');
    pickAudioRef.current.volume = 0.5;
  }, []);

  // Play tick sound at 10 seconds
  useEffect(() => {
    if (secondsLeft === 10 && !isDraftComplete) {
      tickAudioRef.current?.play().catch(() => { });
    }
  }, [secondsLeft, isDraftComplete]);

  // Play pick sound on new picks
  const prevPickCountRef = useRef(picks.length);
  useEffect(() => {
    if (picks.length > prevPickCountRef.current) {
      pickAudioRef.current?.play().catch(() => { });
    }
    prevPickCountRef.current = picks.length;
  }, [picks.length]);

  // Global Countdown timer
  useEffect(() => {
    if (isDraftComplete) return;

    // Reset lock when a new pick lands
    autoPickTriggeredRef.current = false;

    const latestPickTimeStr = effectivePicks.length > 0
      ? effectivePicks[effectivePicks.length - 1].picked_at
      : league.updated_at;

    const latestPickDate = new Date(latestPickTimeStr ?? Date.now());

    const updateTimer = () => {
      const now = new Date();
      const elapsed = Math.floor((now.getTime() - latestPickDate.getTime()) / 1000);
      const remain = Math.max(0, TIMER_SECONDS - elapsed);
      setSecondsLeft(remain);

      // Client Fallback: Execute auto-pick
      if (remain === 0 && isMyTurn && !autoPickTriggeredRef.current) {
        autoPickTriggeredRef.current = true;
        setPickError('Time expired! Auto-picking...');
        fetch(`/api/leagues/${leagueId}/draft/auto-pick`, { method: 'POST' })
          .then(() => router.refresh())
          .catch(console.error);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [effectivePicks, isDraftComplete, league.updated_at]);

  // Scroll current pick column into view (horizontal only, inside boardScroll container)
  useEffect(() => {
    const container = boardScrollRef.current;
    const cell = currentCellRef.current;
    if (!container || !cell) return;
    const cellLeft = cell.offsetLeft;
    const cellRight = cellLeft + cell.offsetWidth;
    const scrollLeft = container.scrollLeft;
    const scrollRight = scrollLeft + container.clientWidth;
    if (cellLeft < scrollLeft) {
      container.scrollTo({ left: cellLeft - 40, behavior: 'smooth' });
    } else if (cellRight > scrollRight) {
      container.scrollTo({ left: cellRight - container.clientWidth + 40, behavior: 'smooth' });
    }
  }, [effectivePicks.length]);

  // Build a lookup: player_id → pick
  const pickedPlayerIds = useMemo(
    () => new Set(effectivePicks.map((p) => p.player_id)),
    [effectivePicks],
  );

  // Build picks lookup: [round][teamId] → DraftPick
  const pickGrid = useMemo(() => {
    const grid: Record<number, Record<string, DraftPick>> = {};
    for (const pick of effectivePicks) {
      if (!grid[pick.round]) grid[pick.round] = {};
      grid[pick.round][pick.team_id] = pick;
    }
    return grid;
  }, [effectivePicks]);

  // Build per-team pick lists for the roster panel
  const teamPicks = useMemo(() => {
    const map: Record<string, DraftPick[]> = {};
    for (const team of teams) map[team.id] = [];
    for (const pick of effectivePicks) {
      if (map[pick.team_id]) map[pick.team_id].push(pick);
    }
    return map;
  }, [effectivePicks, teams]);

  // Filtered available players
  const availablePlayers = useMemo(() => {
    return allPlayers.filter((p) => {
      if (pickedPlayerIds.has(p.id)) return false;
      if (posFilter !== 'ALL' && p.primary_position !== posFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (
          !formatPlayerName(p).toLowerCase().includes(q) &&
          !p.pl_team.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [allPlayers, pickedPlayerIds, posFilter, search]);

  // Player lookup for queue display
  const playerMap = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of allPlayers) map.set(p.id, p);
    return map;
  }, [allPlayers]);

  // Queue players that are still available
  const activeQueuePlayers = useMemo(
    () => draftQueue.filter((id) => !pickedPlayerIds.has(id)),
    [draftQueue, pickedPlayerIds],
  );

  const makePick = useCallback(
    async (playerId: string) => {
      if (!isMyTurn || loadingPick || !currentTeam || !myTeam) return;
      setLoadingPick(true);
      setPickError(null);

      // Optimistic UI: immediately show the pick
      const player = playerMap.get(playerId);
      const optimistic: DraftPick = {
        id: `optimistic-${Date.now()}`,
        league_id: leagueId,
        team_id: currentTeam.id,
        player_id: playerId,
        round: currentRound,
        pick: currentPickNumber,
        picked_at: new Date().toISOString(),
        player: player ?? undefined,
        team: currentTeam,
      };
      setOptimisticPick(optimistic);

      try {
        const res = await fetch(`/api/leagues/${leagueId}/draft/pick`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId, draftQueue: activeQueuePlayers }),
        });

        const json = await res.json();
        if (!res.ok) {
          // Revert optimistic pick
          setOptimisticPick(null);
          setPickError(json.error ?? 'Pick failed');
          setLoadingPick(false);
          return;
        }

        // Remove picked player from queue
        if (draftQueue.includes(playerId)) {
          saveDraftQueue(draftQueue.filter((id) => id !== playerId));
        }

        // Broadcast will handle adding to picks state; just reset UI
        setLoadingPick(false);
        if (json.status === 'active') router.refresh();
      } catch {
        setOptimisticPick(null);
        setPickError('Network error. Please try again.');
        setLoadingPick(false);
      }
    },
    [isMyTurn, loadingPick, currentTeam, myTeam, playerMap, leagueId, currentRound, currentPickNumber, activeQueuePlayers, draftQueue, saveDraftQueue, router],
  );

  const timerPct = (secondsLeft / TIMER_SECONDS) * 100;
  const timerColor =
    timerPct > 50 ? 'var(--color-accent-green)' : timerPct > 25 ? 'var(--color-accent-yellow)' : 'var(--color-accent-red)';

  // Teams sorted by draft_order for the board columns
  const sortedTeams = [...teams].sort((a, b) => (a.draft_order ?? 0) - (b.draft_order ?? 0));

  // Recent picks for mobile list view
  const recentPicks = useMemo(
    () => [...effectivePicks].reverse().slice(0, 20),
    [effectivePicks],
  );

  const rowProps: PlayerRowCustomProps = useMemo(
    () => ({
      players: availablePlayers,
      queue: draftQueue,
      myTurn: isMyTurn,
      picking: loadingPick,
      draftDone: isDraftComplete,
      onToggleQueue: toggleQueue,
      onMakePick: makePick,
      onSelectPlayer: setSelectedPlayer,
    }),
    [availablePlayers, draftQueue, isMyTurn, loadingPick, isDraftComplete, toggleQueue, makePick],
  );

  // Measure player list height for react-window
  const [listHeight, setListHeight] = useState(500);
  useEffect(() => {
    const el = playerListRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setListHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
              <span className={styles.bannerTeam}>{currentTeam?.team_name ?? '\u2014'}</span>
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
            <Link href={`/league/${leagueId}/team`} className={styles.goToTeamBtn}>
              Go to My Team &rarr;
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

      {/* Mobile view toggle */}
      <div className={styles.mobileToggle}>
        <button
          type="button"
          className={`${styles.mobileToggleBtn} ${mobileView === 'picks' ? styles.mobileToggleBtnActive : ''}`}
          onClick={() => setMobileView('picks')}
        >
          Recent Picks
        </button>
        <button
          type="button"
          className={`${styles.mobileToggleBtn} ${mobileView === 'board' ? styles.mobileToggleBtnActive : ''}`}
          onClick={() => setMobileView('board')}
        >
          Draft Board
        </button>
      </div>

      {/* 3-panel layout */}
      <div className={styles.panels}>
        {/* Left: Player Picker */}
        <aside className={styles.pickerPanel}>
          <div className={styles.panelTitleRow}>
            <h2 className={styles.panelTitle}>Players</h2>
            {myTeam && (
              <button
                type="button"
                onClick={() => setShowQueue(!showQueue)}
                className={`${styles.queueToggle} ${showQueue ? styles.queueToggleActive : ''}`}
              >
                Queue ({activeQueuePlayers.length})
              </button>
            )}
          </div>

          {/* Draft Queue Panel */}
          <AnimatePresence>
            {showQueue && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className={styles.queuePanel}
              >
                {activeQueuePlayers.length === 0 ? (
                  <p className={styles.queueEmpty}>
                    No players queued. Click the star on any player to add them.
                  </p>
                ) : (
                  <ul className={styles.queueList}>
                    {activeQueuePlayers.map((playerId, idx) => {
                      const player = playerMap.get(playerId);
                      if (!player) return null;
                      return (
                        <li key={playerId} className={styles.queueItem}>
                          <span className={styles.queueRank}>{idx + 1}</span>
                          <span className={`${styles.posBadgeSm} ${styles[`pos${player.primary_position}`]}`}>
                            {player.primary_position}
                          </span>
                          <span className={styles.queuePlayerName}>{formatPlayerName(player)}</span>
                          <div className={styles.queueControls}>
                            <button
                              type="button"
                              onClick={() => moveQueueItem(playerId, 'up')}
                              disabled={idx === 0}
                              className={styles.queueMoveBtn}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => moveQueueItem(playerId, 'down')}
                              disabled={idx === activeQueuePlayers.length - 1}
                              className={styles.queueMoveBtn}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleQueue(playerId)}
                              className={styles.queueRemoveBtn}
                            >
                              ×
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <input
            type="text"
            placeholder="Search name or club\u2026"
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

          <div className={styles.playerList} ref={playerListRef}>
            {availablePlayers.length > 0 ? (
              <List<PlayerRowCustomProps>
                rowComponent={PlayerRow}
                rowCount={availablePlayers.length}
                rowHeight={64}
                rowProps={rowProps}
                overscanCount={10}
                style={{ height: listHeight }}
              />
            ) : (
              <p className={styles.emptyPicker}>No players match your search.</p>
            )}
          </div>
        </aside>

        {/* Middle: Draft Board */}
        <main className={`${styles.boardPanel} ${styles.boardDesktop}`}>
          <h2 className={styles.panelTitle}>Draft Board</h2>
          <div className={styles.boardScroll} ref={boardScrollRef}>
            <table className={styles.boardTable}>
              <thead>
                <tr>
                  <th className={styles.roundCell}>Rd</th>
                  {sortedTeams.map((team) => (
                    <th
                      key={team.id}
                      className={`${styles.teamHeaderCell} ${team.user_id === myUserId ? styles.myTeamCol : ''} ${currentTeam?.id === team.id ? styles.teamHeaderOnClock : ''
                        }`}
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
                          currentPickNumber === effectivePicks.length + 1 &&
                          roundNum === currentRound &&
                          team.draft_order === currentDraftOrderSlot;
                        const isOptimistic = pick?.id?.startsWith('optimistic-');
                        const shouldAnimate = pick && !animatedPickIds.has(pick.id);

                        return (
                          <td
                            key={team.id}
                            ref={isCurrentSlot ? currentCellRef : undefined}
                            className={`${styles.pickCell} ${pick ? styles.pickCellFilled : ''} ${isCurrentSlot ? styles.pickCellCurrent : ''
                              } ${team.user_id === myUserId ? styles.myTeamCol : ''} ${isOptimistic ? styles.pickCellOptimistic : ''
                              }`}
                          >
                            {pick ? (
                              <motion.div
                                className={styles.pickedPlayer}
                                variants={pickVariants}
                                initial={shouldAnimate ? 'hidden' : 'visible'}
                                animate="visible"
                                style={{ cursor: 'pointer' }}
                                onClick={() => pick.player && setSelectedPlayer(pick.player)}
                                onAnimationComplete={() => {
                                  if (shouldAnimate) {
                                    setAnimatedPickIds((prev) => new Set(prev).add(pick.id));
                                  }
                                }}
                              >
                                <span
                                  className={`${styles.posBadgeSm} ${styles[`pos${pick.player?.primary_position}`]}`}
                                >
                                  {pick.player?.primary_position}
                                </span>
                                <span className={styles.pickedName}>
                                  {formatPlayerName(pick.player)}
                                </span>
                                {isOptimistic && (
                                  <span className={styles.confirmingLabel}>confirming\u2026</span>
                                )}
                              </motion.div>
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

        {/* Mobile: Recent Picks List View */}
        <div className={`${styles.boardMobile} ${mobileView === 'picks' ? styles.boardMobileVisible : ''}`}>
          <h2 className={styles.panelTitle}>Recent Picks</h2>
          <div className={styles.recentPicksList}>
            <AnimatePresence>
              {recentPicks.map((pick) => {
                const isOptimistic = pick.id?.startsWith('optimistic-');
                return (
                  <motion.div
                    key={pick.id}
                    className={`${styles.recentPickItem} ${isOptimistic ? styles.recentPickOptimistic : ''}`}
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                  >
                    <span className={styles.recentPickNumber}>#{pick.pick}</span>
                    <span className={`${styles.posBadgeSm} ${styles[`pos${pick.player?.primary_position}`]}`}>
                      {pick.player?.primary_position}
                    </span>
                    <div className={styles.recentPickDetails}>
                      <span className={styles.recentPickName}>{formatPlayerName(pick.player)}</span>
                      <span className={styles.recentPickTeam}>{pick.team?.team_name ?? '\u2014'}</span>
                    </div>
                    {isOptimistic && <span className={styles.confirmingLabel}>confirming\u2026</span>}
                  </motion.div>
                );
              })}
            </AnimatePresence>
            {recentPicks.length === 0 && (
              <p className={styles.emptyPicker}>No picks yet. Draft will begin soon.</p>
            )}
          </div>
        </div>

        {/* Mobile: Draft Board (hidden by default on mobile) */}
        <div className={`${styles.boardMobile} ${mobileView === 'board' ? styles.boardMobileVisible : ''}`}>
          <h2 className={styles.panelTitle}>Draft Board</h2>
          <div className={styles.boardScroll}>
            <table className={styles.boardTable}>
              <thead>
                <tr>
                  <th className={styles.roundCell}>Rd</th>
                  {sortedTeams.map((team) => (
                    <th key={team.id} className={styles.teamHeaderCell}>
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
                        return (
                          <td key={team.id} className={`${styles.pickCell} ${pick ? styles.pickCellFilled : ''}`}>
                            {pick ? (
                              <div
                                className={styles.pickedPlayer}
                                style={{ cursor: 'pointer' }}
                                onClick={() => pick.player && setSelectedPlayer(pick.player)}
                              >
                                <span className={styles.pickedName}>
                                  {formatPlayerName(pick.player)}
                                </span>
                              </div>
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
        </div>

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
                      <AnimatePresence>
                        {tp.map((pick) => {
                          const isOptimistic = pick.id?.startsWith('optimistic-');
                          return (
                            <motion.li
                              key={pick.id}
                              className={`${styles.rosterPickItem} ${isOptimistic ? styles.rosterPickOptimistic : ''}`}
                              variants={rosterItemVariants}
                              initial="hidden"
                              animate="visible"
                              layout
                            >
                              <span
                                className={`${styles.posBadgeSm} ${styles[`pos${pick.player?.primary_position}`]}`}
                              >
                                {pick.player?.primary_position}
                              </span>
                              <span className={styles.rosterPickName}>
                                {formatPlayerName(pick.player)}
                              </span>
                            </motion.li>
                          );
                        })}
                      </AnimatePresence>
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </aside>
      </div>

      {/* Global Player Details Modal */}
      {selectedPlayer && (
        <PlayerDetailsModal
          player={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
          onPick={
            isMyTurn && !loadingPick && !isDraftComplete
              ? (p) => makePick(p.id)
              : undefined
          }
        />
      )}
    </div>
  );
}
