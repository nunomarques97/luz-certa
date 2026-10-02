import type { Page, Request } from '@playwright/test';

/** One outgoing request as the privacy test sees it. */
export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Raw body bytes as text, or null when the request has none. */
  body: string | null;
}

export interface Leak {
  url: string;
  reason: string;
}

/**
 * Checks recorded requests against the privacy rule: every request is a same-origin GET without a
 * body, and no URL, header or body carries any of the needles (marker values or the file name).
 * Needles are also searched URL-encoded, so `9,871` is found as `9%2C871`.
 */
export function findLeaks(
  requests: readonly RecordedRequest[],
  appOrigin: string,
  needles: readonly string[],
): Leak[] {
  const leaks: Leak[] = [];
  const variants = needles.flatMap((needle) => [
    needle,
    encodeURIComponent(needle),
    encodeURI(needle),
    needle.replace(/ /g, '+'),
  ]);
  const unique = [...new Set(variants.filter((variant) => variant.length > 0))];
  for (const request of requests) {
    let origin = '';
    try {
      origin = new URL(request.url).origin;
    } catch {
      leaks.push({ url: request.url, reason: 'URL cannot be parsed' });
      continue;
    }
    if (origin !== appOrigin && !request.url.startsWith('data:')) {
      leaks.push({ url: request.url, reason: `third-party origin ${origin}` });
    }
    if (request.method !== 'GET') {
      leaks.push({ url: request.url, reason: `method ${request.method}` });
    }
    if (request.body !== null && request.body.length > 0) {
      leaks.push({ url: request.url, reason: 'request has a body' });
    }
    const places: [string, string][] = [
      ['URL', request.url],
      ['body', request.body ?? ''],
      ...Object.entries(request.headers).map(
        ([name, value]): [string, string] => [`header ${name}`, `${name}: ${value}`],
      ),
    ];
    for (const [place, text] of places) {
      const lower = text.toLowerCase();
      for (const needle of unique) {
        if (lower.includes(needle.toLowerCase())) {
          leaks.push({ url: request.url, reason: `${place} contains "${needle}"` });
        }
      }
    }
  }
  return leaks;
}

/**
 * Records every request the page and its dedicated workers make (Playwright reports worker fetches
 * on the page), with the full header set and body. WebSocket connections are recorded as requests
 * with method WEBSOCKET, and every frame they send as its body, so the detector flags them too.
 * Call `settle()` before reading `requests` so pending header lookups finish.
 */
export function recordRequests(page: Page): {
  requests: RecordedRequest[];
  settle(): Promise<void>;
} {
  const requests: RecordedRequest[] = [];
  const pending: Promise<void>[] = [];
  const record = async (request: Request) => {
    let headers: Record<string, string>;
    try {
      headers = await request.allHeaders();
    } catch {
      headers = request.headers();
    }
    const buffer = request.postDataBuffer();
    requests.push({
      url: request.url(),
      method: request.method(),
      headers,
      body: buffer ? buffer.toString('latin1') : null,
    });
  };
  page.on('request', (request) => {
    pending.push(record(request));
  });
  page.on('websocket', (socket) => {
    const entry: RecordedRequest = { url: socket.url(), method: 'WEBSOCKET', headers: {}, body: null };
    requests.push(entry);
    socket.on('framesent', (frame) => {
      const payload = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('latin1');
      entry.body = (entry.body ?? '') + payload;
    });
  });
  return {
    requests,
    settle: async () => {
      await Promise.all(pending);
    },
  };
}
