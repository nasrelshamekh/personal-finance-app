import { useEffect, useState } from 'react';

/** Reads a media query reactively — used to pick a sheet's side, not to hide content. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Matches Tailwind's `md` breakpoint. */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 768px)');
}
