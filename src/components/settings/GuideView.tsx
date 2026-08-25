import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Icon } from '@/components/ui/Icon';
import styles from './guide.module.css';

interface Props {
  markdown?: string;
  error?: string;
  settingsHref: string;
}

export default function GuideView({ markdown, error, settingsHref }: Props) {
  return (
    <div className={styles.page}>
      <Link href={settingsHref} className={styles.back}>
        <Icon name="chevron-left" size={16} />
        Back to Settings
      </Link>

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
