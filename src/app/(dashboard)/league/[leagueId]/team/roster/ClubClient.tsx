'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import CrestBadge from '@/components/crest/CrestBadge';
import Trophy from '@/components/trophies/Trophy';
import NavigationLink from '@/components/ui/NavigationLink';
import type { ClubProps, SquadEntry } from '@/lib/teams/loadClubView';
import ClubSwitcher from './ClubSwitcher';
import { ClubPitch, DepthChart, SquadTable } from './SquadViews';
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
  { k: 'pitch', label: 'Pitch' },
  { k: 'depth', label: 'Depth chart' },
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

function CommandPicker({
  label, value, options, open, onToggle, onSelect,
}: {
  label: string;
  value: string;
  options: { k: string; label: string }[];
  open: boolean;
  onToggle: () => void;
  onSelect: (key: string) => void;
}) {
  const selected = options.find((option) => option.k === value)?.label ?? value;
  return (
    <div className={styles.commandPicker}>
      <button
        type="button"
        className={`${styles.commandTrigger} ${open ? styles.commandTriggerOpen : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={onToggle}
      >
        <span className={styles.commandLabel}>{label}</span>
        <span className={styles.commandValue}>{selected}</span>
        <span className={styles.commandChevron} aria-hidden>⌄</span>
      </button>
      {open && (
        <>
          <button type="button" className={styles.commandScrim} aria-label={`Close ${label} options`} onClick={onToggle} />
          <div className={styles.commandMenu} role="dialog" aria-label={`${label} options`}>
            <div className={styles.commandMenuHead}>
              <span>{label}</span>
              <button type="button" onClick={onToggle} aria-label={`Close ${label} options`}>Close</button>
            </div>
            <div className={styles.commandOptions}>
              {options.map((option) => (
                <button
                  key={option.k}
                  type="button"
                  className={option.k === value ? styles.commandOptionOn : undefined}
                  aria-pressed={option.k === value}
                  onClick={() => onSelect(option.k)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ClubClient({
  leagueId, teamId, serverNow, clubs, viewerIsOwner, club, standing, entries, savedLineup, departures, honours,
}: ClubProps) {
  const router = useRouter();
  const [view, setView] = useState('pitch');
  const [sort, setSort] = useState('overall');
  const [filter, setFilter] = useState('all');
  const [openCommand, setOpenCommand] = useState<'filter' | 'sort' | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => (entries.find((e) => e.status === 'active') ?? entries[0])?.id ?? null,
  );
  const [decision, setDecision] = useState<DecisionRequest | null>(null);

  // Below the layout's single-column breakpoint, the Inspector rail isn't a
  // sidebar any more — it's a sheet, so picking a card has to open it instead
  // of leaving it wherever it landed at the bottom of a long stacked page.
  const [narrow, setNarrow] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1080px)');
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!narrow || !inspectorOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setInspectorOpen(false); };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [narrow, inspectorOpen]);

  function selectEntry(id: string) {
    setSelectedId(id);
    setInspectorOpen(true);
  }

  useEffect(() => {
    try {
      const v = localStorage.getItem('gaffa:club-view') ?? localStorage.getItem('club-view');
      if (v && VIEWS.some((x) => x.k === v)) setView(v);

      const s = localStorage.getItem('gaffa:club-sort') ?? localStorage.getItem('club-sort');
      if (s && SORTS.some((x) => x.k === s)) setSort(s);

      const f = localStorage.getItem('gaffa:club-filter') ?? localStorage.getItem('club-filter');
      if (f && FILTERS.some((x) => x.k === f)) setFilter(f);
    } catch {
      /* ignore */
    }
  }, []);

  function chooseView(v: string) {
    setView(v);
    try {
      localStorage.setItem('gaffa:club-view', v);
      localStorage.setItem('club-view', v);
    } catch {
      /* ignore */
    }
  }

  function chooseSort(s: string) {
    setSort(s);
    try {
      localStorage.setItem('gaffa:club-sort', s);
      localStorage.setItem('club-sort', s);
    } catch {
      /* ignore */
    }
  }

  function chooseFilter(f: string) {
    setFilter(f);
    try {
      localStorage.setItem('gaffa:club-filter', f);
      localStorage.setItem('club-filter', f);
    } catch {
      /* ignore */
    }
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
    else if (n.entryId) selectEntry(n.entryId);
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
              href={`/league/${leagueId}/heritage/cabinets`}
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
        <div className={styles.tbSpacer} />

        <ToDo items={todos} onAct={handleTodo} />

        {view !== 'pitch' && (
          <div className={styles.toolbarData}>
            <span className={styles.tbLabel}>{shown.length} of {entries.length} shown</span>
            <CommandPicker
              label="Show"
              value={filter}
              options={FILTERS}
              open={openCommand === 'filter'}
              onToggle={() => setOpenCommand(openCommand === 'filter' ? null : 'filter')}
              onSelect={(key) => { chooseFilter(key); setOpenCommand(null); }}
            />
            <CommandPicker
              label="Sort"
              value={sort}
              options={SORTS}
              open={openCommand === 'sort'}
              onToggle={() => setOpenCommand(openCommand === 'sort' ? null : 'sort')}
              onSelect={(key) => { chooseSort(key); setOpenCommand(null); }}
            />
          </div>
        )}
      </div>

      {/* ── Layout ── */}
      <div className={styles.layout}>
        <main>
          {view === 'pitch' && <ClubPitch entries={entries} savedLineup={savedLineup} selId={selectedId} onSelect={selectEntry} />}
          {view === 'depth' && <DepthChart entries={shown} allEntries={entries} selId={selectedId} onSelect={selectEntry} />}
          {view === 'table' && <SquadTable entries={shown} selId={selectedId} onSelect={selectEntry} />}
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

        {/* Below 1080px this is a bottom sheet, not a sidebar — see the
            `narrow`/`inspectorOpen` state above. Tapping a card opens it right
            there instead of leaving the detail wherever the rail happens to
            fall in a stacked single-column page. */}
        {narrow && inspectorOpen && (
          <div className={styles.railScrim} onClick={() => setInspectorOpen(false)} />
        )}
        <div className={`${styles.rail} ${narrow && inspectorOpen ? styles.railOpen : ''}`}>
          {narrow && (
            <button
              type="button"
              className={styles.railClose}
              onClick={() => setInspectorOpen(false)}
              aria-label="Close player details"
            >
              ✕
            </button>
          )}
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
