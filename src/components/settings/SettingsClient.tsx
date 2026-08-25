'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useTheme } from '@/context/ThemeContext';
import { Icon } from '@/components/ui/Icon';
import NotificationsToggle from '@/components/layout/NotificationsToggle';
import LeaveLeagueButton from '@/components/settings/LeaveLeagueButton';
import {
  KIND_LABELS,
  NOTIFICATION_KINDS,
  resolvePrefs,
  type NotificationChannel,
  type NotificationKind,
  type NotificationPrefs,
} from '@/lib/notifications/prefs';
import styles from './settings.module.css';

const REPORT_TYPES = ['Bug', 'Feedback', 'Feature', 'Other'] as const;

interface Props {
  leagueId?: string | null;
  leagueName?: string | null;
  isCommissioner?: boolean;
  initialPrefs: NotificationPrefs;
}

export default function SettingsClient({
  leagueId = null,
  leagueName = null,
  isCommissioner = false,
  initialPrefs,
}: Props) {
  const { theme, setTheme } = useTheme();
  const [prefs, setPrefs] = useState<NotificationPrefs>(initialPrefs);
  const [pending, setPending] = useState<string | null>(null);

  const [reportType, setReportType] = useState<(typeof REPORT_TYPES)[number]>('Bug');
  const [reportMessage, setReportMessage] = useState('');
  const [reportStatus, setReportStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle');
  const [reportError, setReportError] = useState<string | null>(null);

  const guideHref = leagueId ? `/league/${leagueId}/guide` : '/guide';
  const crestHref = leagueId ? `/league/${leagueId}/crest` : null;

  useEffect(() => {
    setPrefs(initialPrefs);
  }, [initialPrefs]);

  async function togglePref(kind: NotificationKind, channel: NotificationChannel) {
    if (kind === 'chat' && channel === 'email') return;

    const key = `${kind}:${channel}`;
    const previous = prefs;
    const nextEnabled = !prefs[kind][channel];
    const optimistic = {
      ...prefs,
      [kind]: { ...prefs[kind], [channel]: nextEnabled },
    };
    setPrefs(optimistic);
    setPending(key);

    try {
      const res = await fetch('/api/user/notification-prefs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, channel, enabled: nextEnabled }),
      });
      if (!res.ok) throw new Error('save failed');
      const data = await res.json();
      setPrefs(resolvePrefs(data.prefs));
    } catch {
      setPrefs(previous);
    } finally {
      setPending(null);
    }
  }

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

  const themeIsDark = theme === 'dark';

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Settings</h1>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Appearance</h2>
        <p className={styles.sectionHint}>Theme for this browser. Same control as the top bar.</p>
        <div className={styles.panel}>
          <div className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.rowLabel}>Dark mode</span>
              <span className={styles.rowMeta}>{themeIsDark ? 'On' : 'Off'}</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={themeIsDark}
              aria-label="Toggle dark mode"
              className={`${styles.switch} ${themeIsDark ? styles.switchOn : ''}`}
              onClick={() => setTheme(themeIsDark ? 'light' : 'dark')}
            >
              <span className={styles.switchThumb} />
            </button>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Notifications</h2>
        <p className={styles.sectionHint}>
          In-game mail always arrives. Push and email follow the switches below.
        </p>
        <div className={styles.panel}>
          <div className={styles.deviceBlock}>
            <NotificationsToggle />
          </div>

          <div className={styles.gridHead}>
            <span>Category</span>
            <span className={styles.cellCenter}>Push</span>
            <span className={styles.cellCenter}>Email</span>
          </div>

          {NOTIFICATION_KINDS.map((kind) => {
            const meta = KIND_LABELS[kind];
            const row = prefs[kind];
            return (
              <div key={kind} className={styles.gridRow}>
                <div className={styles.rowMain}>
                  <span className={styles.rowLabel}>{meta.label}</span>
                  <span className={styles.rowMeta}>{meta.hint}</span>
                </div>
                <div className={styles.cellCenter}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={row.push}
                    aria-label={`${meta.label} push`}
                    disabled={pending === `${kind}:push`}
                    className={`${styles.switch} ${row.push ? styles.switchOn : ''}`}
                    onClick={() => togglePref(kind, 'push')}
                  >
                    <span className={styles.switchThumb} />
                  </button>
                </div>
                <div className={styles.cellCenter}>
                  {kind === 'chat' ? (
                    <span className={styles.dash} title="No email for chat">—</span>
                  ) : (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={row.email}
                      aria-label={`${meta.label} email`}
                      disabled={pending === `${kind}:email`}
                      className={`${styles.switch} ${row.email ? styles.switchOn : ''}`}
                      onClick={() => togglePref(kind, 'email')}
                    >
                      <span className={styles.switchThumb} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Help</h2>
        <div className={styles.panel}>
          <Link href={guideHref} className={styles.linkRow} onClick={() => window.dispatchEvent(new Event('navigation-start'))}>
            <span>User guide</span>
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
              <label className={styles.fieldLabel} htmlFor="settings-report-message">Message</label>
              <textarea
                id="settings-report-message"
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

      {leagueId && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>League</h2>
          {leagueName && (
            <p className={styles.sectionHint}>{leagueName}</p>
          )}
          <div className={styles.panel}>
            {crestHref && (
              <Link href={crestHref} className={styles.linkRow} onClick={() => window.dispatchEvent(new Event('navigation-start'))}>
                <span>Edit crest</span>
                <Icon name="chevron-right" size={16} className={styles.linkChevron} />
              </Link>
            )}
            <div className={styles.dangerWrap}>
              <LeaveLeagueButton leagueId={leagueId} isCommissioner={isCommissioner} />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
