import PublicTopBar from './PublicTopBar';
import styles from './share.module.css';

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PublicTopBar />
      <main className={styles.main}>{children}</main>
    </>
  );
}
