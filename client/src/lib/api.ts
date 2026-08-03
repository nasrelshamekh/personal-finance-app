import type { ApiErrorBody } from '@ledger/shared';

/**
 * The one place the client talks to the API.
 *
 * Always same-origin relative URLs — Vite proxies `/api` to the server in dev, so the
 * app works unchanged from a phone on the LAN with no CORS dance and no base-URL config.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-level messages from a ZodError, keyed by path, for attaching to inputs. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};

    const result: Record<string, string> = {};
    for (const issue of this.details) {
      if (
        typeof issue === 'object' &&
        issue !== null &&
        'path' in issue &&
        'message' in issue &&
        typeof issue.path === 'string' &&
        typeof issue.message === 'string'
      ) {
        result[issue.path] = issue.message;
      }
    }
    return result;
  }
}

type Query = Record<string, string | number | boolean | undefined>;

function buildUrl(path: string, query?: Query): string {
  if (!query) return `/api${path}`;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `/api${path}?${search}` : `/api${path}`;
}

async function toError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return new ApiError(
      response.status,
      body.error?.code ?? 'UNKNOWN',
      body.error?.message ?? 'Something went wrong.',
      body.error?.details,
    );
  } catch {
    // A non-JSON error body means the server did not get far enough to format one.
    return new ApiError(response.status, 'UNKNOWN', `The server answered ${response.status}.`);
  }
}

async function request<T>(
  method: string,
  path: string,
  init: { query?: Query; body?: unknown } = {},
) {
  const response = await fetch(buildUrl(path, init.query), {
    method,
    ...(init.body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }),
  });

  if (!response.ok) throw await toError(response);
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, query ? { query } : {}),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
