const fs = require('fs');
const path = './src/app/(dashboard)/league/[leagueId]/page.tsx';
let code = fs.readFileSync(path, 'utf8');

const match = code.match(/\{\/\* ── Dashboard Grid ── \*\/\}([\s\S]*?)<\/div>\s*\{\/\* Leave League/);
if (!match) {
  console.log("Could not match the render block");
  process.exit(1);
}

// Prepare the new block
const newBlock = `{/* ── Dashboard Grid ── */}
      <div className={styles.bodyRow}>

        {/* ── Left Column (Column 1) ── */}
        <div className={styles.leftCol}>
          {/* Manager / FAAB */}
          <div className={styles.standingsCard}>
            <div className={styles.standingsHeading}>
              <span className={styles.sectionLabel}>MANAGER</span>
              <h2 className={styles.sectionTitle}>{myTeam?.team_name ?? 'Observer'}</h2>
              <div className={styles.standingsDivider} />
            </div>
            <div style={{ padding: '0 32px 32px 32px' }}>
              <span className={styles.sectionLabel}>FAAB BALANCE</span>
              <div style={{ fontSize: '2.5rem', fontWeight: 600, fontFamily: "var(--font-noto-serif)", color: "var(--color-accent-green)", marginTop: "8px" }}>
                £{myTeam?.faab_budget ?? 0}m
              </div>
            </div>
          </div>

          {/* Academy (Taxi Squad) */}
          <div className={styles.rightSection} style={{ marginTop: '24px' }}>
            <span className={styles.sectionLabel}>YOUTH SYSTEM</span>
            <h2 className={styles.sectionTitle}>The Academy</h2>
            {taxiSquad.length === 0 ? (
              <p className={styles.emptyHint}>No academy players.</p>
            ) : (
              <div className={styles.playerChips}>
                {taxiSquad.map((entry: any, i: number) => {
                  const player = entry.player;
                  return (
                    <div key={i} className={styles.playerChip} style={{ borderLeftColor: positionColor(player.primary_position) }}>
                      <div className={styles.chipLeft}>
                         <div className={styles.chipPhotoMount} style={{ borderColor: positionColor(player.primary_position) }}>
                          {player.photo_url ? (
                            <img src={player.photo_url} alt={player.web_name} className={styles.chipPhoto} />
                          ) : (
                            <span className={styles.chipPhotoFallback} aria-hidden>{(player.web_name ?? '?').charAt(0)}</span>
                          )}
                        </div>
                        <span className={styles.chipPosBadge} style={{ background: positionColor(player.primary_position) }}>
                          {player.primary_position}
                        </span>
                        <div className={styles.chipInfo}>
                          <span className={styles.chipName}>{formatPlayerName(player, 'full')}</span>
                          <span className={styles.chipClub}>{(player.pl_team ?? '').toUpperCase()}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className={styles.standingsFooter} style={{ marginTop: '24px' }}>
              <Link href={\`/league/\${leagueId}/team/roster\`} className={styles.cardLink}>Manage Roster →</Link>
            </div>
          </div>
        </div>

        {/* ── Center Column (Column 2) ── */}
        <div className={styles.centerCol}>
          {/* Matchup Hero */}
          {heroMatchup && heroState && (
            <div className={styles.heroCard}>
              <div className={styles.heroTeam}>
                <span className={styles.heroTeamName}>{userTeam?.team_name ?? '—'}</span>
                {userRecord && <span className={styles.heroRecord}>{userRecord}</span>}
              </div>
              <div className={styles.heroCenterBlock}>
                <span className={styles.heroCenterLabel}>YOUR FIXTURE · GW {heroMatchup.gameweek}</span>
                <div className={styles.heroScoreGroup}>
                  <span className={\`\${styles.heroScore} \${heroResult === 'win' || (heroState !== 'final' && (userScore ?? 0) > (oppScore ?? 0)) ? styles.heroScoreHighlight : ''}\`}>
                    {heroState === 'upcoming' ? '—' : (userScore?.toFixed(1) ?? '0.0')}
                  </span>
                  <span className={styles.heroScoreDivider}>-</span>
                  <span className={\`\${styles.heroScore} \${heroResult === 'loss' || (heroState !== 'final' && (oppScore ?? 0) > (userScore ?? 0)) ? styles.heroScoreHighlight : ''}\`}>
                    {heroState === 'upcoming' ? '—' : (oppScore?.toFixed(1) ?? '0.0')}
                  </span>
                </div>
                <div className={styles.heroBadgeBox}>
                  {heroState === 'live' && <span className={styles.heroBadgeLivePill}>● IN PROGRESS</span>}
                  {heroState === 'upcoming' && <span className={styles.heroBadgeUpcomingPill}>UPCOMING</span>}
                  {heroState === 'final' && heroResult === 'win' && <span className={styles.heroBadgeFinalWin}>{userTeam?.team_name} WIN</span>}
                  {heroState === 'final' && heroResult === 'loss' && <span className={styles.heroBadgeFinalLoss}>{oppTeam?.team_name} WIN</span>}
                  {heroState === 'final' && heroResult === 'draw' && <span className={styles.heroBadgeFinalDraw}>DRAW</span>}
                </div>
              </div>
              <div className={\`\${styles.heroTeam} \${styles.heroTeamRight}\`}>
                <span className={styles.heroTeamName}>{oppTeam?.team_name ?? '—'}</span>
                {oppRecord && <span className={styles.heroRecord}>{oppRecord}</span>}
              </div>
            </div>
          )}
          {!heroMatchup && league.status === 'active' && (
            <div className={styles.heroEmpty}>
              <p>No matchup results yet — check back after GW 1.</p>
            </div>
          )}

          {/* Transfer Gazette */}
          <div className={styles.gazette}>
            <div className={styles.gazetteHeader}>
              <span className={styles.breakingPill}>BREAKING</span>
              <h2 className={styles.gazetteTitle}>Transfer Gazette</h2>
              <span className={styles.gazetteEdition}>DAILY EDITION</span>
            </div>
            {activity.length === 0 ? (
              <p className={styles.emptyHint}>No activity yet this season.</p>
            ) : (
              <div className={styles.gazetteEntries}>
                {activity.map((tx: any) => {
                  const cat = txCategoryStyle(tx.type);
                  const teamName = (tx.team as any)?.team_name ?? 'Unknown';
                  const playerName = (tx.player as any)?.web_name ?? (tx.player as any)?.name ?? 'Unknown';
                  const faab = tx.faab_bid ? \` · £\${tx.faab_bid}m FAAB\` : '';
                  const note = tx.notes ? \` — \${tx.notes}\` : '';
                  return (
                    <div key={tx.id} className={styles.gazetteEntry}>
                      <span className={styles.gazetteCategory} style={{ background: cat.bg, color: cat.color }}>
                        {cat.label}
                      </span>
                      <p className={styles.gazetteText}>
                        <strong>{teamName}</strong>{' '}
                        {tx.type === 'trade' ? (
                          <>completed a trade{note}</>
                        ) : tx.type === 'drop' ? (
                          <>released <strong>{playerName}</strong>{note}</>
                        ) : (
                          <>signed <strong>{playerName}</strong>{faab}{note}</>
                        )}
                      </p>
                      <span className={styles.gazetteTime}>{timeAgo(tx.processed_at)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Right Column (Column 3) ── */}
        <div className={styles.rightCol}>
          
          {/* League Standings Card */}
          <div className={styles.standingsCard}>
            <div className={styles.standingsHeading}>
              <span className={styles.sectionLabel}>2025/26 SEASON</span>
              <h2 className={styles.sectionTitle}>League Standings</h2>
              <div className={styles.standingsDivider} />
            </div>
            <div className={styles.standingsHeaderRow}>
              <span className={styles.standingsColRnk}>#</span>
              <span className={styles.standingsColTeam}>TEAM</span>
              <span className={styles.standingsColRecord}>W·D·L</span>
              <span className={styles.standingsColPts}>PTS</span>
            </div>
            <div className={styles.standingsRows}>
              {standings.map((s: any) => {
                const isMe = s.team_id === myTeamId;
                const medal = rankMedalStyle(s.rank);
                return (
                  <div key={s.team_id} className={\`\${styles.standingsRow} \${isMe ? styles.myStandingsRow : ''}\`}>
                    <div className={styles.standingsColRnk}>
                      <span className={styles.rankPill} style={{ background: medal.bg, color: medal.color }}>
                        {s.rank}
                      </span>
                    </div>
                    <div className={\`\${styles.standingsColTeam} \${isMe ? styles.myTeamName : ''}\`}>
                      {s.team_name}
                      {isMe && <span className={styles.youTag}>YOU</span>}
                    </div>
                    <div className={styles.standingsColRecord}>
                      {s.wins}·{s.draws}·{s.losses}
                    </div>
                    <div className={\`\${styles.standingsColPts} \${isMe ? styles.myPts : ''}\`}>
                      {s.league_points.toLocaleString()}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className={styles.standingsFooter}>
              <Link href={\`/league/\${leagueId}/standings\`} className={styles.cardLink}>Full Standings →</Link>
            </div>
          </div>

          {/* Top Performers (Stars of the Week) */}
          <div className={styles.rightSection} style={{ marginTop: '24px' }}>
            <span className={styles.sectionLabel}>GAMEWEEK {latestCompletedGW ?? '—'}</span>
            <h2 className={styles.sectionTitle}>Stars of the Week</h2>
            {topPerformers.length === 0 ? (
              <p className={styles.emptyHint}>
                {latestCompletedGW ? 'Match ratings not yet available.' : 'No completed gameweeks yet.'}
              </p>
            ) : (
              <div className={styles.playerChips}>
                {topPerformers.map((perf: any, i: number) => {
                  const player = perf.player as any;
                  if (!player) return null;
                  const isMyPlayer = perf.owner?.team_id === myTeamId;
                  const pts = Number(perf.fantasy_points ?? 0);
                  return (
                    <div key={i} className={\`\${styles.playerChip} \${isMyPlayer ? styles.myPlayerChip : ''}\`} style={{ borderLeftColor: positionColor(player.primary_position) }}>
                      <div className={styles.chipLeft}>
                        <div className={styles.chipPhotoMount} style={{ borderColor: positionColor(player.primary_position) }}>
                          {player.photo_url ? (
                            <img src={player.photo_url} alt={formatPlayerName(player, 'full')} className={styles.chipPhoto} />
                          ) : (
                            <span className={styles.chipPhotoFallback} aria-hidden>{(player.web_name ?? player.name ?? '?').charAt(0)}</span>
                          )}
                        </div>
                        <span className={styles.chipPosBadge} style={{ background: positionColor(player.primary_position) }}>{player.primary_position}</span>
                        <div className={styles.chipInfo}>
                          <span className={styles.chipName}>{formatPlayerName(player, 'full')}</span>
                          <span className={styles.chipClub}>{(player.pl_team ?? '').toUpperCase()}</span>
                        </div>
                        {isMyPlayer && <span className={styles.chipMyTag}>★ Your squad</span>}
                      </div>
                      <span className={styles.chipPoints} style={{ background: pointsBadgeColor(pts) }}>{pts.toFixed(1)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tournament Status */}
          <div className={styles.rightSection} style={{ marginTop: '24px' }}>
            <span className={styles.sectionLabel}>CUPS & COMPETITIONS</span>
            <h2 className={styles.sectionTitle}>Tournament Status</h2>
            {tournaments.length === 0 ? (
              <p className={styles.emptyHint}>No active tournaments.</p>
            ) : (
              <div className={styles.playerChips}>
                {tournaments.map((t: any) => (
                  <div key={t.id} className={styles.playerChip} style={{ padding: '16px', display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontFamily: 'var(--font-noto-serif)', fontWeight: 600, color: 'var(--color-text-primary)', fontSize: '1.1rem' }}>{t.name}</span>
                      <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Status: {t.status === 'active' ? \`Round \${t.current_round ?? 1}\` : t.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className={styles.standingsFooter} style={{ marginTop: '24px' }}>
              <Link href={\`/league/\${leagueId}/tournaments\`} className={styles.cardLink}>View Brackets →</Link>
            </div>
          </div>

        </div>
      </div>
`;

code = code.replace(match[0], newBlock + '\n\n      {/* Leave League');
fs.writeFileSync(path, code);
console.log("Updated structure");
