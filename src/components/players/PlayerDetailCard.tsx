import type { Player } from '@/types';
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

const FPL_STATUS_INFO: Record<string, { label: string; cssVar: string }> = {
    i: { label: 'Injured', cssVar: 'var(--color-accent-red)' },
    d: { label: 'Doubtful', cssVar: 'var(--color-accent-yellow)' },
    s: { label: 'Suspended', cssVar: '#f97316' },
    u: { label: 'Unavailable', cssVar: 'var(--color-text-muted)' },
};

interface Props {
    player: Player;
    totalPoints?: number;
    recentForm?: number;
}

export default function PlayerDetailCard({ player, totalPoints, recentForm }: Props) {
    const age = player.date_of_birth ? calculateAge(player.date_of_birth) : null;
    const statusInfo = player.fpl_status ? FPL_STATUS_INFO[player.fpl_status] : null;
    const showBiometrics = age !== null || player.height_cm || player.nationality;

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
                    {player.web_name && player.web_name !== player.name && (
                        <p className={styles.webName}>&ldquo;{player.web_name}&rdquo;</p>
                    )}
                    <p className={styles.club}>{player.pl_team}</p>
                    <div className={styles.positions}>
                        <PositionBadge position={player.primary_position} size="md" />
                        {player.secondary_positions?.map((pos) => (
                            <PositionBadge key={pos} position={pos} size="sm" />
                        ))}
                    </div>
                </div>
            </div>

            {/* ── Biometrics ── */}
            {showBiometrics && (
                <div className={styles.biometrics}>
                    {age !== null && (
                        <div className={styles.bioItem}>
                            <span className={styles.bioLabel}>Age</span>
                            <span className={styles.bioValue}>{age}</span>
                        </div>
                    )}
                    {player.height_cm && (
                        <div className={styles.bioItem}>
                            <span className={styles.bioLabel}>Height</span>
                            <span className={styles.bioValue}>{player.height_cm} cm</span>
                        </div>
                    )}
                    {player.nationality && (
                        <div className={styles.bioItem}>
                            <span className={styles.bioLabel}>Nation</span>
                            <span className={styles.bioValue}>{player.nationality}</span>
                        </div>
                    )}
                </div>
            )}

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

                {totalPoints !== undefined && (
                    <div className={styles.statItem}>
                        <span className={styles.statValue}>{totalPoints.toFixed(1)}</span>
                        <span className={styles.statLabel}>Total Pts</span>
                    </div>
                )}

                {recentForm !== undefined && (
                    <div className={styles.statItem}>
                        <span className={styles.statValue}>{recentForm.toFixed(1)}</span>
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
        </div>
    );
}
