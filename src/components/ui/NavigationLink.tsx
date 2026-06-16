'use client';

import Link from 'next/link';
import { ComponentProps, ReactNode } from 'react';

type Props = ComponentProps<typeof Link> & { children: ReactNode };

/**
 * Drop-in replacement for next/link that triggers the TopBar loading bar
 * by dispatching a global 'navigation-start' custom event on click.
 * Works from any server or client component without prop drilling.
 */
export default function NavigationLink({ children, onClick, ...props }: Props) {
  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    window.dispatchEvent(new Event('navigation-start'));
    if (onClick) (onClick as React.MouseEventHandler<HTMLAnchorElement>)(e);
  }
  return (
    <Link {...props} onClick={handleClick}>
      {children}
    </Link>
  );
}
