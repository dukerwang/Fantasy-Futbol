'use client';

import { MODEL } from './data';
import s from './board.module.css';

/**
 * VARIANT 2 — "Board"
 *
 * Two genuinely distinct planes. The ground drops to --color-bg-inset and
 * every block sits on --color-bg-card: a real step, not the 4% smudge.
 * Elevation is declared once per block (hairline, no shadow). Newsreader
 * carries block titles; each block is tagged by a rule drawn from its content.
 */
export default function Board() {
  const m = MODEL;
  const fx = m.fixture;

  return (
    <div className={s.page}>
      <div className={s.inner}>
        <header className={s.mast}>
          <div className={s.mastId}>
            <span className={s.crest}>{m.club.abbr}</span>
            <div>
              <h1 className={s.name}>{m.club.name}</h1>
              <div className={s.sub}>{m.subtitle}</div>
            </div>
          </div>
          <div className={s.figs}>
            {m.figures.map((f) => (
              <div key={f.stake} className={s.fig}>
                <div className={f.accent ? `${s.figV} ${s.figVAccent}` : s.figV}>{f.value}</div>
                <div className={s.figS}>{f.stake}</div>
              </div>
            ))}
          </div>
        </header>

        <div className={s.body}>
          <div className={s.col}>
            {/* Fixture */}
            <section className={s.block}>
              <div className={`${s.tag} ${s.tagLive}`} />
              <div className={s.blockHd}>
                <span className={s.blockTitle}>Matchweek {fx.gameweek}</span>
                <span className={s.blockNote}>{fx.when}</span>
              </div>
              <div className={s.blockBody}>
                <div className={s.fx}>
                  <div className={s.fxSide}>
                    <span className={s.fxCrest}>{fx.home.abbr}</span>
                    <div>
                      <div className={s.fxClub}>{fx.home.name}</div>
                      <div className={s.fxMeta}>{fx.homeMeta}</div>
                    </div>
                  </div>
                  <div className={s.fxScores}>
                    <span className={`${s.fxScore} ${s.fxScoreMine}`}>{fx.homeScore.toFixed(1)}</span>
                    <span className={s.fxScore}>{fx.awayScore.toFixed(1)}</span>
                  </div>
                  <div className={`${s.fxSide} ${s.fxSideAway}`}>
                    <div style={{ textAlign: 'right' }}>
                      <div className={s.fxClub}>{fx.away.name}</div>
                      <div className={s.fxMeta}>{fx.awayMeta}</div>
                    </div>
                    <span className={s.fxCrest}>{fx.away.abbr}</span>
                  </div>
                </div>
                <div className={s.track}>
                  <span className={s.trackBand} />
                  <span className={s.trackInk} style={{ left: `${fx.markerPct}%` }} />
                </div>
                <div className={s.fxFoot}>
                  <span className={s.live}>Live</span>
                  <span>{fx.verdict}</span>
                </div>
              </div>
            </section>

            {/* XI */}
            <section className={s.block}>
              <div className={`${s.tag} ${s.tagSpine}`} />
              <div className={s.blockHd}>
                <span className={s.blockTitle}>Your XI</span>
                <span className={s.blockNote}>{m.xiSummary}</span>
              </div>
              <div className={`${s.blockBody} ${s.blockFlush}`}>
                <div className={s.xi}>
                  {m.xi.map((p, i) => (
                    <div key={`${p.slot}-${i}`} className={s.xiSlot}>
                      <div className={s.xiPos}>{p.slot}</div>
                      <div className={s.xiName}>{p.name}</div>
                      <div className={s.xiPts}>{p.pts}</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Standings */}
            <section className={s.block}>
              <div className={`${s.tag} ${s.tagAccent}`} />
              <div className={s.blockHd}>
                <span className={s.blockTitle}>Standings</span>
                <span className={s.blockNote}>
                  After {m.gameweek} of {m.totalGameweeks}
                </span>
              </div>
              <div className={`${s.blockBody} ${s.blockFlush}`}>
                <table className={s.tbl}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Club</th>
                      <th>W</th>
                      <th>D</th>
                      <th>L</th>
                      <th>For</th>
                      <th>Pts</th>
                      <th>Form</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.table.map((r) => (
                      <tr key={r.club.id} className={r.isMe ? s.rowMine : undefined}>
                        <td>
                          <span
                            className={[
                              s.rank,
                              r.rank === 1 ? s.rank1 : '',
                              r.rank === 2 ? s.rank2 : '',
                              r.rank === 3 ? s.rank3 : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          >
                            {String(r.rank).padStart(2, '0')}
                          </span>
                        </td>
                        <td>
                          <div className={s.clubCell}>
                            <span className={s.tblCrest}>{r.club.abbr}</span>
                            <div>
                              <div className={s.club}>{r.club.name}</div>
                              <div className={s.clubMgr}>{r.club.manager}</div>
                            </div>
                          </div>
                        </td>
                        <td>{r.w}</td>
                        <td>{r.d}</td>
                        <td>{r.l}</td>
                        <td>{r.pf}</td>
                        <td>
                          <span className={s.pts}>{r.pts}</span>
                        </td>
                        <td>
                          <span className={s.form}>
                            {r.form.map((f, i) => (
                              <span
                                key={i}
                                className={[s.formC, f === 'W' ? s.formW : '', f === 'L' ? s.formL : '']
                                  .filter(Boolean)
                                  .join(' ')}
                              >
                                {f}
                              </span>
                            ))}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Fronts */}
            <section className={s.block}>
              <div className={s.tag} />
              <div className={s.blockHd}>
                <span className={s.blockTitle}>On all fronts</span>
              </div>
              <div className={`${s.blockBody} ${s.blockFlush}`}>
                <div className={s.fronts}>
                  {m.fronts.map((f) => (
                    <div
                      key={f.competition}
                      className={f.tone === 'out' ? `${s.front} ${s.frontOut}` : s.front}
                    >
                      <div className={s.frontComp}>{f.competition}</div>
                      <div className={s.frontV}>{f.value}</div>
                      <div className={s.frontSub}>
                        {f.sub} · pays {f.prize}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>

          {/* Rail */}
          <aside className={s.col}>
            <section className={s.block}>
              <div className={`${s.tag} ${s.tagWarning}`} />
              <div className={s.blockHd}>
                <span className={s.blockTitle}>In the market</span>
                <span className={s.blockNote}>{m.marketBudget}</span>
              </div>
              <div className={`${s.blockBody} ${s.blockFlush}`}>
                {m.market.map((lot) => (
                  <div key={lot.name} className={s.li}>
                    <div className={s.liMain}>
                      <div>
                        <div className={s.liName}>{lot.name}</div>
                        <div className={s.liMeta}>
                          {lot.position} · {lot.meta}
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className={lot.leading ? `${s.liVal} ${s.liLead}` : s.liVal}>{lot.bid}</div>
                      <div className={s.liWhen}>{lot.expires}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className={s.block}>
              <div className={s.tag} />
              <div className={s.blockHd}>
                <span className={s.blockTitle}>The wire</span>
              </div>
              <div className={`${s.blockBody} ${s.blockFlush}`}>
                {m.wire.map((w) => (
                  <div key={w.text} className={s.li} style={{ display: 'block' }}>
                    <div className={s.wireTx}>{w.text}</div>
                    <div className={s.liWhen} style={{ marginTop: 4 }}>
                      {w.at}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
