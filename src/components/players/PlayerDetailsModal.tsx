'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import NavigationLink from '@/components/ui/NavigationLink';
import type { Player, PlayerOwnership } from '@/types';
import PremiumPlayerCard from './PremiumPlayerCard';
import styles from './PlayerDetailsModal.module.css';

interface Props {
    player: Player | null;
    /**
     * Owner crest data, when the opener already knows it. `undefined` lets the
     * card resolve it; `null` means known free agent.
     */
    ownership?: PlayerOwnership | null;
    onClose: () => void;
    /** If provided, shows a "Pick" action button inside the modal */
    onPick?: (player: Player) => void;
    /** If provided, shows a "Nominate" action button inside the modal */
    onNominate?: (player: Player) => void;
    /** Opens the card onto this gameweek's game-log row, expanded. */
    focusGameweek?: number | null;
    /** Opens the card evaluated under this position slot. */
    focusPosition?: string | null;
}

export default function PlayerDetailsModal({
    player,
    ownership,
    onClose,
    onPick,
    onNominate,
    focusGameweek,
    focusPosition,
}: Props) {
    const params = useParams();
    const leagueId = params?.leagueId as string | undefined;

    // Close on Escape
    useEffect(() => {
        if (!player) return;
        function handleKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose();
        }
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [player, onClose]);

    if (!player) return null;

    return (
        <div
            className={styles.overlay}
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label={`Player details: ${player.name}`}
        >
            <div className={styles.box} onClick={(e) => e.stopPropagation()}>
                <div className={styles.cardScaler}>
                    {/* Keyed on the player so switching subjects remounts rather
                        than briefly painting the previous player's photo. */}
                    <PremiumPlayerCard
                        key={player.id}
                        player={player}
                        ownership={ownership}
                        onClose={onClose}
                        focusGameweek={focusGameweek}
                        focusPosition={focusPosition}
                    />
                </div>

                {/* The modal stays the quick look — reached from fifteen
                    surfaces, and mid-draft you want a peek, not a navigation.
                    This is the way through to the deep view. */}
                {leagueId && (
                    <div className={styles.profileLink}>
                        <NavigationLink
                            href={`/league/${leagueId}/players/${player.id}`}
                            onClick={onClose}
                        >
                            Full profile →
                        </NavigationLink>
                    </div>
                )}

                {(onPick || onNominate) && (
                    <div className={styles.actions}>
                        {onPick && (
                            <button
                                className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
                                onClick={() => { onPick(player); onClose(); }}
                            >
                                Draft Pick
                            </button>
                        )}
                        {onNominate && (
                            <button
                                className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
                                onClick={() => { onNominate(player); onClose(); }}
                            >
                                Nominate
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
