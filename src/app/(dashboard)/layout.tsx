import TopBar from '@/components/layout/TopBar';
import { PlayerCardProvider } from '@/components/players/PlayerCardProvider';
import { SquadPeekProvider } from '@/components/teams/SquadPeekProvider';
import TeamLogoPreloader from '@/components/players/TeamLogoPreloader';
import UpdateAnnouncementModal from '@/components/layout/UpdateAnnouncementModal';
import { LeagueChatProvider } from '@/components/chat/LeagueChatContext';
import LeagueChatWidget from '@/components/chat/LeagueChatWidget';
import PushAutoSync from '@/components/layout/PushAutoSync';
import PushBanner from '@/components/layout/PushBanner';
import styles from './layout.module.css';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <PlayerCardProvider>
      {/* Inside the card provider: the player card's owner crest opens a peek,
          so the peek must be able to mount over an already-open card. */}
      <SquadPeekProvider>
        <LeagueChatProvider>
          <TeamLogoPreloader />
          <TopBar />
          <PushAutoSync />
          <UpdateAnnouncementModal />
          <div className={styles.ground}>
            <PushBanner />
            <main className={styles.main}>{children}</main>
          </div>
          <LeagueChatWidget />
        </LeagueChatProvider>
      </SquadPeekProvider>
    </PlayerCardProvider>
  );
}
