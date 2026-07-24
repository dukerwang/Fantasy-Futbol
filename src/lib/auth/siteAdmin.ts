/**
 * Gaffa — Site Admin Check
 *
 * Distinct from a league "commissioner" (a regular user who owns/runs one
 * league). Site admin is the Gaffa operator — controls platform-wide actions
 * like season Reset/Kickoff across every league, not scoped to any one league.
 *
 * Identity is a plain email allowlist via env var (same trust model as
 * CRON_SECRET — no DB flag needed for a single-operator app).
 */

function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isSiteAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminEmails().includes(email.toLowerCase());
}
