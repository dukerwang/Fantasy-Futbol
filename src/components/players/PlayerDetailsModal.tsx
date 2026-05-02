'use client';

import { useEffect } from 'react';
import type { Player } from '@/types';
import PremiumPlayerCard from './PremiumPlayerCard';
import styles from './PlayerDetailsModal.module.css';

interface Props {
    player: Player | null;
    onClose: () => void;
    totalPoints?: number;
    recentForm?: number;
    /** If provided, shows a "Pick" action button inside the modal */
    onPick?: (player: Player) => void;
    /** If provided, shows a "Nominate" action button inside the modal */
    onNominate?: (player: Player) => void;
}

export default function PlayerDetailsModal({
    player,
    onClose,
    totalPoints,
    recentForm,
    onPick,
    onNominate,
}: Props) {
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
                <PremiumPlayerCard
                    player={player}
                    totalPoints={totalPoints}
                    recentForm={recentForm}
                    onClose={onClose}
                />

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
