import type {
  PluginRegisterFn,
  PluginApi,
  PluginRouteProps,
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
// Example page component
// ---------------------------------------------------------------------------
const MyPluginPage = (_props: PluginRouteProps) => {
  const [message, setMessage] = React.useState<string>('Loading...');

  React.useEffect(() => {
    apiFetch('/hello')
      .then((data: { message?: string }) => setMessage(data.message ?? 'Hello!'))
      .catch((err: Error) => setMessage(`Error: ${err.message}`));
  }, []);

  return React.createElement(
    'div',
    { style: { padding: '2rem' } },
    React.createElement('h1', null, 'My Plugin'),
    React.createElement('p', null, message)
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
    icon: 'extension',
  });

  // Register the main route.
  api.registerExtension({
    type: 'route',
    label: 'My Plugin',
    component: MyPluginPage,
  });

  // Uncomment to register a cluster detail tab:
  // api.registerExtension({
  //   type: 'clusterDetailTab',
  //   label: 'My Plugin',
  //   path: 'my-plugin',
  //   component: MyClusterTab,
  //   providers: ['postgresql'],  // restrict to specific engine types
  // });
};

export default register;
