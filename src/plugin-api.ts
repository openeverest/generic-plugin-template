import type { PluginApi } from '@openeverest/plugin-sdk';

// Host-provided values, captured once in register(api) so any module can use them.
export let pluginFetch: PluginApi['fetch'];
export let cssNonce: PluginApi['cssNonce'];

export function initPluginApi(api: PluginApi): void {
  pluginFetch = api.fetch.bind(api);
  cssNonce = api.cssNonce;
}

// Goes through api.fetch() so the host proxy validates the session and
// forwards the X-Everest-User JWT to the plugin backend.
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await pluginFetch(`/api${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}
