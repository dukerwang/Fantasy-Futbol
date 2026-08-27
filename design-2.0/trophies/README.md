# Trophies

The design record for Gaffa's four trophies and the cabinet that holds them.
Approved 2026-08-27; shipped the same day.

**Canvas:** https://claude.ai/code/artifact/61c75a12-1dac-46bf-8d70-33e97be80bc6

```bash
node build.mjs   # regenerates the .dc.html artboards + canvas.json
```

Only `trophies.mjs` and `build.mjs` are checked in. The artboards, `canvas.json`
and the seeded canvas are build output — the last is ~3.5MB, nearly all of it
editor runtime.

## The four

| Competition | Object | What separates it |
|---|---|---|
| League Title | The Broad Cup | Widest bowl, shortest stem, **squared** handles — bent rod, straight runs, sharp corners |
| Champions Cup | The Great Cup | Two arcs sweeping past the bowl entirely and up above the rim. Tallest, widest reach |
| League Cup | The Tall Cup | Slender chalice, long banded stem, scroll handles held tight to the body |
| Consolation Cup | The Shallow Bowl | Low dish, stubby foot, ring handles at the lip |

Each is a **turned profile** — a radius sampled down the axis and revolved — so
the silhouette carries real mouldings rather than being one curve with texture
painted on. Ribbons on both handles come from the club's own
`crest_config.primaryColor` / `secondaryColor`. The year is engraved on the
plinth, one object per win.

## The implementation is not here

`trophies.mjs` is the record. The shipped code is:

- `src/lib/honours/trophyGeometry.ts` — profiles and the lighting model
- `src/components/trophies/Trophy.tsx` — the component
- `src/lib/honours/getClubHonours.ts` — the data layer

Ported 1:1. **If a profile changes, change it in both**, or this stops being a
record of anything.

## What went wrong on the way

Kept, because each of these took a round of feedback to see and would be easy to
reintroduce:

- **Cards around each trophy** turned physical objects into flashcards; the card
  edge became the strongest line on the page.
- **A green back panel with brown ledges** reads as a chalkboard and a chalk tray.
- **A studio sweep with a wall-meets-floor horizon** put every trophy below the
  line on visibly darker ground than the row above. Two rows of objects cannot
  share one floor line without real perspective. There is no horizon now — one
  even field, and each trophy grounded by its own contact shadow and reflection.
- **A mirrored-room reflection on the metal** banded every cup across the middle.
  Softening it did not help: any two gradient stops close together read as a cut,
  and light does not cut. One monotonic ramp, colour change at zero opacity.
- **Per-part light ramps** (bowl / stem / foot each mapped across its own width)
  made the highlight jump sideways at every part boundary, so the foot looked
  like a different material bolted on. One ramp, re-stretched per band.
- **Saturated gilt** reads brassy and cartoon; **blue-grey steel** reads cold and
  machined. The target is warm-neutral silver — warmth in the metal, never yellow.
- **Vacant plinths** for competitions a club hadn't won turned a trophy room into
  a list of failures. The cabinet shows what a club has won and nothing else.
