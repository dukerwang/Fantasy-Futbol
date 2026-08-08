'use client';

import { useEffect, useState } from 'react';
import styles from './home.module.css';

/**
 * A ticking countdown that offsets against the SERVER's clock, not the
 * browser's.
 *
 * An auction expiry is a server-side fact. Rendering it against `Date.now()`
 * makes a manager whose laptop is four minutes fast believe a lot has already
 * closed — and in a league where the whole point is that bidding stays open
 * until someone stops paying, that is a real cost, not a cosmetic one.
 */
export default function Countdown({
  to,
  serverNow,
  hotWithinMs = 60 * 60 * 1000,
}: {
  to: string | null;
  serverNow: string;
  hotWithinMs?: number;
}) {
  // The gap between this browser and the server, measured once on mount.
  const [skew] = useState(() => Date.now() - new Date(serverNow).getTime());
  const [now, setNow] = useState(() => new Date(serverNow).getTime());

  useEffect(() => {
    if (!to) return;
    const tick = () => setNow(Date.now() - skew);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [to, skew]);

  if (!to) return <span className={styles.clock}>No clock</span>;

  const ms = new Date(to).getTime() - now;
  const hot = ms <= hotWithinMs;

  let label: string;
  if (ms <= 0) {
    label = 'Closing';
  } else {
    const totalMins = Math.floor(ms / 60000);
    const days = Math.floor(totalMins / 1440);
    const hrs = Math.floor((totalMins % 1440) / 60);
    const mins = totalMins % 60;
    if (days > 0) label = hrs ? `${days}d ${hrs}h` : `${days}d`;
    else if (hrs > 0) label = `${hrs}h ${mins}m`;
    else label = `${mins}m`;
  }

  return (
    <span className={hot ? styles.clockHot : styles.clock} suppressHydrationWarning>
      {label}
    </span>
  );
}
