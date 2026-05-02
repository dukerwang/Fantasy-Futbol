'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { Player, RatingBreakdownItem } from '@/types';
import { formatPlayerName } from '@/lib/formatName';
import styles from './PremiumPlayerCard.module.css';

const TEAM_COLORS: Record<string, string> = {
    'Arsenal': '#EF0107',
    'Aston Villa': '#680D3A',
    'Bournemouth': '#DA291C',
    'Brentford': '#E30613',
    'Brighton': '#0057B8',
    'Chelsea': '#034694',
    'Crystal Palace': '#1B458F',
    'Everton': '#003399',
    'Fulham': '#CC0000',
    'Ipswich': '#3469A5',
    'Leicester': '#003090',
    'Liverpool': '#C8102E',
    'Man City': '#6CABDD',
    'Man Utd': '#DA291C',
    'Newcastle': '#363635',
    'Nottm Forest': '#E53233',
    'Southampton': '#D71920',
    'Spurs': '#132257',
    'West Ham': '#7A263A',
    'Wolves': '#D4A017',
};

const TEAM_TO_ID: Record<string, number> = {
    'Arsenal': 1, 'Aston Villa': 2, 'Bournemouth': 3, 'Brentford': 4,
    'Brighton': 5, 'Chelsea': 6, 'Crystal Palace': 7, 'Everton': 8,
    'Fulham': 9, 'Ipswich': 10, 'Leicester': 11, 'Liverpool': 12,
    'Man City': 13, 'Man Utd': 14, 'Newcastle': 15, 'Nottm Forest': 16,
    'Southampton': 17, 'Spurs': 18, 'West Ham': 19, 'Wolves': 20
};

function getTeamColor(teamName: string): string {
    if (TEAM_COLORS[teamName]) return TEAM_COLORS[teamName];
    for (const [key, val] of Object.entries(TEAM_COLORS)) {
        const first = key.split(' ')[0].toLowerCase();
        if (teamName.toLowerCase().startsWith(first)) return val;
    }
    return '#3A6B4A';
}

function ratingHex(r: number | null): string {
    if (r == null) return '#9A9488';
    if (r >= 8.5) return '#3A6B4A';
    if (r >= 7.5) return '#5A9F73';
    if (r >= 6.5) return '#C8A642';
    if (r >= 5.5) return '#D17D3B';
    return '#EF4444';
}

const POS_LONG: Record<string, string> = {
    GK: 'Goalkeeper', CB: 'Centre-Back', LB: 'Left-Back', RB: 'Right-Back',
    DM: 'Defensive Mid', CM: 'Central Mid', LM: 'Left Mid', RM: 'Right Mid',
    AM: 'Attacking Mid', LW: 'Left Winger', RW: 'Right Winger', ST: 'Striker',
};

const POS_CSS_VAR: Record<string, string> = {
    GK: 'var(--color-pos-gk)',
    CB: 'var(--color-pos-cb)',
    LB: 'var(--color-pos-fb)', RB: 'var(--color-pos-fb)',
    DM: 'var(--color-pos-dm)',
    CM: 'var(--color-pos-cm)',
    LM: 'var(--color-pos-wm)', RM: 'var(--color-pos-wm)',
    AM: 'var(--color-pos-am)',
    LW: 'var(--color-pos-lw)', RW: 'var(--color-pos-rw)',
    ST: 'var(--color-pos-st)',
};

interface GamelogEntry {
    gameweek: number;
    fantasy_points: number;
    match_rating: number | null;
    stats: { minutes_played?: number; goals?: number; assists?: number } | null;
    opponent?: string;
    result?: string;
    date?: string;
    isDNP?: boolean;
}

