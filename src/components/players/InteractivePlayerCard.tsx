'use client';

import { useState } from 'react';
import type { Player, RosterEntry } from '@/types';
import PlayerCard from './PlayerCard';
import PlayerDetailsModal from './PlayerDetailsModal';

interface Props {
    player: Player;
    rosterEntry?: RosterEntry;
    compact?: boolean;
}

export default function InteractivePlayerCard({ player, rosterEntry, compact }: Props) {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <PlayerCard
                player={player}
                rosterEntry={rosterEntry}
                compact={compact}
                onClick={() => setIsOpen(true)}
            />
            {isOpen && (
                <PlayerDetailsModal
                    player={player}
                    onClose={() => setIsOpen(false)}
                />
            )}
        </>
    );
}
