'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import NavigationLink from '@/components/ui/NavigationLink';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import { List } from 'react-window';
import { createClient } from '@/lib/supabase/client';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import type { League, Team, Player, DraftPick, PlayerOwnership, GranularPosition } from '@/types';
import { usePlayerCard } from '@/components/players/PlayerCardProvider';
import PositionBadge from '@/components/players/PositionBadge';
import SidebarChat from '../SidebarChat';
import type { DraftShadowMaps } from '@/lib/draft/loadDraftPool';
import styles from './draft.module.css';


const TIMER_SECONDS = 120;
const QUEUE_STORAGE_KEY = (leagueId: string, teamId: string) =>
  `draft-queue:${leagueId}:${teamId}`;

function snakeDraftOrder(pickNumber: number, numTeams: number): number {
  const round = Math.floor((pickNumber - 1) / numTeams);
  const posInRound = (pickNumber - 1) % numTeams;
  return round % 2 === 0 ? posInRound + 1 : numTeams - posInRound;
}

function absolutePickNumber(roundNum: number, teamDraftOrder: number, numTeams: number): number {
  const isEvenRound = roundNum % 2 === 0;
  const posInRound = isEvenRound ? numTeams + 1 - teamDraftOrder : teamDraftOrder;
  return (roundNum - 1) * numTeams + posInRound;
}

function cellPickLabel(roundNum: number, teamDraftOrder: number, numTeams: number): string {
  const isEvenRound = roundNum % 2 === 0;
  const posInRound = isEvenRound ? numTeams + 1 - teamDraftOrder : teamDraftOrder;
  return `${String(roundNum).padStart(2, '0')}.${String(posInRound).padStart(2, '0')}`;
}

type SortKey = 'total_points' | 'ppg' | 'avg_rating' | 'market_value' | 'gp' | 'draft_rank';
type SortDir = 'desc' | 'asc';

interface Props {
  leagueId: string;
  league: League;
  teams: Team[];
  initialPicks: DraftPick[];
  allPlayers: Player[];
  myUserId: string;
  myTeam: Team | null;
  shadowMaps: DraftShadowMaps;
}

const POSITION_ORDER = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'] as const;

interface PlayerRowCustomProps {
  players: { player: Player; activePos: string }[];
  queue: string[];
  myTurn: boolean;
  picking: boolean;
  draftDone: boolean;
  shadowByPlayer: Record<string, Record<string, { gp: number; total_points: number; avg_rating: number; total_minutes: number }>>;
  onToggleQueue: (id: string) => void;
  onMakePick: (id: string) => void;
  onSelectPlayer: (p: Player) => void;
  onPrefetchPlayer: (p: { id: string; photo_url?: string | null }) => void;
}

