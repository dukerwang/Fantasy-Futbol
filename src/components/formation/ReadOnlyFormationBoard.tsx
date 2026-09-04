import { Fragment } from 'react';
import type { Formation, GranularPosition } from '@/types';
import Portrait from '@/components/players/Portrait';
import PositionBadge from '@/components/players/PositionBadge';
import styles from './ReadOnlyFormationBoard.module.css';

type PitchZone = 'ATT' | 'AMZ' | 'CMZ' | 'DMZ' | 'WBZ' | 'DEF' | 'GK';

const ZONE_ORDER: PitchZone[] = ['ATT', 'AMZ', 'CMZ', 'DMZ', 'WBZ', 'DEF', 'GK'];

function zoneFor(slot: GranularPosition, formation?: string | null): PitchZone {
  if (slot === 'GK') return 'GK';
  if (slot === 'CB' || slot === 'LB' || slot === 'RB') return 'DEF';
  if (slot === 'DM') return 'DMZ';
  if (slot === 'AM') return 'AMZ';
  if (slot === 'LWB' || slot === 'RWB') {
    if (formation?.startsWith('3-')) return 'CMZ';
    return 'WBZ';
  }
  if (slot === 'CM') return 'CMZ';
  return 'ATT';
}

export interface FormationBoardPlayer {
  id: string;
  name: string;
  club: string | null;
  photoUrl: string | null;
  photoVersion?: string | null;
  headTopPct?: number | null;
  headWidthPct?: number | null;
  /** Contextual detail such as gameweek points or team ownership. */
  detail?: string | null;
  /** Compact marker badge on the portrait (e.g. points scored). */
  marker?: string | null;
}

export interface FormationBoardSlot {
  slot: GranularPosition;
  player: FormationBoardPlayer | null;
  /** Positional cover for this exact slot. Club boards populate this; TOTW does not. */
  depth?: FormationBoardPlayer[];
}

interface Props {
  formation: string | null | undefined;
  slots: FormationBoardSlot[];
  emptyLabel: string;
  ariaLabel: string;
  selectedPlayerId?: string | null;
  onSelectPlayer?: (id: string) => void;
  variant?: 'deck' | 'standard' | 'A' | 'B' | 'C';
}

function ptsBand(marker: string | null | undefined): string {
  if (!marker) return '';
  const num = parseFloat(marker);
  if (isNaN(num)) {
    if (marker === '–' || marker === 'pending') return styles.nodePtsPending;
    if (marker === 'DNP') return styles.nodePtsDnp;
    return styles.nodePtsBadgeDefault;
  }
  if (num >= 29) return styles.nodePtsElite;
  if (num >= 15.8) return styles.nodePtsGood;
  if (num >= 5.6) return styles.nodePtsFair;
  if (num >= 2.0) return styles.nodePtsBelowAvg;
  if (num > 0) return styles.nodePtsWeak;
  return styles.nodePtsBad;
}

