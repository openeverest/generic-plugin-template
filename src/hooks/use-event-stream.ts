import { useEffect, useRef, useState } from 'react';

export type PluginEvent = {
  resourceVersion?: string;
  type?: string;
  occurredAt?: string;
  namespace?: string;
  resource?: {
    kind?: string;
    name?: string;
  };
  [key: string]: unknown;
};

export type StreamState = 'connecting' | 'open' | 'error';

const MAX_EVENTS = 200;

function parseFrames(buffer: string): { payloads: string[]; rest: string } {
  const payloads: string[] = [];
  let rest = buffer;

  while (true) {
    const sep = rest.search(/\r?\n\r?\n/);
    if (sep === -1) {
      break;
    }
    const frame = rest.slice(0, sep);
    rest = rest.slice(sep + (rest[sep] === '\r' ? 4 : 2));

    const dataLines = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''));

    if (dataLines.length > 0) {
      payloads.push(dataLines.join('\n'));
    }
  }

  return { payloads, rest };
}

function parseEvent(raw: string): PluginEvent | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? (parsed as PluginEvent) : null;
  } catch {
    return null;
  }
}

// For internal sessions the access token lives only in the host UI's memory, so
// the plugin mints its own by exchanging the HttpOnly refresh cookie via
// /v1/auth/token. For OIDC sessions the host keeps it in localStorage.
async function acquireToken(): Promise<string | null> {
  const oidcToken = window.localStorage.getItem('everestToken');
  if (oidcToken) {
    return oidcToken;
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

// Subscribes to the host's lifecycle event stream (GET /v1/events, SSE) and
// resumes from the last seen resourceVersion after a reconnect.
export function useEventStream() {
  const [events, setEvents] = useState<PluginEvent[]>([]);
  const [state, setState] = useState<StreamState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const cursorRef = useRef<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let abortController: AbortController | null = null;
    let reconnectTimer: number | undefined;

    const handlePayload = (raw: string) => {
      const event = parseEvent(raw);
      if (!event) {
        return;
      }
      if (typeof event.resourceVersion === 'string') {
        cursorRef.current = event.resourceVersion;
      }
      setEvents((previous) => [event, ...previous].slice(0, MAX_EVENTS));
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

      const url = cursorRef.current
        ? `/v1/events?since=${encodeURIComponent(cursorRef.current)}`
        : '/v1/events';

      abortController = new AbortController();

      try {
        const response = await fetch(url, {
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${token}`,
          },
          signal: abortController.signal,
          credentials: 'same-origin',
          cache: 'no-store',
        });

        if (!response.ok || !response.body) {
          throw new Error(`HTTP ${response.status}`);
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
          const { payloads, rest } = parseFrames(buffer);
          buffer = rest;
          payloads.forEach(handlePayload);
        }

        if (!stopped) {
          throw new Error('Stream ended');
        }
      } catch (err) {
        if (stopped || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        const message = err instanceof Error ? err.message : 'Unknown error';
        setState('error');
        setError(`Event stream error: ${message}. Reconnecting...`);
        reconnectTimer = window.setTimeout(connect, 2000);
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
