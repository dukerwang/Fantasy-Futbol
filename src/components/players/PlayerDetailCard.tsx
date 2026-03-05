'use client';

import { useState, useEffect } from 'react';
import type { Player, RatingBreakdownItem } from '@/types';
import PositionBadge from './PositionBadge';
import styles from './PlayerDetailCard.module.css';

function calculateAge(dateOfBirth: string): number {
    const today = new Date();
    const birth = new Date(dateOfBirth);
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
}

function cmToFeetInches(cm: number): string {
    const totalInches = cm / 2.54;
    const feet = Math.floor(totalInches / 12);
    const inches = Math.round(totalInches % 12);
    return `${feet}'${inches}"`;
}

const FPL_STATUS_INFO: Record<string, { label: string; cssVar: string }> = {
    i: { label: 'Injured', cssVar: 'var(--color-accent-red)' },
    d: { label: 'Doubtful', cssVar: 'var(--color-accent-yellow)' },
    s: { label: 'Suspended', cssVar: '#f97316' },
    u: { label: 'Unavailable', cssVar: 'var(--color-text-muted)' },
};

function getRatingColor(rating: number): string {
    if (rating >= 8.0) return '#22c55e';
    if (rating >= 7.0) return '#4ade80';
    if (rating >= 6.0) return '#facc15';
    if (rating >= 5.0) return '#f97316';
    return '#ef4444';
}

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
}

