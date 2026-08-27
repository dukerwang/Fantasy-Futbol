import TopBar from '@/components/layout/TopBar';
import { PlayerCardProvider } from '@/components/players/PlayerCardProvider';
import { SquadPeekProvider } from '@/components/teams/SquadPeekProvider';
import TeamLogoPreloader from '@/components/players/TeamLogoPreloader';
import UpdateAnnouncementModal from '@/components/layout/UpdateAnnouncementModal';
import styles from './layout.module.css';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <PlayerCardProvider>
      {/* Inside the card provider: the player card's owner crest opens a peek,
          so the peek must be able to mount over an already-open card. */}
      <SquadPeekProvider>
        <TeamLogoPreloader />
        <TopBar />
        <UpdateAnnouncementModal />
        <div className={styles.ground}>
          <main className={styles.main}>{children}</main>
        </div>
      </SquadPeekProvider>
    </PlayerCardProvider>
  );
}
