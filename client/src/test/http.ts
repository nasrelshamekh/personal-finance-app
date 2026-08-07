import { vi } from 'vitest';

/**
 * A stand-in for the API, so a component test can assert on the request it *would* have
 * sent.
 *
 * That is the point rather than a side effect: for anything money-bearing, the interesting
 * question is not "did the sheet close" but "what exactly went over the wire" — the sign,
 * the shape, whether `toAmount` was omitted or sent as an empty string. Those are the bugs
 * that reach the database.
 *
 * `lib/api.ts` is the only thing in the app that calls `fetch`, so stubbing `fetch` covers
 * every request without mocking anything the app owns.
 */

export interface RecordedRequest {
  method: string;
  /** Path with the `/api` prefix stripped, e.g. `/transactions`. */
  path: string;
  /** Query parameters, if any. */
  query: URLSearchParams;
  /** The parsed JSON body, or `undefined` for a request that had none. */
  body: unknown;
}

interface StubbedResponse {
  status?: number;
  body?: unknown;
}

/** Keyed `"<METHOD> <path>"`, e.g. `"POST /transactions"`. */
export type ApiRoutes = Record<string, StubbedResponse | unknown>;

export interface ApiStub {
  requests: RecordedRequest[];
  /** Every request made to one route, in order. */
  requestsFor: (route: string) => RecordedRequest[];
  /** Replaces or adds a route mid-test — for making the second call fail. */
  setRoute: (route: string, response: StubbedResponse | unknown) => void;
  restore: () => void;
}

function isStubbedResponse(value: unknown): value is StubbedResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('status' in value || 'body' in value) &&
    !Array.isArray(value)
  );
}

export function stubApi(routes: ApiRoutes = {}): ApiStub {
  const table = new Map<string, StubbedResponse | unknown>(Object.entries(routes));
  const requests: RecordedRequest[] = [];
  const original = globalThis.fetch;

  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.origin);
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/api/, '');

    let body: unknown;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }

    requests.push({ method, path, query: url.searchParams, body });

    const match = table.get(`${method} ${path}`);
    if (match === undefined) {
      // Loud on purpose. A silent 404 here surfaces later as an empty dropdown and a
      // confusing assertion failure a hundred lines away.
      throw new Error(
        `No stub for ${method} ${path}. Add it to stubApi({ '${method} ${path}': … }).`,
      );
    }

    const { status = 200, body: responseBody } = isStubbedResponse(match) ? match : { body: match };

    return new Response(responseBody === undefined ? null : JSON.stringify(responseBody), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });

  globalThis.fetch = stub as unknown as typeof fetch;

  return {
    requests,
    requestsFor: (route) => {
      const [method, path] = route.split(' ');
      return requests.filter((request) => request.method === method && request.path === path);
    },
    setRoute: (route, response) => table.set(route, response),
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
