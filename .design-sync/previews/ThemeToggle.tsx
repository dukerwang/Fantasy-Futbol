import { ThemeToggle } from 'gaffa';

export function Default() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 24 }}>
      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--color-text-muted)' }}>
        Toggle theme
      </span>
      <ThemeToggle />
    </div>
  );
}
