'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { Player, PlayerOwnership, PlayerSeasonArchive } from '@/types';
import type { CrestConfig } from '@/components/crest/types';
import { getPlayerDisplayName, playerInitial } from '@/lib/players/displayName';
import { portraitUrl, withVersion } from '@/lib/players/photo';
import { useParams } from 'next/navigation';
import CrestBadge from '@/components/crest/CrestBadge';
import SquadPeekButton from '@/components/teams/SquadPeekButton';
import FormArrow from '@/components/players/FormArrow';
import { clubBadgePath, clubColor } from '@/lib/clubs/registry';
import {
  type CardBack,
  type CardGamelogEntry,
  fetchBack,
  fetchFront,
  getCachedBack,
  getCachedFront,
  getOwnershipFor,
  isImageReady,
  markImageReady,
  primeFront,
} from '@/lib/players/cardCache';
import styles from './PremiumPlayerCard.module.css';

/**
 * The display-rating band, as a CSS variable rather than a literal.
 *
 * The six bands read exactly as they always have — green / green / gold /
 * orange / red / grey — but the values now live in PremiumPlayerCard.module.css
 * on `.container`, where the header records what each one measured and what it
 * was solved to. Five of the six were failing against the card face, the worst
 * at 2.28:1; they were re-solved holding hue and chroma and walking OKLCH
 * lightness only, so the ramp looks like itself and is legible.
 *
 * Returning `var(...)` rather than a hex is what lets the values be tokens at
 * all: these are applied through inline `style`, so there is nowhere else to
 * put them.
 */
function ratingHex(r: number | null): string {
    if (r == null) return 'var(--rating-none)';
    if (r >= 8.5) return 'var(--rating-elite)';
    if (r >= 7.5) return 'var(--rating-good)';
    if (r >= 6.5) return 'var(--rating-fair)';
    if (r >= 5.5) return 'var(--rating-poor)';
    return 'var(--rating-bad)';
}

const POS_LONG: Record<string, string> = {
    GK: 'Goalkeeper', CB: 'Centre-Back', LB: 'Left-Back', RB: 'Right-Back',
    LWB: 'Left Wing-Back', RWB: 'Right Wing-Back',
    DM: 'Defensive Mid', CM: 'Central Mid',
    AM: 'Attacking Mid', LW: 'Left Winger', RW: 'Right Winger', ST: 'Striker',
};

const POS_CSS_VAR: Record<string, string> = {
    GK: 'var(--color-pos-gk)',
    CB: 'var(--color-pos-cb)',
    LB: 'var(--color-pos-fb)', RB: 'var(--color-pos-fb)',
    LWB: 'var(--color-pos-wb)', RWB: 'var(--color-pos-wb)',
    DM: 'var(--color-pos-dm)',
    CM: 'var(--color-pos-cm)',
    AM: 'var(--color-pos-am)',
    LW: 'var(--color-pos-lw)', RW: 'var(--color-pos-rw)',
    ST: 'var(--color-pos-st)',
};

interface Props {
    player: Player;
    /**
     * Owner crest data. `undefined` means "not known yet" and triggers a
     * background lookup; `null` means "known free agent" and does not.
     * List pages pass this down so the crest is present on first paint.
     */
    ownership?: PlayerOwnership | null;
    onClose?: () => void;
    /**
     * Render from the player prop only — no network enrichment.
     * Used by the auth marketing carousel where data is already complete
     * and a fetch would just cause a late re-paint.
     */
    staticOnly?: boolean;
}

interface Snapshot {
    player: Player;
    ownership: PlayerOwnership | null | undefined;
}

/**
 * The best data available synchronously, in priority order: whatever a previous
 * open cached, then the props. Never returns null, so the card always has
 * something complete enough to paint on its very first frame.
 */
function buildSnapshot(
    player: Player,
    ownership: PlayerOwnership | null | undefined,
    leagueId: string | undefined,
): Snapshot {
    const cached = getCachedFront(player.id, leagueId);
    const resolvedOwnership =
        ownership !== undefined
            ? ownership
            : cached?.ownership !== undefined
                ? cached.ownership
                : getOwnershipFor(player.id, leagueId);

    if (!cached) return { player, ownership: resolvedOwnership };
    return {
        // Props win on any field they actually carry — a list page's row is at
        // least as fresh as the cache, and merging avoids flicker either way.
        player: { ...cached.player, ...stripUndefined(player) },
        ownership: resolvedOwnership,
    };
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
    const out: Partial<T> = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined) (out as any)[k] = v;
    }
    return out;
}

/** True when the front face still has holes only the server can fill. */
function frontIsIncomplete(snapshot: Snapshot, leagueId: string | undefined): boolean {
    if (snapshot.player.overall_rank === undefined) return true;
    if (snapshot.player.position_ranks === undefined) return true;
    if (leagueId && snapshot.ownership === undefined) return true;
    return false;
}

