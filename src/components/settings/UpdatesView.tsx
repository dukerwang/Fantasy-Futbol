import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Icon } from '@/components/ui/Icon';
import type { ProductUpdate } from '@/lib/updates/getProductUpdates';
import styles from './updates.module.css';

interface Props {
  updates: ProductUpdate[];
}

function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function UpdatesView({ updates }: Props) {
  const groups: { month: string; entries: ProductUpdate[] }[] = [];
  for (const entry of updates) {
    const month = monthLabel(entry.published_at);
    const group = groups[groups.length - 1];
    if (group && group.month === month) {
      group.entries.push(entry);
    } else {
      groups.push({ month, entries: [entry] });
    }
  }

  return (
    <div className={styles.page}>
      <Link href="/help" className={styles.back}>
        <Icon name="chevron-left" size={16} />
        Back to Help
      </Link>

      <h1 className={styles.pageTitle}>What&rsquo;s New</h1>

      {updates.length === 0 ? (
        <p className={styles.empty}>Nothing published yet — check back soon.</p>
      ) : (
        groups.map((group) => (
          <section key={group.month} className={styles.monthGroup}>
            <h2 className={styles.monthHeading}>{group.month}</h2>
            {group.entries.map((entry) => (
              <article key={entry.id} id={entry.slug} className={styles.entry}>
                <div className={styles.entryMeta}>
                  <span className={styles.entryDate}>{dayLabel(entry.published_at)}</span>
                  {entry.is_major && <span className={styles.majorBadge}>Big update</span>}
                </div>
                <h3 className={styles.entryTitle}>{entry.title}</h3>
                <div className={styles.prose}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.body}</ReactMarkdown>
                </div>
              </article>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
