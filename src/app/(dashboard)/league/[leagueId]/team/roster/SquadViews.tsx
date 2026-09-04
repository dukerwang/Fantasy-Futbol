'use client';

import { useMemo, useState } from 'react';
import { ALL_FORMATIONS, type Formation, type GranularPosition, type MatchupLineup, type Player } from '@/types';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import Portrait from '@/components/players/Portrait';
import PositionBadge from '@/components/players/PositionBadge';
import ReadOnlyFormationBoard, { type FormationBoardPlayer, type FormationBoardSlot } from '@/components/formation/ReadOnlyFormationBoard';
import type { ClubProps, SquadEntry } from './ClubClient';
import {
  ZONES, statusMeta, INJURY, posColor,
  money, ppgOf, seasonPts, valueOf, ageOf, formationReport, shortages, projectedLineup, projectedScores,
} from './clubDerive';
import styles from './club.module.css';

// ── Small shared bits ────────────────────────────────────────────────────────

/**
 * The shared PositionBadge, with a ghost wrapper for a secondary position.
 *
 * This page had its own copy — a plain coloured rectangle keyed off
 * `--color-pos-*` — which meant it was the one surface in the app where LB and
 * RB, and LWB and RWB, were the same badge. Those pairs share a hue by design
 * and are separated by a clipped corner that only the real component draws.
 * Same lesson as ListingCard's duplicated crest treatment: a copied rule
 * decays, and here it had decayed into being wrong.
 */
export function PosBadge({ pos, ghost }: { pos?: string | null; ghost?: boolean }) {
  const badge = <PositionBadge position={(pos ?? 'N/A') as GranularPosition} size="sm" />;
  return ghost ? <span className={styles.ghostBadge}>{badge}</span> : badge;
}

function StatusTag({ status, short }: { status: string; short?: boolean }) {
  const s = statusMeta(status);
  return <span className={styles.tstatus} style={{ ['--tone' as string]: s.tone }}>{short ? s.short : s.label}</span>;
}

function InjuryTag({ player, hideOnIr, status }: { player: Player; hideOnIr?: boolean; status?: string }) {
  const f = player.fpl_status;
  if (!f || f === 'a') return null;
  if (hideOnIr && status === 'ir') return null;
  const i = INJURY[f];
  if (!i) return null;
  return <span className={styles.tstatus} style={{ ['--tone' as string]: i.tone }}>{i.label}</span>;
}

/** Fitness-first single status token for a compact tile. */
function TileStatus({ e }: { e: SquadEntry }) {
  const f = e.player.fpl_status;
  let label: string, tone: string;
  if (e.status === 'ir') { label = statusMeta('ir').short; tone = statusMeta('ir').tone; }
  else if (f && f !== 'a' && INJURY[f]) { label = INJURY[f].label; tone = INJURY[f].tone; }
  else { const s = statusMeta(e.status); label = s.short; tone = s.tone; }
  return <span className={styles.tstatus} style={{ ['--tone' as string]: tone }}>{label}</span>;
}

function Spark({ form }: { form: number[] }) {
  if (!form.length) return <span className={styles.sparkEmpty}>—</span>;
  const max = Math.max(...form, 1);
  return (
    <div className={styles.spark} title="Last 5 gameweeks">
      {form.map((v, i) => (
        <i key={i} className={v === 0 ? styles.sparkZero : ''} style={{ height: `${Math.max(2, Math.round((v / max) * 20))}px` }} />
      ))}
    </div>
  );
}

// ── Tiles ─────────────────────────────────────────────────────────────────────

