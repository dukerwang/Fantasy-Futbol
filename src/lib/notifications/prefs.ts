export const NOTIFICATION_KINDS = ['auctions', 'deals', 'matchdays', 'chat', 'club', 'product'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_CHANNELS = ['push', 'email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export type ChannelPrefs = { push: boolean; email: boolean };
export type NotificationPrefs = Record<NotificationKind, ChannelPrefs>;

/** Defaults match today's send policy. Chat has no email template. */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  auctions: { push: true, email: true },
  deals: { push: true, email: true },
  matchdays: { push: true, email: true },
  chat: { push: true, email: false },
  club: { push: true, email: true },
  product: { push: false, email: false },
};

export const KIND_LABELS: Record<NotificationKind, { label: string; hint: string }> = {
  auctions: {
    label: 'Auctions',
    hint: 'Lots, bids, outbids, and results',
  },
  deals: {
    label: 'Deals',
    hint: 'Trades and loans',
  },
  matchdays: {
    label: 'Matchdays',
    hint: 'League results and cup ties',
  },
  chat: {
    label: 'Chat',
    hint: 'Direct messages',
  },
  club: {
    label: 'Club',
    hint: 'Draft, season start, drops, and departures',
  },
  product: {
    label: 'Gaffa updates',
    hint: 'New features and big changes to the app',
  },
};

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === 'string' && (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

export function isNotificationChannel(value: unknown): value is NotificationChannel {
  return typeof value === 'string' && (NOTIFICATION_CHANNELS as readonly string[]).includes(value);
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Merge stored JSON with defaults. A missing key is not off. Unknown kinds
 * are ignored so a stale extra key cannot break the grid.
 */
export function resolvePrefs(raw: unknown): NotificationPrefs {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};

  const out = { ...DEFAULT_NOTIFICATION_PREFS };
  for (const kind of NOTIFICATION_KINDS) {
    const row = src[kind];
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const rec = row as Record<string, unknown>;
    out[kind] = {
      push: asBoolean(rec.push, DEFAULT_NOTIFICATION_PREFS[kind].push),
      email: asBoolean(rec.email, DEFAULT_NOTIFICATION_PREFS[kind].email),
    };
  }
  return out;
}

export function mergePref(
  raw: unknown,
  kind: NotificationKind,
  channel: NotificationChannel,
  enabled: boolean,
): NotificationPrefs {
  const next = resolvePrefs(raw);
  next[kind] = { ...next[kind], [channel]: enabled };
  return next;
}

/**
 * Whether this user should receive `channel` for `kind`. Unknown kinds send
 * rather than drop — a typo must not silently swallow mail.
 */
export function wantsChannel(
  raw: unknown,
  kind: string,
  channel: NotificationChannel,
): boolean {
  if (!isNotificationKind(kind)) return true;
  return resolvePrefs(raw)[kind][channel];
}
