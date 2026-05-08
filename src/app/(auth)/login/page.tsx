import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import styles from './login.module.css';
import LoginForm from '@/components/auth/LoginForm';

export default function LoginPage() {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}><Icon name="activity" size={32} strokeWidth={2.5} /></span>
          <h1 className={styles.logoText}>Gaffa</h1>
        </div>
        <h2 className={styles.heading}>Welcome back</h2>
        <p className={styles.subheading}>Sign in to your account</p>
        <LoginForm />
        <p className={styles.switch}>
          Don&apos;t have an account? <a href="/signup">Sign up</a>
        </p>
      </div>
    </div>
  );
}
