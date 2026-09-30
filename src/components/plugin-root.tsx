import type { ReactNode } from 'react';
import { PluginThemeProvider } from '@openeverest/plugin-theme';
import { cssNonce } from '../plugin-api';

// Emotion cache key: lowercase letters and "-" only, unique across plugins.
// Rename it together with the plugin.
const EMOTION_CACHE_KEY = 'my-plugin';

// Wrap every component you register: it themes MUI from the host design tokens
// (palette, typography, light/dark) and keeps this plugin's styles isolated.
export const PluginRoot = ({ children }: { children: ReactNode }) => (
  <PluginThemeProvider cacheKey={EMOTION_CACHE_KEY} nonce={cssNonce}>
    {children}
  </PluginThemeProvider>
);
