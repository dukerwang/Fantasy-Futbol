import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import JoinLeagueForm from './JoinLeagueForm';
import styles from './join.module.css';

export default async function JoinLeaguePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.breadcrumb}>
          <Link href="/dashboard">Dashboard</Link> / Join League
        </p>
        <h1 className={styles.title}>Join a League</h1>
        <p className={styles.subtitle}>Enter an invite code to join your friends' league.</p>
      </header>

      <div className={styles.formWrapper}>
        <JoinLeagueForm />
      </div>
    </div>
  );
}