function calcAge(dob: string): number {
    const today = new Date();
    const birth = new Date(dob);
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
}

function cmToFeet(cm: number): string {
    const totalIn = cm / 2.54;
    let ft = Math.floor(totalIn / 12);
    let inch = Math.round(totalIn % 12);
    if (inch === 12) { ft++; inch = 0; }
    return `${ft}'${inch}"`;
}

function parseMatchResult(opponent: string | undefined, result: string | undefined) {
    if (!result || !opponent) return null;
    const match = result.match(/(\d+)\s*-\s*(\d+)/);
    if (!match) return null;
    const s1 = parseInt(match[1], 10);
    const s2 = parseInt(match[2], 10);
    const isHome = opponent.includes('(H)');
    const pScore = isHome ? s1 : s2;
    const oScore = isHome ? s2 : s1;
    let code = 'D';
    if (pScore > oScore) code = 'W';
    else if (pScore < oScore) code = 'L';
    return { code, text: `${code} ${s1}-${s2}` };
}

/** FPL availability stamp — null when the player is available. */
function injuryStatus(fplStatus: string | null | undefined, fplNews: string | null | undefined) {
    if (!fplStatus || fplStatus === 'a') return null;
    const label =
        fplStatus === 'd' ? 'Doubtful'
        : fplStatus === 'i' ? 'Out'
        : fplStatus === 's' ? 'Suspended'
        : 'Unavailable';
    const news = fplNews?.trim() || null;
    return {
        label,
        news,
        doubtful: fplStatus === 'd',
        title: news ?? label,
        aria: news ? `${label}: ${news}` : label,
    };
}

/** Points + rating for one game under the selected slot. Falls back to stored primary values. */
function scoreAtPosition(
    g: CardGamelogEntry,
    pos: string,
    primary: string,
) {
    const scored = g.by_position?.[pos];
    if (scored) return scored;
    if (pos === primary) {
        return { fantasy_points: g.fantasy_points, match_rating: g.match_rating };
    }
    return { fantasy_points: g.fantasy_points, match_rating: g.match_rating };
}

function FlipIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16" aria-hidden="true">
            <path d="M3 12a9 9 0 0 1 15-6.7M21 4v5h-5"/>
            <path d="M21 12a9 9 0 0 1-15 6.7M3 20v-5h5"/>
        </svg>
    );
}

