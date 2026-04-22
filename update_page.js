const fs = require('fs');
const path = './src/app/(dashboard)/league/[leagueId]/page.tsx';
let code = fs.readFileSync(path, 'utf8');

// 1. Manager Name
code = code.replace(
  /<span className=\{styles\.managerOwner\}>by \{user\.user_metadata\?\.full_name \?\? 'Manager'\}<\/span>/,
  "<span className={styles.managerOwner}>by {user.user_metadata?.username ?? user.user_metadata?.preferred_username ?? user.email?.split('@')[0] ?? 'Manager'}</span>"
);

// 2. FAAB Budget
const faabRegex = /<span className=\{styles\.kickerLabel\}>FAAB BALANCE<\/span>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/;
const faabReplacement = `<span className={styles.kickerLabel}>BUDGET</span>
              <div className={styles.faabAmountRow}>
                <span className={styles.faabAmount}>£{myTeam?.faab_budget ?? 0}</span>
                <span className={styles.faabRemaining}>REMAINING</span>
              </div>
              <div className={styles.faabSpentLabel}>
                <span>SPENT THIS SEASON: £{200 - (myTeam?.faab_budget ?? 0)}</span>
              </div>
            </div>
          </div>`;
code = code.replace(faabRegex, faabReplacement);

// 3. Gazette Player Names & Hero Scores
// Hero Matchup
code = code.replace(
  /<span className=\{styles\.matchupScore\}>\{heroState === 'upcoming' \? '-' : \(userScore\?\.toFixed\(0\) \?\? '0'\)\}<\/span>/,
  "<span className={styles.matchupScore}>{heroState === 'upcoming' ? '-' : (userScore?.toFixed(1) ?? '0.0')}</span>"
);
code = code.replace(
  /<span className=\{styles\.matchupScore\}>\{heroState === 'upcoming' \? '-' : \(oppScore\?\.toFixed\(0\) \?\? '0'\)\}<\/span>/,
  "<span className={styles.matchupScore}>{heroState === 'upcoming' ? '-' : (oppScore?.toFixed(1) ?? '0.0')}</span>"
);

// Gazette
code = code.replace(
  /const playerName = \(tx\.player as any\)\?\.web_name \?\? \(tx\.player as any\)\?\.name \?\? 'Unknown';/g,
  "const playerName = formatPlayerName(tx.player as any, 'first_last_initial');"
);

// 4. Top Performers
const perfRegex = /<span className=\{`\$\{styles\.perfBadge\} \$\{posClass\}`\}>\{posLabel\}<\/span>\s*<span className=\{styles\.perfName\}>\{player\.web_name\}<\/span>\s*<div className=\{styles\.perfScore\}>\s*<span className=\{styles\.perfPts\}>\{pts\.toFixed\(0\)\}<\/span>/g;
const perfReplacement = `<div className={styles.perfPhotoMount}>
                        {player.fpl_id ? (
                           <img 
                             src={\`https://resources.premierleague.com/premierleague/photos/players/110x140/p\$\{player.fpl_id\}.png\`}
                             alt={player.web_name}
                             className={styles.perfPhoto}
                             onError={(e) => {
                               (e.target as HTMLImageElement).style.display = 'none';
                               (e.target as HTMLImageElement).nextElementSibling?.removeAttribute('style');
                             }}
                           />
                        ) : null}
                        <div className={styles.perfPhotoFallback} style={{ display: player.fpl_id ? 'none' : 'flex' }}>
                          {player.web_name?.[0] ?? '?'}
                        </div>
                      </div>
                      <span className={\`\${styles.perfBadge} \${posClass}\`}>{posLabel}</span>
                      <span className={styles.perfName}>{formatPlayerName(player, 'first_last_initial')}</span>
                      <div className={styles.perfScore}>
                        <span className={styles.perfPts}>{pts.toFixed(1)}</span>`;
code = code.replace(perfRegex, perfReplacement);

fs.writeFileSync(path, code);
console.log("Updated page.tsx successfully");
