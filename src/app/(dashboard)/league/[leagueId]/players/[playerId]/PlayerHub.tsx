import Portrait from '@/components/players/Portrait';
import PositionBadge from '@/components/players/PositionBadge';
import NavigationLink from '@/components/ui/NavigationLink';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import type { GranularPosition } from '@/types';
import type { PlayerHubData } from '@/lib/players/hubData';
import styles from './playerHub.module.css';

/**
 * The player hub: two layers, never blended.
 *
 * The football layer (serif, prose) is who this footballer is — real-world
 * only, and portable back to Futbolpedia. The league layer (condensed labels
 * over mono figures, recessed ground) is what he is worth in this league. They
 * are separated by typographic register rather than decoration, and each panel
 * says which it is, because reading a Gaffa number as a football claim is the
 * failure this page exists to prevent.
 */

const QUALITY_LABEL: Record<string, string> = {
  elite: 'Elite',
  high: 'High',
  solid: 'Solid',
  squad: 'Squad',
};

const FACET_LABEL: Record<string, string> = {
  nailed: 'Nailed',
  likely_starter: 'Likely starter',
  rotation_risk: 'Rotation risk',
  fringe: 'Fringe',
  emerging: 'Emerging',
  peak: 'Peak',
  plateau: 'Plateau',
  decline_risk: 'Decline risk',
  unknown: 'Unknown',
  cornerstone: 'Cornerstone',
  long_term_hold: 'Long-term hold',
  win_now: 'Win now',
  declining_asset: 'Declining asset',
  stable: 'Stable',
  recent_pl_arrival: 'New to the league',
  linked_exit: 'Linked with an exit',
  confirmed_exit: 'Leaving',
  linked_pl_move: 'Linked with a move',
  injury_prone: 'Injury prone',
  minutes_competition: 'Minutes competition',
  contract_year: 'Contract year',
  tactical_misfit: 'Tactical misfit',
  penalties: 'Penalties',
  direct_free_kicks: 'Direct free kicks',
  corners_wide: 'Corners',
};

