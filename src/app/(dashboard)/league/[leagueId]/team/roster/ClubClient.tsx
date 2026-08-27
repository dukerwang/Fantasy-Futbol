'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import CrestBadge from '@/components/crest/CrestBadge';
import Trophy from '@/components/trophies/Trophy';
import NavigationLink from '@/components/ui/NavigationLink';
import type { ClubProps, SquadEntry } from '@/lib/teams/loadClubView';
import ClubSwitcher from './ClubSwitcher';
import { DepthChart, Gallery, SquadTable } from './SquadViews';
import Inspector from './Inspector';
import Intel from './Intel';
import RetainedList from './RetainedList';
import DepartureDecisionModal, { type DecisionRequest } from '@/components/teams/DepartureDecisionModal';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import {
  money, ageOf, overallScores, squadTotals,
  avgForm, seasonPts, ppgOf, valueOf, countdown,
} from './clubDerive';
import styles from './club.module.css';

// ── Shared prop types ────────────────────────────────────────────────────────
// Declared alongside the loader that produces them (`@/lib/teams/loadClubView`)
// and re-exported here, because this file's children have always imported them
// from './ClubClient' and there is no reason for them to care where a type moved.

export type {
  SquadListing,
  SquadEntry,
  DepartureView,
  ClubProps,
} from '@/lib/teams/loadClubView';

// ── Toolbar option sets ──────────────────────────────────────────────────────

const VIEWS = [
  { k: 'depth', label: 'Depth chart' },
  { k: 'gallery', label: 'Gallery' },
  { k: 'table', label: 'Table' },
];
const FILTERS: { k: string; label: string }[] = [
  { k: 'all', label: 'Whole squad' },
  { k: 'active', label: 'First XI' },
  { k: 'bench', label: 'Bench' },
  { k: 'taxi', label: 'Academy' },
  { k: 'ir', label: 'Injured Reserve' },
  { k: 'loan_in', label: 'Loans in' },
  { k: 'loan_out', label: 'Loans out' },
];
const SORTS = [
  { k: 'overall', label: 'Overall' },
  { k: 'pts', label: 'Total points' },
  { k: 'value', label: 'Market value' },
  { k: 'ppg', label: 'Points per game' },
  { k: 'form', label: 'Form' },
  { k: 'age', label: 'Age' },
  { k: 'name', label: 'Name' },
];

interface TodoItem {
  group: 'decision' | 'squad';
  subject: string;
  detail: string;
  when?: string | null;
  act: string;
  decision?: DecisionRequest;
  entryId?: string;
}

function buildTodos(serverNow: string, entries: SquadEntry[], departures: ClubProps['departures'], academyAgeLimit: number): TodoItem[] {
  const out: TodoItem[] = [];

  departures.pending.forEach((d) =>
    out.push({
      group: 'decision', subject: getPlayerDisplayName({ name: d.name, web_name: d.webName }, 'initial_last'), detail: 'left the Premier League',
      when: countdown(serverNow, d.decideBy), act: 'Decide', decision: { mode: 'decide', dep: d },
    }),
  );
  departures.held.filter((d) => d.status === 'return_pending').forEach((d) =>
    out.push({
      group: 'decision', subject: getPlayerDisplayName({ name: d.name, web_name: d.webName }, 'initial_last'), detail: 'is back in the Premier League',
      when: countdown(serverNow, d.reinstateBy), act: 'Reinstate', decision: { mode: 'reinstate', dep: d },
    }),
  );

  const onRoster = new Set(['active', 'bench', 'loan_in']);
  entries.forEach((e) => {
    const s = e.player.fpl_status;
    if (onRoster.has(e.status) && (s === 'i' || s === 'd' || s === 'u')) {
      out.push({
        group: 'squad', subject: getPlayerDisplayName(e.player, 'initial_last'),
        detail: (s === 'd' ? 'is doubtful' : 'is injured') + ' — not on IR',
        act: 'Review', entryId: e.id,
      });
    }
  });
  entries.forEach((e) => {
    const age = ageOf(e.player.date_of_birth);
    if (e.status === 'taxi' && age != null && age >= academyAgeLimit) {
      out.push({
        group: 'squad', subject: getPlayerDisplayName(e.player, 'initial_last'),
        detail: 'ages out of the Academy at reset', act: 'Review', entryId: e.id,
      });
    }
  });

  return out;
}

// ── To-do control (compact toolbar button + bounded popover) ─────────────────

