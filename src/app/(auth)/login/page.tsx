'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import styles from './login.module.css';
import LoginForm from '@/components/auth/LoginForm';
import AuthShowcase from '@/components/auth/AuthShowcase';
import ThemeToggle from '@/components/layout/ThemeToggle';
import { Icon } from '@/components/ui/Icon';

function LoginCard() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const errorParam = searchParams.get('error');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const isEnvMissing = !supabaseUrl.startsWith('http') || !supabaseKey;

  const error = isEnvMissing
    ? 'Supabase environment variables are missing in Vercel. Please add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your Vercel project settings.'
    : errorParam;

  const handleOAuthSignIn = async (provider: 'google' | 'apple') => {
    if (isEnvMissing) return;
    await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Welcome back.</h2>
      <p className={styles.subtitle}>
        Sign in to manage your team, make transfers, and check your matchups.
      </p>

      {error && (
        <div className={styles.errorBanner}>
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </div>
      )}

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
          <span>Continue with Google</span>
        </button>
      </div>

      <div className={styles.legal}>
        By signing in, you agree to the <Link href="/terms">Terms</Link> and{' '}
        <Link href="/privacy">Privacy Policy</Link>.
      </div>
    </div>
  );
}

export default function LoginPage() {
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

        <Suspense fallback={
          <div className={styles.card} style={{ minHeight: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>Loading...</span>
          </div>
        }>
          <LoginCard />
        </Suspense>

        {/* Theme switcher bottom indicator */}
        <div className={styles.themeToggleContainer}>
          <ThemeToggle />
        </div>
      </main>
    </div>
  );
}
