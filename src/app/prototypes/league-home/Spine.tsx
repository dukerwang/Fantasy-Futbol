'use client';

import type { CSSProperties } from 'react';
import { MODEL } from './data';
import s from './spine.module.css';

/** The spine token for a tactical slot, so colour can carry structure. */
const POS_TOKEN: Record<string, string> = {
  GK: '--color-pos-gk',
  CB: '--color-pos-cb',
  LB: '--color-pos-lb',
  RB: '--color-pos-rb',
  LWB: '--color-pos-lwb',
  RWB: '--color-pos-rwb',
  DM: '--color-pos-dm',
  CM: '--color-pos-cm',
  AM: '--color-pos-am',
  LW: '--color-pos-lw',
  RW: '--color-pos-rw',
  ST: '--color-pos-st',
};

const pf = (slot: string): CSSProperties =>
  ({ '--pf': `var(${POS_TOKEN[slot] ?? '--color-border'})` }) as CSSProperties;

/**
 * VARIANT 3 — "Spine"
 *
 * Colour is the structure. The plane changes by content type rather than by
 * elevation, the XI runs full-width as the twelve-position spine, and every
 * standings row is ruled in its club's own colour. Archivo Narrow leads —
 * it carries the club name itself. Newsreader survives only on the scoreline.
 */
export default function Spine() {
  const m = MODEL;
  const fx = m.fixture;

  return (
    <div
      className={s.page}
      style={{ '--clubColor': `var(${m.club.colorToken})` } as CSSProperties}
    >
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
            <div key={f.stake} className={f.accent ? `${s.fig} ${s.figAccent}` : s.fig}>
              <div className={s.figV}>{f.value}</div>
              <div className={s.figS}>{f.stake}</div>
            </div>
          ))}
        </div>
      </header>

      {/* Fixture — the zone is washed by the two clubs' own colours */}
      <section className={`${s.zone} ${s.zoneField}`}>
        <div className={s.zoneHd}>
          <span className={s.zoneTitle}>Matchweek {fx.gameweek}</span>
          <span className={s.zoneNote}>{fx.when}</span>
        </div>
        <div
          className={s.fx}
          style={
            {
              '--homeColor': `var(${fx.home.colorToken})`,
              '--awayColor': `var(${fx.away.colorToken})`,
            } as CSSProperties
          }
        >
          <div className={`${s.fxHalf} ${s.fxHome}`}>
            <span className={s.fxClub}>{fx.home.name}</span>
            <span className={s.fxMeta}>{fx.homeMeta}</span>
            <span className={s.fxScore}>{fx.homeScore.toFixed(1)}</span>
          </div>
          <div className={`${s.fxHalf} ${s.fxAway}`}>
            <span className={s.fxClub}>{fx.away.name}</span>
            <span className={s.fxMeta}>{fx.awayMeta}</span>
            <span className={s.fxScore}>{fx.awayScore.toFixed(1)}</span>
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
      </section>

      {/* The XI as the spine itself */}
      <section className={`${s.zone} ${s.zoneSpine}`}>
        <div className={s.zoneHd}>
          <span className={s.zoneTitle}>Your XI</span>
          <span className={s.zoneNote}>{m.xiSummary}</span>
        </div>
        <div className={s.band}>
          {m.xi.map((p, i) => (
            <div
              key={`${p.slot}-${i}`}
              className={p.state === 'ok' ? `${s.bandSlot} ${s.bandOpen}` : s.bandSlot}
              style={pf(p.slot)}
            >
              <div className={s.bandPos}>{p.slot}</div>
              <div className={s.bandName}>{p.name}</div>
              <div className={s.bandPts}>{p.pts}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Standings — each row ruled in its club's colour */}
      <section className={`${s.zone} ${s.zonePlain}`}>
        <div className={s.zoneHd}>
          <span className={s.zoneTitle}>Standings</span>
          <span className={s.zoneNote}>
            After {m.gameweek} of {m.totalGameweeks}
          </span>
        </div>
        <table className={s.tbl}>
          <thead>
            <tr>
              <th colSpan={2}>#</th>
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
              <tr
                key={r.club.id}
                className={r.isMe ? s.rowMine : undefined}
                style={{ '--clubColor': `var(${r.club.colorToken})` } as CSSProperties}
              >
                <td className={s.rowRule} aria-hidden="true" />
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
      <section className={`${s.zone} ${s.zonePlain}`}>
        <div className={s.zoneHd}>
          <span className={s.zoneTitle}>On all fronts</span>
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

      <div className={s.cols}>
        <section className={`${s.zone} ${s.zoneMarket}`} style={{ marginTop: 0 }}>
          <div className={s.zoneHd}>
            <span className={s.zoneTitle}>In the market</span>
            <span className={s.zoneNote}>{m.marketBudget}</span>
          </div>
          {m.market.map((lot) => (
            <div key={lot.name} className={s.li}>
              <div className={s.liMain}>
                <span className={s.liPos} style={pf(lot.position)}>
                  {lot.position}
                </span>
                <div>
                  <div className={s.liName}>{lot.name}</div>
                  <div className={s.liMeta}>{lot.meta}</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className={s.liVal}>{lot.bid}</div>
                <div className={s.liWhen}>{lot.expires}</div>
              </div>
            </div>
          ))}
        </section>

        <section className={`${s.zone} ${s.zonePlain}`} style={{ marginTop: 0 }}>
          <div className={s.zoneHd}>
            <span className={s.zoneTitle}>The wire</span>
          </div>
          {m.wire.map((w) => (
            <div key={w.text} className={s.li}>
              <span className={s.wireTx}>{w.text}</span>
              <span className={s.liWhen}>{w.at}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
