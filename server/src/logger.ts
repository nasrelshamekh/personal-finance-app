import pino, { type LoggerOptions } from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

// Pretty output is a dev affordance only; production emits newline-delimited JSON.
// Spread rather than assigning `undefined` — `exactOptionalPropertyTypes` treats an
// explicit undefined as a real value, and pino's types reject it.
const transport: Pick<LoggerOptions, 'transport'> = isProduction
  ? {}
  : {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    };

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
  ...transport,
});

export type Logger = typeof logger;