function ToDo({ items, onAct }: { items: TodoItem[]; onAct: (t: TodoItem) => void }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;

  const decisions = items.filter((n) => n.group === 'decision');
  const squad = items.filter((n) => n.group !== 'decision');
  const urgent = decisions.length > 0;

  const act = (n: TodoItem) => { onAct(n); setOpen(false); };
  const render = (list: TodoItem[]) =>
    list.map((n, i) => (
      <div className={styles.todoRow} key={i}>
        <span className={styles.todoText}>
          <b>{n.subject}</b> {n.detail}
          {n.when && <span className={styles.todoWhen}> · {n.when} left</span>}
        </span>
        <button className={styles.todoAct} onClick={() => act(n)}>{n.act}</button>
      </div>
    ));

  return (
    <div className={styles.todo}>
      <button
        type="button"
        className={`${styles.todoBtn} ${urgent ? styles.todoBtnUrgent : ''} ${open ? styles.todoBtnOpen : ''}`}
        onClick={() => setOpen(!open)}
      >
        To-do <span className={styles.todoBadge}>{items.length}</span>
      </button>
      {open && (
        <>
          <div className={styles.todoScrim} onClick={() => setOpen(false)} />
          <div className={styles.todoPop} role="dialog" aria-label="To-do">
            {decisions.length > 0 && (
              <div className={styles.todoGrp}>
                <div className={styles.todoGrpH}>Decisions</div>
                {render(decisions)}
              </div>
            )}
            {squad.length > 0 && (
              <div className={styles.todoGrp}>
                <div className={styles.todoGrpH}>Squad</div>
                {render(squad)}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ClubClient({
  leagueId, teamId, serverNow, clubs, viewerIsOwner, club, standing, entries, departures, honours,
}: ClubProps) {
  const router = useRouter();
  const [view, setView] = useState('depth');
  const [sort, setSort] = useState('overall');
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(
    () => (entries.find((e) => e.status === 'active') ?? entries[0])?.id ?? null,
  );
  const [decision, setDecision] = useState<DecisionRequest | null>(null);

  useEffect(() => {
    const v = typeof window !== 'undefined' ? localStorage.getItem('club-view') : null;
    if (v && VIEWS.some((x) => x.k === v)) setView(v);
  }, []);
  function chooseView(v: string) {
    setView(v);
    try { localStorage.setItem('club-view', v); } catch { /* ignore */ }
  }

  const trophyCount = honours.reduce((n, g) => n + g.count, 0);

  const overall = useMemo(() => overallScores(entries), [entries]);
  const totals = useMemo(() => squadTotals(entries), [entries]);

  const sorters: Record<string, (a: SquadEntry, b: SquadEntry) => number> = {
    overall: (a, b) => overall[b.id] - overall[a.id],
    pts: (a, b) => seasonPts(b) - seasonPts(a),
    value: (a, b) => valueOf(b) - valueOf(a),
    ppg: (a, b) => ppgOf(b) - ppgOf(a),
    form: (a, b) => avgForm(b.form) - avgForm(a.form),
    age: (a, b) => (ageOf(a.player.date_of_birth) ?? 99) - (ageOf(b.player.date_of_birth) ?? 99),
    name: (a, b) => (a.player.name ?? '').localeCompare(b.player.name ?? ''),
  };

  const shown = useMemo(() => {
    const base = filter === 'all' ? entries.slice() : entries.filter((e) => e.status === filter);
    return base.sort(sorters[sort]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, filter, sort, overall]);

  const selected = entries.find((e) => e.id === selectedId) ?? null;
  // A to-do list is a list of things YOU must act on. On a rival's club it
  // would be a list of things you can see but can't touch — worse than absent.
  const todos = useMemo(
    () => (viewerIsOwner ? buildTodos(serverNow, entries, departures, club.academyAgeLimit) : []),
    [viewerIsOwner, entries, departures, club.academyAgeLimit],
  );

  function handleTodo(n: TodoItem) {
    if (n.decision) setDecision(n.decision);
    else if (n.entryId) setSelectedId(n.entryId);
  }

  return (
    <div className={`${styles.shell} ${styles.page} g-page`}>
      {/* ── Masthead ── */}
      {/* The masthead is a bounded OBJECT, not a page section: crest, club name,
          record, the club switcher and four figures are one identity card, and
          its internal hairlines and column rules were drawn to terminate inside
          a container. Flattening it (design-system rework, 2026-08-20) left
          those rules running into nothing and the block open on three sides,
          with a 2px ink rule at the bottom doing all the containment by itself.
          The rework's own spec keeps `.g-panel` for "small, distinct units …
          bounded objects, not page containers" — this is one. */}
      <header className={`${styles.masthead} g-panel`}>
        <div className={styles.mhTop}>
          <div className={styles.mhCrest}>
            <CrestBadge
              config={club.crestConfig ?? undefined}
              teamName={club.name}
              teamId={teamId}
              size={68}
              href={viewerIsOwner ? `/league/${leagueId}/crest` : undefined}
            />
          </div>
          <div className={styles.mhTitles}>
            {/* No "My Club" / "Club" prefix here — the club's name is the
                headline directly below and the manager is the line under that,
                so a label naming the kind of thing you're looking at was just
                repeating the page back at itself. */}
            <div className="g-label">{club.season} · {club.leagueName}</div>
            <h1 className={styles.mhClub}>{club.name}</h1>
            <div className={styles.mhMeta}>
              <span>{club.manager}</span>
              {viewerIsOwner && <span className={styles.mhYou}>You</span>}
              {standing.rank != null && (
                <>
                  <span className={styles.mhDot}>·</span>
                  <span className={styles.mhRank}>{ordinal(standing.rank)}</span>
                  <span>of {standing.ofTeams}</span>
                </>
              )}
              <span className={styles.mhDot}>·</span>
              <span className={styles.mhRecord}>{standing.w}W · {standing.d}D · {standing.l}L</span>
            </div>

            {/* One pip per TROPHY, not per competition — if each win is its own
                object then four of them should look like four.

                The link is ALWAYS here, even with nothing to show. It used to be
                hidden when the cabinet was empty, on the reasoning that a row
                reading "no trophies" is worse than the space it takes. True, but
                it made the cabinet unreachable for every club that had not won
                anything — which, until a season completes, is every club in the
                league. The pips carry the flex; the link carries the way in. */}
            <NavigationLink
              href={`/league/${leagueId}/clubs/${teamId}/honours`}
              className={styles.mhHonours}
            >
              {honours.flatMap((g) =>
                g.seasons.map((season) => (
                  <Trophy key={`${g.kind}-${season}`} kind={g.kind} size="pip" />
                )),
              )}
              <span className={styles.mhHonoursCount}>
                {trophyCount === 0
                  ? 'Honours'
                  : trophyCount === 1
                    ? '1 trophy'
                    : `${trophyCount} trophies`}
              </span>
            </NavigationLink>
          </div>

          {/* On a rival's club the masthead is also the exit: the reason you
              came to look at someone's squad is almost always to deal for part
              of it. Moving to the next club is the switcher's job, below. */}
          {!viewerIsOwner && (
            <div className={styles.mhActions}>
              <NavigationLink
                href={`/league/${leagueId}/transfers/deals?proposeTeam=${teamId}`}
                className={styles.mhCta}
              >
                Propose a deal
              </NavigationLink>
            </div>
          )}
        </div>

        <ClubSwitcher leagueId={leagueId} clubs={clubs} currentTeamId={teamId} />

        <div className={styles.figs}>
          <Fig label="Club Balance" value={money(club.balance)} sub="Available to spend" />
          <Fig label="Squad value" value={money(totals.value)} sub={`${entries.length} players under contract`} />
          <Fig
            label="Points for"
            value={standing.pointsFor.toLocaleString('en-GB')}
            sub={standing.pointsForRank ? `${ordinal(standing.pointsForRank)}-most · GW${club.gw}` : `GW${club.gw}`}
          />
          <Fig
            label="Squad age"
            value={totals.avgAge ? totals.avgAge.toFixed(1) : '—'}
            sub={`${totals.buckets[0].n} under 21 · ${totals.buckets[2].n + totals.buckets[3].n} over 26`}
          />
        </div>
      </header>

      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
        <div className={styles.seg}>
          {VIEWS.map((v) => (
            <button
              key={v.k}
              type="button"
              className={`${styles.segBtn} ${view === v.k ? styles.segBtnOn : ''}`}
              onClick={() => chooseView(v.k)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <span className={styles.tbLabel}>{shown.length} of {entries.length} shown</span>
        <div className={styles.tbSpacer} />

        <ToDo items={todos} onAct={handleTodo} />

        <div className={styles.tbGroup}>
          <span className={styles.tbLabel}>Show</span>
          <select className={styles.tbSelect} value={filter} onChange={(e) => setFilter(e.target.value)}>
            {FILTERS.map((f) => <option key={f.k} value={f.k}>{f.label}</option>)}
          </select>
        </div>
        <div className={styles.tbGroup}>
          <span className={styles.tbLabel}>Sort</span>
          <select className={styles.tbSelect} value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {/* ── Layout ── */}
      <div className={styles.layout}>
        <main>
          {view === 'depth' && <DepthChart entries={shown} allEntries={entries} selId={selectedId} onSelect={setSelectedId} />}
          {view === 'gallery' && <Gallery entries={shown} selId={selectedId} onSelect={setSelectedId} />}
          {view === 'table' && <SquadTable entries={shown} selId={selectedId} onSelect={setSelectedId} />}
          <RetainedList
            leagueId={leagueId}
            teamId={teamId}
            serverNow={serverNow}
            departures={departures}
            viewerIsOwner={viewerIsOwner}
            onDecision={setDecision}
          />
          <Intel entries={entries} totals={totals} />
        </main>

        <div className={styles.rail}>
          <Inspector
            entry={selected}
            teamId={teamId}
            leagueId={leagueId}
            viewerIsOwner={viewerIsOwner}
            academyAgeLimit={club.academyAgeLimit}
            onAfter={() => router.refresh()}
          />
        </div>
      </div>

      {decision && viewerIsOwner && (
        <DepartureDecisionModal
          req={decision}
          leagueId={leagueId}
          slots={departures.slots}
          rosterCount={entries.filter((e) => e.status !== 'ir' && e.status !== 'taxi' && e.status !== 'loan_in').length}
          rosterMax={club.rosterMax}
          onClose={() => setDecision(null)}
          onDone={() => { setDecision(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

function Fig({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className={styles.fig}>
      <div className="g-label">{label}</div>
      <div className={styles.figValue}>{value}</div>
      <div className={styles.figSub}>{sub}</div>
    </div>
  );
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
