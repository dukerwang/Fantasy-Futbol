'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import styles from './settings.module.css';

const REPORT_TYPES = ['Bug', 'Feedback', 'Feature', 'Other'] as const;

interface Props {
  leagueId?: string | null;
}

export default function HelpClient({ leagueId = null }: Props) {
  const [reportType, setReportType] = useState<(typeof REPORT_TYPES)[number]>('Bug');
  const [reportMessage, setReportMessage] = useState('');
  const [reportStatus, setReportStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle');
  const [reportError, setReportError] = useState<string | null>(null);

  const guideHref = leagueId ? `/league/${leagueId}/guide` : '/guide';

  async function submitReport(e: FormEvent) {
    e.preventDefault();
    if (!reportMessage.trim()) {
      setReportStatus('error');
      setReportError('Write a short message before sending.');
      return;
    }

    setReportStatus('sending');
    setReportError(null);

    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: reportType,
          message: reportMessage.trim(),
          leagueId: leagueId || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReportStatus('error');
        setReportError(typeof data.error === 'string' ? data.error : 'Could not send the report.');
        return;
      }
      setReportMessage('');
      setReportStatus('ok');
    } catch {
      setReportStatus('error');
      setReportError('Could not send the report.');
    }
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Help</h1>

      <section className={styles.section}>
        <div className={styles.panel}>
          <Link href={guideHref} className={styles.linkRow} onClick={() => window.dispatchEvent(new Event('navigation-start'))}>
            <span>User guide</span>
            <Icon name="chevron-right" size={16} className={styles.linkChevron} />
          </Link>

          <Link href="/updates" className={styles.linkRow} onClick={() => window.dispatchEvent(new Event('navigation-start'))}>
            <span>What&rsquo;s new</span>
            <Icon name="chevron-right" size={16} className={styles.linkChevron} />
          </Link>

          <form className={styles.form} onSubmit={submitReport}>
            <div>
              <div className={styles.fieldLabel}>Report a problem</div>
              <select
                className={styles.select}
                value={reportType}
                onChange={(e) => setReportType(e.target.value as (typeof REPORT_TYPES)[number])}
                aria-label="Report type"
              >
                {REPORT_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={styles.fieldLabel} htmlFor="help-report-message">Message</label>
              <textarea
                id="help-report-message"
                className={styles.textarea}
                value={reportMessage}
                onChange={(e) => {
                  setReportMessage(e.target.value);
                  if (reportStatus !== 'idle') setReportStatus('idle');
                }}
                placeholder="What happened, and what did you expect?"
                required
              />
            </div>
            <div className={styles.formActions}>
              <button type="submit" className={styles.submit} disabled={reportStatus === 'sending'}>
                {reportStatus === 'sending' ? 'Sending…' : 'Send report'}
              </button>
              {reportStatus === 'ok' && (
                <span className={`${styles.formStatus} ${styles.formOk}`}>Sent. Thanks.</span>
              )}
              {reportStatus === 'error' && (
                <span className={`${styles.formStatus} ${styles.formError}`}>{reportError}</span>
              )}
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