export default function PlayerDetailCard({ player, totalPoints, recentForm, matchRating, ratingBreakdown }: Props) {
    const [showBreakdown, setShowBreakdown] = useState(false);
    const [activeTab, setActiveTab] = useState<'overview' | 'gamelog'>('overview');
    const [gamelog, setGamelog] = useState<GamelogEntry[]>([]);

    const age = player.date_of_birth ? calculateAge(player.date_of_birth) : null;
    const statusInfo = player.fpl_status ? FPL_STATUS_INFO[player.fpl_status] : null;
    const showBiometrics = age !== null || player.height_cm || player.nationality;

    useEffect(() => {
        setGamelog([]);
        fetch(`/api/players/${player.id}`)
            .then((r) => r.json())
            .then((d) => setGamelog(d.gamelog ?? []))
            .catch(() => { /* silently fail — no game data yet */ });
    }, [player.id]);

    const displayTotalPoints = totalPoints ?? player.total_points;
    const displayForm = recentForm ?? player.form;

    return (
        <div className={styles.card}>
            {/* ── Header: Photo + Identity ── */}
            <div className={styles.header}>
                <div className={styles.photoWrap}>
                    {player.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={player.photo_url} alt={player.name} className={styles.photo} />
                    ) : (
                        <span className={styles.photoPlaceholder}>
                            {player.name.charAt(0).toUpperCase()}
                        </span>
                    )}
                </div>

                <div className={styles.identity}>
                    <h2 className={styles.playerName}>{player.name}</h2>
                    <p className={styles.club}>{player.pl_team}</p>
                    <div className={styles.positions}>
                        <PositionBadge position={player.primary_position} size="md" />
                        {player.secondary_positions && player.secondary_positions.length > 0 && (
                            <div className={styles.altPositions}>
                                <span className={styles.altLabel}>Alt:</span>
                                {player.secondary_positions.map((pos) => (
                                    <PositionBadge key={pos} position={pos} size="sm" />
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Rating Badge ── */}
                {matchRating != null && matchRating > 0 && (
                    <div
                        className={styles.ratingBadge}
                        style={{ background: getRatingColor(matchRating) }}
                        title={`Match Rating: ${matchRating.toFixed(1)}`}
                    >
                        <span className={styles.ratingNumber}>{matchRating.toFixed(1)}</span>
                        <span className={styles.ratingLabel}>Rating</span>
                    </div>
                )}
            </div>

            {/* ── Biometrics ── */}
            {showBiometrics && (
                <div className={styles.biometrics}>
                    <div className={styles.bioItem}>
                        <span className={styles.bioLabel}>Age</span>
                        <span className={styles.bioValue}>{age ?? '—'}</span>
                    </div>
                    <div className={styles.bioItem}>
                        <span className={styles.bioLabel}>Height</span>
                        <span className={styles.bioValue}>{player.height_cm ? cmToFeetInches(player.height_cm) : '—'}</span>
                    </div>
                    <div className={styles.bioItem}>
                        <span className={styles.bioLabel}>Nation</span>
                        <span className={styles.bioValue}>{player.nationality ?? '—'}</span>
                    </div>
                </div>
            )}

            {/* ── Tabs Content ── */}
            <div className={styles.tabsContainer}>
                <div className={styles.tabsHeader}>
                    <button
                        className={`${styles.tabBtn} ${activeTab === 'overview' ? styles.tabActive : ''}`}
                        onClick={() => setActiveTab('overview')}
                    >
                        Overview
                    </button>
                    <button
                        className={`${styles.tabBtn} ${activeTab === 'gamelog' ? styles.tabActive : ''}`}
                        onClick={() => setActiveTab('gamelog')}
                    >
                        Game Log
                    </button>
                </div>

                {activeTab === 'overview' && (
                    <div className={styles.tabContent}>
                        {/* ── Stats Grid ── */}
                        <div className={styles.statsGrid}>
                            <div className={styles.statItem}>
                                <span className={styles.statValue} data-gold="true">
                                    £{player.market_value}m
                                </span>
                                <span className={styles.statLabel}>Value</span>
                            </div>

                            {player.adp !== null && player.adp !== undefined && (
                                <div className={styles.statItem}>
                                    <span className={styles.statValue}>{player.adp}</span>
                                    <span className={styles.statLabel}>ADP</span>
                                </div>
                            )}

                            {player.projected_points !== null && player.projected_points !== undefined && (
                                <div className={styles.statItem}>
                                    <span className={styles.statValue}>{player.projected_points.toFixed(1)}</span>
                                    <span className={styles.statLabel}>Proj Pts</span>
                                </div>
                            )}

                            {displayTotalPoints != null && (
                                <div className={styles.statItem}>
                                    <span className={styles.statValue}>
                                        {displayTotalPoints.toFixed(1)}
                                    </span>
                                    <span className={styles.statLabel}>Total Pts</span>
                                </div>
                            )}

                            {displayForm != null && (
                                <div className={styles.statItem}>
                                    <span className={styles.statValue}>
                                        {displayForm.toFixed(1)}
                                    </span>
                                    <span className={styles.statLabel}>Form (3 GW)</span>
                                </div>
                            )}
                        </div>

                        {/* ── Status / Injury News ── */}
                        {statusInfo && (
                            <div className={styles.statusBanner} style={{ borderColor: statusInfo.cssVar }}>
                                <span className={styles.statusDot} style={{ background: statusInfo.cssVar }} />
                                <div className={styles.statusBody}>
                                    <span className={styles.statusLabel} style={{ color: statusInfo.cssVar }}>
                                        {statusInfo.label}
                                    </span>
                                    {player.fpl_news && (
                                        <p className={styles.statusNews}>{player.fpl_news}</p>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* ── Rating Breakdown ── */}
                        {ratingBreakdown && ratingBreakdown.length > 0 && (
                            <div className={styles.breakdownSection}>
                                <button
                                    className={styles.breakdownToggle}
                                    onClick={() => setShowBreakdown(!showBreakdown)}
                                >
                                    <span>Rating Breakdown</span>
                                    <span className={styles.chevron} data-open={showBreakdown}>▾</span>
                                </button>

                                {showBreakdown && (
                                    <div className={styles.breakdownList}>
                                        {ratingBreakdown.map((item) => (
                                            <div key={item.key} className={styles.breakdownItem}>
                                                <div className={styles.breakdownHeader}>
                                                    <span className={styles.breakdownName}>{item.component}</span>
                                                    <span className={styles.breakdownWeight}>{(item.weight * 100).toFixed(0)}%</span>
                                                </div>
                                                <div className={styles.barTrack}>
                                                    <div
                                                        className={styles.barFill}
                                                        style={{
                                                            width: `${Math.round(item.score * 100)}%`,
                                                            background: getRatingColor(1 + 9 * item.score),
                                                        }}
                                                    />
                                                </div>
                                                <span className={styles.breakdownDetail}>{item.detail}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )} {/* End Overview Tab */}

                {activeTab === 'gamelog' && (
                    <div className={`${styles.tabContent} ${styles.scrollableTab}`}>
                        {/* ── Game Log ── */}
                        {gamelog.length > 0 ? (
                            <table className={styles.gameLogTable}>
                                <thead>
                                    <tr>
                                        <th className={styles.alignLeft}>Date</th>
                                        <th className={styles.alignCenter}>GW</th>
                                        <th className={styles.opponentCol}>Opp</th>
                                        <th className={styles.alignRight}>Min</th>
                                        <th className={styles.alignRight}>G</th>
                                        <th className={styles.alignRight}>A</th>
                                        <th className={styles.alignRight}>Pts</th>
                                        <th className={styles.alignRight}>Rtg</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {gamelog.map((entry) => {
                                        const dShort = entry.date ? new Date(entry.date).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }) : '—';
                                        if (entry.isDNP) {
                                            return (
                                                <tr key={entry.gameweek} className={styles.dnpRow}>
                                                    <td className={styles.alignLeft}>{dShort}</td>
                                                    <td className={styles.alignCenter}>{entry.gameweek}</td>
                                                    <td className={styles.opponentCol}>{entry.opponent}</td>
                                                    <td colSpan={5} className={styles.dnpText}>DNP</td>
                                                </tr>
                                            );
                                        }
                                        return (
                                            <tr key={entry.gameweek}>
                                                <td className={styles.alignLeft}>{dShort}</td>
                                                <td className={styles.alignCenter}>{entry.gameweek}</td>
                                                <td className={styles.opponentCol}>{entry.opponent}</td>
                                                <td className={styles.alignRight}>{entry.stats?.minutes_played ?? '—'}</td>
                                                <td className={styles.alignRight}>{entry.stats?.goals ?? 0}</td>
                                                <td className={styles.alignRight}>{entry.stats?.assists ?? 0}</td>
                                                <td className={`${styles.gameLogPts} ${styles.alignRight}`}>
                                                    {entry.fantasy_points.toFixed(1)}
                                                </td>
                                                <td className={styles.alignRight}>
                                                    {entry.match_rating != null ? (
                                                        <span style={{ color: getRatingColor(entry.match_rating) }}>
                                                            {entry.match_rating.toFixed(1)}
                                                        </span>
                                                    ) : '—'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        ) : (
                            <div className={styles.emptyState}>No game log records found for this season.</div>
                        )}
                    </div>
                )} {/* End Gamelog Tab */}
            </div>
        </div>
    );
}
