'use client';

import Link from 'next/link';
import ThemeToggle from '@/components/layout/ThemeToggle';
import { Icon } from '@/components/ui/Icon';
import styles from './share.module.css';

export default function PublicTopBar() {
  return (
    <nav className={styles.topBar}>
      <div className={styles.topBarInner}>
        <div className={styles.leftNav}>
          <Link href="/" className={styles.brand}>
            <span className={styles.brandIcon}>
              <Icon name="gaffa" size={20} strokeWidth={2} />
            </span>
            <span className={styles.brandName}>Gaffa</span>
          </Link>
          <span className={styles.publicBadge}>Global Stats</span>
        </div>

        <div className={styles.rightNav}>
          <ThemeToggle />
          <Link href="/login" className={styles.signInBtn}>
            Sign In
          </Link>
        </div>
      </div>
    </nav>
  );
}