function TileCompact({ e, sel, onClick }: { e: SquadEntry; sel: boolean; onClick: () => void }) {
  const p = e.player;
  return (
    <button type="button" className={`${styles.tile} ${styles.tileC} ${sel ? styles.tileSel : ''}`} onClick={onClick}>
      {/* The club is the crest on the portrait, not a three-letter abbreviation
          beside the badge — the same line the crest chip replaced everywhere
          else. Deleting it is what lets the meta row be the badge alone. */}
      <Portrait
        photoUrl={p.photo_url}
        name={getPlayerDisplayName(p, 'full')}
        club={p.pl_team}
        size="sm"
        headTopPct={p.portrait_head_top_pct}
        headWidthPct={p.portrait_head_width_pct}
        photoVersion={p.photo_version}
      />
      <div className={styles.tcBody}>
        <div className={styles.tcName}>{getPlayerDisplayName(p, 'initial_last')}</div>
        <div className={styles.tcMeta}>
          <PosBadge pos={p.primary_position} />
        </div>
      </div>
      <div className={styles.tcRight}>
        <div className={styles.tcVal}>{money(valueOf(e))}</div>
        <TileStatus e={e} />
      </div>
    </button>
  );
}

function TileGallery({ e, sel, onClick }: { e: SquadEntry; sel: boolean; onClick: () => void }) {
  const p = e.player;
  const f = p.fpl_status;
  const inj = f && f !== 'a' ? INJURY[f] : null;
  const { first, last } = getPlayerDisplayName(p, 'split') as { first: string; last: string };
  return (
    <button type="button" className={`${styles.tile} ${styles.tileG} ${sel ? styles.tileSel : ''}`} onClick={onClick}>
      <div className={styles.tgPhoto}>
        <Portrait
          photoUrl={p.photo_url}
          name={getPlayerDisplayName(p, 'full')}
          club={p.pl_team}
          size="lg"
          headTopPct={p.portrait_head_top_pct}
          headWidthPct={p.portrait_head_width_pct}
          photoVersion={p.photo_version}
        />
        <span className={styles.tgValchip}>{money(valueOf(e))}</span>
        {inj && <span className={styles.tgInjchip} style={{ color: inj.tone }}>{inj.label}</span>}
      </div>
      <div className={styles.tgFoot}>
        <div className={styles.tgIdline}>
          <div className={styles.tgNamewrap}>
            {first && <span className={styles.tgFirst}>{first}</span>}
            <div className={styles.tgName}>{last}</div>
          </div>
          <StatusTag status={e.status} short />
        </div>
        <div className={styles.tgBadges}>
          <PosBadge pos={p.primary_position} />
          {(p.secondary_positions ?? []).map((s) => <PosBadge key={s} pos={s} ghost />)}
        </div>
        <div className={styles.tgStatline}>
          <span className={styles.tgStatnum}>{seasonPts(e)}</span><span className={styles.tgStatunit}>pts</span>
          <span className={styles.tgStatsep}>·</span>
          <span className={styles.tgStatnum}>{ppgOf(e).toFixed(2)}</span><span className={styles.tgStatunit}>ppg</span>
          <span className={styles.tgSpacer} />
          <Spark form={e.form} />
        </div>
      </div>
    </button>
  );
}

// ── Depth Chart ───────────────────────────────────────────────────────────────

