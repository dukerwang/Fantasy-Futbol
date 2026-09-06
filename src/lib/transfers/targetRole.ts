/**
 * What LEVEL of player a club is looking for.
 *
 * A position alone is a thin statement — "an LB" could mean a €60m starter or
 * a body for the bench, and the clubs who could answer it have no way to tell
 * which. Pairing the position with the role turns a target into something a
 * seller can act on: "Starting left-back, up to €25m" tells you whether your
 * surplus full-back is what they mean.
 *
 * Roles are DESCRIPTIVE, not a matching filter. A prospect target still hears
 * about a 30-year-old left-back who hits the market, because judging whether a
 * player fits a role is the manager's job, not the query's. (Filtering
 * prospects by age is a plausible later refinement; it is deliberately not
 * here, so that no target silently misses a player it should have seen.)
 */

import { roleName } from '@/lib/scoring/perfBand';

export const TARGET_ROLES = ['star', 'starter', 'bench', 'prospect'] as const;
export type TargetRole = (typeof TARGET_ROLES)[number];

export function isTargetRole(value: unknown): value is TargetRole {
  return typeof value === 'string' && (TARGET_ROLES as readonly string[]).includes(value);
}

/** The editor's four choices, each with the line that tells them apart. */
export const TARGET_ROLE_OPTIONS: { role: TargetRole; label: string; hint: string }[] = [
  { role: 'star',     label: 'Star',     hint: 'A player the side is built around' },
  { role: 'starter',  label: 'Starter',  hint: 'Straight into the first eleven' },
  { role: 'bench',    label: 'Bench',    hint: 'Depth and rotation' },
  { role: 'prospect', label: 'Prospect', hint: 'Young, for the academy' },
];

/**
 * "Starting Left-Back" — how a role profile is titled on its card.
 *
 * Word order flips for a prospect because English puts it there: you look for
 * a starting left-back, but a left-back prospect.
 */
export function targetRoleTitle(role: TargetRole | null | undefined, position: string | null | undefined): string {
  const noun = titleCase(roleName(position));

  switch (role) {
    case 'star':     return `Star ${noun}`;
    case 'starter':  return `Starting ${noun}`;
    case 'bench':    return `Bench ${noun}`;
    case 'prospect': return `${noun} Prospect`;
    default:         return noun;
  }
}

/** Title Case that leaves hyphenated positions intact ("Left-Back"). */
function titleCase(text: string): string {
  return text.replace(/(^|[\s-])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}
