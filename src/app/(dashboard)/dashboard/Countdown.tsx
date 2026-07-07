'use client';

import { useEffect, useState } from 'react';

function formatRemaining(target: number): string {
  const diff = Math.max(0, target - Date.now());
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
}

export default function Countdown({ deadline, className }: { deadline: string; className?: string }) {
  const target = new Date(deadline).getTime();
  const [label, setLabel] = useState(() => formatRemaining(target));

  useEffect(() => {
    const id = setInterval(() => setLabel(formatRemaining(target)), 30000);
    return () => clearInterval(id);
  }, [target]);

  return (
    <span className={className} suppressHydrationWarning>
      {label}
    </span>
  );
}
