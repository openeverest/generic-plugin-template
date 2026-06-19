import type {
  PluginRegisterFn,
  PluginApi,
  PluginRouteProps,
  ClusterDetailTabProps,
} from '@openeverest/plugin-sdk';

// React and fetch are provided by the host at runtime.
let React: PluginApi['React'];
let pluginFetch: PluginApi['fetch'];

type PluginEvent = {
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

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
// Uses api.fetch() so the host proxy receives a valid session, generates the
// X-Everest-User JWT, and forwards it to the backend.
async function apiFetch(path: string, opts?: RequestInit) {
  const res = await pluginFetch(`/api${path}`, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Main page — demonstrates the plugin is running
// ---------------------------------------------------------------------------
const MyPluginPage = (props: PluginRouteProps) => {
  const [backendMessage, setBackendMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [events, setEvents] = React.useState<PluginEvent[]>([]);
  const [streamState, setStreamState] = React.useState<'connecting' | 'open' | 'error'>('connecting');
  const [streamError, setStreamError] = React.useState<string | null>(null);
  const cursorRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    apiFetch('/hello')
      .then((data: { message?: string }) => setBackendMessage(data.message ?? 'Connected!'))
      .catch((err: Error) => setError(err.message));
  }, []);

  React.useEffect(() => {
    let stopped = false;
    let abortController: AbortController | null = null;
    let reconnectTimer: number | undefined;

    const handlePayload = (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        return;
      }

      let parsed: PluginEvent;
      try {
        parsed = JSON.parse(trimmed) as PluginEvent;
      } catch {
        return;
      }

      if (typeof parsed.resourceVersion === 'string') {
        cursorRef.current = parsed.resourceVersion;
      }

      setEvents((previous) => {
        const next = [parsed, ...previous];
        return next.slice(0, 200);
      });
    };

    const parseFrames = (buffer: string): { events: string[]; rest: string } => {
      const events: string[] = [];
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
          events.push(dataLines.join('\n'));
        }
      }

      return { events, rest };
    };

    // Acquires an access token. For internal sessions the access token lives
    // only in the host UI's memory; the plugin mints its own by exchanging the
    // HttpOnly refresh cookie via /v1/auth/token. For OIDC sessions the host
    // still stores the token in localStorage under 'everestToken'.
    const acquireToken = async (): Promise<string | null> => {
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
        const data = (await res.json()) as { access_token?: string };
        return data.access_token ?? null;
      } catch {
        return null;
      }
    };

    const connect = async () => {
      if (stopped) {
        return;
      }

      setStreamState('connecting');
      setStreamError(null);

      const token = await acquireToken();
      if (!token) {
        setStreamState('error');
        setStreamError('Could not obtain Everest auth token. Are you logged in?');
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

        setStreamState('open');
        setStreamError(null);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const { events: frames, rest } = parseFrames(buffer);
          buffer = rest;
          frames.forEach(handlePayload);
        }

        if (!stopped) {
          throw new Error('Stream ended');
        }
      } catch (err) {
        if (stopped || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        const message = err instanceof Error ? err.message : 'Unknown error';
        setStreamState('error');
        setStreamError(`Event stream error: ${message}. Reconnecting...`);
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

  return React.createElement(
    'div',
    { style: { padding: '2rem' } },
    React.createElement('h1', null, '👋 Hello from My Plugin!'),
    React.createElement(
      'p',
      null,
      'This page is served by a dynamically loaded plugin module running inside OpenEverest.'
    ),
    React.createElement(
      'p',
      { style: { color: '#666' } },
      `Plugin: ${props.pluginName}`
    ),
    React.createElement(
      'div',
      { style: { marginTop: '1.5rem', padding: '1rem', background: '#f5f7fa', borderRadius: '8px' } },
      React.createElement('h3', { style: { margin: '0 0 0.5rem' } }, 'Backend Status'),
      backendMessage
        ? React.createElement('p', { style: { color: '#2e7d32' } }, `✓ ${backendMessage}`)
        : error
        ? React.createElement('p', { style: { color: '#c62828' } }, `✗ ${error}`)
        : React.createElement('p', { style: { color: '#999' } }, '⏳ Connecting…')
    ),
    React.createElement(
      'div',
      { style: { marginTop: '1.5rem', padding: '1rem', background: '#f5f7fa', borderRadius: '8px' } },
      React.createElement('h3', { style: { margin: '0 0 0.5rem' } }, 'Live Event Stream (SSE)'),
      React.createElement(
        'p',
        { style: { margin: 0, color: streamState === 'open' ? '#2e7d32' : streamState === 'error' ? '#c62828' : '#666' } },
        streamState === 'open'
          ? `Connected. Capturing all event types. Stored in memory: ${events.length}`
          : streamState === 'error'
          ? streamError ?? 'Disconnected'
          : 'Connecting to /v1/events...'
      ),
      React.createElement(
        'div',
        { style: { marginTop: '0.75rem', display: 'flex', gap: '0.5rem' } },
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: () => setEvents([]),
            style: {
              border: '1px solid #d0d7de',
              background: 'white',
              borderRadius: 6,
              padding: '0.35rem 0.75rem',
              cursor: 'pointer',
            },
          },
          'Clear'
        )
      ),
      events.length === 0
        ? React.createElement('p', { style: { color: '#999', marginTop: '0.75rem' } }, 'Waiting for events...')
        : React.createElement(
            'div',
            {
              style: {
                marginTop: '0.75rem',
                display: 'grid',
                gap: '0.5rem',
                maxHeight: 360,
                overflow: 'auto',
              },
            },
            events.map((event, index) =>
              React.createElement(
                'div',
                {
                  key: `${event.resourceVersion ?? 'no-rv'}-${index}`,
                  style: {
                    border: '1px solid #e5e7eb',
                    borderRadius: 6,
                    padding: '0.5rem',
                    background: 'white',
                  },
                },
                React.createElement(
                  'div',
                  { style: { display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' } },
                  React.createElement('strong', null, event.type ?? 'unknown'),
                  React.createElement(
                    'span',
                    { style: { color: '#666', fontSize: '0.85rem' } },
                    `${event.occurredAt ?? 'unknown time'}${event.namespace ? ` | ns: ${event.namespace}` : ''}`
                  )
                ),
                React.createElement(
                  'div',
                  { style: { marginTop: '0.25rem', color: '#444', fontSize: '0.9rem' } },
                  `${event.resource?.kind ?? 'Resource'}${event.resource?.name ? `/${event.resource.name}` : ''}`
                ),
                React.createElement(
                  'pre',
                  {
                    style: {
                      marginTop: '0.4rem',
                      fontSize: '0.75rem',
                      background: '#f7f7f7',
                      padding: '0.45rem',
                      borderRadius: 4,
                      overflow: 'auto',
                    },
                  },
                  JSON.stringify(event, null, 2)
                )
              )
            )
          )
    ),
    React.createElement(
      'div',
      { style: { marginTop: '1.5rem', padding: '1rem', background: '#f5f7fa', borderRadius: '8px' } },
      React.createElement('h3', { style: { margin: '0 0 0.5rem' } }, 'Next Steps'),
      React.createElement('ul', { style: { margin: 0, paddingLeft: '1.25rem', lineHeight: '1.8' } },
        React.createElement('li', null, 'Edit src/main.tsx to build your plugin UI'),
        React.createElement('li', null, 'Edit backend/main.go to add your API logic (or rewrite in any language)'),
        React.createElement('li', null, 'Update charts/my-plugin/values.yaml with your extension points'),
      )
    )
  );
};

// ---------------------------------------------------------------------------
// Cluster detail tab — demonstrates clusterDetailTab extension point
// ---------------------------------------------------------------------------
const MyPluginClusterTab = (props: ClusterDetailTabProps) => {
  return React.createElement(
    'div',
    { style: { padding: '1rem' } },
    React.createElement('h3', null, '👋 My Plugin Tab'),
    React.createElement('p', null, `Instance: ${props.instanceName}`),
    React.createElement('p', null, `Namespace: ${props.namespace}`),
    React.createElement(
      'pre',
      { style: { fontSize: '0.75rem', background: '#f5f5f5', padding: '0.5rem', borderRadius: 4, overflow: 'auto', maxHeight: 200 } },
      JSON.stringify(props.cluster, null, 2)
    )
  );
};

// ---------------------------------------------------------------------------
// Wizard step — demonstrates instanceCreateStep / instanceEditStep
// ---------------------------------------------------------------------------
// These extension points let a plugin own a full wizard step in the
// create- and edit-instance flows (vs. instanceCreateFormSection /
// instanceEditFormSection which embed inside an existing step).
//
// Props (per the spec):
//   instanceCreateStep: { formValues, onChange, namespace, onValidityChange }
//   instanceEditStep:   { instance, formValues, onChange, namespace, onValidityChange }
//
// `onChange(pluginConfig)` writes an opaque JSON blob keyed by plugin name into
// the wizard's form state. `onValidityChange(boolean)` gates the wizard's
// Next/Submit button.

type InstanceStepConfig = {
  team?: string;
  costCenter?: string;
  notes?: string;
};

type InstanceCreateStepProps = {
  formValues: Record<string, unknown>;
  onChange: (config: InstanceStepConfig) => void;
  namespace: string;
  onValidityChange: (valid: boolean) => void;
};

type InstanceEditStepProps = InstanceCreateStepProps & {
  instance: { metadata?: { labels?: Record<string, string> } } & Record<string, unknown>;
};

const MyPluginWizardStep = (
  props: InstanceCreateStepProps & { instance?: InstanceEditStepProps['instance'] }
) => {
  const existing = (props.formValues['my-plugin'] as InstanceStepConfig | undefined) ?? {};
  const labels = props.instance?.metadata?.labels ?? {};

  const [team, setTeam] = React.useState<string>(
    existing.team ?? labels['my-plugin/team'] ?? ''
  );
  const [costCenter, setCostCenter] = React.useState<string>(
    existing.costCenter ?? labels['my-plugin/cost-center'] ?? ''
  );
  const [notes, setNotes] = React.useState<string>(existing.notes ?? '');

  // Push state up to the wizard whenever any field changes.
  React.useEffect(() => {
    props.onChange({ team: team.trim(), costCenter: costCenter.trim(), notes: notes.trim() });
    // `team` is required; gate Next/Submit on it.
    props.onValidityChange(team.trim().length > 0);
  }, [team, costCenter, notes]);

  const fieldStyle = {
    display: 'block',
    width: '100%',
    padding: '0.5rem',
    border: '1px solid #d0d7de',
    borderRadius: 6,
    fontSize: '0.9rem',
    boxSizing: 'border-box' as const,
  };
  const labelStyle = { display: 'block', marginBottom: '0.25rem', fontWeight: 600 };
  const helpStyle = { color: '#666', fontSize: '0.8rem', marginTop: '0.25rem' };

  return React.createElement(
    'div',
    { style: { maxWidth: 520, padding: '1rem' } },
    React.createElement('h3', { style: { marginTop: 0 } }, 'My Plugin — Tagging'),
    React.createElement(
      'p',
      { style: { color: '#555', marginTop: 0 } },
      props.instance
        ? `Edit plugin-managed tags for this instance in namespace ${props.namespace}.`
        : `Attach plugin-managed tags to the new instance in namespace ${props.namespace}.`
    ),
    React.createElement(
      'div',
      { style: { marginTop: '1rem' } },
      React.createElement('label', { style: labelStyle }, 'Team *'),
      React.createElement('input', {
        type: 'text',
        value: team,
        onChange: (e: { target: { value: string } }) => setTeam(e.target.value),
        placeholder: 'e.g. payments',
        style: fieldStyle,
      }),
      React.createElement('p', { style: helpStyle }, 'Required. Used to route alerts to the owning team.')
    ),
    React.createElement(
      'div',
      { style: { marginTop: '1rem' } },
      React.createElement('label', { style: labelStyle }, 'Cost center'),
      React.createElement('input', {
        type: 'text',
        value: costCenter,
        onChange: (e: { target: { value: string } }) => setCostCenter(e.target.value),
        placeholder: 'e.g. CC-1042',
        style: fieldStyle,
      })
    ),
    React.createElement(
      'div',
      { style: { marginTop: '1rem' } },
      React.createElement('label', { style: labelStyle }, 'Notes'),
      React.createElement('textarea', {
        value: notes,
        onChange: (e: { target: { value: string } }) => setNotes(e.target.value),
        rows: 3,
        placeholder: 'Optional free-form notes',
        style: { ...fieldStyle, fontFamily: 'inherit', resize: 'vertical' },
      })
    ),
    team.trim().length === 0
      ? React.createElement(
          'p',
          { style: { marginTop: '1rem', color: '#c62828', fontSize: '0.85rem' } },
          'Enter a team to enable the Next button.'
        )
      : null
  );
};

const MyPluginCreateStep = (props: InstanceCreateStepProps) =>
  React.createElement(MyPluginWizardStep, props);

const MyPluginEditStep = (props: InstanceEditStepProps) =>
  React.createElement(MyPluginWizardStep, props);

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------
const register: PluginRegisterFn = (api: PluginApi) => {
  React = api.React;
  pluginFetch = api.fetch.bind(api);

  // Register a sidebar entry.
  api.registerExtension({
    type: 'sidebarItem',
    label: 'My Plugin',
  });

  // Register the main route.
  api.registerExtension({
    type: 'route',
    label: 'My Plugin',
    component: MyPluginPage,
  });

  // Register a cluster detail tab (visible on every database cluster page).
  api.registerExtension({
    type: 'clusterDetailTab',
    label: 'My Plugin',
    path: 'my-plugin',
    component: MyPluginClusterTab,
  });

  // Wizard steps. The SDK union does not yet include these new types, so the
  // registration objects are passed through `unknown` to keep TypeScript happy
  // until the SDK is updated.
  api.registerExtension({
    type: 'instanceCreateStep',
    label: 'My Plugin',
    component: MyPluginCreateStep,
    // Optional: providers: ['postgresql'],
  } as unknown as Parameters<PluginApi['registerExtension']>[0]);

  api.registerExtension({
    type: 'instanceEditStep',
    label: 'My Plugin',
    component: MyPluginEditStep,
    // Optional: providers: ['postgresql'],
  } as unknown as Parameters<PluginApi['registerExtension']>[0]);

  // Uncomment to restrict the tab to specific engine types:
  // api.registerExtension({
  //   type: 'clusterDetailTab',
  //   label: 'My Plugin',
  //   path: 'my-plugin',
  //   component: MyPluginClusterTab,
  //   providers: ['postgresql'],
  // });
};

export default register;
