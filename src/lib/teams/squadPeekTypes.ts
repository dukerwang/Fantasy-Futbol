import type { BenchSlot, Formation, GranularPosition, RosterStatus } from '@/types';

/**
 * The squad-peek payload, shared by the route that builds it and the drawer
 * that draws it. Kept in `lib/` rather than exported from the route module so
 * the client bundle never has to reach into a file that imports the admin
 * Supabase client.
 */

export interface PeekPlayer {
  id: string;
  name: string;
  webName: string | null;
  pos: GranularPosition;
  plTeam: string | null;
  status: RosterStatus;
  ppg: number;
  points: number;
  value: number;
  fplStatus: string | null;
  photoUrl: string | null;
}

export interface SquadPeek {
  team: {
    id: string;
    name: string;
    manager: string;
    crestConfig: unknown | null;
    balance: number;
    isMine: boolean;
  };
  standing: {
    rank: number | null;
    ofTeams: number;
    w: number;
    d: number;
    l: number;
    pointsFor: number;
  };
  lineup: {
    formation: Formation;
    gameweek: number;
    /** True when the lineup came from a completed/live gameweek rather than an upcoming one. */
    played: boolean;
    starters: { slot: GranularPosition; player: PeekPlayer | null }[];
    bench: { slot: BenchSlot; player: PeekPlayer | null }[];
  } | null;
  /** Everyone not in the XI or on the named bench, grouped the way the club page groups them. */
  groups: { key: string; label: string; players: PeekPlayer[] }[];
  counts: { squad: number; academy: number; ir: number };
}
