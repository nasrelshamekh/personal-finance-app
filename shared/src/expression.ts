import { Decimal } from './decimal';

/**
 * A shunting-yard arithmetic parser for the money inputs (SPEC §8).
 *
 * No `eval`, no `Function` constructor, no `mathjs` — a money field is the last place to
 * hand arbitrary text to a code path that can execute it. One implementation lives here
 * in `shared/` so the client preview and the server's accepted input cannot drift.
 *
 * Supports: + - * / %, parentheses, unary minus and plus, decimals.
 * Returns a `Decimal`; never rounds — callers decide precision via `money.ts`.
 */

export type ExpressionErrorCode =
  'EmptyExpression' | 'UnexpectedToken' | 'UnbalancedParen' | 'DivideByZero';

export interface ExpressionError {
  code: ExpressionErrorCode;
  /** Plain language, no apology — this is rendered inline under the field (SPEC §10). */
  message: string;
  /** Index into the source string, for pointing at the offending character. */
  position: number;
}

export type ExpressionResult = { ok: true; value: Decimal } | { ok: false; error: ExpressionError };

type BinaryOperator = '+' | '-' | '*' | '/' | '%';
type UnaryOperator = 'u+' | 'u-';
type Operator = BinaryOperator | UnaryOperator;

type Token =
  | { kind: 'number'; value: string; position: number }
  | { kind: 'operator'; value: Operator; position: number }
  | { kind: 'lparen'; position: number }
  | { kind: 'rparen'; position: number };

interface OperatorInfo {
  precedence: number;
  associativity: 'left' | 'right';
  arity: 1 | 2;
}

const OPERATORS: Record<Operator, OperatorInfo> = {
  '+': { precedence: 1, associativity: 'left', arity: 2 },
  '-': { precedence: 1, associativity: 'left', arity: 2 },
  '*': { precedence: 2, associativity: 'left', arity: 2 },
  '/': { precedence: 2, associativity: 'left', arity: 2 },
  '%': { precedence: 2, associativity: 'left', arity: 2 },
  'u+': { precedence: 3, associativity: 'right', arity: 1 },
  'u-': { precedence: 3, associativity: 'right', arity: 1 },
};

const BINARY_OPERATORS = new Set(['+', '-', '*', '/', '%']);

function fail(code: ExpressionErrorCode, message: string, position: number): ExpressionResult {
  return { ok: false, error: { code, message, position } };
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/**
 * Tokenises, deciding unary vs binary from what came before: a `-` is unary at the start
 * of the expression, after another operator, or after an opening paren.
 */
function tokenise(input: string): Token[] | ExpressionError {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    if (ch === undefined) break;

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }

    if (isDigit(ch) || ch === '.') {
      const start = i;
      let seenDot = false;

      while (i < input.length) {
        const c = input[i];
        if (c !== undefined && isDigit(c)) {
          i += 1;
        } else if (c === '.') {
          if (seenDot) {
            return {
              code: 'UnexpectedToken',
              message: 'That number has two decimal points.',
              position: i,
            };
          }
          seenDot = true;
          i += 1;
        } else {
          break;
        }
      }

      let raw = input.slice(start, i);
      // Tolerate the shapes you get mid-typing: `.5` and `5.` are both meant as numbers.
      if (raw.startsWith('.')) raw = `0${raw}`;
      if (raw.endsWith('.')) raw = `${raw}0`;
      if (raw === '0.0' && input.slice(start, i) === '.') {
        return { code: 'UnexpectedToken', message: 'A lone "." is not a number.', position: start };
      }

      tokens.push({ kind: 'number', value: raw, position: start });
      continue;
    }

    if (ch === '(') {
      tokens.push({ kind: 'lparen', position: i });
      i += 1;
      continue;
    }

    if (ch === ')') {
      tokens.push({ kind: 'rparen', position: i });
      i += 1;
      continue;
    }

    if (BINARY_OPERATORS.has(ch)) {
      const previous = tokens[tokens.length - 1];
      const isUnaryPosition =
        previous === undefined || previous.kind === 'operator' || previous.kind === 'lparen';

      if (isUnaryPosition) {
        if (ch === '-' || ch === '+') {
          tokens.push({ kind: 'operator', value: ch === '-' ? 'u-' : 'u+', position: i });
          i += 1;
          continue;
        }
        return {
          code: 'UnexpectedToken',
          message: `"${ch}" needs a number before it.`,
          position: i,
        };
      }

      tokens.push({ kind: 'operator', value: ch as BinaryOperator, position: i });
      i += 1;
      continue;
    }

    return {
      code: 'UnexpectedToken',
      message: `"${ch}" isn't something I can calculate.`,
      position: i,
    };
  }

  return tokens;
}

