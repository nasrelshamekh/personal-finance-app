import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { NAV_ITEMS } from './navigation';

const APP_NAME = 'Ledger EG';

function titleFor(pathname: string): string {
  const match = NAV_ITEMS.find((item) =>
    item.to === '/' ? pathname === '/' : pathname.startsWith(item.to),
  );
  return match?.label ?? 'Not found';
}

/**
 * Announces navigation, and keeps the tab title in step.
 *
 * A client-side route change moves no focus and fires no page load, so a screen reader is
 * given nothing to say — you activate a nav link and, as far as it is concerned, nothing
 * happened. This says what you arrived at.
 *
 * The live region is deliberately empty on first render: the initial page load already
 * announces itself, and repeating it would be noise before anyone has done anything.
 */
export function RouteAnnouncer() {
  const { pathname } = useLocation();
  const [announcement, setAnnouncement] = useState('');
  const isFirstRender = useRef(true);

  useEffect(() => {
    const title = titleFor(pathname);
    document.title = `${title} · ${APP_NAME}`;
  }, [pathname]);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // A tick's delay so the region is already in the accessibility tree when it changes;
    // setting the text in the same frame it mounts is a change some readers never see.
    const timer = window.setTimeout(() => setAnnouncement(`${titleFor(pathname)} page`), 100);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  return (
    <p aria-live="polite" aria-atomic="true" className="sr-only">
      {announcement}
    </p>
  );
}