function PlayerRow({
  index,
  style,
  players,
  queue,
  myTurn,
  picking,
  draftDone,
  shadowByPlayer,
  onToggleQueue,
  onMakePick,
  onSelectPlayer,
  onPrefetchPlayer,
}: { index: number; style: React.CSSProperties; ariaAttributes: Record<string, unknown> } & PlayerRowCustomProps) {
  const item = players[index];
  if (!item) return null;
  const { player, activePos } = item;
  const isQueued = queue.includes(player.id);
  const isMyPick = myTurn && !picking && !draftDone;

  const s = shadowByPlayer[player.id]?.[activePos];
  const gp = s ? s.gp : 0;
  // PPG = Pts/GP for the active minutes filter (not a frozen archive column).
  const totalPoints = s && s.gp > 0 ? s.total_points.toFixed(1) : '—';
  const ppg = s && s.gp > 0 ? (s.total_points / s.gp).toFixed(1) : '—';
  const avgRating = s && s.gp > 0 ? s.avg_rating.toFixed(1) : '—';
  const value = player.market_value != null ? `€${Number(player.market_value).toFixed(1)}m` : '—';
  const rank = player.draftRank != null ? String(player.draftRank) : '—';
  const isUnavailable = !!player.fpl_status && player.fpl_status !== 'a';

  return (
    <div
      style={style}
      className={styles.playerRow}
      onClick={() => onSelectPlayer(player)}
      onPointerEnter={() => onPrefetchPlayer(player)}
    >
      {/* Sticky Player + Actions Column */}
      <div className={styles.tdPlayerSticky}>
        <div className={styles.playerRowLeft}>
          <div className={`g-namerow ${styles.posRow}`}>
            <PositionBadge position={player.primary_position as GranularPosition} size="sm" />
            {player.primary_position !== activePos && (
              <>
                <span className={styles.secArrow} title={`Primary position: ${player.primary_position} — evaluated as ${activePos}`}>→</span>
                <PositionBadge position={activePos as GranularPosition} size="sm" />
              </>
            )}
          </div>
          <div className={styles.playerInfo}>
            <span className={styles.playerName}>{getPlayerDisplayName(player, 'initial_last')}</span>
            {isUnavailable && player.fpl_news ? (
              <span className={styles.injuryNote} title={player.fpl_news}>{player.fpl_news}</span>
            ) : (
              <span className={styles.playerClub}>{player.pl_team}</span>
            )}
          </div>
        </div>
        <div className={styles.rowActions}>
          <button
            type="button"
            className={`${styles.queueBtn} ${isQueued ? styles.queueBtnActive : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggleQueue(player.id); }}
            title={isQueued ? 'Remove from queue' : 'Add to queue'}
          >
            {isQueued ? '★' : '☆'}
          </button>
          <button
            type="button"
            className={`${styles.draftBtn} ${!isMyPick ? styles.draftBtnDisabled : ''}`}
            onClick={(e) => { e.stopPropagation(); onMakePick(player.id); }}
            disabled={!isMyPick}
          >
            Draft
          </button>
        </div>
      </div>

      {/* Draft Rank — shown for every player, including isNewToPrem (that's
          exactly the case its confidence-weighting exists for), unlike the
          stat columns below which have nothing to show for them. */}
      <div className={styles.tdNum}>{rank}</div>

      {/* Scrollable Stats Columns */}
      {player.isNewToPrem ? (
        <div className={styles.newStatsCell} title="New to the Premier League this season — no prior-season stats">
          <span className={styles.newTag}>NEW</span>
        </div>
      ) : (
        <>
          <div className={styles.tdNum}>{gp}</div>
          <div className={styles.tdNum}>{totalPoints}</div>
          <div className={styles.tdNum}>{ppg}</div>
          <div className={styles.tdNum}>{avgRating}</div>
        </>
      )}
      <div className={styles.tdNum}>{value}</div>
    </div>
  );
}

// Mobile equivalent of PlayerRow — same row-props shape (so both can share
// one react-window List's plumbing across the desktop/mobile branch), but
// a two-line card instead of six fixed-width table columns, since a 580px
// table has nowhere to go on a ~350px phone. Shows the three numbers a
// manager is most likely to actually use mid-draft (Rank, PPG, Value); GP
// and Avg rating are dropped rather than tucked behind a tap-to-expand —
// variable-height rows would break react-window's fixed rowHeight.
function MobilePlayerCard({
  index,
  style,
  players,
  queue,
  myTurn,
  picking,
  draftDone,
  shadowByPlayer,
  onToggleQueue,
  onMakePick,
  onSelectPlayer,
  onPrefetchPlayer,
}: { index: number; style: React.CSSProperties; ariaAttributes: Record<string, unknown> } & PlayerRowCustomProps) {
  const item = players[index];
  if (!item) return null;
  const { player, activePos } = item;
  const isQueued = queue.includes(player.id);
  const isMyPick = myTurn && !picking && !draftDone;

  const s = shadowByPlayer[player.id]?.[activePos];
  const ppg = s && s.gp > 0 ? (s.total_points / s.gp).toFixed(1) : '—';
  const totalPoints = s && s.gp > 0 ? String(Math.round(s.total_points)) : '—';
  const value = player.market_value != null ? `€${Number(player.market_value).toFixed(1)}m` : '—';
  const rank = player.draftRank != null ? String(player.draftRank) : '—';
  const isUnavailable = !!player.fpl_status && player.fpl_status !== 'a';

  return (
    <div
      style={style}
      className={styles.mobileCard}
      onClick={() => onSelectPlayer(player)}
      onPointerEnter={() => onPrefetchPlayer(player)}
    >
      <div className={styles.mobileCardLeft}>
        <div className={`g-namerow ${styles.posRow}`}>
          <PositionBadge position={player.primary_position as GranularPosition} size="sm" />
        </div>
        <div className={styles.playerInfo}>
          <span className={styles.playerName}>{getPlayerDisplayName(player, 'initial_last')}</span>
          {isUnavailable && player.fpl_news ? (
            <span className={styles.injuryNote} title={player.fpl_news}>{player.fpl_news}</span>
          ) : (
            <span className={styles.playerClub}>{player.pl_team}</span>
          )}
        </div>
      </div>
      <div className={styles.mobileCardRight}>
        <div className={styles.mobileCardStats}>
          <span className={styles.mobileCardRank}>#{rank}</span>
          {player.isNewToPrem ? (
            <span className={styles.mobileCardSub}>NEW · {value}</span>
          ) : (
            <>
              <span className={styles.mobileCardSub}>{ppg} PPG · {totalPoints} Pts</span>
              <span className={styles.mobileCardSub}>{value}</span>
            </>
          )}
        </div>
        <div className={styles.rowActions}>
          <button
            type="button"
            className={`${styles.queueBtn} ${isQueued ? styles.queueBtnActive : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggleQueue(player.id); }}
            title={isQueued ? 'Remove from queue' : 'Add to queue'}
          >
            {isQueued ? '★' : '☆'}
          </button>
          <button
            type="button"
            className={`${styles.draftBtn} ${!isMyPick ? styles.draftBtnDisabled : ''}`}
            onClick={(e) => { e.stopPropagation(); onMakePick(player.id); }}
            disabled={!isMyPick}
          >
            Draft
          </button>
        </div>
      </div>
    </div>
  );
}

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
  shadowMaps,
}: Props) {
  const router = useRouter();
  const [picks, setPicks] = useState<DraftPick[]>(initialPicks);
  const [animatedPickIds, setAnimatedPickIds] = useState<Set<string>>(
    () => new Set(initialPicks.map((p) => p.id))
  );
  const [optimisticPick, setOptimisticPick] = useState<DraftPick | null>(null);

  useEffect(() => {
    setPicks((prev) => {
      const serverIds = new Set(initialPicks.map((p) => p.id));
      if (optimisticPick && serverIds.has(optimisticPick.id)) {
        setOptimisticPick(null);
      }
      if (initialPicks.length >= prev.length) return initialPicks;
      return prev;
    });
  }, [initialPicks, optimisticPick]);

  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState<string>('ALL');
  const [newToPremOnly, setNewToPremOnly] = useState(false);
  const [loadingPick, setLoadingPick] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(TIMER_SECONDS);
  const { openPlayer, prefetchPlayer } = usePlayerCard();
  const [sidebarTab, setSidebarTab] = useState<'players' | 'roster' | 'queue' | 'chat'>('players');
  const [rosterSortMode, setRosterSortMode] = useState<'draft' | 'position'>('draft');

  // Mobile: the board is the primary view (matching desktop) and the tabbed
  // panel becomes a drag-open drawer instead of taking the full screen —
  // see docs/superpowers/specs/2026-08-19-mobile-draft-drawer-design.md.
  const [isMobile, setIsMobile] = useState(false);
  const [drawerExpanded, setDrawerExpanded] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const selectSidebarTab = useCallback((tab: 'players' | 'roster' | 'queue' | 'chat') => {
    setSidebarTab(tab);
    setDrawerExpanded(true);
  }, []);

  // Drawer position, in pixels, while an active drag is tracking the
  // finger 1:1 — null means "not currently dragging, use the resting CSS
  // transform for `drawerExpanded`". A CSS `height` transition (the first
  // version of this) forces a layout reflow every frame and is janky on
  // mobile; `transform: translateY()` is GPU-composited and smooth, and
  // driving it from `onPan`/`onPanEnd` (rather than only reacting after
  // release, which is what the first version did) gives real live feedback
  // during the gesture instead of nothing happening until you let go.
  const [drawerLiveOffset, setDrawerLiveOffset] = useState<number | null>(null);
  const drawerMaxOffsetRef = useRef(0);
  const drawerPanStartRef = useRef(0);

  useEffect(() => {
    const updateMax = () => {
      // COLLAPSED_PX (64) must match .drawerGrip + .sidebarTabs' combined
      // height in draft.module.css's mobile block.
      drawerMaxOffsetRef.current = Math.round(window.innerHeight * 0.72) - 64;
    };
    updateMax();
    window.addEventListener('resize', updateMax);
    return () => window.removeEventListener('resize', updateMax);
  }, []);

  const handleDrawerPanStart = useCallback(() => {
    drawerPanStartRef.current = drawerExpanded ? 0 : drawerMaxOffsetRef.current;
  }, [drawerExpanded]);

  const handleDrawerPan = useCallback((_e: unknown, info: PanInfo) => {
    const max = drawerMaxOffsetRef.current;
    setDrawerLiveOffset(Math.min(max, Math.max(0, drawerPanStartRef.current + info.offset.y)));
  }, []);

  const handleDrawerPanEnd = useCallback((_e: unknown, info: PanInfo) => {
    const max = drawerMaxOffsetRef.current;
    const current = drawerPanStartRef.current + info.offset.y;
    const FLICK_VELOCITY = 300;
    if (info.velocity.y < -FLICK_VELOCITY) setDrawerExpanded(true);
    else if (info.velocity.y > FLICK_VELOCITY) setDrawerExpanded(false);
    else setDrawerExpanded(current < max / 2);
    setDrawerLiveOffset(null);
  }, []);

  // Scouting Leaderboard Advanced Filters & Sorting States
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Matches the stats page's minutes filter exactly (GlobalStatsTable.tsx) —
  // the draft room used to have its own, different two-option version.
  const [minMins, setMinMins] = useState<'played' | 'all' | 'gt45'>('all');
  const [minGames, setMinGames] = useState<number>(0);
  const [posType, setPosType] = useState<'primary' | 'secondary' | 'both'>('primary');
  // Default sort is Draft Rank, not raw points — the whole point of the
  // ranking is that a manager who touches nothing sees the recommended
  // order first, not a stat they may not know how to weigh.
  const [sortKey, setSortKey] = useState<SortKey>('draft_rank');
  // 'asc' so Draft Rank (the default sortKey) starts at #1, not the highest
  // rank number — see handleSort for the same asc-by-default on reselecting it.
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const currentCellRef = useRef<HTMLTableCellElement>(null);
  const boardScrollRef = useRef<HTMLDivElement>(null);
  const currentStripItemRef = useRef<HTMLDivElement>(null);
  const playerListRef = useRef<HTMLDivElement>(null);
  const autoPickTriggeredRef = useRef(false);
  // loadingPick is state, so two clicks landing in the same tick both read it
  // as false and both POST. The ref flips synchronously.
  const pickInFlightRef = useRef(false);
  const hadDisconnectRef = useRef(false);

  const [draftQueue, setDraftQueue] = useState<string[]>([]);
  useEffect(() => {
    if (!myTeam) return;
    try {
      const stored = localStorage.getItem(QUEUE_STORAGE_KEY(leagueId, myTeam.id));
      if (stored) setDraftQueue(JSON.parse(stored));
    } catch { /* ignore */ }
  }, [leagueId, myTeam]);

  const saveDraftQueue = useCallback((queue: string[]) => {
    setDraftQueue(queue);
    if (myTeam) {
      localStorage.setItem(QUEUE_STORAGE_KEY(leagueId, myTeam.id), JSON.stringify(queue));
    }
  }, [leagueId, myTeam]);

  useEffect(() => {
    if (!myUserId || !leagueId || !myTeam) return;

    const handler = setTimeout(async () => {
      const supabase = createClient();
      
      // Delete existing queue rows for this user in this league
      await supabase
        .from('draft_queues')
        .delete()
        .eq('user_id', myUserId)
        .eq('league_id', leagueId);
        
      // Insert new queue list in order
      if (draftQueue.length > 0) {
        const records = draftQueue.map((playerId, index) => ({
          user_id: myUserId,
          league_id: leagueId,
          player_id: playerId,
          rank: index + 1,
        }));
        await supabase.from('draft_queues').insert(records);
      }
    }, 1500); // 1.5-second debounce

    return () => clearTimeout(handler);
  }, [draftQueue, myUserId, leagueId, myTeam]);

  useEffect(() => {
    if (!myTeam?.id) return;
    const supabase = createClient();
    
    const sendHeartbeat = () => {
      // last_seen_at only — consecutive_autopicks resets in make_draft_pick_rpc
      // when this team actually completes a pick, not here. Resetting it on
      // mere presence let a manager who reconnects without picking dodge the
      // "2 misses in a row skips the wait" escalation in
      // auto_pick_expired_drafts() forever: a live league produced exactly
      // that pattern, one team maxing out the full timeout for its last 5
      // picks in a row because its heartbeat kept re-arming the grace period.
      supabase
        .from('teams')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', myTeam.id)
        .then();
    };

    // Initial heartbeat on mount
    sendHeartbeat();

    // Heartbeat interval
    const interval = setInterval(sendHeartbeat, 10000);

    return () => {
      clearInterval(interval);
      // Clean up on unmount
      supabase
        .from('teams')
        .update({ last_seen_at: null })
        .eq('id', myTeam.id)
        .then();
    };
  }, [myTeam?.id]);

  const toggleQueue = useCallback((playerId: string) => {
    saveDraftQueue(
      draftQueue.includes(playerId)
        ? draftQueue.filter((id) => id !== playerId)
        : [...draftQueue, playerId],
    );
  }, [draftQueue, saveDraftQueue]);

  const moveQueueItem = useCallback((playerId: string, direction: 'up' | 'down') => {
    const idx = draftQueue.indexOf(playerId);
    if (idx === -1) return;
    const newQueue = [...draftQueue];
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= newQueue.length) return;
    [newQueue[idx], newQueue[swapIdx]] = [newQueue[swapIdx], newQueue[idx]];
    saveDraftQueue(newQueue);
  }, [draftQueue, saveDraftQueue]);

  const numTeams = teams.length;
  const totalPicks = numTeams * league.roster_size;
  const effectivePicks = optimisticPick
    ? [...picks.filter((p) => p.id !== optimisticPick.id), optimisticPick]
    : picks;
  const isDraftComplete = effectivePicks.length >= totalPicks || league.status === 'active';

  const currentPickNumber = effectivePicks.length + 1;
  const currentDraftOrderSlot = isDraftComplete ? null : snakeDraftOrder(currentPickNumber, numTeams);
  const currentTeam = isDraftComplete ? null : teams.find((t) => t.draft_order === currentDraftOrderSlot) ?? null;
  const isMyTurn = !isDraftComplete && currentTeam?.user_id === myUserId;
  const currentRound = isDraftComplete
    ? league.roster_size
    : Math.ceil(currentPickNumber / numTeams);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`draft:${leagueId}`)
      .on('broadcast', { event: 'new_pick' }, (payload) => {
        const newPick = payload.payload as DraftPick;
        setPicks((prev) => {
          if (prev.some((p) => p.id === newPick.id)) return prev;
          return [...prev, newPick].sort((a, b) => a.pick - b.pick);
        });
        setAnimatedPickIds((prev) => new Set(prev).add(newPick.id));
        setOptimisticPick((prev) => (prev?.player_id === newPick.player_id ? null : prev));
        setPickError(null);
      })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'draft_picks',
        filter: `league_id=eq.${leagueId}`,
      }, (payload) => {
        const newPick = payload.new as DraftPick;
        setPicks((prev) => {
          if (prev.some((p) => p.id === newPick.id)) return prev;
          return [...prev, newPick].sort((a, b) => a.pick - b.pick);
        });
        setAnimatedPickIds((prev) => new Set(prev).add(newPick.id));
        setOptimisticPick((prev) => (prev?.player_id === newPick.player_id ? null : prev));
        setPickError(null);
      })
      .on('broadcast', { event: 'draft_complete' }, () => { router.refresh(); })
      .subscribe((status) => {
        // A tab whose socket drops (network blip, laptop sleep, tab
        // backgrounded) misses every broadcast/postgres_changes event sent
        // while it's down, and previously had no way to notice — it just
        // sat stale until the next 15s poll below. Refetch once the channel
        // comes back up so a reconnect closes the gap immediately instead
        // of leaving up to 15s of missed picks on screen.
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          hadDisconnectRef.current = true;
        } else if (status === 'SUBSCRIBED' && hadDisconnectRef.current) {
          hadDisconnectRef.current = false;
          router.refresh();
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, [leagueId, router]);

  useEffect(() => {
    if (isDraftComplete) return;
    const interval = setInterval(() => { router.refresh(); }, 15000);
    return () => clearInterval(interval);
  }, [isDraftComplete, router]);

  const tickAudioRef = useRef<HTMLAudioElement | null>(null);
  const pickAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    tickAudioRef.current = new Audio('/sounds/tick.mp3');
    tickAudioRef.current.volume = 0.3;
    pickAudioRef.current = new Audio('/sounds/pick.mp3');
    pickAudioRef.current.volume = 0.5;
  }, []);

  useEffect(() => {
    if (secondsLeft === 10 && !isDraftComplete) tickAudioRef.current?.play().catch(() => {});
  }, [secondsLeft, isDraftComplete]);

  const prevPickCountRef = useRef(picks.length);
  useEffect(() => {
    if (picks.length > prevPickCountRef.current) pickAudioRef.current?.play().catch(() => {});
    prevPickCountRef.current = picks.length;
  }, [picks.length]);

  useEffect(() => {
    if (isDraftComplete) return;
    autoPickTriggeredRef.current = false;

    if (effectivePicks.length === 0) {
      // Pick 1 is untimed — the clock only starts once the first pick lands.
      setSecondsLeft(TIMER_SECONDS);
      return;
    }

    const latestPickTimeStr = effectivePicks[effectivePicks.length - 1].picked_at;
    const latestPickDate = new Date(latestPickTimeStr ?? Date.now());

    const updateTimer = () => {
      const elapsed = Math.floor((Date.now() - latestPickDate.getTime()) / 1000);
      const remain = Math.max(0, TIMER_SECONDS - elapsed);
      setSecondsLeft(remain);

      if (remain === 0 && isMyTurn && !autoPickTriggeredRef.current) {
        if (league.name?.toLowerCase().includes('demo') || league.name?.toLowerCase().includes('test')) {
          setPickError('Timer expired! (Auto-pick disabled for Demo/Test leagues)');
          return;
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivePicks, isDraftComplete]);

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

  // The top banner's pick strip (.pickStripWrap) never had this — it rendered
  // a window of picks around the current one but nothing scrolled that
  // window into view within its own container, so on a narrow screen (where
  // only 2-3 items fit) the current pick was often just off-screen with no
  // way to tell without manually scrolling.
  useEffect(() => {
    currentStripItemRef.current?.scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest',
    });
  }, [currentPickNumber]);

  const pickedPlayerIds = useMemo(
    () => new Set(effectivePicks.map((p) => p.player_id)),
    [effectivePicks],
  );

  const pickGrid = useMemo(() => {
    const grid: Record<number, Record<string, DraftPick>> = {};
    for (const pick of effectivePicks) {
      if (!grid[pick.round]) grid[pick.round] = {};
      grid[pick.round][pick.team_id] = pick;
    }
    return grid;
  }, [effectivePicks]);

  const teamPicks = useMemo(() => {
    const map: Record<string, DraftPick[]> = {};
    for (const team of teams) map[team.id] = [];
    for (const pick of effectivePicks) {
      if (map[pick.team_id]) map[pick.team_id].push(pick);
    }
    return map;
  }, [effectivePicks, teams]);

  const shadowByPlayer =
    minMins === 'played' ? shadowMaps.played : minMins === 'all' ? shadowMaps.all : shadowMaps.gt45;

  const unpickedPlayers = useMemo(() => {
    return allPlayers.filter((p) => !pickedPlayerIds.has(p.id));
  }, [allPlayers, pickedPlayerIds]);

  const sortedAndFiltered = useMemo(() => {
    function groupContains(group: string, pos: string): boolean {
      const DEF_POSITIONS = ['CB', 'LB', 'RB', 'LWB', 'RWB'];
      const MID_POSITIONS = ['DM', 'CM', 'AM'];
      const ATT_POSITIONS = ['LW', 'RW', 'ST'];
      if (group === 'ALL') return true;
      if (group === 'GK') return pos === 'GK';
      if (group === 'DEF') return DEF_POSITIONS.includes(pos);
      if (group === 'MID') return MID_POSITIONS.includes(pos);
      if (group === 'ATT') return ATT_POSITIONS.includes(pos);
      return pos === group;
    }

    function resolveActivePosition(
      player: Player,
      posFilter: string,
      posType: 'primary' | 'secondary' | 'both'
    ): string | null {
      const primary = player.primary_position;
      const secondaries = player.secondary_positions ?? [];

      if (posType === 'primary') {
        if (groupContains(posFilter, primary)) {
          return primary;
        }
      } else if (posType === 'secondary') {
        const match = secondaries.find((pos) => groupContains(posFilter, pos));
        if (match) return match;
      } else if (posType === 'both') {
        if (groupContains(posFilter, primary)) {
          return primary;
        }
        const match = secondaries.find((pos) => groupContains(posFilter, pos));
        if (match) return match;
      }
      return null;
    }

    const q = search.trim().toLowerCase();
    const filtered = unpickedPlayers
      .map((p) => {
        const activePos = resolveActivePosition(p, posFilter, posType);
        return { player: p, activePos };
      })
      .filter((item): item is { player: Player; activePos: string } => {
        const { player: p, activePos } = item;
        if (!activePos) return false;

        if (q) {
          const full = p.name.toLowerCase();
          const web = (p.web_name || '').toLowerCase();
          const club = (p.pl_team || '').toLowerCase();
          if (!full.includes(q) && !web.includes(q) && !club.includes(q)) return false;
        }

        if (newToPremOnly && !p.isNewToPrem) return false;

        const s = shadowByPlayer[p.id]?.[activePos];
        const gp = s?.gp ?? 0;
        if (gp < minGames) return false;

        return true;
      });

    return [...filtered].sort((aObj, bObj) => {
      let av = 0;
      let bv = 0;

      const sa = shadowByPlayer[aObj.player.id]?.[aObj.activePos];
      const sb = shadowByPlayer[bObj.player.id]?.[bObj.activePos];

      if (sortKey === 'total_points') {
        av = sa ? sa.total_points : 0;
        bv = sb ? sb.total_points : 0;
      } else if (sortKey === 'ppg') {
        av = sa && sa.gp > 0 ? sa.total_points / sa.gp : 0;
        bv = sb && sb.gp > 0 ? sb.total_points / sb.gp : 0;
      } else if (sortKey === 'avg_rating') {
        av = sa ? sa.avg_rating : 0;
        bv = sb ? sb.avg_rating : 0;
      } else if (sortKey === 'market_value') {
        av = aObj.player.market_value ?? 0;
        bv = bObj.player.market_value ?? 0;
      } else if (sortKey === 'gp') {
        av = sa ? sa.gp : 0;
        bv = sb ? sb.gp : 0;
      } else if (sortKey === 'draft_rank') {
        av = aObj.player.draftRank ?? Infinity;
        bv = bObj.player.draftRank ?? Infinity;
      }

      return sortDir === 'desc' ? bv - av : av - bv;
    });
  }, [unpickedPlayers, search, posFilter, posType, shadowByPlayer, minGames, sortKey, sortDir, newToPremOnly]);

  const playerMap = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of allPlayers) map.set(p.id, p);
    return map;
  }, [allPlayers]);

  const activeQueuePlayers = useMemo(
    () => draftQueue.filter((id) => !pickedPlayerIds.has(id)),
    [draftQueue, pickedPlayerIds],
  );

  const myRoster = useMemo(() => {
    if (!myTeam) return [];
    const rosterPicks = [...(teamPicks[myTeam.id] ?? [])];
    if (rosterSortMode === 'draft') {
      return rosterPicks.sort((a, b) => a.pick - b.pick);
    } else {
      return rosterPicks.sort((a, b) => {
        const posA = POSITION_ORDER.indexOf(a.player?.primary_position as typeof POSITION_ORDER[number]);
        const posB = POSITION_ORDER.indexOf(b.player?.primary_position as typeof POSITION_ORDER[number]);
        return (posA === -1 ? 99 : posA) - (posB === -1 ? 99 : posB);
      });
    }
  }, [teamPicks, myTeam, rosterSortMode]);

  const makePick = useCallback(async (playerId: string) => {
    if (!isMyTurn || loadingPick || pickInFlightRef.current || !currentTeam || !myTeam) return;
    if (pickedPlayerIds.has(playerId)) {
      setPickError('Player already drafted');
      return;
    }
    pickInFlightRef.current = true;
    setLoadingPick(true);
    setPickError(null);

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
        // The server re-derives who is on the clock; expectPick only lets it
        // reject this request outright if the board moved while we were
        // deciding, rather than drafting for whoever is up now.
        body: JSON.stringify({ playerId, draftQueue: activeQueuePlayers, expectPick: currentPickNumber }),
      });

      const json = await res.json();
      if (!res.ok) {
        setOptimisticPick(null);
        setPickError(json.error ?? 'Pick failed');
        setLoadingPick(false);
        pickInFlightRef.current = false;
        return;
      }

      if (draftQueue.includes(playerId)) {
        saveDraftQueue(draftQueue.filter((id) => id !== playerId));
      }

      setLoadingPick(false);
      pickInFlightRef.current = false;
      if (json.status === 'active') router.refresh();
    } catch {
      setOptimisticPick(null);
      setPickError('Network error. Please try again.');
      setLoadingPick(false);
      pickInFlightRef.current = false;
    }
  }, [isMyTurn, loadingPick, currentTeam, myTeam, playerMap, leagueId, currentRound, currentPickNumber, activeQueuePlayers, draftQueue, saveDraftQueue, router, pickedPlayerIds]);

  // Picker rows are fully hydrated server-side (ranks + archive stats), so the
  // card opens straight from the row with nothing to fetch. Undrafted players
  // have no owner by definition — saying so explicitly skips a crest lookup.
  // Never offer "Draft Pick" for a player already on the board (board/roster
  // clicks open the card read-only even when it's your turn).
  const selectPlayer = useCallback(
    (p: Player | null, ownership?: PlayerOwnership | null) => {
      if (!p) return;
      const stillAvailable = !pickedPlayerIds.has(p.id);
      openPlayer(p, {
        ownership,
        onPick:
          stillAvailable && isMyTurn && !loadingPick && !isDraftComplete
            ? (picked) => makePick(picked.id)
            : undefined,
      });
    },
    [openPlayer, isMyTurn, loadingPick, isDraftComplete, makePick, pickedPlayerIds],
  );

  const selectAvailablePlayer = useCallback(
    (p: Player | null) => selectPlayer(p, null),
    [selectPlayer],
  );

  const timerPct = (secondsLeft / TIMER_SECONDS) * 100;
  const timerColor =
    timerPct > 50 ? 'var(--color-accent)' : timerPct > 25 ? 'var(--color-warning)' : 'var(--color-danger)';

  const sortedTeams = [...teams].sort((a, b) => (a.draft_order ?? 0) - (b.draft_order ?? 0));

  const pickStrip = useMemo(() => {
    if (isDraftComplete) return [];
    const items: Array<{
      pickNum: number;
      team: Team | undefined;
      isCurrent: boolean;
      isPast: boolean;
      label: string;
    }> = [];
    const start = Math.max(1, currentPickNumber - 2);
    const end = Math.min(totalPicks, currentPickNumber + 7);
    for (let i = start; i <= end; i++) {
      const slot = snakeDraftOrder(i, numTeams);
      const team = teams.find((t) => t.draft_order === slot);
      const roundNum = Math.ceil(i / numTeams);
      const isEvenRound = roundNum % 2 === 0;
      const posInRound = isEvenRound ? numTeams + 1 - slot : slot;
      const label = `${String(roundNum).padStart(2, '0')}.${String(posInRound).padStart(2, '0')}`;
      items.push({ pickNum: i, team, isCurrent: i === currentPickNumber, isPast: i < currentPickNumber, label });
    }
    return items;
  }, [currentPickNumber, isDraftComplete, totalPicks, numTeams, teams]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      // Every other column's "best" value is the highest number; Draft
      // Rank's is the lowest (#1), so it starts ascending instead.
      setSortDir(key === 'draft_rank' ? 'asc' : 'desc');
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return '↕';
    return sortDir === 'desc' ? '↓' : '↑';
  }

  const rowProps = useMemo<PlayerRowCustomProps>(() => ({
    players: sortedAndFiltered,
    queue: draftQueue,
    myTurn: isMyTurn,
    picking: loadingPick,
    draftDone: isDraftComplete,
    shadowByPlayer,
    onToggleQueue: toggleQueue,
    onMakePick: makePick,
    onSelectPlayer: selectAvailablePlayer,
    onPrefetchPlayer: prefetchPlayer,
  }), [sortedAndFiltered, draftQueue, isMyTurn, loadingPick, isDraftComplete, shadowByPlayer, toggleQueue, makePick, selectAvailablePlayer, prefetchPlayer]);

  const [listHeight, setListHeight] = useState(500);
  useEffect(() => {
    if (sidebarTab !== 'players') return;
    const el = playerListRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.height > 0) setListHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    const h = el.getBoundingClientRect().height;
    if (h > 0) setListHeight(h);
    return () => observer.disconnect();
  }, [sidebarTab]);

  const timerMm = String(Math.floor(secondsLeft / 60));
  const timerSs = String(secondsLeft % 60).padStart(2, '0');

  return (
    <div className={styles.draftRoot}>
      {/* Top Banner */}
      <header className={`${styles.topBanner} ${isMyTurn ? styles.topBannerMyTurn : ''}`}>
        {isDraftComplete ? (
          <div className={styles.completeBanner}>
            <span className={styles.completeText}>Draft complete — league is now active.</span>
            <NavigationLink href={`/league/${leagueId}/team`} className={styles.goToTeamBtn}>
              Go to My Team →
            </NavigationLink>
          </div>
        ) : (
          <>
            <div className={`${styles.clockBlock} ${isMyTurn ? styles.clockBlockMyTurn : ''}`}>
              <span className={styles.clockLabel}>ON THE CLOCK</span>
              <span className={styles.clockTime}>{timerMm}:{timerSs}</span>
              {isMyTurn && <span className={styles.clockYouLabel}>YOU</span>}
            </div>

            <div className={styles.pickStripWrap}>
              <div className={styles.pickStrip}>
                {pickStrip.map((item, i) => (
                  <div key={item.pickNum} className={styles.pickStripItemWrap}>
                    {i > 0 && <span className={styles.stripChevron}>›</span>}
                    <div
                      ref={item.isCurrent ? currentStripItemRef : undefined}
                      className={[
                        styles.stripItem,
                        item.isCurrent ? styles.stripItemCurrent : '',
                        item.isPast ? styles.stripItemPast : '',
                        !item.isCurrent && !item.isPast ? styles.stripItemFuture : '',
                      ].filter(Boolean).join(' ')}
                    >
                      <span className={styles.stripPickLabel}>{item.label}</span>
                      <span className={styles.stripTeamName}>
                        {item.team?.abbreviation ?? item.team?.team_name ?? '—'}
                      </span>
                      {item.isCurrent && (
                        <span className={styles.stripPickingNow}>PICKING NOW</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.bannerMeta}>
              <span className={styles.bannerRoundLabel}>
                ROUND {currentRound} / {league.roster_size}
              </span>
              <span className={styles.bannerPickLabel}>
                Pick {currentPickNumber} of {totalPicks}
              </span>
            </div>
          </>
        )}
      </header>

      {/* Timer Bar */}
      {!isDraftComplete && (
        <div className={styles.timerBar}>
          <div
            className={styles.timerFill}
            style={{ width: `${timerPct}%`, background: timerColor }}
          />
        </div>
      )}

      {/* Main Area */}
      <div className={styles.mainArea}>
        {/* Draft Board */}
        <main className={styles.boardPanel}>
          <div className={styles.boardHeader}>
            <h1 className={styles.boardHeadline}>The Draft Room</h1>
            <p className={styles.boardSubtitle}>
              Dynasty League · Round {currentRound}/{league.roster_size} · {effectivePicks.length} picks made
            </p>
          </div>
          <div className={styles.boardScroll} ref={boardScrollRef}>
            <table
              className={styles.boardTable}
              // Natural width always, never shrunk to fit — `.boardScroll`'s
              // overflow:auto scrolls instead when it doesn't fit, rather
              // than squeezing every column down to unreadable widths on a
              // many-team board or a narrow phone (both hit the same cap
              // before this fix, since it read `min(100%, ...)`).
              style={{ width: `calc(34px + ${numTeams} * 140px)` } as React.CSSProperties}
            >
              <thead>
                <tr>
                  <th className={styles.roundHeaderCell} style={{ width: '34px' }}>RD</th>
                  {sortedTeams.map((team) => (
                    <th
                      key={team.id}
                      className={[
                        styles.teamHeaderCell,
                        team.user_id === myUserId ? styles.myTeamHeader : '',
                        currentTeam?.id === team.id && !isDraftComplete ? styles.onClockHeader : '',
                      ].filter(Boolean).join(' ')}
                      style={{ width: `calc((100% - 34px) / ${numTeams})` }}
                    >
                      <span className={styles.teamHeaderName}>{team.abbreviation ?? team.team_name}</span>
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
                          roundNum === currentRound &&
                          team.draft_order === currentDraftOrderSlot;
                        const isFuture =
                          !pick &&
                          !isCurrentSlot &&
                          absolutePickNumber(roundNum, team.draft_order ?? 1, numTeams) > currentPickNumber;
                        const isOptimistic = pick?.id?.startsWith('optimistic-');
                        const shouldAnimate = pick && !animatedPickIds.has(pick.id);
                        const label = cellPickLabel(roundNum, team.draft_order ?? 1, numTeams);

                        return (
                          <td
                            key={team.id}
                            ref={isCurrentSlot ? currentCellRef : undefined}
                            className={[
                              styles.pickCell,
                              pick ? styles.pickCellFilled : '',
                              isCurrentSlot ? styles.pickCellCurrent : '',
                              isFuture ? styles.pickCellFuture : '',
                              team.user_id === myUserId ? styles.myTeamCell : '',
                              isOptimistic ? styles.pickCellOptimistic : '',
                            ].filter(Boolean).join(' ')}
                          >
                            <span className={styles.cellLabel}>{label}</span>
                            {pick ? (
                              <motion.div
                                className={styles.pickedContent}
                                variants={pickVariants}
                                initial={shouldAnimate ? 'hidden' : 'visible'}
                                animate="visible"
                                style={{ cursor: 'pointer' }}
                                onClick={() => pick.player && selectPlayer(pick.player)}
                                onAnimationComplete={() => {
                                  if (shouldAnimate) {
                                    setAnimatedPickIds((prev) => new Set(prev).add(pick.id));
                                  }
                                }}
                              >
                                {pick.player?.primary_position && (
                                  <PositionBadge position={pick.player.primary_position as GranularPosition} size="sm" />
                                )}
                                <span className={styles.pickedName}>
                                  {getPlayerDisplayName(pick.player, 'initial_last')}
                                </span>
                                {isOptimistic && (
                                  <span className={styles.confirmingLabel}>…</span>
                                )}
                              </motion.div>
                            ) : isCurrentSlot ? (
                              <div className={styles.onClockContent}>
                                <span className={styles.onClockDot} />
                                <span className={styles.onClockText}>PICK</span>
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
        </main>

        {/* Right Sidebar — a static side panel on desktop, a drag-open bottom
            drawer on mobile. Position is `transform: translateY()`, not a
            toggled height class — see the drawerLiveOffset comment above for
            why. isMobile gates the drag/transform; desktop is untouched. */}
        <aside
          className={styles.sidebarPanel}
          style={isMobile ? {
            transform: `translateY(${
              drawerLiveOffset ?? (drawerExpanded ? 0 : drawerMaxOffsetRef.current)
            }px)`,
            transition: drawerLiveOffset != null ? 'none' : 'transform 220ms ease',
          } : undefined}
        >
          {isMobile && (
            // The grip is a full-width ~44px touch target, not just the
            // thin visual bar — a 36×4px hit area is unreliable on a real
            // finger. Pan gesture lives here, not on the whole panel: the
            // panel also contains scrollable lists (players/roster/queue),
            // and dragging the whole thing would hijack their touch-scroll
            // instead of letting it through.
            <motion.div
              className={styles.drawerGrip}
              onPanStart={handleDrawerPanStart}
              onPan={handleDrawerPan}
              onPanEnd={handleDrawerPanEnd}
              onClick={() => setDrawerExpanded((v) => !v)}
            >
              <div className={styles.drawerHandle} />
            </motion.div>
          )}
          <div className={styles.sidebarTabs}>
            <button
              type="button"
              className={`${styles.sidebarTab} ${sidebarTab === 'players' ? styles.sidebarTabActive : ''}`}
              onClick={() => selectSidebarTab('players')}
            >
              Players
            </button>
            <button
              type="button"
              className={`${styles.sidebarTab} ${sidebarTab === 'roster' ? styles.sidebarTabActive : ''}`}
              onClick={() => selectSidebarTab('roster')}
            >
              My roster{myRoster.length > 0 ? ` (${myRoster.length})` : ''}
            </button>
            <button
              type="button"
              className={`${styles.sidebarTab} ${sidebarTab === 'queue' ? styles.sidebarTabActive : ''}`}
              onClick={() => selectSidebarTab('queue')}
            >
              Queue{activeQueuePlayers.length > 0 ? ` (${activeQueuePlayers.length})` : ''}
            </button>
            <button
              type="button"
              className={`${styles.sidebarTab} ${sidebarTab === 'chat' ? styles.sidebarTabActive : ''}`}
              onClick={() => selectSidebarTab('chat')}
            >
              Chat
            </button>
          </div>

          {/* Players Tab — not rendered while the mobile drawer is collapsed,
              so the virtualized list/filters don't do work behind a 56px
              strip nobody can see. */}
          {(!isMobile || drawerExpanded) && sidebarTab === 'players' && (
            <div className={styles.tabContent}>
              <div className={styles.searchRow}>
                <input
                  type="text"
                  placeholder="Search player or club…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className={styles.searchInput}
                />
              </div>
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
                <button
                  type="button"
                  onClick={() => setNewToPremOnly((v) => !v)}
                  className={`${styles.posBtn} ${styles.newFilterBtn} ${newToPremOnly ? styles.posBtnActive : ''}`}
                  title="Show only players new to the Premier League this season"
                >
                  NEW
                </button>
              </div>

              {/* Advanced Filters Toggle */}
              <div className={styles.advancedFiltersToggle}>
                <button
                  type="button"
                  className={styles.advancedBtn}
                  onClick={() => setAdvancedOpen(!advancedOpen)}
                >
                  {advancedOpen ? 'Hide Advanced Filters' : 'Show Advanced Filters'}
                  <span className={styles.btnChevron}>{advancedOpen ? ' ▲' : ' ▼'}</span>
                </button>
              </div>

              {/* Collapsible Advanced Filters Drawer */}
              {advancedOpen && (
                <div className={styles.advancedFiltersPanel}>
                  <div className={styles.filterGroup}>
                    <label className={styles.filterLabel}>Minutes Filter</label>
                    <select
                      className={styles.filterSelect}
                      value={minMins}
                      onChange={(e) => setMinMins(e.target.value as 'played' | 'all' | 'gt45')}
                    >
                      <option value="played">Played (&gt;0 mins)</option>
                      <option value="all">Meaningful (&ge;15 mins)</option>
                      <option value="gt45">Starters (&gt;45 mins)</option>
                    </select>
                  </div>

                  <div className={styles.filterGroup}>
                    <span className={styles.filterLabel}>Min Games Played: <strong>{minGames}</strong></span>
                    <input
                      type="range"
                      min="0"
                      max="38"
                      value={minGames}
                      onChange={(e) => setMinGames(parseInt(e.target.value))}
                      className={styles.sliderInput}
                    />
                  </div>

                  <div className={styles.filterGroup}>
                    <label className={styles.filterLabel}>Role Matching</label>
                    <div className={styles.segmentedToggle}>
                      <button
                        type="button"
                        className={`${styles.toggleButton} ${posType === 'primary' ? styles.activeToggle : ''}`}
                        onClick={() => setPosType('primary')}
                      >
                        Primary
                      </button>
                      <button
                        type="button"
                        className={`${styles.toggleButton} ${posType === 'secondary' ? styles.activeToggle : ''}`}
                        onClick={() => setPosType('secondary')}
                      >
                        Secondary
                      </button>
                      <button
                        type="button"
                        className={`${styles.toggleButton} ${posType === 'both' ? styles.activeToggle : ''}`}
                        onClick={() => setPosType('both')}
                      >
                        Both
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {pickError && <p className={styles.pickError}>{pickError}</p>}

              {isMobile ? (
                <>
                  {/* No columns to click on a card list — a compact sort
                      control replaces the table's clickable headers. */}
                  <div className={styles.mobileSortRow}>
                    <select
                      className={styles.filterSelect}
                      value={sortKey}
                      onChange={(e) => handleSort(e.target.value as SortKey)}
                    >
                      <option value="draft_rank">Sort: Rank</option>
                      <option value="ppg">Sort: PPG</option>
                      <option value="total_points">Sort: Points</option>
                      <option value="market_value">Sort: Value</option>
                      <option value="gp">Sort: GP</option>
                      <option value="avg_rating">Sort: Avg rating</option>
                    </select>
                    <button
                      type="button"
                      className={styles.mobileSortDirBtn}
                      onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
                      title="Reverse sort direction"
                    >
                      {sortDir === 'desc' ? '↓' : '↑'}
                    </button>
                  </div>
                  <div className={styles.playerList} ref={playerListRef}>
                    {sortedAndFiltered.length > 0 ? (
                      <List<PlayerRowCustomProps>
                        rowComponent={MobilePlayerCard}
                        rowCount={sortedAndFiltered.length}
                        rowHeight={72}
                        rowProps={rowProps}
                        overscanCount={10}
                        style={{ height: listHeight }}
                      />
                    ) : (
                      <p className={styles.emptyState}>No players match your filters.</p>
                    )}
                  </div>
                </>
              ) : (
                /* Premium Scrollable Stats Table */
                <div className={styles.tableScroller}>
                  <div className={styles.tableStatsLayout}>
                    {/* Table Header Row */}
                    <div className={styles.tableStatsHeader}>
                      <div className={styles.thSticky}>Player</div>
                      <div className={`${styles.th} ${sortKey === 'draft_rank' ? styles.thActive : ''}`} onClick={() => handleSort('draft_rank')} title="Gaffa's synthetic pre-draft ranking — market value and prior-season performance, not a real historical ADP">
                        Rank {sortIndicator('draft_rank')}
                      </div>
                      <div className={`${styles.th} ${sortKey === 'gp' ? styles.thActive : ''}`} onClick={() => handleSort('gp')}>
                        GP {sortIndicator('gp')}
                      </div>
                      <div className={`${styles.th} ${sortKey === 'total_points' ? styles.thActive : ''}`} onClick={() => handleSort('total_points')}>
                        Pts {sortIndicator('total_points')}
                      </div>
                      <div className={`${styles.th} ${sortKey === 'ppg' ? styles.thActive : ''}`} onClick={() => handleSort('ppg')}>
                        PPG {sortIndicator('ppg')}
                      </div>
                      <div className={`${styles.th} ${sortKey === 'avg_rating' ? styles.thActive : ''}`} onClick={() => handleSort('avg_rating')}>
                        Avg {sortIndicator('avg_rating')}
                      </div>
                      <div className={`${styles.th} ${sortKey === 'market_value' ? styles.thActive : ''}`} onClick={() => handleSort('market_value')}>
                        Val {sortIndicator('market_value')}
                      </div>
                    </div>

                    {/* Virtualized Player Rows */}
                    <div className={styles.playerList} ref={playerListRef}>
                      {sortedAndFiltered.length > 0 ? (
                        <List<PlayerRowCustomProps>
                          rowComponent={PlayerRow}
                          rowCount={sortedAndFiltered.length}
                          rowHeight={60}
                          rowProps={rowProps}
                          overscanCount={10}
                          style={{ height: listHeight }}
                        />
                      ) : (
                        <p className={styles.emptyState}>No players match your filters.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* My Roster Tab */}
          {(!isMobile || drawerExpanded) && sidebarTab === 'roster' && (
            <div className={styles.tabContentScrollable}>
              {myRoster.length > 0 && (
                <div className={styles.rosterToggleBar}>
                  <button
                    type="button"
                    className={`${styles.rosterToggleBtn} ${rosterSortMode === 'draft' ? styles.rosterToggleBtnActive : ''}`}
                    onClick={() => setRosterSortMode('draft')}
                  >
                    By Draft Pick
                  </button>
                  <button
                    type="button"
                    className={`${styles.rosterToggleBtn} ${rosterSortMode === 'position' ? styles.rosterToggleBtnActive : ''}`}
                    onClick={() => setRosterSortMode('position')}
                  >
                    By Position
                  </button>
                </div>
              )}
              {myRoster.length === 0 ? (
                <div className={styles.emptyStateWrap}>
                  <p className={styles.emptyState}>No picks yet.</p>
                  <p className={styles.emptyStateHint}>Your drafted players will appear here.</p>
                </div>
              ) : (
                <ul className={styles.rosterList}>
                  <AnimatePresence>
                    {myRoster.map((pick) => {
                      const isOptimistic = pick.id?.startsWith('optimistic-');
                      return (
                        <motion.li
                          key={pick.id}
                          className={`${styles.rosterItem} ${isOptimistic ? styles.rosterItemOptimistic : ''}`}
                          variants={rosterItemVariants}
                          initial="hidden"
                          animate="visible"
                          layout
                        >
                          <span className={styles.rosterPickNum}>#{pick.pick}</span>
                          {pick.player?.primary_position && (
                            <PositionBadge position={pick.player.primary_position as GranularPosition} size="sm" />
                          )}
                          <div className={styles.rosterPlayerInfo}>
                            <span
                              className={`${styles.rosterPlayerName} ${styles.rosterPlayerNameClickable}`}
                              onClick={() => pick.player && selectPlayer(pick.player)}
                              onPointerEnter={() => pick.player && prefetchPlayer(pick.player)}
                            >
                              {getPlayerDisplayName(pick.player, 'initial_last')}
                            </span>
                            <span className={styles.rosterPlayerClub}>{pick.player?.pl_team}</span>
                          </div>
                          {isOptimistic && (
                            <span className={styles.confirmingLabel}>confirming…</span>
                          )}
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ul>
              )}
            </div>
          )}

          {/* Queue Tab */}
          {(!isMobile || drawerExpanded) && sidebarTab === 'queue' && (
            <div className={styles.tabContentScrollable}>
              {activeQueuePlayers.length === 0 ? (
                <div className={styles.emptyStateWrap}>
                  <p className={styles.emptyState}>Queue is empty.</p>
                  <p className={styles.emptyStateHint}>
                    Star players in the Players tab to add them. The top queued player auto-drafts
                    when time expires.
                  </p>
                </div>
              ) : (
                <>
                  {isMyTurn && (
                    <div className={styles.queueAutoPickHint}>
                      Top player auto-drafts if time expires
                    </div>
                  )}
                  <ul className={styles.queueList}>
                    {activeQueuePlayers.map((playerId, idx) => {
                      const player = playerMap.get(playerId);
                      if (!player) return null;
                      return (
                        <li key={playerId} className={styles.queueItem}>
                          <span className={styles.queueRank}>{idx + 1}</span>
                          <PositionBadge position={player.primary_position as GranularPosition} size="sm" />
                          <div className={styles.queuePlayerInfo}>
                            <span className={styles.queuePlayerName}>
                              {getPlayerDisplayName(player, 'initial_last')}
                            </span>
                            <span className={styles.queuePlayerClub}>{player.pl_team}</span>
                          </div>
                          <div className={styles.queueItemActions}>
                            {isMyTurn && !isDraftComplete && (
                              <button
                                type="button"
                                className={styles.queueDraftBtn}
                                onClick={() => makePick(playerId)}
                                disabled={loadingPick}
                              >
                                Draft
                              </button>
                            )}
                            <button
                              type="button"
                              className={styles.queueMoveBtn}
                              onClick={() => moveQueueItem(playerId, 'up')}
                              disabled={idx === 0}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className={styles.queueMoveBtn}
                              onClick={() => moveQueueItem(playerId, 'down')}
                              disabled={idx === activeQueuePlayers.length - 1}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className={styles.queueRemoveBtn}
                              onClick={() => toggleQueue(playerId)}
                            >
                              ×
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          )}

          {/* Chat Tab */}
          <div
            className={styles.tabContent}
            style={{ display: sidebarTab === 'chat' ? 'block' : 'none' }}
          >
            <div className={styles.draftChatWrapper}>
              <SidebarChat
                leagueId={leagueId}
                currentUserId={myUserId}
                currentUsername={(myTeam as any)?.user?.username || (myTeam as any)?.user?.email?.split('@')[0] || 'Manager'}
              />
            </div>
          </div>
        </aside>
      </div>

      {/* The player card modal is owned by PlayerCardProvider in the dashboard layout. */}
    </div>
  );
}
