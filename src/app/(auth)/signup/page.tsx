import styles from '../login/login.module.css';
import SignupForm from '@/components/auth/SignupForm';

export default function SignupPage() {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>⚽</span>
          <h1 className={styles.logoText}>Fantasy Futbol</h1>
        </div>
        <h2 className={styles.heading}>Create your account</h2>
        <p className={styles.subheading}>Join a dynasty league today</p>
        <SignupForm />
        <p className={styles.switch}>
          Already have an account? <a href="/login">Sign in</a>
        </p>
      </div>
    </div>
  );
}
