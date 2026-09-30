import type { Transition, Variants } from 'framer-motion';

/**
 * Aurora's motion language, defined once.
 *
 * Every animation in the app comes from this file. Scattering springs across twenty
 * components is how an interface ends up with six subtly different ideas of "fast" — and
 * the difference between a design that feels alive and one that feels twitchy is almost
 * entirely consistency.
 *
 * Two rules the earlier passes cost us:
 *
 * 1. **Damping stays at or above critical** (`damping ≥ 2√stiffness`). An underdamped
 *    spring overshoots and settles back, which reads as the element vibrating in place
 *    rather than arriving.
 * 2. **Opacity never rides a spring.** A spring reaches ~90% within a beat regardless of
 *    stiffness, so a fade driven by one snaps to visible and then crawls — it registers as
 *    a flash, not a fade. Opacity always gets its own tween, and it is always the slower
 *    half of the pair.
 */

/** The default: things arriving on screen. Critical damping for 260 is ~32. */
export const SPRING: Transition = { type: 'spring', stiffness: 260, damping: 34 };

/** For things responding to a pointer, where a beat of delay would feel broken. */
export const SPRING_SNAPPY: Transition = { type: 'spring', stiffness: 420, damping: 38 };

/**
 * A hover lift that cannot fight an entrance animation.
 *
 * Deliberately `scale` and not `y`: framer-motion composes the transform from independent
 * motion values, so a gesture writing `scale` and a variant writing `y` never contend. An
 * earlier version used `y` for both and the cards shook whenever the pointer happened to
 * be resting over the grid as a page mounted.
 */
export const LIFT = { scale: 1.012 } as const;

/** Parent of a group that should arrive in sequence rather than all at once. */
export const STAGGER = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.03 } },
} satisfies Variants;

/** The child of a STAGGER parent — and the app's single entrance animation. */
export const RISE = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { y: SPRING, opacity: { duration: 0.55, ease: 'easeOut' } },
  },
} satisfies Variants;

/** Same arrival, no group — for a single panel that is not part of a grid. */
export const RISE_ONCE = {
  initial: RISE.hidden,
  animate: RISE.show,
} as const;