export default function PremiumPlayerCard({
    player,
    ownership,
    onClose,
    staticOnly = false,
}: Props) {
    const stageRef = useRef<HTMLDivElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const holoRef = useRef<HTMLDivElement>(null);
    const [flipped, setFlipped] = useState(false);
    // Ref mirrors flipped state so mouse callbacks always read the latest value
    // without needing to be re-created on every flip (avoids stale closures).
    const flippedRef = useRef(false);
    const [tab, setTab] = useState<'log' | 'history'>('log');
    const [hovering, setHovering] = useState(false);
    // Position the card is evaluating — chips flip both faces to that slot's scoring.
    const [selectedPos, setSelectedPos] = useState<string>(player.primary_position);

    const params = useParams();
    const leagueId = params?.leagueId as string | undefined;

    // ── Front face: painted on the first frame, always ────────────────────────
    const [snapshot, setSnapshot] = useState<Snapshot>(() =>
        staticOnly ? { player, ownership: ownership ?? null } : buildSnapshot(player, ownership, leagueId),
    );

    // Deriving during render (rather than in an effect) means switching players
    // never paints one frame of the previous player's data.
    const [renderedId, setRenderedId] = useState(player.id);
    if (renderedId !== player.id) {
        setRenderedId(player.id);
        setSnapshot(
            staticOnly ? { player, ownership: ownership ?? null } : buildSnapshot(player, ownership, leagueId),
        );
        setFlipped(false);
        flippedRef.current = false;
        setTab('log');
        setSelectedPos(player.primary_position);
    }

    const resolvedPlayer = snapshot.player;
    const resolvedOwnership = snapshot.ownership ?? null;

    // ── Back face: fetched after paint, never gates anything ──────────────────
    const [back, setBack] = useState<CardBack | null>(
        () => (staticOnly ? { gamelog: [], history: [] } : getCachedBack(player.id, leagueId)),
    );
    const [backRenderedId, setBackRenderedId] = useState(player.id);
    if (backRenderedId !== player.id) {
        setBackRenderedId(player.id);
        setBack(staticOnly ? { gamelog: [], history: [] } : getCachedBack(player.id, leagueId));
    }

    // ── Photo: fixed slot, cascades through FPL's two cut-outs before initials,
    // instant when warm, grace-then-crossfade when cold ───────────────────────
    // `photo_url` is the 110x140 cut-out the card's box is tuned to; the
    // 500x500 one is a different crop (see photo.ts) but coverage isn't
    // nested, so trying it before giving up on a photo entirely closes real
    // gaps for players missing just the one FPL happens to serve at 110x140.
    // PL sends no Cache-Control on these images, so a browser that cached the
    // 110x140 URL before PL replaced its bytes never refetches on its own —
    // photo_version (migration 136) busts that cache; see photo.ts.
    const rawPhotoUrl = resolvedPlayer.photo_url
        ? withVersion(resolvedPlayer.photo_url, resolvedPlayer.photo_version)
        : null;
    const photoAltUrl = portraitUrl(resolvedPlayer.photo_url, resolvedPlayer.photo_version);
    const photoSources = [rawPhotoUrl, photoAltUrl].filter((u): u is string => u !== null);
    const sourcesKey = `${resolvedPlayer.id}|${photoSources.join('|')}`;

    const [photoState, setPhotoState] = useState<{ key: string; n: number; loaded: boolean }>(
        () => ({ key: sourcesKey, n: 0, loaded: isImageReady(photoSources[0] ?? null) }),
    );
    if (photoState.key !== sourcesKey) {
        setPhotoState({ key: sourcesKey, n: 0, loaded: isImageReady(photoSources[0] ?? null) });
    }
    const photoUrl = photoSources[photoState.n] ?? null;

    const advancePhoto = useCallback(() => {
        setPhotoState((s) => ({ key: s.key, n: s.n + 1, loaded: false }));
    }, []);

    // An <img> whose bytes are already in the HTTP cache can finish before React
    // attaches onLoad, so mount-time completeness has to be checked directly or
    // a warm photo would still fade in. A source that 403s before that handler
    // attaches never fires onError either — caught the same way, by advancing
    // the cascade instead of getting stuck on a dead source.
    const photoRef = useCallback((node: HTMLImageElement | null) => {
        if (!node || !node.complete) return;
        if (node.naturalWidth > 0) {
            markImageReady(node.currentSrc || node.src);
            setPhotoState((s) => (s.loaded ? s : { ...s, loaded: true }));
        } else {
            setPhotoState((s) => ({ key: s.key, n: s.n + 1, loaded: false }));
        }
    }, []);

    // The placeholder is armed (allowed to render) immediately when there's no
    // photo to even try; for one that's in flight it waits a beat, so a
    // cache-fast paint never gets a single frame with the initial visible
    // before the crossfade takes over.
    const [placeholderArmed, setPlaceholderArmed] = useState(() => !photoUrl);
    useEffect(() => {
        if (!photoUrl || photoState.loaded) {
            setPlaceholderArmed(!photoUrl);
            return;
        }
        setPlaceholderArmed(false);
        const t = setTimeout(() => setPlaceholderArmed(true), 100);
        return () => clearTimeout(t);
    }, [photoUrl, photoState.loaded]);

    useEffect(() => {
        if (staticOnly) return;
        let active = true;

        // Only reach for the network when the props genuinely left a hole.
        if (frontIsIncomplete(snapshot, leagueId)) {
            fetchFront(player.id, leagueId).then((front) => {
                if (!active || !front) return;
                // `snapshot` here is this player's opening snapshot — the effect
                // is keyed on player.id and nothing else writes it.
                const merged: Snapshot = {
                    player: { ...front.player, ...stripUndefined(snapshot.player) },
                    ownership:
                        snapshot.ownership !== undefined ? snapshot.ownership : front.ownership,
                };
                // Cache the filled-in version, or every reopen of a player whose
                // row was missing a rank refetches the same thing.
                primeFront(merged.player, leagueId, merged.ownership);
                setSnapshot(merged);
            });
        } else {
            // Props were complete — record them so the next open of this player
            // (from anywhere in the app) skips the check entirely.
            primeFront(snapshot.player, leagueId, resolvedOwnership);
        }

        if (!getCachedBack(player.id, leagueId)) {
            fetchBack(player.id, leagueId).then((data) => {
                if (active && data) setBack(data);
            });
        }

        return () => {
            active = false;
        };
    // Keyed on the player, not the snapshot — refetching on every merge would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [player.id, leagueId, staticOnly]);

    const teamColor = clubColor(resolvedPlayer.pl_team);
    const primaryPos = resolvedPlayer.primary_position;
    const viewPos = selectedPos || primaryPos;
    const isPrimaryView = viewPos === primaryPos;
    const posLong = POS_LONG[viewPos] ?? viewPos;
    // Spine / card accent follows the selected slot; identity tags keep each
    // position's own color so selecting RB doesn't recolor the DM pill.
    const posVar = POS_CSS_VAR[viewPos] ?? 'var(--color-accent-green)';
    const primaryPosVar = POS_CSS_VAR[primaryPos] ?? 'var(--color-accent-green)';

    /** True once a real photo is on screen and the fallback initial can recede. */
    const photoShowing = !!photoUrl && photoState.loaded;
    const showPlaceholder = !photoShowing && placeholderArmed;

    const gamelog = back?.gamelog ?? [];
    const history = back?.history ?? [];
    const backPending = back === null;

    const playedGames = gamelog.filter(g => {
        const isDNP = g.isDNP ?? (g.stats?.minutes_played === 0);
        return !isDNP;
    });
    const recentGames = playedGames.slice(0, 8).reverse();

    // Position-aware season totals from the game log (same re-score path as ranks).
    // Primary view keeps the synced players.total_points / ppg so the default
    // card never drifts; secondary waits on the back payload.
    let viewTotalPts: number | null = resolvedPlayer.total_points;
    let viewPpg: number | null = resolvedPlayer.ppg;
    if (!isPrimaryView) {
        if (back !== null) {
            let pts = 0;
            let gp = 0;
            for (const g of playedGames) {
                if ((g.stats?.minutes_played ?? 0) <= 0) continue;
                pts += scoreAtPosition(g, viewPos, primaryPos).fantasy_points;
                gp += 1;
            }
            viewTotalPts = pts;
            viewPpg = gp > 0 ? Math.round((pts / gp) * 100) / 100 : 0;
        } else {
            viewTotalPts = null;
            viewPpg = null;
        }
    }

    // Form must average the same games the "L5" label promises. The cached
    // players.form_rating column is computed server-side (see
    // update_player_form_ratings in supabase/migrations) over the last 5
    // appearances with >=15 minutes, but it's only refreshed by a live stats
    // sync — so once gamelog is in hand, recompute client-side from it
    // instead of trusting a column that can go stale between syncs.
    const qualifyingGames = playedGames.filter(g => (g.stats?.minutes_played ?? 0) >= 15);
    const last5Qualifying = qualifyingGames.slice(0, 5);
    const computedForm = (() => {
        const rated = last5Qualifying
            .map(g => scoreAtPosition(g, viewPos, primaryPos).match_rating)
            .filter((r): r is number => r != null);
        if (rated.length === 0) return null;
        return Math.round((rated.reduce((sum, r) => sum + r, 0) / rated.length) * 100) / 100;
    })();
    // Secondary form only exists once the back has by_position; until then keep
    // the primary form so the bubble doesn't flash empty on a chip click.
    const rating = back !== null ? computedForm : resolvedPlayer.form_rating;
    const totalPts = viewTotalPts;

    // Resolved by club NAME, never by pl_team_id — FPL reassigns those ids every
    // season, which is how this card once rendered Spurs' badge for West Ham.
    const badgePath = clubBadgePath(resolvedPlayer.pl_team);
    const { first: firstName, last: webName } = getPlayerDisplayName(resolvedPlayer, 'split');
    const injury = injuryStatus(resolvedPlayer.fpl_status, resolvedPlayer.fpl_news);

    const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const stage = stageRef.current;
        const card = cardRef.current;
        const holo = holoRef.current;
        if (!stage || !card) return;

        const rect = stage.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width;
        const py = (e.clientY - rect.top) / rect.height;
        const rx = (0.5 - py) * 12;
        const ry = (px - 0.5) * 16;

        card.style.transform = `rotateX(${rx}deg) rotateY(${flippedRef.current ? 180 + ry : ry}deg)`;

        if (holo) {
            holo.style.setProperty('--mx', `${px * 100}%`);
            holo.style.setProperty('--my', `${py * 100}%`);
            holo.style.setProperty('--gx', `${(px - 0.5) * 30}%`);
            holo.style.setProperty('--gy', `${(py - 0.5) * 30}%`);
            holo.style.setProperty('--rot', `${45 + (px - 0.5) * 30}deg`);
        }
    }, []);

    const onMouseLeave = useCallback(() => {
        if (cardRef.current) {
            cardRef.current.style.transform = `rotateX(0deg) rotateY(${flippedRef.current ? 180 : 0}deg)`;
        }
        setHovering(false);
    }, []);

    const handleFlip = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        const next = !flippedRef.current;
        flippedRef.current = next;
        setFlipped(next);
        if (cardRef.current) {
            cardRef.current.style.transform = `rotateX(0deg) rotateY(${next ? 180 : 0}deg)`;
        }
    }, []);

    const cardVars = {
        '--team-color': teamColor,
        '--team-color-soft': teamColor + '22',
        '--team-color-deep': teamColor + '55',
        '--pos-color': posVar,
        '--rating-color': ratingHex(rating ?? null),
    } as React.CSSProperties;

    return (
        /* `g-theme-light` re-supplies globals.css's light palette to this
           subtree. The card is a light-only object by design — a trading card
           is a printed thing — and it used to pin itself by keeping its own
           copy of 25 tokens, which went stale. See the header of
           PremiumPlayerCard.module.css. */
        <div className={`${styles.container} g-theme-light`}>
            {/* Flat Action Buttons — Outside stage to prevent jitter and 3D issues */}
            <div className={styles.cardActionsOverlay}>
                <button className={styles.actionIconBtn} onClick={handleFlip} aria-label={flipped ? 'Flip to front' : 'Flip to game log'}>
                    <FlipIcon />
                </button>
                {onClose && (
                    <button className={styles.actionIconBtn} onClick={onClose} aria-label="Close">
                        ×
                    </button>
                )}
            </div>

            <div
                className={styles.stage}
                ref={stageRef}
                onMouseMove={onMouseMove}
                onMouseEnter={() => setHovering(true)}
                onMouseLeave={onMouseLeave}
            >
                <div className={styles.cardShadow} style={{ opacity: hovering ? 0.5 : 0.22 }} />

            <div
                className={`${styles.card} ${flipped ? styles.flipped : ''}`}
                ref={cardRef}
                style={cardVars}
            >
                {/* ══════════════ FRONT ══════════════ */}
                <div className={`${styles.face} ${styles.front}`}>
                    <div className={styles.frontBg} />

                    {/* Masthead */}
                    <div className={styles.masthead}>
                        <div className={styles.mastheadLeft}>
                            {badgePath ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    src={badgePath}
                                    alt={resolvedPlayer.pl_team}
                                    className={styles.crestImg}
                                    width={28}
                                    height={28}
                                    decoding="sync"
                                    fetchPriority="high"
                                />
                            ) : (
                                <div className={styles.crest} style={{ background: teamColor }}>
                                    {resolvedPlayer.pl_team.charAt(0)}
                                </div>
                            )}
                            <div className={styles.clubMeta}>
                                <span className={styles.mastheadName}>{getPlayerDisplayName(resolvedPlayer, 'full')}</span>
                                <span className={styles.mastheadClub}>{resolvedPlayer.pl_team}</span>
                            </div>
                        </div>
                        {/* Always mounted at a fixed width — a crest that resolves late
                            fades in instead of re-flowing the club name beside it. */}
                        <div className={styles.mastheadRight}>
                            {resolvedOwnership && (
                                resolvedOwnership.loanedTo ? (
                                    <div className={styles.loanCrests} title={`On loan from ${resolvedOwnership.owner.teamName} to ${resolvedOwnership.loanedTo.teamName}`}>
                                        <SquadPeekButton
                                            teamId={resolvedOwnership.owner.teamId}
                                            teamName={resolvedOwnership.owner.teamName}
                                            className={styles.loanCrestCol}
                                            title={`${resolvedOwnership.owner.teamName} — peek at their squad`}
                                        >
                                            <CrestBadge
                                                config={resolvedOwnership.owner.crestConfig as CrestConfig | null}
                                                size={22}
                                                teamName={resolvedOwnership.owner.teamName}
                                            />
                                            <span className={styles.loanRole}>Lender</span>
                                        </SquadPeekButton>
                                        <span className={styles.loanArrow} aria-hidden="true">→</span>
                                        <SquadPeekButton
                                            teamId={resolvedOwnership.loanedTo.teamId}
                                            teamName={resolvedOwnership.loanedTo.teamName}
                                            className={styles.loanCrestCol}
                                            title={`${resolvedOwnership.loanedTo.teamName} — peek at their squad`}
                                        >
                                            <CrestBadge
                                                config={resolvedOwnership.loanedTo.crestConfig as CrestConfig | null}
                                                size={22}
                                                teamName={resolvedOwnership.loanedTo.teamName}
                                            />
                                            <span className={styles.loanRole}>On loan</span>
                                        </SquadPeekButton>
                                    </div>
                                ) : (
                                    // "Who owns him?" and "what else have they got?" are one
                                    // question asked twice — the crest answers both.
                                    <SquadPeekButton
                                        teamId={resolvedOwnership.owner.teamId}
                                        teamName={resolvedOwnership.owner.teamName}
                                        className={styles.ownerCrest}
                                        title={`${resolvedOwnership.owner.teamName} — peek at their squad`}
                                    >
                                        <CrestBadge
                                            config={resolvedOwnership.owner.crestConfig as CrestConfig | null}
                                            size={28}
                                            teamName={resolvedOwnership.owner.teamName}
                                        />
                                    </SquadPeekButton>
                                )
                            )}
                        </div>
                    </div>

                    {/* Position spine */}
                    <div className={styles.posSpine}>
                        <span className={styles.posSpineText}>{posLong}</span>
                    </div>

                    {/* Hero — player photo */}
                    <div className={styles.hero}>
                        {injury && !flipped && (
                            <div
                                className={`${styles.injuryStamp} ${injury.doubtful ? styles.injuryDoubtful : styles.injuryOut}`}
                                aria-label={injury.aria}
                                tabIndex={injury.news ? 0 : undefined}
                            >
                                <span className={styles.injuryDot} aria-hidden="true" />
                                <span className={styles.injuryLabel}>{injury.label}</span>
                                {injury.news && (
                                    <span className={styles.injuryTip} role="tooltip">
                                        {injury.news}
                                    </span>
                                )}
                            </div>
                        )}
                        {/* Fixed-size slot. The photo and its fallback occupy the exact
                            same box, so nothing around them can ever move. */}
                        <div className={styles.photoSlot}>
                            {photoUrl && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    key={photoUrl}
                                    ref={photoRef}
                                    src={photoUrl}
                                    alt={getPlayerDisplayName(resolvedPlayer, 'full')}
                                    className={`${styles.photo} ${photoState.n > 0 ? styles.photoAlt : ''} ${photoState.loaded ? styles.photoLoaded : ''}`}
                                    width={196}
                                    height={250}
                                    loading="eager"
                                    decoding="async"
                                    fetchPriority="high"
                                    referrerPolicy="no-referrer"
                                    onLoad={(e) => {
                                        markImageReady(e.currentTarget.currentSrc || e.currentTarget.src);
                                        setPhotoState((s) => (s.loaded ? s : { ...s, loaded: true }));
                                    }}
                                    onError={advancePhoto}
                                />
                            )}
                            {/* Stays mounted and fades out as the photo fades in.
                                Unmounting it instead would flash the card
                                background through a transparent cutout PNG. */}
                            <div
                                className={`${styles.photoPlaceholder} ${showPlaceholder ? '' : styles.photoPlaceholderHidden}`}
                                style={{ '--placeholder-tint': teamColor } as React.CSSProperties}
                                aria-hidden={photoShowing ? 'true' : undefined}
                            >
                                {playerInitial(resolvedPlayer)}
                            </div>
                        </div>
                    </div>

                    {/* Identity bar */}
                    <div className={styles.identityBar}>
                        <div className={styles.ratingCluster}>
                            {rating != null && rating > 0 && (
                                <div
                                    className={styles.ratingBubble}
                                    style={{ borderColor: ratingHex(rating), color: ratingHex(rating) }}
                                >
                                    <span className={styles.ratingVal}>{rating.toFixed(2)}</span>
                                    <span className={styles.ratingLbl}>Rtg</span>
                                </div>
                            )}
                            <FormArrow rating={rating} size={18} className={styles.formArrow} />
                        </div>
                        {firstName && <span className={styles.firstName}>{firstName}</span>}
                        <span className={styles.lastName}>{webName}</span>
                        <div className={styles.idMeta}>
                            <span className={styles.posTag} style={{ background: primaryPosVar }}>{resolvedPlayer.primary_position}</span>
                            {resolvedPlayer.secondary_positions?.map(pos => (
                                <span key={pos} className={styles.posTag} style={{ background: POS_CSS_VAR[pos] || 'var(--color-bg-elevated)' }}>
                                    {pos}
                                </span>
                            ))}
                            {resolvedPlayer.nationality && (
                                <><span className={styles.dot}>·</span><span>{resolvedPlayer.nationality}</span></>
                            )}
                            {resolvedPlayer.date_of_birth && (
                                <><span className={styles.dot}>·</span><span>Age {calcAge(resolvedPlayer.date_of_birth)}</span></>
                            )}
                            {resolvedPlayer.height_cm && (
                                <><span className={styles.dot}>·</span><span>{cmToFeet(resolvedPlayer.height_cm)}</span></>
                            )}
                        </div>
                    </div>

                    {/* Stats strip */}
                    <div className={styles.statsStrip}>
                        <div className={styles.statCell}>
                            <span className={`${styles.statVal} ${styles.statGold}`}>
                                {resolvedPlayer.market_value != null ? `€${resolvedPlayer.market_value}m` : 'n/a'}
                            </span>
                            <span className={styles.statLbl}>Value</span>
                        </div>
                        <div className={styles.statCell}>
                            <span className={`${styles.statVal} ${styles.statGreen}`}>
                                {totalPts != null ? Number(totalPts).toFixed(0) : 'n/a'}
                            </span>
                            <span className={styles.statLbl}>Pts</span>
                        </div>
                        <div className={styles.statCell}>
                            <span className={styles.statVal}>
                                {viewPpg != null ? viewPpg.toFixed(2) : 'n/a'}
                            </span>
                            <span className={styles.statLbl}>PPG</span>
                        </div>
                        <div className={styles.statCell}>
                            <span className={styles.statVal}>
                                {resolvedPlayer.overall_rank != null ? `#${resolvedPlayer.overall_rank}` : 'n/a'}
                            </span>
                            <span className={styles.statLbl}>OVR</span>
                        </div>
                    </div>

                    {/* Position rank strip — chips select which slot's scoring the card shows */}
                    <div className={styles.rankStrip}>
                        <span className={styles.rankLbl}>Pos rank</span>
                        <div className={styles.rankChips} role="group" aria-label="Score as position">
                            {resolvedPlayer.position_ranks && resolvedPlayer.position_ranks.length > 0 ? (
                                [...resolvedPlayer.position_ranks].sort((a, b) => a.rank - b.rank).map((r) => {
                                    const selected = r.position === viewPos;
                                    return (
                                        <button
                                            key={r.position}
                                            type="button"
                                            className={`${styles.rankChip} ${selected ? styles.rankChipSelected : ''}`}
                                            style={{ '--chip-color': POS_CSS_VAR[r.position] ?? 'var(--color-accent-green)' } as React.CSSProperties}
                                            aria-pressed={selected}
                                            aria-label={`Score as ${r.position}, rank ${r.rank}`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedPos(r.position);
                                            }}
                                        >
                                            <span className={styles.rcPos}>{r.position}</span>
                                            <span className={styles.rcNum}>#{r.rank}</span>
                                        </button>
                                    );
                                })
                            ) : (
                                <span className={styles.rankEmpty}>—</span>
                            )}
                        </div>
                    </div>

                    {/* Holographic overlay */}
                    <div
                        className={`${styles.holo} ${hovering ? styles.holoActive : ''}`}
                        ref={holoRef}
                        style={{ opacity: hovering ? 0.85 : 0 }}
                    >
                        <div className={styles.holoShimmer} />
                        <div className={styles.holoGrid} />
                        <div className={styles.holoGlare} />
                    </div>
                </div>

                {/* ══════════════ BACK ══════════════ */}
                <div className={`${styles.face} ${styles.back}`}>
                    <div className={styles.backContent}>
                        {/* Back header */}
                        <div className={styles.backHead}>
                            <div>
                                <span className={styles.backEyebrow}>
                                    {/* Whatever season the server actually resolved — this
                                        read "2025/26" hardcoded, so it kept claiming the old
                                        season after the rollover. */}
                                    Form Guide{back?.season ? ` · ${back.season.replace('-', '/')}` : ''}
                                    {!isPrimaryView ? ` · as ${viewPos}` : ''}
                                </span>
                                <div className={styles.backName}>
                                    {webName} <em>·</em> Last {recentGames.length || '—'}
                                </div>
                            </div>
                        </div>

                        {/* Form sparkline */}
                        <div className={styles.formSection}>
                            <div className={styles.formBars}>
                                {recentGames.length > 0 ? recentGames.map((g, i) => {
                                    const ratingVal = scoreAtPosition(g, viewPos, primaryPos).match_rating ?? 0;
                                    const h = Math.max(3, (ratingVal / 10) * 42);
                                    const barCls = ratingVal >= 8 ? styles.barHigh
                                        : ratingVal >= 5.5 ? styles.barMid
                                        : ratingVal > 0 ? styles.barLow
                                        : styles.barDnp;
                                    return (
                                        <div
                                            key={i}
                                            className={`${styles.formBar} ${barCls}`}
                                            style={{ height: `${h}px` }}
                                            title={`GW${g.gameweek} · ${ratingVal.toFixed(2)} Rtg`}
                                        />
                                    );
                                }) : backPending ? (
                                    Array.from({ length: 8 }).map((_, i) => (
                                        <div key={i} className={`${styles.formBar} ${styles.barSkeleton}`} style={{ height: `${12 + (i % 4) * 7}px` }} />
                                    ))
                                ) : <span className={styles.formEmpty}>No data yet</span>}
                            </div>
                            {rating != null && rating > 0 && (
                                <div className={styles.formSummary}>
                                    <span className={styles.formLbl}>Form · L5</span>
                                    <FormArrow rating={rating} size={14} showValue />
                                </div>
                            )}
                        </div>

                        {/* Tabs */}
                        <div className={styles.backTabs}>
                            <button
                                className={`${styles.backTab} ${tab === 'log' ? styles.backTabActive : ''}`}
                                onClick={() => setTab('log')}
                            >
                                Game Log
                            </button>
                            <button
                                className={`${styles.backTab} ${tab === 'history' ? styles.backTabActive : ''}`}
                                onClick={() => setTab('history')}
                            >
                                History
                            </button>
                        </div>

                        {/* Tab content */}
                        <div className={styles.backTabContent}>
                            {tab === 'log' && (
                                <div className={styles.glWrap} onWheel={(e) => e.stopPropagation()}>
                                    {gamelog.length > 0 ? (
                                        <table className={styles.glTable}>
                                            <thead>
                                                <tr>
                                                    <th className={styles.gwTh}>GW</th>
                                                    <th className={styles.oppTh}>Opp</th>
                                                    <th className={styles.ctrTh}>Min</th>
                                                    <th className={styles.ctrTh}>G</th>
                                                    <th className={styles.ctrTh}>A</th>
                                                    <th>Pts</th>
                                                    <th>Rtg</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {gamelog.map((g, index) => {
                                                    if (g.isDNP) {
                                                        return (
                                                            <tr key={`${g.gameweek}-${g.opponent ?? "x"}-${index}`} className={styles.dnpRow}>
                                                                <td className={styles.gwTd}>{g.gameweek}</td>
                                                                <td className={styles.oppTd}>{g.opponent}</td>
                                                                <td colSpan={5} className={styles.dnpTd}>DNP</td>
                                                            </tr>
                                                        );
                                                    }
                                                    const parsedRes = parseMatchResult(g.opponent, g.result);
                                                    const resCode = parsedRes?.code;
                                                    const resText = parsedRes?.text ?? g.result;
                                                    const gameScore = scoreAtPosition(g, viewPos, primaryPos);

                                                    return (
                                                        <tr key={`${g.gameweek}-${g.opponent ?? "x"}-${index}`}>
                                                            <td className={styles.gwTd}>{g.gameweek}</td>
                                                            <td className={styles.oppTd}>
                                                                {g.opponent}
                                                                {resText && (
                                                                    <span
                                                                        className={styles.resTag}
                                                                        style={{
                                                                            color: resCode === 'W' ? 'var(--color-accent-green)'
                                                                                : resCode === 'L' ? 'var(--color-accent-red)'
                                                                                    : 'var(--color-accent-yellow)',
                                                                        }}
                                                                    >
                                                                        {resText}
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td className={styles.ctrTd}>{g.stats?.minutes_played ?? '—'}</td>
                                                            <td className={styles.ctrTd}>{g.stats?.goals ?? 0}</td>
                                                            <td className={styles.ctrTd}>{g.stats?.assists ?? 0}</td>
                                                            <td className={styles.ptsTd}>{gameScore.fantasy_points.toFixed(2)}</td>
                                                            <td>
                                                                {gameScore.match_rating != null ? (
                                                                    <span style={{ color: ratingHex(gameScore.match_rating) }}>
                                                                        {gameScore.match_rating.toFixed(2)}
                                                                    </span>
                                                                ) : '—'}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    ) : backPending ? (
                                        <div className={styles.rowSkeletons} aria-busy="true" aria-label="Loading game log">
                                            {Array.from({ length: 7 }).map((_, i) => (
                                                <div key={i} className={styles.rowSkeleton} />
                                            ))}
                                        </div>
                                    ) : (
                                        <div className={styles.emptyState}>No game log records found.</div>
                                    )}
                                </div>
                            )}
                            {tab === 'history' && (
                                <div className={styles.glWrap} onWheel={(e) => e.stopPropagation()}>
                                    {history.length > 0 ? (
                                        <table className={styles.glTable}>
                                            <thead>
                                                <tr>
                                                    <th className={styles.gwTh}>Season</th>
                                                    <th className={styles.ctrTh}>Points</th>
                                                    <th className={styles.ctrTh}>PPG</th>
                                                    <th className={styles.ctrTh}>OVR</th>
                                                    <th>Pos rank</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {history.map((h, index) => {
                                                    const bestPosRank = h.position_ranks && h.position_ranks.length > 0
                                                        ? [...h.position_ranks].sort((a, b) => a.rank - b.rank)[0]
                                                        : null;

                                                    return (
                                                        <tr key={h.season ?? index}>
                                                            <td className={styles.gwTd}>{h.season.replace('-', '/')}</td>
                                                            <td className={styles.ctrTd}>{Number(h.total_points).toFixed(2)}</td>
                                                            <td className={styles.ctrTd}>{Number(h.ppg).toFixed(2)}</td>
                                                            <td className={styles.ctrTd}>#{h.overall_rank}</td>
                                                            <td>
                                                                {bestPosRank ? (
                                                                    <span className={styles.resTag} style={{ color: 'var(--color-accent-green)' }}>
                                                                        {bestPosRank.position} #{bestPosRank.rank}
                                                                    </span>
                                                                ) : '—'}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    ) : backPending ? (
                                        <div className={styles.rowSkeletons} aria-busy="true" aria-label="Loading season history">
                                            {Array.from({ length: 4 }).map((_, i) => (
                                                <div key={i} className={styles.rowSkeleton} />
                                            ))}
                                        </div>
                                    ) : (
                                        <div className={styles.emptyState}>No past season stats available.</div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                {/* end .back face */}
            </div>
            {/* end .card */}

            </div>
            {/* end .stage */}
        </div>
    );
}