interface Props {
    player: Player;
    totalPoints?: number;
    recentForm?: number;
    matchRating?: number | null;
    ratingBreakdown?: RatingBreakdownItem[] | null;
    onClose?: () => void;
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
    totalPoints,
    recentForm,
    matchRating,
    ratingBreakdown,
    onClose,
}: Props) {
    const stageRef = useRef<HTMLDivElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const holoRef = useRef<HTMLDivElement>(null);
    const [flipped, setFlipped] = useState(false);
    const [tab, setTab] = useState<'log' | 'breakdown'>('log');
    const [hovering, setHovering] = useState(false);
    const [gamelog, setGamelog] = useState<GamelogEntry[]>([]);

    useEffect(() => {
        fetch(`/api/players/${player.id}`)
            .then(r => r.json())
            .then(d => setGamelog(d.gamelog ?? []))
            .catch(() => {});
        return () => setGamelog([]);
    }, [player.id]);

    const teamColor = getTeamColor(player.pl_team);
    const posLong = POS_LONG[player.primary_position] ?? player.primary_position;
    const posVar = POS_CSS_VAR[player.primary_position] ?? 'var(--color-accent-green)';

    const playedGames = gamelog.filter(g => !g.isDNP);
    const recentGames = playedGames.slice(-8);
    const maxPts = Math.max(...recentGames.map(g => g.fantasy_points), 20);
    const avgL3 = recentGames.length >= 3
        ? recentGames.slice(-3).reduce((s, g) => s + g.fantasy_points, 0) / 3
        : recentGames.length > 0
            ? recentGames.reduce((s, g) => s + g.fantasy_points, 0) / recentGames.length
            : null;

    const displayForm = avgL3 ?? recentForm ?? player.form;
    const rating = matchRating;

    // Try 250×250 photo for better quality
    let photoUrl = player.photo_url?.replace('110x140', '250x250') ?? null;
    if (photoUrl) {
        photoUrl = photoUrl.replace(/\/250x250\/(\d)/, '/250x250/p$1');
        photoUrl = photoUrl.replace('.jpg', '.png');
    }

    const resolvedTeamId = player.pl_team_id ?? TEAM_TO_ID[player.pl_team];

    const webName = player.web_name ?? player.name;
    const nameParts = (player.name ?? '').trim().split(/\s+/);
    const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : '';



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

        card.style.transform = `rotateX(${rx}deg) rotateY(${flipped ? 180 + ry : ry}deg)`;

        if (holo) {
            holo.style.setProperty('--mx', `${px * 100}%`);
            holo.style.setProperty('--my', `${py * 100}%`);
            holo.style.setProperty('--gx', `${(px - 0.5) * 30}%`);
            holo.style.setProperty('--gy', `${(py - 0.5) * 30}%`);
            holo.style.setProperty('--rot', `${45 + (px - 0.5) * 30}deg`);
        }
    }, [flipped]);

    const onMouseLeave = useCallback(() => {
        if (cardRef.current) {
            cardRef.current.style.transform = `rotateX(0deg) rotateY(${flipped ? 180 : 0}deg)`;
        }
        setHovering(false);
    }, [flipped]);

    const handleFlip = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        const next = !flipped;
        setFlipped(next);
        if (cardRef.current) {
            cardRef.current.style.transform = `rotateX(0deg) rotateY(${next ? 180 : 0}deg)`;
        }
    }, [flipped]);

    const cardVars = {
        '--team-color': teamColor,
        '--team-color-soft': teamColor + '22',
        '--team-color-deep': teamColor + '55',
        '--pos-color': posVar,
        '--rating-color': ratingHex(rating ?? null),
    } as React.CSSProperties;

    return (
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
                            {resolvedTeamId ? (
                                <img
                                    src={`/team-logos/${resolvedTeamId}.png`}
                                    alt={player.pl_team}
                                    className={styles.crestImg}
                                />
                            ) : (
                                <div className={styles.crest} style={{ background: teamColor }}>
                                    {player.pl_team.charAt(0)}
                                </div>
                            )}
                            <div className={styles.clubMeta}>
                                <span className={styles.mastheadName}>{formatPlayerName(player, 'full')}</span>
                                <span className={styles.mastheadClub}>{player.pl_team}</span>
                            </div>
                        </div>
                    </div>

                    {/* Position spine */}
                    <div className={styles.posSpine}>
                        <span className={styles.posSpineText}>{posLong}</span>
                    </div>

                    {/* Hero — player photo */}
                    <div className={styles.hero}>
                        {photoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={photoUrl}
                                alt={formatPlayerName(player, 'full')}
                                className={styles.photo}
                                loading="eager"
                            />
                        ) : (
                            <div className={styles.photoPlaceholder}>
                                {player.name.charAt(0).toUpperCase()}
                            </div>
                        )}
                    </div>

                    {/* Identity bar */}
                    <div className={styles.identityBar}>
                        {rating != null && rating > 0 && (
                            <div
                                className={styles.ratingBubble}
                                style={{ borderColor: ratingHex(rating), color: ratingHex(rating) }}
                            >
                                <span className={styles.ratingVal}>{rating.toFixed(1)}</span>
                                <span className={styles.ratingLbl}>Rtg</span>
                            </div>
                        )}
                        {firstName && <span className={styles.firstName}>{firstName}</span>}
                        <span className={styles.lastName}>{webName}</span>
                        <div className={styles.idMeta}>
                            <span className={styles.posTag} style={{ background: posVar }}>{player.primary_position}</span>
                            {player.nationality && (
                                <><span className={styles.dot}>·</span><span>{player.nationality}</span></>
                            )}
                            {player.date_of_birth && (
                                <><span className={styles.dot}>·</span><span>Age {calcAge(player.date_of_birth)}</span></>
                            )}
                            {player.height_cm && (
                                <><span className={styles.dot}>·</span><span>{cmToFeet(player.height_cm)}</span></>
                            )}
                        </div>
                    </div>

                    {/* Stats strip */}
                    <div className={styles.statsStrip}>
                        <div className={styles.statCell}>
                            <span className={`${styles.statVal} ${styles.statGold}`}>
                                {player.market_value != null ? `£${player.market_value}m` : '—'}
                            </span>
                            <span className={styles.statLbl}>Value</span>
                        </div>
                        <div className={styles.statCell}>
                            <span className={styles.statVal}>
                                {player.ppg != null ? player.ppg.toFixed(1) : '—'}
                            </span>
                            <span className={styles.statLbl}>PPG</span>
                        </div>
                        <div className={styles.statCell}>
                            <span className={`${styles.statVal} ${styles.statGreen}`}>
                                {displayForm != null ? displayForm.toFixed(1) : '—'}
                            </span>
                            <span className={styles.statLbl}>Form</span>
                        </div>
                        <div className={styles.statCell}>
                            <span className={styles.statVal}>
                                {player.overall_rank != null ? `#${player.overall_rank}` : '—'}
                            </span>
                            <span className={styles.statLbl}>OVR</span>
                        </div>
                    </div>

                    {/* Position rank strip */}
                    <div className={styles.rankStrip}>
                        <span className={styles.rankLbl}>Pos Rank</span>
                        <div className={styles.rankChips}>
                            {player.position_ranks && player.position_ranks.length > 0 ? (
                                player.position_ranks.sort((a, b) => a.rank - b.rank).map((r, i) => (
                                    <span
                                        key={r.position}
                                        className={`${styles.rankChip} ${i === 0 ? styles.rankChipPrimary : ''}`}
                                        style={{ '--chip-color': POS_CSS_VAR[r.position] ?? 'var(--color-accent-green)' } as React.CSSProperties}
                                    >
                                        <span className={styles.rcPos}>{r.position}</span>
                                        <span className={styles.rcNum}>#{r.rank}</span>
                                    </span>
                                ))
                            ) : (
                                <span className={styles.rankEmpty}>—</span>
                            )}
                        </div>
                    </div>

                    {/* Action buttons */}
                    <div className={styles.cardActions}>
                        {onClose && (
                            <button className={styles.actionIconBtn} onClick={onClose} aria-label="Close">
                                ×
                            </button>
                        )}
                        <button className={styles.actionIconBtn} onClick={handleFlip} aria-label="Flip to game log">
                            <FlipIcon />
                        </button>
                    </div>

                    {/* Holographic overlay */}
                    <div
                        className={styles.holo}
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
                                <span className={styles.backEyebrow}>Form Guide · 2025/26</span>
                                <div className={styles.backName}>
                                    {webName} <em>·</em> Last {recentGames.length || '—'}
                                </div>
                            </div>
                        </div>

                        {/* Form sparkline */}
                        <div className={styles.formSection}>
                            <div className={styles.formBars}>
                                {recentGames.length > 0 ? recentGames.map((g, i) => {
                                    const h = Math.max(3, (g.fantasy_points / maxPts) * 42);
                                    const barCls = g.fantasy_points >= 12 ? styles.barHigh
                                        : g.fantasy_points >= 7 ? styles.barMid
                                        : g.fantasy_points > 0 ? styles.barLow
                                        : styles.barDnp;
                                    return (
                                        <div
                                            key={i}
                                            className={`${styles.formBar} ${barCls}`}
                                            style={{ height: `${h}px` }}
                                            title={`GW${g.gameweek} · ${g.fantasy_points.toFixed(1)} pts`}
                                        />
                                    );
                                }) : <span className={styles.formEmpty}>No data yet</span>}
                            </div>
                            {displayForm != null && (
                                <div className={styles.formSummary}>
                                    <span className={styles.formLbl}>Form · L3</span>
                                    <span className={styles.formVal}>{displayForm.toFixed(1)}</span>
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
                            {ratingBreakdown && ratingBreakdown.length > 0 && (
                                <button
                                    className={`${styles.backTab} ${tab === 'breakdown' ? styles.backTabActive : ''}`}
                                    onClick={() => setTab('breakdown')}
                                >
                                    Rating
                                </button>
                            )}
                        </div>

                        {/* Tab content */}
                        <div className={styles.backTabContent}>
                            {tab === 'log' && (
                                <div className={styles.glWrap}>
                                    {gamelog.length > 0 ? (
                                        <table className={styles.glTable}>
                                            <thead>
                                                <tr>
                                                    <th className={styles.gwTh}>GW</th>
                                                    <th className={styles.oppTh}>Opp</th>
                                                    <th>Min</th>
                                                    <th>G</th>
                                                    <th>A</th>
                                                    <th>Pts</th>
                                                    <th>Rtg</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {gamelog.map((g) => {
                                                    if (g.isDNP) {
                                                        return (
                                                            <tr key={g.gameweek} className={styles.dnpRow}>
                                                                <td className={styles.gwTd}>{g.gameweek}</td>
                                                                <td className={styles.oppTd}>{g.opponent}</td>
                                                                <td colSpan={5} className={styles.dnpTd}>DNP</td>
                                                            </tr>
                                                        );
                                                    }
                                                    const parsedRes = parseMatchResult(g.opponent, g.result);
                                                    const resCode = parsedRes?.code;
                                                    const resText = parsedRes?.text ?? g.result;
                                                    
                                                    return (
                                                        <tr key={g.gameweek}>
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
                                                            <td>{g.stats?.minutes_played ?? '—'}</td>
                                                            <td>{g.stats?.goals ?? 0}</td>
                                                            <td>{g.stats?.assists ?? 0}</td>
                                                            <td className={styles.ptsTd}>{g.fantasy_points.toFixed(1)}</td>
                                                            <td>
                                                                {g.match_rating != null ? (
                                                                    <span style={{ color: ratingHex(g.match_rating) }}>
                                                                        {g.match_rating.toFixed(1)}
                                                                    </span>
                                                                ) : '—'}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    ) : (
                                        <div className={styles.emptyState}>No game log records found.</div>
                                    )}
                                </div>
                            )}
                            {tab === 'breakdown' && ratingBreakdown && (
                                <div className={styles.bdList}>
                                    {ratingBreakdown.map(item => (
                                        <div key={item.key} className={styles.bdRow}>
                                            <div className={styles.bdTop}>
                                                <span className={styles.bdName}>{item.component}</span>
                                                <span className={styles.bdWt}>{(item.weight * 100).toFixed(0)}% WT</span>
                                            </div>
                                            <div className={styles.bdTrack}>
                                                <div
                                                    className={styles.bdFill}
                                                    style={{
                                                        width: `${Math.round(item.score * 100)}%`,
                                                        background: ratingHex(1 + 9 * item.score),
                                                    }}
                                                />
                                            </div>
                                            <span className={styles.bdDetail}>{item.detail}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                    {/* Action buttons */}
                    <div className={styles.cardActionsBack}>
                        {onClose && (
                            <button className={styles.actionIconBtn} onClick={onClose} aria-label="Close">
                                ×
                            </button>
                        )}
                        <button className={styles.actionIconBtn} onClick={handleFlip} aria-label="Flip to front">
                            <FlipIcon />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