function humanise(value: string): string {
  return FACET_LABEL[value] ?? value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function Facet({ k, v, lead = false }: { k: string; v: string; lead?: boolean }) {
  return (
    <span className={`${styles.facet} ${lead ? styles.facetLead : ''}`}>
      <span className={`g-label-quiet ${styles.facetKey}`}>{k}</span>
      <span className={styles.facetValue}>{v}</span>
    </span>
  );
}

function num(value: number | null | undefined, digits = 2): string {
  return value == null ? '—' : value.toFixed(digits);
}

export default function PlayerHub({
  leagueId,
  leagueName,
  data,
}: {
  leagueId: string;
  leagueName: string;
  data: PlayerHubData;
}) {
  const { player, football, league, availableSeasons, season, seasonClub } = data;
  const isCurrentSeason = season === availableSeasons[0];
  const { report, form } = football;
  const displayName = getPlayerDisplayName(player, 'full');
  const secondary = (player.secondary_positions ?? []) as GranularPosition[];

  return (
    <div className={styles.root}>
      <div className={styles.topRow}>
        <div className={`g-label ${styles.kicker}`}>
        {/* The players index is the next slice; until it exists this returns
            to the stats table, which is the surface players are found on. */}
          <NavigationLink href={`/league/${leagueId}/stats`}>{leagueName} players</NavigationLink>
        </div>

        {availableSeasons.length > 1 && (
          <nav className={styles.seasons} aria-label="Season">
            {availableSeasons.map((s) => (
              <NavigationLink
                key={s}
                href={`/league/${leagueId}/players/${player.id}?season=${s}`}
                className={`${styles.seasonTab} ${s === season ? styles.seasonTabOn : ''}`}
                aria-current={s === season ? 'page' : undefined}
              >
                {s.replace('-', '/')}
              </NavigationLink>
            ))}
          </nav>
        )}
      </div>

      {/* --- identity --- */}
      <header className={styles.identity}>
        <Portrait
          photoUrl={player.photo_url}
          name={displayName}
          club={player.pl_team}
          size="lg"
          headTopPct={player.portrait_head_top_pct}
          headWidthPct={player.portrait_head_width_pct}
          photoVersion={player.photo_version}
        />

        <div className={styles.identityMain}>
          <div className={`g-namerow ${styles.badgeRow}`}>
            <PositionBadge position={player.primary_position as GranularPosition} />
            {secondary.map((pos) => (
              <PositionBadge key={pos} position={pos} size="sm" />
            ))}
            {report && (
              <span className={`${styles.quality} ${styles[`q_${report.quality}`]}`}>
                {QUALITY_LABEL[report.quality] ?? report.quality}
              </span>
            )}
          </div>

          <h1 className={styles.name}>{displayName}</h1>

          <div className={styles.metaRow}>
            <span>{player.pl_team}</span>
            {player.nationality && (
              <>
                <i className={styles.dot} />
                <span>{player.nationality}</span>
              </>
            )}
          </div>
        </div>

        <div className={styles.identitySide}>
          <div className="g-label-quiet">{league.ownership ? 'Rostered' : 'Status'}</div>
          <div className={styles.sideValue}>
            {league.ownership?.owner.teamName ?? 'Free agent'}
          </div>
          <div className={`g-label-quiet ${styles.sideGap}`}>Market value</div>
          <div className={`${styles.sideValue} ${styles.mono}`}>
            {player.market_value != null ? `€${Number(player.market_value).toFixed(1)}m` : '—'}
          </div>
        </div>
      </header>

      <div className={styles.columns}>
        {/* ================= FOOTBALL LAYER ================= */}
        <div className={styles.stack}>
          <section className="g-panel">
            <div className="g-panel-hd">
              <span className="g-label">Scouting report</span>
              <span className={styles.rubric}>what kind of footballer he is</span>
              <span className={styles.headMeta}>
                {report
                  ? `Futbolpedia · ${new Date(report.generatedAt).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                    })}`
                  : 'Not yet written'}
              </span>
            </div>

            <div className={styles.panelBody}>
              {report && !isCurrentSeason && (
                /* An outlook is a judgment about the player NOW. It has no
                   historical version, so viewing an older season must not make
                   it look like it describes that season. */
                <p className={styles.pinNote}>
                  This report describes the player today, not{' '}
                  {season.replace('-', '/')}. The figures below are{' '}
                  {season.replace('-', '/')}.
                </p>
              )}
              {report ? (
                <>
                  <div className={styles.facets}>
                    <Facet k="Minutes" v={humanise(report.minutes_role)} lead />
                    <Facet k="Dynasty" v={humanise(report.dynasty_value)} lead />
                    <Facet k="Phase" v={humanise(report.career_phase)} />
                    <Facet k="Mobility" v={humanise(report.pl_mobility)} />
                    {report.style.slice(0, 3).map((s) => (
                      <Facet key={s} k="Style" v={humanise(s)} />
                    ))}
                    {report.risk_flags.map((r) => (
                      <Facet key={r} k="Watch" v={humanise(r)} />
                    ))}
                  </div>

                  <p className={styles.outlook}>{report.outlook}</p>

                  <div className={styles.source}>
                    <span className="g-label-quiet">
                      Confidence: {report.confidence}
                      {report.evidence_gaps.length > 0
                        ? ` · ${report.evidence_gaps.length} unresolved gap${report.evidence_gaps.length === 1 ? '' : 's'}`
                        : ' · no unresolved evidence gaps'}
                    </span>
                    {report.fromFallback && (
                      <span className="g-label-quiet">Computed from record — not yet scouted</span>
                    )}
                  </div>
                </>
              ) : (
                <p className={styles.empty}>
                  No scouting report for this player yet. His record and league figures are below.
                </p>
              )}
            </div>
          </section>

          {form && (
            <section className="g-panel">
              <div className="g-panel-hd">
                <span className="g-label">Real-world form</span>
                <span className={styles.rubric}>Premier League output, not league scoring</span>
                <span className={styles.headMeta}>
                  {form.season.replace('-', '/')}
                  {seasonClub && seasonClub !== player.pl_team ? ` · ${seasonClub}` : ''} ·{' '}
                  {form.appearances} apps
                </span>
              </div>

              <div className={styles.panelBody}>
                <div className={styles.statGrid}>
                  <div className={styles.statCell}>
                    <div className={styles.statValue}>{form.minutes.toLocaleString()}</div>
                    <div className="g-label-quiet">Minutes</div>
                    <div className={styles.statSub}>
                      {form.starts} starts of {form.appearances}
                    </div>
                  </div>
                  <div className={styles.statCell}>
                    <div className={styles.statValue}>
                      {form.startRate == null ? '—' : `${Math.round(form.startRate * 100)}%`}
                    </div>
                    <div className="g-label-quiet">Start rate</div>
                    <div className={styles.statSub}>when available</div>
                  </div>
                  <div className={styles.statCell}>
                    <div className={styles.statValue}>{form.goalContributions}</div>
                    <div className="g-label-quiet">Goals + assists</div>
                    <div className={styles.statSub}>{num(form.xgiPer90)} xGI per 90</div>
                  </div>
                  <div className={styles.statCell}>
                    <div className={styles.statValue}>
                      {form.setPieces.length > 0 ? form.setPieces.length : '—'}
                    </div>
                    <div className="g-label-quiet">Set-piece duties</div>
                    <div className={styles.statSub}>
                      {form.setPieces.length > 0
                        ? form.setPieces.map(humanise).join(' · ')
                        : 'none listed'}
                    </div>
                  </div>
                </div>

                {form.xgiPercentile != null ? (
                  <div className={styles.percentile}>
                    <div className={styles.percentileHead}>
                      <span className="g-label-quiet">
                        Expected goal involvement, against his position
                      </span>
                      <span className={styles.percentileValue}>
                        {Math.round(form.xgiPercentile * 100)}th percentile
                      </span>
                    </div>
                    <div className="g-track">
                      <i style={{ width: `${Math.round(form.xgiPercentile * 100)}%` }} />
                    </div>
                  </div>
                ) : (
                  /* Elite centre-backs rank near the bottom of attacking output;
                     ranking them on it would invert what the position is for. */
                  <p className={styles.note}>
                    Attacking output is not how this position is judged, so it is not ranked here.
                  </p>
                )}
              </div>
            </section>
          )}
        </div>

        {/* ================= LEAGUE LAYER ================= */}
        <aside className={styles.stack}>
          <section className={`g-panel ${styles.ledger}`}>
            <div className="g-panel-hd">
              <span className="g-label">In your league</span>
              <span className={styles.headMeta}>Gaffa scoring</span>
            </div>

            <div className={styles.panelBody}>
              <p className={styles.rubricBlock}>
                What he is worth in {leagueName} — league scoring, not a football judgment.
              </p>

              <div className={styles.bigStat}>
                <span className={styles.bigStatValue}>{num(league.points)}</span>
                <span className="g-label-quiet">points · {league.season.replace('-', '/')}</span>
              </div>

              <div className={styles.ledgerRow}>
                <span className="g-label-quiet">Per game</span>
                <span className={styles.mono}>{num(league.pointsPerGame)}</span>
              </div>
              <div className={styles.ledgerRow}>
                <span className="g-label-quiet">Avg rating</span>
                <span className={styles.mono}>{num(league.averageRating)}</span>
              </div>
              <div className={styles.ledgerRow}>
                <span className="g-label-quiet">Games played</span>
                <span className={styles.mono}>{league.gamesPlayed}</span>
              </div>

              <div className={styles.separator}>
                <span className="g-label-quiet">Ownership</span>
                <i />
              </div>
              <div className={styles.ledgerRow}>
                <span className="g-label-quiet">Manager</span>
                <span className={styles.ledgerText}>
                  {league.ownership?.owner.teamName ?? 'Free agent'}
                </span>
              </div>
              {league.ownership?.loanedTo && (
                <div className={styles.ledgerRow}>
                  <span className="g-label-quiet">On loan at</span>
                  <span className={styles.ledgerText}>{league.ownership.loanedTo.teamName}</span>
                </div>
              )}

              <p className={styles.note}>
                League figures come from Gaffa&apos;s scoring engine and never feed the scouting
                report.
              </p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
