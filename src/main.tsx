import type { PluginApi, PluginRegisterFn } from '@openeverest/plugin-sdk';
import { initPluginApi } from './plugin-api';
import { MyPluginPage } from './components/my-plugin-page';
import { MyPluginClusterTab } from './components/my-plugin-cluster-tab';

// The host imports this bundle and calls register(api) once at startup.
const register: PluginRegisterFn = (api: PluginApi) => {
  initPluginApi(api);

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

  // To restrict the tab to specific providers, add `providers` with the
  // provider names (spec.providerRef.name on the Instance), e.g.:
  //   providers: ['provider-percona-postgresql'],
};

export default register;
