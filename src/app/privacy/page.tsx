import Link from 'next/link';
import styles from '../terms/terms.module.css'; // Reuse terms styling for consistent layout

export const metadata = {
  title: 'Privacy Policy · Gaffa',
  description: 'Privacy Policy outlining the collection, use, and security of user data in Gaffa.',
};

export default function PrivacyPage() {
  return (
    <div className={styles.container}>
      <main className={styles.content}>
        <Link href="/login" className={styles.backBtn}>
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 3L5 8l5 5" />
          </svg>
          Back to Gaffa
        </Link>

        <header className={styles.header}>
          <h1 className={styles.title}>Privacy Policy</h1>
          <p className={styles.subtitle}>Last updated: May 30, 2026</p>
        </header>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>1. Introduction</h2>
          <p className={styles.paragraph}>
            Gaffa respects your privacy and is committed to protecting the personal data we collect when you access and play Gaffa. This Privacy Policy explains what information we collect, how we use it, and your rights concerning your personal data.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>2. Information We Collect</h2>
          <p className={styles.paragraph}>
            We only collect standard information necessary to authenticate you, manage your fantasy squad, and send you in-game notifications:
          </p>
          <ul className={styles.list}>
            <li className={styles.listItem}>
              <strong>Identity & Authentication Data:</strong> When you register or sign in via Google OAuth, we receive your email address, full name, profile picture, and a unique provider user ID.
            </li>
            <li className={styles.listItem}>
              <strong>Game Activity Data:</strong> We store your draft selections, player transfers, auction bids, lineups, and chat messages in Gaffa's database to run your leagues.
            </li>
            <li className={styles.listItem}>
              <strong>Usage Information:</strong> We may collect diagnostic data, session activity, and IP addresses to maintain security and resolve bugs.
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>3. How We Use Your Information</h2>
          <p className={styles.paragraph}>
            We use the collected information for the following limited purposes:
          </p>
          <ul className={styles.list}>
            <li className={styles.listItem}>To securely log you in and manage your Gaffa account.</li>
            <li className={styles.listItem}>To maintain and calculate league standings, draft boards, and player transfers.</li>
            <li className={styles.listItem}>To send you critical transaction emails (such as draft start notifications or trade alerts) via secure third-party email providers (Resend).</li>
            <li className={styles.listItem}>To troubleshoot technical issues and prevent fraudulent behavior.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>4. Data Sharing and Service Providers</h2>
          <p className={styles.paragraph}>
            <strong>We do not sell, rent, or trade your personal data with third parties for marketing purposes.</strong> We share your information only with core cloud infrastructure providers strictly to execute the game:
          </p>
          <ul className={styles.list}>
            <li className={styles.listItem}>
              <strong>Supabase:</strong> Our database and user session platform. Your data is stored securely in their encrypted infrastructure.
            </li>
            <li className={styles.listItem}>
              <strong>Resend:</strong> Used solely to send transactional system emails.
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>5. Cookies and Local Storage</h2>
          <p className={styles.paragraph}>
            Gaffa uses standard authentication cookies and local storage tokens to keep you logged in between sessions and remember your light/dark theme preference. No tracking or advertisement cookies are used on Gaffa.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>6. Your Rights & Data Deletion</h2>
          <p className={styles.paragraph}>
            You have the right to access your personal data or request that we delete your account and associated teams.
          </p>
          <p className={styles.paragraph}>
            If you would like to request that your account, email, and player profile be permanently deleted from Gaffa's database, please email us at <strong>support@gaffa.live</strong>, and we will fulfill your request in a prompt manner.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>7. Contact Us</h2>
          <p className={styles.paragraph}>
            For any privacy concerns or general questions, you can reach out to us at:
          </p>
          <p className={styles.paragraph}>
            Email: <strong>support@gaffa.live</strong>
          </p>
        </section>

        <footer className={styles.footer}>
          <p className={styles.footerText}>© 2026 Gaffa. All rights reserved.</p>
        </footer>
      </main>
    </div>
  );
}
