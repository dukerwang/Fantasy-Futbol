'use client';

import { MODEL } from './data';
import s from './ledger.module.css';

/**
 * VARIANT 1 — "Ledger"
 *
 * One plane. No cards, no second surface, no rail: the page is a single
 * column of ruled groups. Colour is spent only on state. Newsreader carries
 * names and figures; Archivo Narrow carries every head and column.
 */
export default function Ledger() {
  const m = MODEL;
  const fx = m.fixture;

  return (
    <div className={s.page}>
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

      {/* Fixture */}
      <section className={s.sec}>
        <div className={s.secHd}>
          <span className={s.secTitle}>Matchweek {fx.gameweek}</span>
          <span className={s.secNote}>{fx.when}</span>
        </div>

        <div className={s.fx}>
          <div className={s.fxSide}>
            <div className={s.fxClub}>{fx.home.name}</div>
            <div className={s.fxMeta}>{fx.homeMeta}</div>
          </div>
          <div className={s.fxScores}>
            <span className={`${s.fxScore} ${s.fxScoreMine}`}>{fx.homeScore.toFixed(1)}</span>
            <span className={s.fxScore}>{fx.awayScore.toFixed(1)}</span>
          </div>
          <div className={`${s.fxSide} ${s.fxSideAway}`}>
            <div className={s.fxClub}>{fx.away.name}</div>
            <div className={s.fxMeta}>{fx.awayMeta}</div>
          </div>
        </div>

        <div className={s.fxAxis}>
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

      {/* Your XI */}
      <section className={s.sec}>
        <div className={s.secHd}>
          <span className={s.secTitle}>Your XI</span>
          <span className={s.secNote}>{m.xiSummary}</span>
        </div>
        <div className={s.xi}>
          {m.xi.map((p, i) => (
            <div
              key={`${p.slot}-${i}`}
              className={[
                s.xiSlot,
                p.state === 'flag' ? s.xiFlag : '',
                p.state === 'ok' ? s.xiOpen : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div className={s.xiPos}>{p.slot}</div>
              <div className={s.xiName}>{p.name}</div>
              <div className={s.xiPts}>{p.pts}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Standings */}
      <section className={s.sec}>
        <div className={s.secHd}>
          <span className={s.secTitle}>Standings</span>
          <span className={s.secNote}>After {m.gameweek} of {m.totalGameweeks}</span>
        </div>
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
                    className={[s.rank, r.rank === 1 ? s.rank1 : '', r.rank === 2 ? s.rank2 : '', r.rank === 3 ? s.rank3 : '']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {String(r.rank).padStart(2, '0')}
                  </span>
                </td>
                <td>
                  <div className={s.club}>{r.club.name}</div>
                  <div className={s.clubMgr}>{r.club.manager}</div>
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
      </section>

      {/* Fronts */}
      <section className={s.sec}>
        <div className={s.secHd}>
          <span className={s.secTitle}>On all fronts</span>
        </div>
        <div className={s.fronts}>
          {m.fronts.map((f) => (
            <div key={f.competition} className={f.tone === 'out' ? `${s.front} ${s.frontOut}` : s.front}>
              <div className={s.frontComp}>{f.competition}</div>
              <div className={s.frontV}>{f.value}</div>
              <div className={s.frontSub}>
                {f.sub} · pays {f.prize}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Market + Wire, two columns, still one plane */}
      <section className={s.sec}>
        <div className={s.cols}>
          <div>
            <div className={s.secHd}>
              <span className={s.secTitle}>In the market</span>
              <span className={s.secNote}>{m.marketBudget}</span>
            </div>
            <div className={s.list}>
              {m.market.map((lot) => (
                <div key={lot.name} className={s.li}>
                  <div className={s.liMain}>
                    <span className={s.liName}>{lot.name}</span>
                    <span className={s.liMeta}>
                      {lot.position} · {lot.meta}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s3)' }}>
                    <span className={lot.leading ? `${s.liVal} ${s.liLead}` : s.liVal}>{lot.bid}</span>
                    <span className={s.liWhen}>{lot.expires}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className={s.secHd}>
              <span className={s.secTitle}>The wire</span>
            </div>
            <div className={s.list}>
              {m.wire.map((w) => (
                <div key={w.text} className={s.li}>
                  <span className={s.wireTx}>{w.text}</span>
                  <span className={s.liWhen}>{w.at}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