export function DepthChart({
  entries, allEntries, selId, onSelect,
}: { entries: SquadEntry[]; allEntries: SquadEntry[]; selId: string | null; onSelect: (id: string) => void }) {
  const forms = useMemo(() => formationReport(allEntries), [allEntries]);
  const short = useMemo(() => shortages(allEntries), [allEntries]);
  const okCount = forms.filter((f) => f.ok).length;
  const needLine = short.map((s) => (s.have === 0 ? `any ${s.pos}` : `${s.need - s.have} more ${s.pos}`)).join(', ');

  return (
    <section className={`${styles.panel} g-panel`}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Depth Chart</h2>
        <span className="g-label">By tactical position · attack first</span>
      </div>

      {ZONES.map((z) => {
        const inZone = entries.filter((e) => e.player.primary_position && z.positions.includes(e.player.primary_position));
        const absent = short.filter((s) => z.positions.includes(s.pos) && s.have === 0);
        const thin = short.filter((s) => z.positions.includes(s.pos) && s.have > 0);
        return (
          <div className={styles.zone} key={z.key}>
            <div className={styles.zoneHead}>
              <span className={styles.zoneLabel}>{z.label}</span>
              <span className={styles.zoneCount}>{inZone.length}</span>
              {absent.map((s) => <span className={styles.zoneFlag} key={s.pos}>No {s.pos} cover</span>)}
              {thin.map((s) => <span className={styles.zoneFlag} key={s.pos}>{s.pos} — {s.have} of {s.need} needed</span>)}
            </div>
            <div className={styles.strip}>
              {inZone.map((e) => <TileCompact key={e.id} e={e} sel={e.id === selId} onClick={() => onSelect(e.id)} />)}
              {absent.map((s) => (
                <div className={`${styles.gapChip} g-namerow`} key={s.pos}><PosBadge pos={s.pos} ghost /><span>No cover</span></div>
              ))}
              {inZone.length === 0 && absent.length === 0 && (
                <div className={styles.gapSlot}>Nobody in this zone matches the current filter.</div>
              )}
            </div>
          </div>
        );
      })}

      <div className={styles.forms}>
        <span className={styles.zoneLabel}>Fieldable formations</span>
        <div className={styles.formChips}>
          {forms.map((f) => (
            <span key={f.name} className={`${styles.fchip} ${f.ok ? styles.fchipOk : ''}`}>
              <span className={styles.tick}>{f.ok ? '✓' : '✗'}</span>{f.name}
            </span>
          ))}
        </div>
        <p className={styles.formsNote}>
          {okCount} of {forms.length} available.{needLine ? ` To unlock the rest, sign: ${needLine}.` : ''}{' '}
          Injured and Academy players are excluded — neither can be slotted into a lineup.
        </p>
      </div>
    </section>
  );
}

// ── Read-only club pitch ───────────────────────────────────────────────────

function boardPlayer(entry: SquadEntry): FormationBoardPlayer {
  const player = entry.player;
  return {
    id: player.id,
    name: getPlayerDisplayName(player, 'initial_last'),
    club: player.pl_team,
    photoUrl: player.photo_url,
    photoVersion: player.photo_version,
    headTopPct: player.portrait_head_top_pct,
    headWidthPct: player.portrait_head_width_pct,
    detail: player.market_value ? `£${player.market_value}M` : null,
  };
}

function matchesSlot(entry: SquadEntry, slot: GranularPosition): boolean {
  return entry.player.primary_position === slot || (entry.player.secondary_positions ?? []).includes(slot);
}

function pitchDepth(
  starters: { playerId: string; slot: GranularPosition }[],
  entries: SquadEntry[],
  byPlayerId: Map<string, SquadEntry>,
  scores: Record<string, number>,
): FormationBoardSlot[] {
  const starterIds = new Set(starters.map((starter) => starter.playerId));
  const available = entries
    .filter((entry) => ['active', 'bench', 'loan_in'].includes(entry.status) && !starterIds.has(entry.player.id))
    .sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0));

  // 1. Calculate candidate scarcity per unique position in formation
  const starterPositions = starters.map((s) => s.slot);
  const uniquePositions = Array.from(new Set(starterPositions));
  const poolCount: Record<string, number> = {};
  for (const pos of uniquePositions) {
    poolCount[pos] = available.filter((e) => matchesSlot(e, pos)).length;
  }

  // 2. Sort available bench players by their most constrained position (lowest poolCount), then by score
  const benchSorted = [...available].sort((a, b) => {
    const aMinPool = Math.min(...uniquePositions.filter((p) => matchesSlot(a, p)).map((p) => poolCount[p] ?? 99), 99);
    const bMinPool = Math.min(...uniquePositions.filter((p) => matchesSlot(b, p)).map((p) => poolCount[p] ?? 99), 99);
    if (aMinPool !== bMinPool) return aMinPool - bMinPool;
    return (scores[b.id] ?? 0) - (scores[a.id] ?? 0);
  });

  // 3. Assign each bench player to AT MOST ONE starter slot that needs them most
  const assignedBySlot = new Map<number, SquadEntry[]>();
  starters.forEach((_, idx) => assignedBySlot.set(idx, []));

  for (const benchPlayer of benchSorted) {
    const eligibleSlotIndices = starters
      .map((s, idx) => ({ s, idx }))
      .filter(({ s }) => matchesSlot(benchPlayer, s.slot));

    if (eligibleSlotIndices.length === 0) continue;

    // Prioritize slots with the fewest currently assigned depth players,
    // breaking ties by position scarcity (poolCount)
    eligibleSlotIndices.sort((a, b) => {
      const aCount = assignedBySlot.get(a.idx)!.length;
      const bCount = assignedBySlot.get(b.idx)!.length;
      if (aCount !== bCount) return aCount - bCount;
      return (poolCount[a.s.slot] ?? 99) - (poolCount[b.s.slot] ?? 99);
    });

    const targetSlotIndex = eligibleSlotIndices[0].idx;
    assignedBySlot.get(targetSlotIndex)!.push(benchPlayer);
  }

  return starters.map((starter, idx) => {
    const entry = byPlayerId.get(starter.playerId);
    const assigned = assignedBySlot.get(idx) ?? [];

    return {
      slot: starter.slot,
      player: entry ? boardPlayer(entry) : null,
      depth: assigned.map(boardPlayer),
    };
  });
}

