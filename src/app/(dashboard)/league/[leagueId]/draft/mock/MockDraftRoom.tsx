'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NavigationLink from '@/components/ui/NavigationLink';
import { motion, type PanInfo } from 'framer-motion';
import { List } from 'react-window';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import { usePlayerCard } from '@/components/players/PlayerCardProvider';
import {
  pickBestCandidate,
  type ScoredDraftCandidate,
  type PositionCounts,
} from '@/lib/draft/autoPickEngine';
import type { DraftShadowMaps } from '@/lib/draft/loadDraftPool';
import type { League, Player, GranularPosition, PlayerOwnership } from '@/types';
import draftStyles from '../draft.module.css';
import styles from './mockDraft.module.css';
import { fold } from '@/lib/text/fold';

const TIMER_SECONDS = 120;
const BOT_PICK_DELAY_MS = 650;
const POSITION_ORDER: GranularPosition[] = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'];

type SortKey = 'total_points' | 'ppg' | 'avg_rating' | 'market_value' | 'gp' | 'draft_rank';
type SortDir = 'desc' | 'asc';

const BOT_NAMES = [
  'Ironclad FC', 'Riverside Rovers', 'Northgate United', 'Vantage City', 'Old Mill Athletic',
  'Crownhill Rangers', 'Redbrook Town', 'Sable Harbor FC', 'Glasshouse United', 'Fenwick Albion',
  'Stonebridge SC', 'Harrow Point FC', 'Meridian Wanderers', 'Lockwood Athletic', 'Foxglove United',
  'Ashcombe Rovers', 'Brightwell FC', 'Kestrel Town', 'Thistledown FC', 'Copperfield United',
];

function botName(slot: number): string {
  return BOT_NAMES[(slot - 1) % BOT_NAMES.length];
}

function snakeDraftOrder(pickNumber: number, numTeams: number): number {
  const round = Math.floor((pickNumber - 1) / numTeams);
  const posInRound = (pickNumber - 1) % numTeams;
  return round % 2 === 0 ? posInRound + 1 : numTeams - posInRound;
}

interface MockPick {
  pick: number;
  round: number;
  teamSlot: number;
  playerId: string;
  pickedAt: string;
}

interface MockSession {
  numTeams: number;
  mySlot: number;
  rosterSize: number;
  picks: MockPick[];
  queue: string[];
  startedAt: string;
}

function storageKey(leagueId: string) {
  return `gaffa-mock-draft:${leagueId}`;
}