/** Shunting-yard: infix tokens in, reverse-polish out. */
function toRpn(tokens: readonly Token[]): Token[] | ExpressionError {
  const output: Token[] = [];
  const stack: Token[] = [];

  for (const token of tokens) {
    switch (token.kind) {
      case 'number':
        output.push(token);
        break;

      case 'operator': {
        const info = OPERATORS[token.value];
        while (stack.length > 0) {
          const top = stack[stack.length - 1];
          if (top === undefined || top.kind !== 'operator') break;

          const topInfo = OPERATORS[top.value];
          const shouldPop =
            topInfo.precedence > info.precedence ||
            (topInfo.precedence === info.precedence && info.associativity === 'left');
          if (!shouldPop) break;

          output.push(top);
          stack.pop();
        }
        stack.push(token);
        break;
      }

      case 'lparen':
        stack.push(token);
        break;

      case 'rparen': {
        let foundLeft = false;
        while (stack.length > 0) {
          const top = stack.pop();
          if (top === undefined) break;
          if (top.kind === 'lparen') {
            foundLeft = true;
            break;
          }
          output.push(top);
        }
        if (!foundLeft) {
          return {
            code: 'UnbalancedParen',
            message: 'There is a ")" with no matching "(".',
            position: token.position,
          };
        }
        break;
      }
    }
  }

  while (stack.length > 0) {
    const top = stack.pop();
    if (top === undefined) break;
    if (top.kind === 'lparen') {
      return {
        code: 'UnbalancedParen',
        message: 'There is a "(" that was never closed.',
        position: top.position,
      };
    }
    output.push(top);
  }

  return output;
}

function evaluateRpn(rpn: readonly Token[]): ExpressionResult {
  const stack: Decimal[] = [];

  for (const token of rpn) {
    if (token.kind === 'number') {
      stack.push(new Decimal(token.value));
      continue;
    }

    if (token.kind !== 'operator') {
      return fail('UnexpectedToken', 'That expression is not complete.', token.position);
    }

    const info = OPERATORS[token.value];

    if (info.arity === 1) {
      const operand = stack.pop();
      if (operand === undefined) {
        return fail('UnexpectedToken', 'That sign has no number after it.', token.position);
      }
      stack.push(token.value === 'u-' ? operand.negated() : operand);
      continue;
    }

    const right = stack.pop();
    const left = stack.pop();
    if (left === undefined || right === undefined) {
      return fail('UnexpectedToken', 'An operator is missing one of its numbers.', token.position);
    }

    switch (token.value) {
      case '+':
        stack.push(left.plus(right));
        break;
      case '-':
        stack.push(left.minus(right));
        break;
      case '*':
        stack.push(left.times(right));
        break;
      case '/':
        if (right.isZero()) {
          return fail('DivideByZero', 'You cannot divide by zero.', token.position);
        }
        stack.push(left.dividedBy(right));
        break;
      case '%':
        if (right.isZero()) {
          return fail('DivideByZero', 'You cannot take a remainder of zero.', token.position);
        }
        stack.push(left.modulo(right));
        break;
    }
  }

  if (stack.length !== 1) {
    return fail(
      'UnexpectedToken',
      stack.length === 0 ? 'There is nothing to calculate.' : 'That expression is not complete.',
      0,
    );
  }

  const result = stack[0];
  if (result === undefined || !result.isFinite()) {
    return fail('UnexpectedToken', 'That does not work out to a number.', 0);
  }

  return { ok: true, value: result };
}

/**
 * Evaluates an arithmetic expression. Never throws — invalid input comes back as a typed
 * error so the field can show a quiet inline message rather than a toast.
 */
export function evaluateExpression(input: string): ExpressionResult {
  if (input.trim() === '') {
    return fail('EmptyExpression', 'Enter an amount.', 0);
  }

  const tokens = tokenise(input);
  if (!Array.isArray(tokens)) {
    return { ok: false, error: tokens };
  }
  if (tokens.length === 0) {
    return fail('EmptyExpression', 'Enter an amount.', 0);
  }

  const rpn = toRpn(tokens);
  if (!Array.isArray(rpn)) {
    return { ok: false, error: rpn };
  }

  return evaluateRpn(rpn);
}

/** True when the text is more than a plain number, i.e. worth showing a live preview for. */
export function isExpression(input: string): boolean {
  return /[+\-*/%()]/.test(input.trim().replace(/^[+-]/, ''));
}
