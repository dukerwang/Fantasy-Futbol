import PublicTopBar from './PublicTopBar';
import { PlayerCardProvider } from '@/components/players/PlayerCardProvider';
import TeamLogoPreloader from '@/components/players/TeamLogoPreloader';
import styles from './share.module.css';

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return (
    // The public share pages reuse GlobalStatsTable, so they need the same card
    // provider the dashboard has — without it usePlayerCard throws on render.
    <PlayerCardProvider>
      <TeamLogoPreloader />
      <PublicTopBar />
      <main className={styles.main}>{children}</main>
    </PlayerCardProvider>
  );
}
