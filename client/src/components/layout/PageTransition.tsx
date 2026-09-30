import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';

/**
 * Fades and lifts each route in as it mounts (SPEC §10 redesign). Keyed on `pathname` so
 * `AnimatePresence` treats every navigation as an exit/enter pair rather than a re-render —
 * without the key, React Router would swap `<Outlet />`'s children in place and nothing
 * would ever be seen leaving.
 *
 * `mode="wait"` is deliberately not used: waiting for the old page to finish exiting before
 * the new one enters is a visible pause on every single navigation. `initial={false}` is
 * what stops the very first page load from playing the animation before anyone has done
 * anything to react to.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
