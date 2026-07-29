import TopBar from '@/components/layout/TopBar';
import { PlayerCardProvider } from '@/components/players/PlayerCardProvider';
import TeamLogoPreloader from '@/components/players/TeamLogoPreloader';
import styles from './layout.module.css';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <PlayerCardProvider>
      <TeamLogoPreloader />
      <TopBar />
      <main className={styles.main}>{children}</main>
    </PlayerCardProvider>
  );
}
