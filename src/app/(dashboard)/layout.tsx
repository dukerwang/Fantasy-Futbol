import TopBar from '@/components/layout/TopBar';
import styles from './layout.module.css';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TopBar />
      <main className={styles.main}>{children}</main>
    </>
  );
}