function Node({
  item,
  selectedPlayerId,
  onSelectPlayer,
  variant,
}: {
  item: FormationBoardSlot;
  selectedPlayerId?: string | null;
  onSelectPlayer?: (id: string) => void;
  variant?: 'deck' | 'standard' | 'A' | 'B' | 'C';
}) {
  const player = item.player;
  const isSelected = player ? player.id === selectedPlayerId : false;
  const depthList = item.depth ?? [];
  const isInteractive = Boolean(onSelectPlayer);
  const hasSelection = isSelected || depthList.some((d) => d.id === selectedPlayerId);
  const isDeckVariant = variant === 'deck' || variant === 'B' || (item.depth !== undefined && variant !== 'standard');

  if (!player) {
    return (
      <div className={`${styles.nodeWrap} ${styles.nodeWrapEmpty}`}>
        <div className={styles.slotHeaderBadge}>
          <PositionBadge position={item.slot} size="sm" />
        </div>
        <div className={styles.emptyPortraitWrap} />
        <div className={`${styles.nodeChip} ${styles.nodeChipEmpty}`}>
          <span className={styles.nodeEmptyName}>Open</span>
        </div>
      </div>
    );
  }

  // ── Tactical Deck Variant (Variant B modified: badge above, centered names, no sub tag, no cover empty state) ──
  if (isDeckVariant) {
    return (
      <div className={`${styles.nodeWrap} ${hasSelection ? styles.nodeWrapSelected : ''}`}>
        <div className={styles.slotHeaderBadge}>
          <PositionBadge position={item.slot} size="sm" />
        </div>

        <button
          type="button"
          className={styles.starterButton}
          onClick={isInteractive ? () => onSelectPlayer!(player.id) : undefined}
          aria-label={`${player.name}, ${item.slot}`}
          tabIndex={isInteractive ? 0 : -1}
        >
          <span className={styles.portraitWrap}>
            <Portrait
              photoUrl={player.photoUrl}
              name={player.name}
              club={player.club}
              size="md"
              headTopPct={player.headTopPct}
              headWidthPct={player.headWidthPct}
              photoVersion={player.photoVersion}
            />
            {player.marker && (
              <span className={`${styles.nodePtsBadge} ${ptsBand(player.marker)}`}>
                {player.marker}
              </span>
            )}
          </span>
        </button>

        <div className={`${styles.deckCard} ${hasSelection ? styles.deckCardSelected : ''}`}>
          <button
            type="button"
            className={`${styles.deckStarterRow} ${isSelected ? styles.deckStarterSelected : ''}`}
            onClick={isInteractive ? () => onSelectPlayer!(player.id) : undefined}
          >
            <span className={styles.deckStarterName}>{player.name}</span>
          </button>
          {depthList.map((backup) => (
            <Fragment key={backup.id}>
              <div className={styles.deckDivider} />
              <button
                type="button"
                className={`${styles.deckDepthRow} ${backup.id === selectedPlayerId ? styles.deckDepthRowSelected : ''}`}
                onClick={isInteractive ? (e) => { e.stopPropagation(); onSelectPlayer!(backup.id); } : undefined}
                title={`Cover: ${backup.name}${backup.club ? ` (${backup.club})` : ''}`}
              >
                <span className={styles.deckDepthName}>{backup.name}</span>
              </button>
            </Fragment>
          ))}
        </div>
      </div>
    );
  }

  // ── Standard broadsheet pill (TOTW) ──────────────────────────────────────
  return (
    <div className={`${styles.nodeWrap} ${isSelected ? styles.nodeWrapSelected : ''}`}>
      <button
        type="button"
        className={styles.starterButton}
        onClick={isInteractive ? () => onSelectPlayer!(player.id) : undefined}
        aria-label={`${player.name}, ${item.slot}`}
        tabIndex={isInteractive ? 0 : -1}
      >
        <span className={styles.portraitWrap}>
          <Portrait
            photoUrl={player.photoUrl}
            name={player.name}
            club={player.club}
            size="md"
            headTopPct={player.headTopPct}
            headWidthPct={player.headWidthPct}
            photoVersion={player.photoVersion}
          />
          {player.marker && (
            <span className={`${styles.nodePtsBadge} ${ptsBand(player.marker)}`}>
              {player.marker}
            </span>
          )}
        </span>

        <span className={styles.nodeChip}>
          <span className={styles.nodeName}>{player.name}</span>
          <span className={styles.nodeMeta}>
            <PositionBadge position={item.slot} size="sm" />
          </span>
        </span>
      </button>
    </div>
  );
}

export default function ReadOnlyFormationBoard({
  formation,
  slots,
  emptyLabel,
  ariaLabel,
  selectedPlayerId,
  onSelectPlayer,
  variant,
}: Props) {
  const byZone = new Map<PitchZone, FormationBoardSlot[]>();
  for (const zone of ZONE_ORDER) byZone.set(zone, []);
  for (const slot of slots) {
    byZone.get(zoneFor(slot.slot, formation))?.push(slot);
  }

  if (slots.length === 0) {
    return <div className={styles.emptyBoard}>{emptyLabel}</div>;
  }

  return (
    <div className={styles.pitchField} aria-label={ariaLabel}>
      <div className={styles.pitchTopPenaltyBox} aria-hidden />
      <div className={styles.pitchTopPenaltyArc} aria-hidden />
      <div className={styles.pitchHalftimeLine} aria-hidden />
      <div className={styles.centerCircle} aria-hidden />
      <div className={styles.pitchBottomPenaltyBox} aria-hidden />
      <div className={styles.pitchBottomPenaltyArc} aria-hidden />

      {formation && <span className={styles.formationWatermark}>{formation}</span>}

      <div className={styles.pitchZones}>
        {ZONE_ORDER.map((zone) => {
          const zoneSlots = byZone.get(zone) ?? [];
          if (zoneSlots.length === 0) {
            if (zone === 'AMZ' && (byZone.get('ATT')?.length ?? 0) > 0 && (byZone.get('CMZ')?.length ?? 0) > 0) {
              return <div key="AMZ-spacer" className={styles.emptyZoneSpacer} aria-hidden />;
            }
            return null;
          }
          const is4222 = formation === '4-2-2-2';
          const is4321 = formation === '4-3-2-1';

          let rowModifier = '';
          if (zone === 'ATT') {
            if (is4222) rowModifier = styles.rowATTCompact;
          } else if (zone === 'WBZ') {
            rowModifier = styles.rowWBZ;
          } else if (zone === 'AMZ') {
            if (is4222) rowModifier = styles.rowAMZWide;
            else if (is4321) rowModifier = styles.rowAMZCompact;
          } else if (zone === 'CMZ') {
            if (is4321) rowModifier = styles.rowCMZWide;
            else if (zoneSlots.length >= 4) rowModifier = styles.rowMidfieldFour;
          } else if (zone === 'DMZ') {
            if (is4222) rowModifier = styles.rowDMZPivot;
          }

          return (
            <div key={zone} className={`${styles.pitchZone} ${styles[`zone${zone}`]}`}>
              <div className={`${styles.pitchRow} ${rowModifier}`}>
                {zoneSlots.map((item, i) => (
                  <Node
                    key={`${item.slot}-${item.player?.id ?? i}`}
                    item={item}
                    selectedPlayerId={selectedPlayerId}
                    onSelectPlayer={onSelectPlayer}
                    variant={variant}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
