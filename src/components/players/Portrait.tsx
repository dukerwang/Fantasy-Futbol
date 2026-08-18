'use client';

import { useEffect, useRef, useState } from 'react';
import { clubBadgePath, resolveClub } from '@/lib/clubs/registry';
import { portraitInitials, portraitSources } from '@/lib/players/photo';

interface Props {
  /** Either a stored `players.photo_url` or a bare FPL `elements[].code`. */
  photoUrl: string | null | undefined;
  /** Full name — the alt text, and the source of the fallback initials. */
  name: string;
  /**
   * The player's club, in whatever spelling the feed used (`players.pl_team`
   * works). Resolved through the registry; omit it to render no crest.
   *
   * For anything archived, pass the club from `player_season_clubs`, not
   * `players.pl_team` — that column is overwritten by every sync and describes
   * the player's club TODAY.
   */
  club?: string | null;
  /** hero 104x120 · lot 66x78 · row 44x44. */
  size?: 'lg' | 'md' | 'sm';
  className?: string;
}

/**
 * The Gaffa 2.0 portrait. Treatment lives in globals.css under
 * "GAFFA 2.0 — THE PORTRAIT"; this component only decides which picture, if
 * any, there is to show.
 *
 * The ground is never tinted by position — the kit already carries strong
 * colour and a position tint fights it. Position colour stays on the badge,
 * club identity on the crest.
 *
 * Three photo states, in order: the 500x500 cut-out the crop was locked
 * against; then the 220x280 one, which is a different picture and carries its
 * own measured zoom (`-alt`); then a serif initial. A player with no cut-out
 * gets a 403 rather than a 404 or a placeholder image, which reaches us as the
 * <img>'s error event — 27% of the pool misses the square source, so this
 * cascade is load-bearing rather than defensive.
 */
export default function Portrait({ photoUrl, name, club, size = 'sm', className }: Props) {
  const sources = portraitSources(photoUrl);
  const key = sources[0] ?? '';

  // Remember WHICH player the failures belong to, not just how many there were.
  // A recycled row (a virtualised squad list, a re-sorted table) hands this
  // component a new player without unmounting it; a bare counter would carry
  // one player's 403s onto whoever lands in the slot next, and resetting it in
  // an effect costs a cascading render. Comparing keys resets itself.
  const [tried, setTried] = useState<{ key: string; n: number }>({ key, n: 0 });
  const n = tried.key === key ? tried.n : 0;
  const src = sources[n];

  // `onError` alone is not enough. The markup is server-rendered, so the browser
  // starts fetching the cut-out long before React hydrates — and a source that
  // 403s (27% of the pool has no square one) has already fired and lost its
  // error event by the time the handler attaches. The result was a portrait
  // stuck on a broken source: an empty lit frame, no second source tried and no
  // initials, which is the one outcome this cascade exists to prevent.
  //
  // A loaded-but-zero-width image is exactly that missed failure, so re-check it
  // after every commit. This terminates: each pass advances `n`, and once the
  // sources run out `src` is undefined, the <img> is not rendered at all, and
  // the fallback takes over.
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const el = imgRef.current;
    if (el?.complete && el.naturalWidth === 0) setTried({ key, n: n + 1 });
  }, [key, n, src]);

  // resolveClub returns null rather than guessing, so an unrecognised spelling
  // shows no crest instead of confidently showing the wrong badge.
  const badge = clubBadgePath(club);
  const clubName = resolveClub(club)?.name ?? club ?? '';

  return (
    <span className={`g-portrait g-portrait-${size}${className ? ` ${className}` : ''}`}>
      <span className="g-portrait-frame">
        {src ? (
          <img
            ref={imgRef}
            className={`g-portrait-img${n > 0 ? ' g-portrait-img-alt' : ''}`}
            src={src}
            alt={name}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setTried({ key, n: n + 1 })}
          />
        ) : (
          <span className="g-portrait-fallback" aria-label={name}>
            {portraitInitials(name)}
          </span>
        )}
      </span>
      {badge && (
        <span className="g-portrait-crest">
          <img src={badge} alt={clubName} title={clubName} />
        </span>
      )}
    </span>
  );
}
