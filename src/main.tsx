import type {
  PluginRegisterFn,
  PluginApi,
  PluginRouteProps,
  ClusterDetailTabProps,
} from '@openeverest/plugin-sdk';

// React and fetch are provided by the host at runtime.
let React: PluginApi['React'];
let pluginFetch: PluginApi['fetch'];

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

  React.useEffect(() => {
    apiFetch('/hello')
      .then((data: { message?: string }) => setBackendMessage(data.message ?? 'Connected!'))
      .catch((err: Error) => setError(err.message));
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
