import { createContext } from 'react';

/**
 * The calculator's shared state, kept out of the provider component so that file exports
 * only components and Fast Refresh keeps working.
 */

export interface TapeEntry {
  id: string;
  /** What was typed, e.g. `1200*3+450`. */
  expression: string;
  /** The result, as a plain decimal string. */
  result: string;
  at: number;
}

/** Roughly the last twenty calculations (SPEC §8B). Older ones fall off the end. */
export const TAPE_LIMIT = 20;

export const TAPE_STORAGE_KEY = 'ledger.calculator.tape';

export interface CalculatorContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  tape: TapeEntry[];
  push: (expression: string, result: string) => void;
  clearTape: () => void;
  /**
   * Closes the calculator and drops the value into a new transaction.
   *
   * Not named `useValue`: a `use`-prefixed member read off a context looks like a hook to
   * the rules-of-hooks lint, which then forbids calling it from an event handler.
   */
  sendToTransaction: (value: string) => void;
}

export const CalculatorContext = createContext<CalculatorContextValue | null>(null);
