'use client';

import { useRouter } from 'next/navigation';
import styles from './TeamSwitcher.module.css';

export interface TeamOption {
  id: string;
  team_name: string;
  league_name: string;
}

interface Props {
  teams: TeamOption[];
  activeTeamId: string;
}

export default function TeamSwitcher({ teams, activeTeamId }: Props) {
  const router = useRouter();

  if (teams.length <= 1) return null;

  return (
    <div className={styles.switcher}>
      <label htmlFor="team-switcher" className={styles.label}>
        Team
      </label>
      <select
        id="team-switcher"
        className={styles.select}
        value={activeTeamId}
        onChange={(e) => router.push(`/my-team?teamId=${e.target.value}`)}
      >
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.team_name} — {t.league_name}
          </option>
        ))}
      </select>
    </div>
  );
}
