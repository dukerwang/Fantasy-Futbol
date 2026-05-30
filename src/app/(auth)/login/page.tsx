'use client';

import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import styles from './login.module.css';
import LoginForm from '@/components/auth/LoginForm';
import AuthShowcase from '@/components/auth/AuthShowcase';
import ThemeToggle from '@/components/layout/ThemeToggle';
import { Icon } from '@/components/ui/Icon';

export default function LoginPage() {
  const supabase = createClient();

  const handleOAuthSignIn = async (provider: 'google' | 'apple') => {
    await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  return (
    <div className={styles.shell}>
      {/* LEFT — Feature showcase carousel */}
      <div className={styles.showcaseSide}>
        <AuthShowcase />
      </div>

      {/* RIGHT — Sign-in form */}
      <main className={styles.formSide}>
        {/* Header link */}
        <div className={styles.topNav}>
          <span>New here?</span>
          <Link href="/signup" className={styles.topNavLink}>
            Create an account
          </Link>
        </div>

        {/* Brand stamp for mobile only */}
        <div className={styles.mobileBrand}>
          <span className={styles.brandIcon}>
            <Icon name="activity" size={24} strokeWidth={2.5} />
          </span>
          <span className={styles.brandName}>Gaffa</span>
        </div>

        <div className={styles.card}>
          <h2 className={styles.title}>Welcome back.</h2>
          <p className={styles.subtitle}>
            Sign in to manage your team, make transfers, and check your matchups.
          </p>

          <LoginForm />

          <div className={styles.divider}>
            <span>or continue with</span>
          </div>

          <div className={styles.providers}>
            <button
              onClick={() => handleOAuthSignIn('google')}
              type="button"
              className={styles.providerBtn}
              aria-label="Continue with Google"
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <path
                  d="M15.5 8.18c0-.55-.05-1.08-.14-1.59H8v3.01h4.21a3.6 3.6 0 01-1.56 2.36v1.96h2.52c1.47-1.36 2.33-3.36 2.33-5.74z"
                  fill="currentColor"
                />
                <path
                  d="M8 16c2.1 0 3.86-.7 5.15-1.89l-2.52-1.96c-.7.47-1.59.74-2.63.74-2.02 0-3.74-1.36-4.35-3.2H1.05v2.02A8 8 0 008 16z"
                  fill="currentColor"
                />
                <path
                  d="M3.65 9.69A4.8 4.8 0 013.4 8c0-.59.1-1.16.25-1.69V4.29H1.05A8 8 0 000 8a8 8 0 001.05 3.71l2.6-2.02z"
                  fill="currentColor"
                />
                <path
                  d="M8 3.18c1.14 0 2.16.39 2.97 1.16l2.22-2.22A8 8 0 008 0a8 8 0 00-6.95 4.29l2.6 2.02C4.26 4.54 5.98 3.18 8 3.18z"
                  fill="currentColor"
                />
              </svg>
              <span>Google</span>
            </button>
            <button
              onClick={() => handleOAuthSignIn('apple')}
              type="button"
              className={styles.providerBtn}
              aria-label="Continue with Apple"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16" aria-hidden="true">
                <path d="M11.18 8.5c-.02-1.97 1.61-2.92 1.69-2.97-.92-1.35-2.36-1.53-2.86-1.55-1.21-.13-2.38.71-3 .71-.62 0-1.58-.7-2.6-.68-1.34.02-2.58.78-3.27 1.98-1.4 2.42-.36 6 1.01 7.97.67.96 1.46 2.04 2.49 2 1-.04 1.38-.65 2.59-.65s1.55.65 2.6.63c1.07-.02 1.75-.98 2.4-1.94.76-1.11 1.07-2.18 1.09-2.24-.02-.01-2.09-.8-2.11-3.18zM9.4 2.78a3.07 3.07 0 00.71-2.21 3.13 3.13 0 00-2.04 1.06c-.45.5-.84 1.32-.74 2.13a2.6 2.6 0 002.07-.98z" />
              </svg>
              <span>Apple</span>
            </button>
          </div>

          <div className={styles.legal}>
            By signing in, you agree to the <Link href="/terms">Terms</Link> and{' '}
            <Link href="/privacy">Privacy Policy</Link>.
          </div>
        </div>

        {/* Theme switcher bottom indicator */}
        <div className={styles.themeToggleContainer}>
          <ThemeToggle />
        </div>
      </main>
    </div>
  );
}