function loadSession(leagueId: string, rosterSize: number): MockSession | null {
  try {
    const raw = window.localStorage.getItem(storageKey(leagueId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MockSession;
    if (!parsed || typeof parsed.numTeams !== 'number' || typeof parsed.mySlot !== 'number' || !Array.isArray(parsed.picks)) {
      return null;
    }
    if (parsed.rosterSize !== rosterSize) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveSession(leagueId: string, session: MockSession | null) {
  if (!session) {
    window.localStorage.removeItem(storageKey(leagueId));
  } else {
    window.localStorage.setItem(storageKey(leagueId), JSON.stringify(session));
  }
}

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
  const totalPoints = s && s.gp > 0 ? s.total_points.toFixed(2) : '—';
  const ppg = s && s.gp > 0 ? (s.total_points / s.gp).toFixed(2) : '—';
  const avgRating = s && s.gp > 0 ? s.avg_rating.toFixed(2) : '—';
  const value = player.market_value != null ? `€${Number(player.market_value).toFixed(1)}m` : '—';
  const rank = player.draftRank != null ? String(player.draftRank) : '—';
  const isUnavailable = !!player.fpl_status && player.fpl_status !== 'a';

  return (
    <div
      style={style}
      className={draftStyles.playerRow}
      onClick={() => onSelectPlayer(player)}
      onPointerEnter={() => onPrefetchPlayer(player)}
    >
      <div className={draftStyles.tdPlayerSticky}>
        <div className={draftStyles.playerRowLeft}>
          <div className={draftStyles.posRow}>
            <span className={`${draftStyles.posBadge} ${draftStyles[`pos${player.primary_position}` as keyof typeof draftStyles]}`}>
              {player.primary_position}
            </span>
            {player.primary_position !== activePos && (
              <>
                <span className={draftStyles.secArrow} title={`Primary position: ${player.primary_position} — evaluated as ${activePos}`}>→</span>
                <span className={`${draftStyles.posBadge} ${draftStyles[`pos${activePos}` as keyof typeof draftStyles]}`}>
                  {activePos}
                </span>
              </>
            )}
          </div>
          <div className={draftStyles.playerInfo}>
            <span className={draftStyles.playerName}>{getPlayerDisplayName(player, 'initial_last')}</span>
            {isUnavailable && player.fpl_news ? (
              <span className={draftStyles.injuryNote} title={player.fpl_news}>{player.fpl_news}</span>
            ) : (
              <span className={draftStyles.playerClub}>{player.pl_team}</span>
            )}
          </div>
        </div>
        <div className={draftStyles.rowActions}>
          <button
            type="button"
            className={`${draftStyles.queueBtn} ${isQueued ? draftStyles.queueBtnActive : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggleQueue(player.id); }}
            title={isQueued ? 'Remove from queue' : 'Add to queue'}
          >
            {isQueued ? '★' : '☆'}
          </button>
          <button
            type="button"
            className={`${draftStyles.draftBtn} ${!isMyPick ? draftStyles.draftBtnDisabled : ''}`}
            onClick={(e) => { e.stopPropagation(); onMakePick(player.id); }}
            disabled={!isMyPick}
          >
            Draft
          </button>
        </div>
      </div>

      <div className={draftStyles.tdNum}>{rank}</div>

      {player.isNewToPrem ? (
        <div className={draftStyles.newStatsCell} title="New to the Premier League this season — no prior-season stats">
          <span className={draftStyles.newTag}>NEW</span>
        </div>
      ) : (
        <>
          <div className={draftStyles.tdNum}>{gp}</div>
          <div className={draftStyles.tdNum}>{totalPoints}</div>
          <div className={draftStyles.tdNum}>{ppg}</div>
          <div className={draftStyles.tdNum}>{avgRating}</div>
        </>
      )}
      <div className={draftStyles.tdNum}>{value}</div>
    </div>
  );
}

// Mobile equivalent of PlayerRow — mirrors DraftRoom.tsx's MobilePlayerCard.
// Same reasoning: a fixed 2-line card instead of table columns (no room on
// a phone regardless of container width), GP/Avg rating dropped rather than
// tucked behind a tap-to-expand (would need variable row heights, which
// breaks react-window's fixed rowHeight).
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
  const ppg = s && s.gp > 0 ? (s.total_points / s.gp).toFixed(2) : '—';
  const totalPoints = s && s.gp > 0 ? String(Math.round(s.total_points)) : '—';
  const value = player.market_value != null ? `€${Number(player.market_value).toFixed(1)}m` : '—';
  const rank = player.draftRank != null ? String(player.draftRank) : '—';
  const isUnavailable = !!player.fpl_status && player.fpl_status !== 'a';

  return (
    <div
      style={style}
      className={draftStyles.mobileCard}
      onClick={() => onSelectPlayer(player)}
      onPointerEnter={() => onPrefetchPlayer(player)}
    >
      <div className={draftStyles.mobileCardLeft}>
        <div className={draftStyles.posRow}>
          <span className={`${draftStyles.posBadge} ${draftStyles[`pos${player.primary_position}` as keyof typeof draftStyles]}`}>
            {player.primary_position}
          </span>
        </div>
        <div className={draftStyles.playerInfo}>
          <span className={draftStyles.playerName}>{getPlayerDisplayName(player, 'initial_last')}</span>
          {isUnavailable && player.fpl_news ? (
            <span className={draftStyles.injuryNote} title={player.fpl_news}>{player.fpl_news}</span>
          ) : (
            <span className={draftStyles.playerClub}>{player.pl_team}</span>
          )}
        </div>
      </div>
      <div className={draftStyles.mobileCardRight}>
        <div className={draftStyles.mobileCardStats}>
          <span className={draftStyles.mobileCardRank}>#{rank}</span>
          {player.isNewToPrem ? (
            <span className={draftStyles.mobileCardSub}>NEW · {value}</span>
          ) : (
            <>
              <span className={draftStyles.mobileCardSub}>{ppg} PPG · {totalPoints} Pts</span>
              <span className={draftStyles.mobileCardSub}>{value}</span>
            </>
          )}
        </div>
        <div className={draftStyles.rowActions}>
          <button
            type="button"
            className={`${draftStyles.queueBtn} ${isQueued ? draftStyles.queueBtnActive : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggleQueue(player.id); }}
            title={isQueued ? 'Remove from queue' : 'Add to queue'}
          >
            {isQueued ? '★' : '☆'}
          </button>
          <button
            type="button"
            className={`${draftStyles.draftBtn} ${!isMyPick ? draftStyles.draftBtnDisabled : ''}`}
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

interface Props {
  leagueId: string;
  league: League;
  players: Player[];
  shadowMaps: DraftShadowMaps;
  myTeamName: string;
}

export default function MockDraftRoom({ leagueId, league, players, shadowMaps, myTeamName }: Props) {
  const { openPlayer, prefetchPlayer, primePlayers } = usePlayerCard();
  useEffect(() => {
    if (players.length) primePlayers(players);
  }, [players, primePlayers]);

  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState<MockSession | null>(null);
  const [picking, setPicking] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(TIMER_SECONDS);
  const [paused, setPaused] = useState(false);
  // Accumulated paused ms for the current pick clock, plus when the current pause started.
  const pausedMsRef = useRef(0);
  const pauseStartedAtRef = useRef<number | null>(null);

  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState<string>('ALL');
  const [newToPremOnly, setNewToPremOnly] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Matches the stats page's minutes filter exactly (GlobalStatsTable.tsx).
  const [minMins, setMinMins] = useState<'played' | 'all' | 'gt45'>('all');
  const [minGames, setMinGames] = useState(0);
  const [posType, setPosType] = useState<'primary' | 'secondary' | 'both'>('primary');
  // Matches DraftRoom.tsx's default — see Draft Rank spec.
  const [sortKey, setSortKey] = useState<SortKey>('draft_rank');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [sidebarTab, setSidebarTab] = useState<'players' | 'roster' | 'queue' | 'recap'>('players');
  const [rosterSortMode, setRosterSortMode] = useState<'draft' | 'position'>('draft');

  const [setupNumTeams, setSetupNumTeams] = useState(() => Math.min(20, Math.max(4, league.max_teams)));
  const [setupSlot, setSetupSlot] = useState(0);

  const playerListRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(500);

  // Mobile drawer — mirrors DraftRoom.tsx exactly (board primary, drawer for
  // the tabs; transform-based drag with live finger tracking, not a height
  // transition). See docs/superpowers/specs/2026-08-19-mobile-draft-drawer-design.md
  // and the follow-up real-device fixes in DraftRoom.tsx.
  const [isMobile, setIsMobile] = useState(false);
  const [drawerExpanded, setDrawerExpanded] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const selectSidebarTab = useCallback((tab: 'players' | 'roster' | 'queue' | 'recap') => {
    setSidebarTab(tab);
    setDrawerExpanded(true);
  }, []);

  const [drawerLiveOffset, setDrawerLiveOffset] = useState<number | null>(null);
  const drawerMaxOffsetRef = useRef(0);
  const drawerPanStartRef = useRef(0);

  useEffect(() => {
    const updateMax = () => {
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

  const currentStripItemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loaded = loadSession(leagueId, league.roster_size);
    if (loaded) setSession(loaded);
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveSession(leagueId, session);
  }, [hydrated, leagueId, session]);

  const playerMap = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of players) map.set(p.id, p);
    return map;
  }, [players]);

  // loadDraftPool.ts already scores every player once (draftQualityScore) using
  // the correct resolved-season stats — recomputing here used to read the live
  // players.total_points/ppg columns instead, which are the *current*
  // (in-progress, often preseason-empty) season, not the prior completed one
  // the rest of the draft room uses. Reading the precomputed value keeps the
  // bot's picks consistent with the displayed Rank column and fixes that.
  const scoredPool = useMemo<ScoredDraftCandidate[]>(
    () =>
      players.map((p) => ({
        id: p.id,
        primaryPosition: p.primary_position,
        marketValue: p.market_value,
        totalPoints: p.total_points,
        ppg: p.ppg,
        gp: 0, // Not read post-scoring — qualityScore below is already final.
        fplStatus: p.fpl_status,
        qualityScore: p.draftQualityScore ?? 0,
      })),
    [players],
  );

  const positionById = useMemo(() => {
    const map = new Map<string, GranularPosition>();
    for (const p of players) map.set(p.id, p.primary_position);
    return map;
  }, [players]);

  const phase: 'loading' | 'setup' | 'drafting' | 'complete' = !hydrated
    ? 'loading'
    : !session
    ? 'setup'
    : session.picks.length >= session.numTeams * session.rosterSize
    ? 'complete'
    : 'drafting';

  useEffect(() => {
    if (phase === 'complete') {
      setSidebarTab('recap');
      setDrawerExpanded(true);
    }
  }, [phase]);

  const pickedIds = useMemo(() => new Set((session?.picks ?? []).map((p) => p.playerId)), [session]);

  const rosterCountsBySlot = useMemo(() => {
    const map: Record<number, PositionCounts> = {};
    if (!session) return map;
    for (let s = 1; s <= session.numTeams; s++) map[s] = {};
    for (const pick of session.picks) {
      const pos = positionById.get(pick.playerId);
      if (!pos) continue;
      const counts = map[pick.teamSlot] ?? (map[pick.teamSlot] = {});
      counts[pos] = (counts[pos] ?? 0) + 1;
    }
    return map;
  }, [session, positionById]);

  const computeAutoPick = useCallback(
    (slot: number): string | null => {
      if (!session) return null;
      const remaining = scoredPool.filter((c) => !pickedIds.has(c.id));
      const counts = rosterCountsBySlot[slot] ?? {};
      const best = pickBestCandidate(remaining, counts, session.rosterSize);
      return best?.id ?? null;
    },
    [session, scoredPool, pickedIds, rosterCountsBySlot],
  );

  const commitPick = useCallback((playerId: string) => {
    setSession((prev) => {
      if (!prev) return prev;
      if (prev.picks.some((p) => p.playerId === playerId)) return prev;
      const total = prev.numTeams * prev.rosterSize;
      if (prev.picks.length >= total) return prev;
      const pickNumber = prev.picks.length + 1;
      const teamSlot = snakeDraftOrder(pickNumber, prev.numTeams);
      const round = Math.ceil(pickNumber / prev.numTeams);
      const newPick: MockPick = { pick: pickNumber, round, teamSlot, playerId, pickedAt: new Date().toISOString() };
      return { ...prev, picks: [...prev.picks, newPick], queue: prev.queue.filter((id) => id !== playerId) };
    });
  }, []);

  const currentPickNumber = session ? session.picks.length + 1 : 1;
  const numTeams = session?.numTeams ?? 0;
  const currentSlot = session && phase === 'drafting' ? snakeDraftOrder(currentPickNumber, numTeams) : null;
  const isMyTurn = phase === 'drafting' && currentSlot === session?.mySlot;
  const currentRound = session ? Math.ceil(currentPickNumber / session.numTeams) : 1;
  const totalPicks = session ? session.numTeams * session.rosterSize : 0;

  useEffect(() => {
    currentStripItemRef.current?.scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest',
    });
  }, [currentPickNumber]);

  // Reset pick lock + pause accounting whenever a new pick lands.
  useEffect(() => {
    setPicking(false);
    pausedMsRef.current = 0;
    pauseStartedAtRef.current = null;
    setPaused(false);
    setSecondsLeft(TIMER_SECONDS);
  }, [session?.picks.length]);

  function togglePause() {
    if (phase !== 'drafting') return;
    if (paused) {
      if (pauseStartedAtRef.current != null) {
        pausedMsRef.current += Date.now() - pauseStartedAtRef.current;
        pauseStartedAtRef.current = null;
      }
      setPaused(false);
    } else {
      pauseStartedAtRef.current = Date.now();
      setPaused(true);
    }
  }

  // Bot turns — skipped while paused.
  useEffect(() => {
    if (phase !== 'drafting' || !session || currentSlot === null || currentSlot === session.mySlot || paused) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      const id = computeAutoPick(currentSlot);
      if (id) commitPick(id);
    }, BOT_PICK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.picks.length, phase, currentSlot, paused]);

  // Human countdown — frozen while paused; queue-then-engine auto-pick on expiry.
  useEffect(() => {
    if (phase !== 'drafting' || !session) return;
    let autoFired = false;
    const lastPick = session.picks[session.picks.length - 1];
    const lastTime = lastPick ? new Date(lastPick.pickedAt).getTime() : new Date(session.startedAt).getTime();

    const tick = () => {
      const livePauseMs =
        pauseStartedAtRef.current != null ? Date.now() - pauseStartedAtRef.current : 0;
      const effectivePaused = pausedMsRef.current + livePauseMs;
      const elapsed = Math.floor((Date.now() - lastTime - effectivePaused) / 1000);
      const remain = Math.max(0, TIMER_SECONDS - elapsed);
      setSecondsLeft(remain);
      if (remain === 0 && isMyTurn && !autoFired && !paused) {
        autoFired = true;
        const fallbackId = session.queue.find((id) => !pickedIds.has(id)) ?? computeAutoPick(session.mySlot);
        if (fallbackId) commitPick(fallbackId);
      }
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.picks.length, phase, isMyTurn, paused]);

  function handleManualPick(playerId: string) {
    if (!isMyTurn || picking || phase !== 'drafting') return;
    if (pickedIds.has(playerId)) return;
    setPicking(true);
    commitPick(playerId);
  }

  function toggleQueue(playerId: string) {
    setSession((prev) => {
      if (!prev) return prev;
      const inQueue = prev.queue.includes(playerId);
      return { ...prev, queue: inQueue ? prev.queue.filter((id) => id !== playerId) : [...prev.queue, playerId] };
    });
  }

  function moveQueueItem(playerId: string, dir: 'up' | 'down') {
    setSession((prev) => {
      if (!prev) return prev;
      const idx = prev.queue.indexOf(playerId);
      if (idx === -1) return prev;
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= prev.queue.length) return prev;
      const q = [...prev.queue];
      [q[idx], q[swapIdx]] = [q[swapIdx], q[idx]];
      return { ...prev, queue: q };
    });
  }

  function startDraft() {
    const mySlot = setupSlot === 0 ? 1 + Math.floor(Math.random() * setupNumTeams) : setupSlot;
    pausedMsRef.current = 0;
    pauseStartedAtRef.current = null;
    setPaused(false);
    setSession({
      numTeams: setupNumTeams,
      mySlot,
      rosterSize: league.roster_size,
      picks: [],
      queue: [],
      startedAt: new Date().toISOString(),
    });
    setSidebarTab('players');
  }

  function restartDraft() {
    if (!window.confirm('Restart this mock draft from scratch? Progress will be lost.')) return;
    setSession(null);
    setPaused(false);
    pausedMsRef.current = 0;
    pauseStartedAtRef.current = null;
  }

  function teamLabel(slot: number): string {
    if (!session) return '';
    return slot === session.mySlot ? myTeamName : botName(slot);
  }

  function teamAbbrev(slot: number): string {
    if (!session) return '';
    return slot === session.mySlot ? 'YOU' : `B${slot}`;
  }

  const shadowByPlayer =
    minMins === 'played' ? shadowMaps.played : minMins === 'all' ? shadowMaps.all : shadowMaps.gt45;

  const unpickedPlayers = useMemo(() => players.filter((p) => !pickedIds.has(p.id)), [players, pickedIds]);

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
      filter: string,
      type: 'primary' | 'secondary' | 'both',
    ): string | null {
      const primary = player.primary_position;
      const secondaries = player.secondary_positions ?? [];
      if (type === 'primary') {
        if (groupContains(filter, primary)) return primary;
      } else if (type === 'secondary') {
        const match = secondaries.find((pos) => groupContains(filter, pos));
        if (match) return match;
      } else {
        if (groupContains(filter, primary)) return primary;
        const match = secondaries.find((pos) => groupContains(filter, pos));
        if (match) return match;
      }
      return null;
    }

    const q = fold(search);
    const filtered = unpickedPlayers
      .map((p) => {
        const activePos = resolveActivePosition(p, posFilter, posType);
        return { player: p, activePos };
      })
      .filter((item): item is { player: Player; activePos: string } => {
        const { player: p, activePos } = item;
        if (!activePos) return false;
        if (q) {
          const full = fold(p.name);
          const web = fold(p.web_name);
          const club = fold(p.pl_team);
          // Word-start prefix, not substring — see DraftRoom.tsx's identical fix.
          const startsWithQuery = (text: string) => text.split(/\s+/).some((word) => word.startsWith(q));
          if (!startsWithQuery(full) && !startsWithQuery(web) && !startsWithQuery(club)) return false;
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

  const myRoster = useMemo(() => {
    if (!session) return [];
    const rosterPicks = session.picks.filter((p) => p.teamSlot === session.mySlot);
    if (rosterSortMode === 'draft') return [...rosterPicks].sort((a, b) => a.pick - b.pick);
    return [...rosterPicks].sort((a, b) => {
      const posA = POSITION_ORDER.indexOf(positionById.get(a.playerId) as GranularPosition);
      const posB = POSITION_ORDER.indexOf(positionById.get(b.playerId) as GranularPosition);
      return (posA === -1 ? 99 : posA) - (posB === -1 ? 99 : posB);
    });
  }, [session, rosterSortMode, positionById]);

  const activeQueuePlayers = useMemo(
    () => (session?.queue ?? []).filter((id) => !pickedIds.has(id)),
    [session, pickedIds],
  );

  const pickGrid = useMemo(() => {
    const grid: Record<number, Record<number, MockPick>> = {};
    for (const pick of session?.picks ?? []) {
      if (!grid[pick.round]) grid[pick.round] = {};
      grid[pick.round][pick.teamSlot] = pick;
    }
    return grid;
  }, [session]);

  const pickStrip = useMemo(() => {
    if (!session || phase !== 'drafting') return [];
    const items: Array<{ pickNum: number; slot: number; isCurrent: boolean; isPast: boolean; label: string }> = [];
    const start = Math.max(1, currentPickNumber - 2);
    const end = Math.min(totalPicks, currentPickNumber + 7);
    for (let i = start; i <= end; i++) {
      const slot = snakeDraftOrder(i, session.numTeams);
      const roundNum = Math.ceil(i / session.numTeams);
      const isEvenRound = roundNum % 2 === 0;
      const posInRound = isEvenRound ? session.numTeams + 1 - slot : slot;
      const label = `${String(roundNum).padStart(2, '0')}.${String(posInRound).padStart(2, '0')}`;
      items.push({ pickNum: i, slot, isCurrent: i === currentPickNumber, isPast: i < currentPickNumber, label });
    }
    return items;
  }, [session, phase, currentPickNumber, totalPicks]);

  const leaderboard = useMemo(() => {
    if (!session || phase !== 'complete') return [];
    const rows: { slot: number; label: string; value: number; points: number; ppg: number }[] = [];
    for (let s = 1; s <= session.numTeams; s++) {
      const teamPicks = session.picks.filter((p) => p.teamSlot === s);
      const value = teamPicks.reduce((sum, p) => sum + (playerMap.get(p.playerId)?.market_value ?? 0), 0);
      const points = teamPicks.reduce((sum, p) => sum + (playerMap.get(p.playerId)?.total_points ?? 0), 0);
      const ppgSum = teamPicks.reduce((sum, p) => sum + (playerMap.get(p.playerId)?.ppg ?? 0), 0);
      rows.push({
        slot: s,
        label: teamLabel(s),
        value,
        points,
        ppg: teamPicks.length > 0 ? ppgSum / teamPicks.length : 0,
      });
    }
    return rows.sort((a, b) => b.value - a.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, phase, playerMap]);

  const selectPlayer = useCallback(
    (p: Player | null, ownership?: PlayerOwnership | null) => {
      if (!p) return;
      const stillAvailable = !pickedIds.has(p.id);
      openPlayer(p, {
        ownership,
        onPick:
          stillAvailable && isMyTurn && !picking && phase === 'drafting'
            ? (picked) => handleManualPick(picked.id)
            : undefined,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openPlayer, isMyTurn, picking, phase, pickedIds],
  );

  const selectAvailablePlayer = useCallback(
    (p: Player | null) => selectPlayer(p, null),
    [selectPlayer],
  );

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else {
      setSortKey(key);
      // Every other column's "best" is the highest number; Draft Rank's is
      // the lowest (#1) — see DraftRoom.tsx's handleSort.
      setSortDir(key === 'draft_rank' ? 'asc' : 'desc');
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return '↕';
    return sortDir === 'desc' ? '↓' : '↑';
  }

  const rowProps = useMemo<PlayerRowCustomProps>(() => ({
    players: sortedAndFiltered,
    queue: session?.queue ?? [],
    myTurn: isMyTurn,
    picking,
    draftDone: phase !== 'drafting',
    shadowByPlayer,
    onToggleQueue: toggleQueue,
    onMakePick: handleManualPick,
    onSelectPlayer: selectAvailablePlayer,
    onPrefetchPlayer: prefetchPlayer,
  }), [sortedAndFiltered, session?.queue, isMyTurn, picking, phase, shadowByPlayer, selectAvailablePlayer, prefetchPlayer]);

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
    // See DraftRoom.tsx's identical fix — the Players tab isn't rendered at
    // all on mobile while the drawer is collapsed, so the ref is null on
    // first mount and this bailed out before ever attaching; nothing after
    // that re-ran it once the drawer actually opened.
  }, [sidebarTab, isMobile, drawerExpanded]);

  const timerPct = (secondsLeft / TIMER_SECONDS) * 100;
  const timerColor = timerPct > 50 ? 'var(--color-accent)' : timerPct > 25 ? 'var(--color-warning)' : 'var(--color-danger)';
  const timerMm = String(Math.floor(secondsLeft / 60));
  const timerSs = String(secondsLeft % 60).padStart(2, '0');

  if (phase === 'loading') {
    return <div className={styles.wrap} />;
  }

  if (phase === 'setup') {
    return (
      <div className={styles.wrap}>
        <div className={styles.topBar}>
          <span className={styles.mockBadge}>Mock Draft</span>
          <NavigationLink href={`/league/${leagueId}`} className={styles.exitLink}>← Back to lobby</NavigationLink>
        </div>
        <div className={styles.card}>
          <h1 className={styles.title}>Practice Your Draft</h1>
          <p className={styles.desc}>
            Run a full snake draft against AI-controlled bots using the real player pool, before the
            real draft starts. Nothing here touches your league — picks, teams, and rosters are
            simulated locally and never saved to the league.
          </p>

          <div className={styles.formRow}>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Number of teams</label>
              <select
                className={styles.select}
                value={setupNumTeams}
                onChange={(e) => setSetupNumTeams(parseInt(e.target.value, 10))}
              >
                {Array.from({ length: 17 }, (_, i) => i + 4).map((n) => (
                  <option key={n} value={n}>{n} teams</option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Your draft slot</label>
              <select
                className={styles.select}
                value={setupSlot}
                onChange={(e) => setSetupSlot(parseInt(e.target.value, 10))}
              >
                <option value={0}>Random</option>
                {Array.from({ length: setupNumTeams }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>Slot #{n}</option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Roster size</label>
              <select className={styles.select} value={league.roster_size} disabled>
                <option value={league.roster_size}>{league.roster_size} players (league setting)</option>
              </select>
            </div>
          </div>

          <div className={styles.btnRow}>
            <button type="button" className={styles.primaryBtn} onClick={startDraft}>
              Start Mock Draft
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={draftStyles.draftRoot}>
      <header className={`${draftStyles.topBanner} ${isMyTurn ? draftStyles.topBannerMyTurn : ''}`}>
        {phase === 'complete' ? (
          <div className={draftStyles.completeBanner}>
            <span className={draftStyles.completeText}>Mock draft complete — see how your squad stacks up.</span>
            <div className={styles.btnRow}>
              <button type="button" className={styles.secondaryBtn} onClick={restartDraft}>Start new mock draft</button>
              <NavigationLink href={`/league/${leagueId}`} className={draftStyles.goToTeamBtn}>Back to Lobby →</NavigationLink>
            </div>
          </div>
        ) : (
          <>
            <div className={`${draftStyles.clockBlock} ${isMyTurn ? draftStyles.clockBlockMyTurn : ''}`}>
              <span className={draftStyles.clockLabel}>
                {paused ? 'PAUSED' : isMyTurn ? 'ON THE CLOCK' : `${teamLabel(currentSlot ?? 1)} drafting…`}
              </span>
              <span className={draftStyles.clockTime}>{timerMm}:{timerSs}</span>
              {isMyTurn && !paused && <span className={draftStyles.clockYouLabel}>YOU</span>}
            </div>

            <div className={draftStyles.pickStripWrap}>
              <div className={draftStyles.pickStrip}>
                {pickStrip.map((item, i) => (
                  <div key={item.pickNum} className={draftStyles.pickStripItemWrap}>
                    {i > 0 && <span className={draftStyles.stripChevron}>›</span>}
                    <div
                      ref={item.isCurrent ? currentStripItemRef : undefined}
                      className={[
                        draftStyles.stripItem,
                        item.isCurrent ? draftStyles.stripItemCurrent : '',
                        item.isPast ? draftStyles.stripItemPast : '',
                        !item.isCurrent && !item.isPast ? draftStyles.stripItemFuture : '',
                      ].filter(Boolean).join(' ')}
                    >
                      <span className={draftStyles.stripPickLabel}>{item.label}</span>
                      <span className={draftStyles.stripTeamName}>{teamAbbrev(item.slot)}</span>
                      {item.isCurrent && <span className={draftStyles.stripPickingNow}>PICKING NOW</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.controlsCol}>
              <div className={draftStyles.bannerMeta}>
                <span className={draftStyles.bannerRoundLabel}>ROUND {currentRound} / {session?.rosterSize}</span>
                <span className={draftStyles.bannerPickLabel}>Pick {currentPickNumber} of {totalPicks}</span>
              </div>
              <div className={styles.controlBtns}>
                <button type="button" className={styles.controlBtn} onClick={togglePause}>
                  {paused ? 'Resume' : 'Pause'}
                </button>
                <button type="button" className={styles.controlBtn} onClick={restartDraft}>
                  Restart
                </button>
                <NavigationLink href={`/league/${leagueId}`} className={styles.controlBtn}>
                  Exit
                </NavigationLink>
              </div>
            </div>
          </>
        )}
      </header>

      {phase === 'drafting' && (
        <div className={draftStyles.timerBar}>
          <div
            className={draftStyles.timerFill}
            style={{ width: `${paused ? timerPct : timerPct}%`, background: paused ? 'var(--color-text-secondary)' : timerColor }}
          />
        </div>
      )}

      <div className={draftStyles.mainArea}>
        <main className={draftStyles.boardPanel}>
          <div className={draftStyles.boardHeader}>
            <h1 className={draftStyles.boardHeadline}>Mock Draft Board</h1>
            <p className={draftStyles.boardSubtitle}>
              Practice run · Round {currentRound}/{session?.rosterSize} · {session?.picks.length ?? 0} picks made
            </p>
          </div>
          <div className={draftStyles.boardScroll}>
            <table
              className={draftStyles.boardTable}
              // Natural width always — see DraftRoom.tsx's identical fix.
              style={{ width: `calc(34px + ${numTeams} * 140px)` } as React.CSSProperties}
            >
              <thead>
                <tr>
                  <th className={draftStyles.roundHeaderCell} style={{ width: '34px' }}>RD</th>
                  {Array.from({ length: numTeams }, (_, i) => i + 1).map((slot) => (
                    <th
                      key={slot}
                      className={[
                        draftStyles.teamHeaderCell,
                        slot === session?.mySlot ? draftStyles.myTeamHeader : '',
                        currentSlot === slot && phase === 'drafting' ? draftStyles.onClockHeader : '',
                      ].filter(Boolean).join(' ')}
                      style={{ width: `calc((100% - 34px) / ${numTeams})` }}
                    >
                      <span className={draftStyles.teamHeaderName}>{teamAbbrev(slot)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: session?.rosterSize ?? 0 }, (_, ri) => {
                  const roundNum = ri + 1;
                  return (
                    <tr key={roundNum}>
                      <td className={draftStyles.roundCell}>{roundNum}</td>
                      {Array.from({ length: numTeams }, (_, i) => i + 1).map((slot) => {
                        const pick = pickGrid[roundNum]?.[slot];
                        const isCurrentSlot = phase === 'drafting' && roundNum === currentRound && slot === currentSlot;
                        const player = pick ? playerMap.get(pick.playerId) : undefined;
                        const isEvenRound = roundNum % 2 === 0;
                        const posInRound = isEvenRound ? numTeams + 1 - slot : slot;
                        const label = `${String(roundNum).padStart(2, '0')}.${String(posInRound).padStart(2, '0')}`;

                        return (
                          <td
                            key={slot}
                            className={[
                              draftStyles.pickCell,
                              pick ? draftStyles.pickCellFilled : '',
                              isCurrentSlot ? draftStyles.pickCellCurrent : '',
                              slot === session?.mySlot ? draftStyles.myTeamCell : '',
                            ].filter(Boolean).join(' ')}
                          >
                            <span className={draftStyles.cellLabel}>{label}</span>
                            {pick && player ? (
                              <motion.div
                                className={draftStyles.pickedContent}
                                initial={{ opacity: 0, scale: 0.5 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                                style={{ cursor: 'pointer' }}
                                onClick={() => selectPlayer(player)}
                              >
                                <span className={`${draftStyles.posBadge} ${draftStyles[`pos${player.primary_position}` as keyof typeof draftStyles]}`}>
                                  {player.primary_position}
                                </span>
                                <span className={draftStyles.pickedName}>{getPlayerDisplayName(player, 'initial_last')}</span>
                              </motion.div>
                            ) : isCurrentSlot ? (
                              <div className={draftStyles.onClockContent}>
                                <span className={draftStyles.onClockDot} />
                                <span className={draftStyles.onClockText}>PICK</span>
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

        <aside
          className={draftStyles.sidebarPanel}
          style={isMobile ? {
            transform: `translateY(${
              drawerLiveOffset ?? (drawerExpanded ? 0 : drawerMaxOffsetRef.current)
            }px)`,
            transition: drawerLiveOffset != null ? 'none' : 'transform 220ms ease',
          } : undefined}
        >
          {isMobile && (
            <motion.div
              className={draftStyles.drawerGrip}
              onPanStart={handleDrawerPanStart}
              onPan={handleDrawerPan}
              onPanEnd={handleDrawerPanEnd}
              onClick={() => setDrawerExpanded((v) => !v)}
            >
              <div className={draftStyles.drawerHandle} />
            </motion.div>
          )}
          <div className={draftStyles.sidebarTabs}>
            <button type="button" className={`${draftStyles.sidebarTab} ${sidebarTab === 'players' ? draftStyles.sidebarTabActive : ''}`} onClick={() => selectSidebarTab('players')}>
              Players
            </button>
            <button type="button" className={`${draftStyles.sidebarTab} ${sidebarTab === 'roster' ? draftStyles.sidebarTabActive : ''}`} onClick={() => selectSidebarTab('roster')}>
              My Roster{myRoster.length > 0 ? ` (${myRoster.length})` : ''}
            </button>
            <button type="button" className={`${draftStyles.sidebarTab} ${sidebarTab === 'queue' ? draftStyles.sidebarTabActive : ''}`} onClick={() => selectSidebarTab('queue')}>
              Queue{activeQueuePlayers.length > 0 ? ` (${activeQueuePlayers.length})` : ''}
            </button>
            {phase === 'complete' && (
              <button type="button" className={`${draftStyles.sidebarTab} ${sidebarTab === 'recap' ? draftStyles.sidebarTabActive : ''}`} onClick={() => selectSidebarTab('recap')}>
                Recap
              </button>
            )}
          </div>

          {(!isMobile || drawerExpanded) && sidebarTab === 'players' && (
            <div className={draftStyles.tabContent}>
              <div className={draftStyles.searchRow}>
                <input
                  type="text"
                  placeholder="Search player or club…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className={draftStyles.searchInput}
                />
              </div>
              <div className={draftStyles.posFilters}>
                {(['ALL', ...POSITION_ORDER] as const).map((pos) => (
                  <button
                    key={pos}
                    type="button"
                    onClick={() => setPosFilter(pos)}
                    className={`${draftStyles.posBtn} ${posFilter === pos ? draftStyles.posBtnActive : ''}`}
                  >
                    {pos}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setNewToPremOnly((v) => !v)}
                  className={`${draftStyles.posBtn} ${draftStyles.newFilterBtn} ${newToPremOnly ? draftStyles.posBtnActive : ''}`}
                  title="Show only players new to the Premier League this season"
                >
                  NEW
                </button>
              </div>

              <div className={draftStyles.advancedFiltersToggle}>
                <button type="button" className={draftStyles.advancedBtn} onClick={() => setAdvancedOpen(!advancedOpen)}>
                  {advancedOpen ? 'Hide Advanced Filters' : 'Show Advanced Filters'}
                  <span className={draftStyles.btnChevron}>{advancedOpen ? ' ▲' : ' ▼'}</span>
                </button>
              </div>

              {advancedOpen && (
                <div className={draftStyles.advancedFiltersPanel}>
                  <div className={draftStyles.filterGroup}>
                    <label className={draftStyles.filterLabel}>Minutes filter</label>
                    <select
                      className={draftStyles.filterSelect}
                      value={minMins}
                      onChange={(e) => setMinMins(e.target.value as 'played' | 'all' | 'gt45')}
                    >
                      <option value="played">Played (&gt;0 mins)</option>
                      <option value="all">Meaningful (&ge;15 mins)</option>
                      <option value="gt45">Starters (&gt;45 mins)</option>
                    </select>
                  </div>
                  <div className={draftStyles.filterGroup}>
                    <span className={draftStyles.filterLabel}>Min Games Played: <strong>{minGames}</strong></span>
                    <input
                      type="range"
                      min="0"
                      max="38"
                      value={minGames}
                      onChange={(e) => setMinGames(parseInt(e.target.value))}
                      className={draftStyles.sliderInput}
                    />
                  </div>
                  <div className={draftStyles.filterGroup}>
                    <label className={draftStyles.filterLabel}>Role matching</label>
                    <div className={draftStyles.segmentedToggle}>
                      {(['primary', 'secondary', 'both'] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          className={`${draftStyles.toggleButton} ${posType === t ? draftStyles.activeToggle : ''}`}
                          onClick={() => setPosType(t)}
                        >
                          {t === 'primary' ? 'Primary' : t === 'secondary' ? 'Secondary' : 'Both'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {isMobile ? (
                <>
                  <div className={draftStyles.mobileSortRow}>
                    <select
                      className={draftStyles.filterSelect}
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
                      className={draftStyles.mobileSortDirBtn}
                      onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
                      title="Reverse sort direction"
                    >
                      {sortDir === 'desc' ? '↓' : '↑'}
                    </button>
                  </div>
                  <div className={draftStyles.playerList} ref={playerListRef}>
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
                      <p className={draftStyles.emptyState}>No players match your filters.</p>
                    )}
                  </div>
                </>
              ) : (
                <div className={draftStyles.tableScroller}>
                  <div className={draftStyles.tableStatsLayout}>
                    <div className={draftStyles.tableStatsHeader}>
                      <div className={draftStyles.thSticky}>Player</div>
                      <div className={`${draftStyles.th} ${sortKey === 'draft_rank' ? draftStyles.thActive : ''}`} onClick={() => handleSort('draft_rank')} title="Gaffa's synthetic pre-draft ranking — market value and prior-season performance, not a real historical ADP">
                        Rank {sortIndicator('draft_rank')}
                      </div>
                      <div className={`${draftStyles.th} ${sortKey === 'gp' ? draftStyles.thActive : ''}`} onClick={() => handleSort('gp')}>
                        GP {sortIndicator('gp')}
                      </div>
                      <div className={`${draftStyles.th} ${sortKey === 'total_points' ? draftStyles.thActive : ''}`} onClick={() => handleSort('total_points')}>
                        Pts {sortIndicator('total_points')}
                      </div>
                      <div className={`${draftStyles.th} ${sortKey === 'ppg' ? draftStyles.thActive : ''}`} onClick={() => handleSort('ppg')}>
                        PPG {sortIndicator('ppg')}
                      </div>
                      <div className={`${draftStyles.th} ${sortKey === 'avg_rating' ? draftStyles.thActive : ''}`} onClick={() => handleSort('avg_rating')}>
                        Avg {sortIndicator('avg_rating')}
                      </div>
                      <div className={`${draftStyles.th} ${sortKey === 'market_value' ? draftStyles.thActive : ''}`} onClick={() => handleSort('market_value')}>
                        Val {sortIndicator('market_value')}
                      </div>
                    </div>

                    <div className={draftStyles.playerList} ref={playerListRef}>
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
                        <p className={draftStyles.emptyState}>No players match your filters.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {(!isMobile || drawerExpanded) && sidebarTab === 'roster' && (
            <div className={draftStyles.tabContentScrollable}>
              {myRoster.length > 0 && (
                <div className={draftStyles.rosterToggleBar}>
                  <button
                    type="button"
                    className={`${draftStyles.rosterToggleBtn} ${rosterSortMode === 'draft' ? draftStyles.rosterToggleBtnActive : ''}`}
                    onClick={() => setRosterSortMode('draft')}
                  >
                    By Draft Pick
                  </button>
                  <button
                    type="button"
                    className={`${draftStyles.rosterToggleBtn} ${rosterSortMode === 'position' ? draftStyles.rosterToggleBtnActive : ''}`}
                    onClick={() => setRosterSortMode('position')}
                  >
                    By Position
                  </button>
                </div>
              )}
              {myRoster.length === 0 ? (
                <div className={draftStyles.emptyStateWrap}>
                  <p className={draftStyles.emptyState}>No picks yet.</p>
                  <p className={draftStyles.emptyStateHint}>Your drafted players will appear here.</p>
                </div>
              ) : (
                <ul className={draftStyles.rosterList}>
                  {myRoster.map((pick) => {
                    const player = playerMap.get(pick.playerId);
                    return (
                      <li key={pick.pick} className={draftStyles.rosterItem}>
                        <span className={draftStyles.rosterPickNum}>#{pick.pick}</span>
                        <span className={`${draftStyles.posBadge} ${draftStyles[`pos${player?.primary_position}` as keyof typeof draftStyles]}`}>
                          {player?.primary_position}
                        </span>
                        <div className={draftStyles.rosterPlayerInfo}>
                          <span
                            className={`${draftStyles.rosterPlayerName} ${draftStyles.rosterPlayerNameClickable}`}
                            onClick={() => player && selectPlayer(player)}
                          >
                            {getPlayerDisplayName(player, 'initial_last')}
                          </span>
                          <span className={draftStyles.rosterPlayerClub}>{player?.pl_team}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {(!isMobile || drawerExpanded) && sidebarTab === 'queue' && (
            <div className={draftStyles.tabContentScrollable}>
              {activeQueuePlayers.length === 0 ? (
                <div className={draftStyles.emptyStateWrap}>
                  <p className={draftStyles.emptyState}>Queue is empty.</p>
                  <p className={draftStyles.emptyStateHint}>
                    Star players in the Players tab to add them. The top queued player auto-drafts
                    if your timer expires.
                  </p>
                </div>
              ) : (
                <ul className={draftStyles.queueList}>
                  {activeQueuePlayers.map((playerId, idx) => {
                    const player = playerMap.get(playerId);
                    if (!player) return null;
                    return (
                      <li key={playerId} className={draftStyles.queueItem}>
                        <span className={draftStyles.queueRank}>{idx + 1}</span>
                        <span className={`${draftStyles.posBadge} ${draftStyles[`pos${player.primary_position}` as keyof typeof draftStyles]}`}>
                          {player.primary_position}
                        </span>
                        <div className={draftStyles.queuePlayerInfo}>
                          <span className={draftStyles.queuePlayerName}>{getPlayerDisplayName(player, 'initial_last')}</span>
                          <span className={draftStyles.queuePlayerClub}>{player.pl_team}</span>
                        </div>
                        <div className={draftStyles.queueItemActions}>
                          {isMyTurn && phase === 'drafting' && (
                            <button type="button" className={draftStyles.queueDraftBtn} onClick={() => handleManualPick(playerId)} disabled={picking}>
                              Draft
                            </button>
                          )}
                          <button type="button" className={draftStyles.queueMoveBtn} onClick={() => moveQueueItem(playerId, 'up')} disabled={idx === 0}>↑</button>
                          <button type="button" className={draftStyles.queueMoveBtn} onClick={() => moveQueueItem(playerId, 'down')} disabled={idx === activeQueuePlayers.length - 1}>↓</button>
                          <button type="button" className={draftStyles.queueRemoveBtn} onClick={() => toggleQueue(playerId)}>×</button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {(!isMobile || drawerExpanded) && sidebarTab === 'recap' && phase === 'complete' && (
            <div className={draftStyles.tabContentScrollable}>
              <div className={styles.recapSection}>
                <h3 className={styles.recapSectionTitle}>Squad Value Leaderboard</h3>
                <table className={styles.leaderboard}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Club</th>
                      <th>Value</th>
                      <th>Pts</th>
                      <th>PPG</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((row, i) => (
                      <tr key={row.slot} className={row.slot === session?.mySlot ? styles.leaderboardMe : ''}>
                        <td>{i + 1}</td>
                        <td>{row.label}{row.slot === session?.mySlot ? ' (You)' : ''}</td>
                        <td>€{row.value.toFixed(0)}m</td>
                        <td>{row.points.toFixed(0)}</td>
                        <td>{row.ppg.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
