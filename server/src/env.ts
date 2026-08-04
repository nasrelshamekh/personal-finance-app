import { z } from 'zod';

/**
 * Every environment variable the server reads, validated once at boot.
 *
 * A missing DATABASE_URL should stop the process with a readable message, not surface
 * as an undefined halfway through the first request.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // One rule, one message: a missing and a malformed URL are the same fix, and two
  // messages for one field reads like two problems.
  DATABASE_URL: z
    .string()
    .regex(
      /^postgres(ql)?:\/\/.+/,
      'DATABASE_URL must be a postgresql:// connection string. Copy .env.example to .env at the repo root.',
    ),

  /**
   * Deliberately not `PORT`. That name is a convention meaning "serve the app here", and
   * outer tooling sets it freely — a preview runner setting PORT=5173 for the whole dev
   * command had the API try to bind the client's port. Node's `--env-file` does not
   * override an already-set variable, so `.env` could not win it back. An API-specific
   * name cannot be claimed by accident.
   */
  API_PORT: z.coerce.number().int().positive().max(65535).default(4000),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('debug'),

  /**
   * Comma-separated. Add a LAN address here to use the app from a phone; there is no
   * auth in v1, so this list is the only thing limiting who can reach the API.
   */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  FX_API_BASE_URL: z.string().url().default('https://open.er-api.com/v6/latest'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
