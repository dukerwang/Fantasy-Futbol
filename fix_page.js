const fs = require('fs');
const path = './src/app/(dashboard)/league/[leagueId]/page.tsx';
let code = fs.readFileSync(path, 'utf8');

const match = code.match(/\{\/\* ── Dashboard Grid ── \*\/\}([\s\S]*?)<\/div>\s*\{\/\* Leave League/);
if (!match) {
  console.log("Could not match the render block");
  process.exit(1);
}

const newBlock = `{/* ── Dashboard Grid ── */}
      <div className={styles.bodyRow}>

        {/* ── Left Column ── */}
        <div className={styles.leftCol}>
          {/* Manager Card */}
          <div className={styles.managerCard}>
            <div className={styles.cardPadding}>
              <span className={styles.kickerLabel}>MANAGER</span>
              <h2 className={styles.managerName}>{myTeam?.team_name ?? 'Observer'}</h2>
              <span className={styles.managerOwner}>by {user.user_metadata?.full_name ?? 'Manager'}</span>
              
              <div className={styles.managerDivider} />
              
              <div className={styles.managerStatsRow}>
                <div className={styles.managerStat}>
                  <span className={styles.kickerLabel}>RANK</span>
                  <span className={styles.managerStatValue}>#{userStanding?.rank ?? '-'}</span>
                </div>
                <div className={styles.managerStat}>
                  <span className={styles.kickerLabel}>POINTS</span>
                  <span className={styles.managerStatValue}>{userStanding?.league_points?.toLocaleString() ?? '-'}</span>
                </div>
              </div>

              <div className={styles.managerDivider} />

              <div className={styles.managerRecordBlock}>
                <span className={styles.kickerLabel}>RECORD</span>
                <span className={styles.managerRecord}>{userRecord}</span>
              </div>
            </div>
          </div>

          {/* FAAB Balance Card */}
          <div className={styles.faabCard}>
            <div className={styles.cardPadding}>
              <span className={styles.kickerLabel}>FAAB BALANCE</span>
              <div className={styles.faabAmountRow}>
                <span className={styles.faabAmount}>£{myTeam?.faab_budget ?? 0}</span>
                <span className={styles.faabRemaining}>REMAINING</span>
              </div>
              <div className={styles.faabProgressBar}>
                <div className={styles.faabProgressFill} style={{ width: \`\${((200 - (myTeam?.faab_budget ?? 0)) / 200) * 100}%\` }} />
              </div>
              <div className={styles.faabProgressLabels}>
                <span>USED: £{200 - (myTeam?.faab_budget ?? 0)}</span>
                <span>BUDGET: £200</span>
              </div>
            </div>
          </div>

          {/* Taxi Squad */}
          <div className={styles.taxiCard}>
            <div className={styles.cardPadding}>
              <div className={styles.taxiHeaderRow}>
                <span className={styles.kickerLabel}>TAXI SQUAD</span>
                <span className={styles.u21Badge}>U21</span>
              </div>
              
              {taxiSquad.length === 0 ? (
                <p className={styles.emptyHint}>No academy players.</p>
              ) : (
                <div className={styles.taxiList}>
                  {taxiSquad.map((entry: any, i: number) => {
                    const player = entry.player;
                    const initials = (player.web_name ?? player.name ?? '?').split(' ').map((n: string) => n[0]).join('').substring(0, 2);
                    return (
                      <div key={i} className={styles.taxiRow}>
                        <div className={styles.taxiAvatar}>{initials}</div>
                        <div className={styles.taxiInfo}>
                          <span className={styles.taxiName}>{formatPlayerName(player, 'full')}</span>
                          <span className={styles.taxiPosClub}>{player.primary_position} • {player.pl_team}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Center Column ── */}
        <div className={styles.centerCol}>
          {/* Matchup Hero */}
          {heroMatchup && heroState && (
            <div className={styles.matchupHero}>
              <div className={styles.matchupTeam}>
                <div className={styles.matchupShield}></div>
                <span className={styles.matchupTeamName}>{userTeam?.team_name ?? '—'}</span>
                <span className={styles.matchupManager}>MANAGER {user.user_metadata?.full_name?.split(' ').pop()?.toUpperCase() ?? 'NAME'}</span>
              </div>
              
              <div className={styles.matchupCenter}>
                {heroState === 'live' && <span className={styles.matchupLiveBadge}>LIVE</span>}
                <div className={styles.matchupScoreRow}>
                  <span className={styles.matchupScore}>{heroState === 'upcoming' ? '-' : (userScore?.toFixed(0) ?? '0')}</span>
                  <span className={styles.matchupScoreDash}>-</span>
                  <span className={styles.matchupScore}>{heroState === 'upcoming' ? '-' : (oppScore?.toFixed(0) ?? '0')}</span>
                </div>
                <span className={styles.matchupGwLabel}>MATCHWEEK {heroMatchup.gameweek}</span>
              </div>

              <div className={styles.matchupTeam}>
                <div className={styles.matchupShield}></div>
                <span className={styles.matchupTeamName}>{oppTeam?.team_name ?? '—'}</span>
                <span className={styles.matchupManager}>MANAGER OPPONENT</span>
              </div>
            </div>
          )}

          {/* Transfer Gazette */}
          <div className={styles.gazetteCard}>
            <div className={styles.gazetteHeaderBar}>
              <span className={styles.gazetteTitle}>TRANSFER GAZETTE & FEED</span>
              <span className={styles.gazetteDate}>Edition: {new Date().toLocaleDateString('en-GB').replace(/\\//g, '.')}</span>
            </div>
            
            <div className={styles.gazetteContent}>
              {activity.length === 0 ? (
                <p className={styles.emptyHint}>No activity yet this season.</p>
              ) : (
                <div className={styles.gazetteList}>
                  {activity.map((tx: any) => {
                    const cat = txCategoryStyle(tx.type);
                    const teamName = (tx.team as any)?.team_name ?? 'Unknown';
                    const playerName = (tx.player as any)?.web_name ?? (tx.player as any)?.name ?? 'Unknown';
                    const faab = tx.faab_bid ? \` for a fee of £\${tx.faab_bid}m\` : '';
                    
                    let summaryText = <></>;
                    if (tx.type === 'trade') summaryText = <>Trade completed by {teamName}.</>;
                    else if (tx.type === 'drop') summaryText = <>{playerName} dropped by {teamName}.</>;
                    else summaryText = <>{playerName} moves to {teamName}{faab}.</>;

                    return (
                      <div key={tx.id} className={styles.gazetteRow}>
                        <div className={styles.gazetteRowHeader}>
                          <span className={styles.gazetteRowKicker}>{cat.label}</span>
                          <span className={styles.gazetteRowTime}>{timeAgo(tx.processed_at)}</span>
                        </div>
                        <p className={styles.gazetteHeadline}>{summaryText}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Right Column ── */}
        <div className={styles.rightCol}>
          
          {/* League Standings */}
          <div className={styles.rightCard}>
            <span className={styles.kickerLabel}>LEAGUE STANDINGS</span>
            <div className={styles.standingsTable}>
              <div className={styles.standingsHeader}>
                <span className={styles.stRank}>RK</span>
                <span className={styles.stTeam}>TEAM</span>
                <span className={styles.stPts}>PTS</span>
              </div>
              <div className={styles.standingsList}>
                {standings.map((s: any) => {
                  const isMe = s.team_id === myTeamId;
                  return (
                    <div key={s.team_id} className={\`\${styles.standingsRow} \${isMe ? styles.stRowActive : ''}\`}>
                      <span className={styles.stRankValue}>{s.rank}</span>
                      <span className={\`\${styles.stTeamName} \${isMe ? styles.stTeamNameBold : ''}\`}>{s.team_name}</span>
                      <span className={styles.stPtsValue}>{s.league_points.toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>
              <div className={styles.standingsFooter}>
                <Link href={\`/league/\${leagueId}/standings\`} className={styles.cardLink}>VIEW FULL LEDGER</Link>
              </div>
            </div>
          </div>

          {/* Top Performers */}
          <div className={styles.rightCard}>
            <span className={styles.kickerLabel}>TOP PERFORMERS (GW {latestCompletedGW ?? '—'})</span>
            {topPerformers.length === 0 ? (
               <p className={styles.emptyHint}>Not available.</p>
            ) : (
              <div className={styles.perfList}>
                {topPerformers.map((perf: any, i: number) => {
                  const player = perf.player;
                  if (!player) return null;
                  const pts = Number(perf.fantasy_points ?? 0);
                  const posClass = player.primary_position === 'GK' || player.primary_position === 'CB' || player.primary_position === 'LB' || player.primary_position === 'RB' ? styles.badgeDef : 
                                   player.primary_position === 'ST' || player.primary_position === 'LW' || player.primary_position === 'RW' ? styles.badgeAtt : styles.badgeMid;
                  const posLabel = player.primary_position === 'GK' || player.primary_position === 'CB' || player.primary_position === 'LB' || player.primary_position === 'RB' ? 'DEF' : 
                                   player.primary_position === 'ST' || player.primary_position === 'LW' || player.primary_position === 'RW' ? 'ATT' : 'MID';
                  return (
                    <div key={i} className={styles.perfRow}>
                      <span className={\`\${styles.perfBadge} \${posClass}\`}>{posLabel}</span>
                      <span className={styles.perfName}>{player.web_name}</span>
                      <div className={styles.perfScore}>
                        <span className={styles.perfPts}>{pts.toFixed(0)}</span>
                        <span className={styles.perfPtsUnit}>pts</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tournament Status */}
          <div className={styles.rightCard}>
            <span className={styles.kickerLabel}>TOURNAMENT STATUS</span>
            {tournaments.length === 0 ? (
              <p className={styles.emptyHint}>No active tournaments.</p>
            ) : (
              <div className={styles.tournList}>
                {tournaments.map((t: any) => (
                  <div key={t.id} className={styles.tournRow}>
                    <div className={styles.tournIcon}>🏆</div>
                    <div className={styles.tournInfo}>
                      <span className={styles.tournName}>{t.name}</span>
                      <span className={styles.tournDesc}>{t.status === 'active' ? \`Round \${t.current_round ?? 1}\` : t.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
`;

code = code.replace(match[0], newBlock + '\n\n      {/* Leave League');
fs.writeFileSync(path, code);
console.log("Updated structure successfully");
