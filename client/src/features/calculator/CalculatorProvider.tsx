import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalculatorContext,
  TAPE_LIMIT,
  TAPE_STORAGE_KEY,
  type CalculatorContextValue,
  type TapeEntry,
} from './calculator-context';

function readTape(): TapeEntry[] {
  try {
    const raw = localStorage.getItem(TAPE_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (entry): entry is TapeEntry =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as TapeEntry).expression === 'string' &&
          typeof (entry as TapeEntry).result === 'string',
      )
      .slice(0, TAPE_LIMIT);
  } catch {
    // Corrupt or unavailable storage is not worth failing over — start with a blank tape.
    return [];
  }
}

/**
 * Holds the calculator's open state and its tape, and owns the global shortcut.
 *
 * The tape survives a reload because a running total you were part-way through is
 * exactly the thing you do not want to lose to an accidental refresh.
 */
export function CalculatorProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [tape, setTape] = useState<TapeEntry[]>(readTape);

  useEffect(() => {
    try {
      localStorage.setItem(TAPE_STORAGE_KEY, JSON.stringify(tape));
    } catch {
      // Not fatal; the tape simply won't survive this reload.
    }
  }, [tape]);

  const push = useCallback((expression: string, result: string) => {
    setTape((previous) =>
      [{ id: crypto.randomUUID(), expression, result, at: Date.now() }, ...previous].slice(
        0,
        TAPE_LIMIT,
      ),
    );
  }, []);

  const clearTape = useCallback(() => setTape([]), []);

  const sendToTransaction = useCallback(
    (value: string) => {
      setOpen(false);
      // One route in, the same one the FAB and `n` use, with the amount prefilled.
      navigate(`/transactions?new=1&amount=${encodeURIComponent(value)}`);
    },
    [navigate],
  );

  // `c` opens it from anywhere (SPEC §8B) — but never while you are typing somewhere else.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'c' || event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
          target.closest('[role="dialog"]') !== null)
      ) {
        return;
      }

      event.preventDefault();
      setOpen(true);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const value = useMemo<CalculatorContextValue>(
    () => ({ open, setOpen, tape, push, clearTape, sendToTransaction }),
    [open, tape, push, clearTape, sendToTransaction],
  );

  return <CalculatorContext.Provider value={value}>{children}</CalculatorContext.Provider>;
}
