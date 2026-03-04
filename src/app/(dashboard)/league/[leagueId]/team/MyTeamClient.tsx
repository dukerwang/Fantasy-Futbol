'use client';

import { useRouter, usePathname } from 'next/navigation';
import styles from './my-team.module.css';

interface Props {
  teamId: string;
  isEditMode: boolean;
}

export default function MyTeamClient({ teamId, isEditMode }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <button
      className={styles.editToggleBtn}
      onClick={() => {
        if (isEditMode) {
          router.push(pathname);
        } else {
          router.push(`${pathname}?mode=edit`);
        }
      }}
    >
      {isEditMode ? 'View Roster' : 'Edit Lineup'}
    </button>
  );
}
