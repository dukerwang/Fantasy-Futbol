'use client';

import { useState } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Icon } from '@/components/ui/Icon';
import styles from './guide.module.css';

interface Props {
  markdown?: string;
  error?: string;
  settingsHref?: string;
  isAuthenticated?: boolean;
}

export default function GuideView({
  markdown,
  error,
  settingsHref,
  isAuthenticated = true,
}: Props) {
  const [copied, setCopied] = useState(false);

  const backHref = settingsHref || (isAuthenticated ? '/settings' : '/login');
  const backLabel = isAuthenticated ? 'Back to Settings' : 'Back to Gaffa';

  const handleShare = async () => {
    const url = typeof window !== 'undefined' ? `${window.location.origin}/guide` : '';
    if (!url) return;

    if (navigator.share) {
      try {
        await navigator.share({
          title: "The Gaffa Player's Guide",
          text: 'Official rules, scoring system, and manager guide for Gaffa.',
          url,
        });
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
      }
    }

    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } catch (err) {
        console.error('Failed to copy guide link:', err);
      }
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <Link href={backHref} className={styles.back}>
          <Icon name="chevron-left" size={16} />
          {backLabel}
        </Link>
        <button
          type="button"
          className={`${styles.shareBtn} ${copied ? styles.shareBtnCopied : ''}`}
          onClick={handleShare}
          title="Share user guide"
          aria-label="Share user guide"
        >
          <Icon name={copied ? 'check' : 'share'} size={14} strokeWidth={1.75} />
          <span>{copied ? 'Link copied' : 'Share guide'}</span>
        </button>
      </div>

      {error ? (
        <p className={styles.error}>{error}</p>
      ) : (
        <article className={styles.prose}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown ?? ''}</ReactMarkdown>
        </article>
      )}
    </div>
  );
}
