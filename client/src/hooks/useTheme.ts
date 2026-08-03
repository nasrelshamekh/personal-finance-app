import { useContext } from 'react';
import { ThemeContext, type ThemeContextValue } from '@/providers/theme-context';

/** Kept out of ThemeProvider.tsx so the module exports components only (react-refresh). */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === null) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return context;
}
