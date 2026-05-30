import Link from 'next/link';
import styles from './terms.module.css';

export const metadata = {
  title: 'Terms of Service · Gaffa',
  description: 'Terms of Service and terms of use for the Gaffa fantasy football application.',
};

export default function TermsPage() {
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
          <h1 className={styles.title}>Terms of Service</h1>
          <p className={styles.subtitle}>Last updated: May 30, 2026</p>
        </header>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>1. Welcome to Gaffa</h2>
          <p className={styles.paragraph}>
            Thank you for using Gaffa! Gaffa is a dynasty-style fantasy football simulation platform designed to let football fans manage virtual squads, compete in matchups, execute strategic player transfers, and participate in active virtual auctions.
          </p>
          <p className={styles.paragraph}>
            By accessing or using our website located at https://gaffa.live (including all subdomains), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the application.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>2. Account Registration and Eligibility</h2>
          <p className={styles.paragraph}>
            To participate in Gaffa, you must sign up for an account (e.g., via Google OAuth). You agree to provide accurate, current, and complete information and maintain the security of your account credentials.
          </p>
          <ul className={styles.list}>
            <li className={styles.listItem}>You must be at least 13 years of age (or the minimum age of digital consent in your country).</li>
            <li className={styles.listItem}>You are responsible for all activities that occur under your Gaffa account.</li>
            <li className={styles.listItem}>Creation of multiple accounts by a single user to gain a competitive advantage in a league (multi-accounting) is strictly prohibited and constitutes grounds for immediate account suspension.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>3. Virtual Economy and In-Game Items</h2>
          <p className={styles.paragraph}>
            Gaffa includes in-game mechanics representing a virtual economy, including virtual cash, club balances, fantasy player cards, bid limits, and auctions.
          </p>
          <ul className={styles.list}>
            <li className={styles.listItem}>
              <strong>No Real-World Value:</strong> All virtual currency, cash, player values, and cards are strictly virtual resources designed solely for in-game entertainment. They have no real-world monetary value, cannot be redeemed for fiat currency, and do not represent any real-world asset or property.
            </li>
            <li className={styles.listItem}>
              <strong>Virtual Auctions:</strong> Transfer auctions and bidding processes are simulated mechanics based on virtual club balances. No real-world bidding, wagering, or gambling takes place on our platform.
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>4. Acceptable Conduct</h2>
          <p className={styles.paragraph}>
            We want Gaffa to be a competitive and fun environment. You agree not to engage in any activity that ruins league integrity, such as:
          </p>
          <ul className={styles.list}>
            <li className={styles.listItem}>Colluding or dumping players to intentionally benefit another team.</li>
            <li className={styles.listItem}>Using automated scripts, bots, or scrapers to perform actions in Gaffa.</li>
            <li className={styles.listItem}>Harassing, abusing, or posting offensive content in public chat channels.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>5. Disclaimers & Limitation of Liability</h2>
          <p className={styles.paragraph}>
            Gaffa is provided on an "AS IS" and "AS AVAILABLE" basis. While we strive to maintain high uptime and accurate statistics, we do not warrant that the application will be uninterrupted, error-free, or that the scoring engine data feeds will be 100% accurate or prompt.
          </p>
          <p className={styles.paragraph}>
            Under no circumstances shall Gaffa or its developers be liable for any direct, indirect, incidental, special, or consequential damages resulting from server downtime, lost matchup data, or in-game scoring calculation issues.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>6. Contact Us</h2>
          <p className={styles.paragraph}>
            If you have any questions or feedback regarding these Terms, please contact us at:
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
