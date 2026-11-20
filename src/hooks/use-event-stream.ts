import { useEffect, useRef, useState } from 'react';
import { clusterName } from '../plugin-api';

// A lifecycle event, as served by GET /v1/clusters/{cluster}/events
// (OpenEverest 2.0.0-alpha.1+).
export type LifecycleEvent = {
  name: string;
  cursor: string;
  occurredAt: string;
  // Kind and reason, e.g. instance.phase-changed.
  type: string;
  reason: string;
  severity: 'Normal' | 'Warning';
  cluster: string;
  namespace?: string;
  object: { apiVersion?: string; kind: string; name: string; uid?: string };
  actor?: { type: 'user' | 'system' | 'kubernetes-client'; id?: string };
  phase?: { from?: string; to?: string };
  instance?: string;
  provider?: string;
  message?: string;
  [key: string]: unknown;
};

export type StreamState = 'connecting' | 'open' | 'error';

const MAX_EVENTS = 200;
const LIST_LIMIT = 100;

type Frame = { id?: string; event?: string; data: string };

// Splits complete Server-Sent Events frames off the buffer.
function parseFrames(buffer: string): { frames: Frame[]; rest: string } {
  const frames: Frame[] = [];
  let rest = buffer;

  while (true) {
    const sep = rest.search(/\r?\n\r?\n/);
    if (sep === -1) {
      break;
    }
    const block = rest.slice(0, sep);
    rest = rest.slice(sep + (rest[sep] === '\r' ? 4 : 2));

    const frame: Frame = { data: '' };
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      const colon = line.indexOf(':');
      if (colon <= 0) {
        continue;
      }
      const field = line.slice(0, colon);
      const value = line.slice(colon + 1).replace(/^ /, '');
      if (field === 'data') {
        data.push(value);
      } else if (field === 'id') {
        frame.id = value;
      } else if (field === 'event') {
        frame.event = value;
      }
    }
    frame.data = data.join('\n');
    frames.push(frame);
  }

  return { frames, rest };
}

function parseJSON<T>(raw: string): T | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as T) : null;
  } catch {
    return null;
  }
}

class StreamError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}

// For internal sessions the access token lives only in the host UI's memory, so
// the plugin mints its own by exchanging the HttpOnly refresh cookie via
// /v1/auth/token. For SSO sessions the host keeps the OpenEverest token it
// got for the ID token in localStorage.
async function acquireToken(): Promise<string | null> {
  const ssoToken = window.localStorage.getItem('everestToken');
  if (ssoToken) {
    return ssoToken;
  }

  try {
    const res = await fetch('/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token_delivery: 'cookie',
      }),
    });
    if (!res.ok) {
      return null;
    }
    const data: { access_token?: string } = await res.json();
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

function describeStatus(status: number): string {
  if (status === 403) {
    return 'HTTP 403: reading events needs the read-events permission on the objects';
  }
  return `HTTP ${status}`;
}

// Lists the cluster's retained lifecycle events, then streams new ones
// (GET /v1/clusters/{cluster}/events?watch=true&since=<cursor>, SSE). It
// resumes from the last cursor after a reconnect, and relists when the
// cluster can no longer resume from it (an error event with code 410).
export function useEventStream() {
  const [events, setEvents] = useState<LifecycleEvent[]>([]);
  const [state, setState] = useState<StreamState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const cursorRef = useRef<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let abortController: AbortController | null = null;
    let reconnectTimer: number | undefined;
    const base = `/v1/clusters/${encodeURIComponent(clusterName)}/events`;

    const request = (url: string, token: string, accept: string) =>
      fetch(url, {
        headers: { Accept: accept, Authorization: `Bearer ${token}` },
        signal: abortController?.signal,
        credentials: 'same-origin',
        cache: 'no-store',
      });

    // The first page of retained events, newest first, and the cursor to
    // stream from.
    const list = async (token: string) => {
      const response = await request(`${base}?limit=${LIST_LIMIT}`, token, 'application/json');
      if (!response.ok) {
        throw new StreamError(describeStatus(response.status), response.status);
      }
      const page: { items?: LifecycleEvent[]; resourceVersion?: string } = await response.json();
      const items = [...(page.items ?? [])].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
      setEvents(items.slice(0, MAX_EVENTS));
      cursorRef.current = page.resourceVersion ?? null;
    };

    const handleFrame = (frame: Frame) => {
      switch (frame.event) {
        case 'bookmark':
          break;
        case 'error': {
          const body = parseJSON<{ code?: number; message?: string }>(frame.data);
          if (body?.code === 410) {
            cursorRef.current = null;
          }
          throw new StreamError(body?.message ?? 'stream error', body?.code);
        }
        default: {
          const event = parseJSON<LifecycleEvent>(frame.data);
          if (event) {
            setEvents((previous) => [event, ...previous].slice(0, MAX_EVENTS));
          }
        }
      }
      // The SSE id is the event's cursor.
      if (frame.id) {
        cursorRef.current = frame.id;
      }
    };

    const connect = async () => {
      if (stopped) {
        return;
      }

      setState('connecting');
      setError(null);

      const token = await acquireToken();
      if (!token) {
        setState('error');
        setError('Could not obtain Everest auth token. Are you logged in?');
        reconnectTimer = window.setTimeout(connect, 3000);
        return;
      }

      abortController = new AbortController();

      try {
        if (cursorRef.current === null) {
          await list(token);
        }
        const since = cursorRef.current ? `&since=${encodeURIComponent(cursorRef.current)}` : '';
        const response = await request(`${base}?watch=true${since}`, token, 'text/event-stream');
        if (!response.ok || !response.body) {
          throw new StreamError(describeStatus(response.status), response.status);
        }

        setState('open');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const { frames, rest } = parseFrames(buffer);
          buffer = rest;
          frames.forEach(handleFrame);
        }

        if (!stopped) {
          throw new StreamError('Stream ended');
        }
      } catch (err) {
        if (stopped || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        abortController?.abort();
        const message = err instanceof Error ? err.message : 'Unknown error';
        const relist = err instanceof StreamError && err.status === 410;
        setState('error');
        setError(`Event stream error: ${message}. ${relist ? 'Relisting' : 'Reconnecting'}...`);
        reconnectTimer = window.setTimeout(connect, relist ? 0 : 2000);
      }
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
      }
      abortController?.abort();
    };
  }, []);

  return { events, state, error, clear: () => setEvents([]) };
}
