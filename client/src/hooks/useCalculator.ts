import { useContext } from 'react';
import {
  CalculatorContext,
  type CalculatorContextValue,
} from '@/features/calculator/calculator-context';

export function useCalculator(): CalculatorContextValue {
  const context = useContext(CalculatorContext);
  if (context === null) {
    throw new Error('useCalculator must be used inside <CalculatorProvider>');
  }
  return context;
}
