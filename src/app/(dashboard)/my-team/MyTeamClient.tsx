'use client';

import { useRouter } from 'next/navigation';
import styles from './my-team.module.css';

interface Props {
  teamId: string;
  isEditMode: boolean;
}

export default function MyTeamClient({ teamId, isEditMode }: Props) {
  const router = useRouter();

  return (
    <button
      className={styles.editToggleBtn}
      onClick={() => {
        if (isEditMode) {
          router.push(`/my-team?teamId=${teamId}`);
        } else {
          router.push(`/my-team?teamId=${teamId}&mode=edit`);
        }
      }}
    >
      {isEditMode ? 'View Roster' : 'Edit Lineup'}
    </button>
  );
}