export function ClubPitch({
  entries, savedLineup, selId, onSelect,
}: {
  entries: SquadEntry[];
  savedLineup: ClubProps['savedLineup'];
  selId: string | null;
  onSelect: (id: string) => void;
}) {
  const [mode, setMode] = useState<'projected' | 'saved'>('projected');
  const [selectedFormation, setSelectedFormation] = useState<Formation | null>(null);

  const availableFormations = useMemo(() => {
    const list = formationReport(entries);
    return new Map<Formation, boolean>(list.map((f: { name: Formation; ok: boolean }) => [f.name, f.ok]));
  }, [entries]);

  const projected = useMemo(
    () => projectedLineup(entries, selectedFormation),
    [entries, selectedFormation],
  );
  const scores = useMemo(() => projectedScores(entries), [entries]);
  const byPlayerId = useMemo(() => new Map(entries.map((entry) => [entry.player.id, entry])), [entries]);
  const saved: MatchupLineup | null = savedLineup?.lineup ?? null;

  const starters = useMemo<{ playerId: string; slot: GranularPosition }[]>(
    () => mode === 'saved' && saved
      ? saved.starters.map((starter) => ({
          playerId: starter.player_id ?? (starter as unknown as { playerId: string }).playerId,
          slot: starter.slot,
        }))
      : projected?.starters ?? [],
    [mode, projected, saved],
  );

  const boardSlots = useMemo(
    () => pitchDepth(starters, entries, byPlayerId, scores),
    [starters, entries, byPlayerId, scores],
  );

  const activeFormation = mode === 'saved' ? saved?.formation : (selectedFormation ?? projected?.formation);
  const modeLabel = mode === 'saved'
    ? saved ? `Saved Lineup · GW${savedLineup?.gameweek}` : 'No Saved Lineup'
    : projected ? 'Projected XI · matchday outlook' : 'No legal XI';

  return (
    <section className={`${styles.panel} ${styles.clubPitch} g-panel`} aria-label="Squad Pitch">
      <div className={styles.pitchHead}>
        <div>
          <h2 className={styles.panelTitle}>Squad Pitch</h2>
          <p className={styles.pitchCaption}>{modeLabel}{activeFormation ? ` · ${activeFormation}` : ''}</p>
        </div>
        <div className={styles.pitchMode} role="group" aria-label="Pitch mode">
          <button
            type="button"
            className={mode === 'projected' ? styles.pitchModeOn : undefined}
            aria-pressed={mode === 'projected'}
            onClick={() => setMode('projected')}
          >
            Projected XI
          </button>
          <button
            type="button"
            className={mode === 'saved' ? styles.pitchModeOn : undefined}
            aria-pressed={mode === 'saved'}
            onClick={() => setMode('saved')}
          >
            Saved Lineup
          </button>
        </div>
      </div>

      {mode === 'projected' && (
        <div className={styles.formationBar}>
          <span className={styles.formationBarLabel}>Formation:</span>
          <div className={styles.formationPills} role="group" aria-label="Select formation">
            <button
              type="button"
              className={`${styles.formationPill} ${selectedFormation === null ? styles.formationPillActive : ''}`}
              onClick={() => setSelectedFormation(null)}
            >
              Auto ({projected?.formation ?? 'Best'})
            </button>
            {ALL_FORMATIONS.map((f) => {
              const isFeasible = availableFormations.get(f) ?? true;
              const isActive = (selectedFormation ?? projected?.formation) === f;
              return (
                <button
                  key={f}
                  type="button"
                  className={`${styles.formationPill} ${isActive ? styles.formationPillActive : ''}`}
                  onClick={() => setSelectedFormation(f)}
                  disabled={!isFeasible}
                  title={!isFeasible ? 'Squad lacks eligible players for this formation' : undefined}
                >
                  {f}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className={styles.clubPitchField}>
        <ReadOnlyFormationBoard
          formation={activeFormation}
          slots={boardSlots}
          ariaLabel={`${modeLabel}${activeFormation ? ` in a ${activeFormation}` : ''}`}
          emptyLabel={mode === 'saved' ? 'No saved lineup has been submitted yet. Switch to Projected XI to view the recommended matchday side.' : 'This squad cannot make a legal XI yet.'}
          selectedPlayerId={entries.find((entry) => entry.id === selId)?.player.id}
          onSelectPlayer={(playerId) => {
            const entry = byPlayerId.get(playerId);
            if (entry) onSelect(entry.id);
          }}
          variant="deck"
        />
      </div>
    </section>
  );
}

// ── Gallery ─────────────────────────────────────────────────────────────────

export function Gallery({ entries, selId, onSelect }: { entries: SquadEntry[]; selId: string | null; onSelect: (id: string) => void }) {
  return (
    <section className={`${styles.panel} g-panel`}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Squad</h2>
        <span className="g-label">{entries.length} players</span>
      </div>
      <div className={styles.grid}>
        {entries.map((e) => <TileGallery key={e.id} e={e} sel={e.id === selId} onClick={() => onSelect(e.id)} />)}
      </div>
    </section>
  );
}

// ── Table ───────────────────────────────────────────────────────────────────

export function SquadTable({ entries, selId, onSelect }: { entries: SquadEntry[]; selId: string | null; onSelect: (id: string) => void }) {
  return (
    <section className={`${styles.panel} g-panel`}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Squad</h2>
        <span className="g-label">{entries.length} players</span>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.tbl}>
          <thead>
            <tr>
              <th className={styles.posCol}>Pos</th><th>Player</th><th>Club</th>
              <th className={styles.num}>Value</th><th className={styles.num}>Pts</th>
              <th className={styles.num}>PPG</th><th className={styles.num}>Age</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const p = e.player;
              const age = ageOf(p.date_of_birth);
              return (
                <tr
                  key={e.id}
                  /* The position hue on hover only, which is the one place a
                     squad list is allowed to teach the taxonomy. A whole-squad
                     table is exactly the surface `.g-row` was written for. */
                  className={`g-row ${e.id === selId ? styles.trSel : ''}`}
                  style={{ ['--pf' as string]: p.primary_position ? posColor(p.primary_position) : 'var(--color-border-subtle)' }}
                  onClick={() => onSelect(e.id)}
                >
                  <td><PosBadge pos={p.primary_position} /></td>
                  <td className={styles.nm}>
                    {getPlayerDisplayName(p, 'full')} <InjuryTag player={p} status={e.status} hideOnIr />
                    {e.listing && <span className={styles.miniTag}>Listed</span>}
                    {e.isPendingDrop && <span className={`${styles.miniTag} ${styles.miniTagWarn}`}>Drop queued</span>}
                  </td>
                  <td className={styles.tdMuted}>{p.pl_team}</td>
                  <td className={styles.num}>{money(valueOf(e))}</td>
                  <td className={styles.num}>{seasonPts(e)}</td>
                  <td className={styles.num}>{ppgOf(e).toFixed(2)}</td>
                  <td className={styles.num}>{age ?? '—'}</td>
                  <td><StatusTag status={e.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
