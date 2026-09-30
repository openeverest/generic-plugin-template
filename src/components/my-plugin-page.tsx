import { useEffect, useState } from 'react';
import { Alert, Box, Card, CardContent, Stack, Typography } from '@mui/material';
import type { PluginRouteProps } from '@openeverest/plugin-sdk';
import { apiFetch } from '../plugin-api';
import { EventStreamCard } from './event-stream-card';
import { PluginRoot } from './plugin-root';

const NEXT_STEPS = [
  'Edit src/ to build your plugin UI with MUI components',
  'Edit backend/main.go to add your API logic (or rewrite in any language)',
  'Update charts/my-plugin/values.yaml with your extension points',
];

const BackendStatus = () => {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ message?: string }>('/hello')
      .then((data) => setMessage(data.message ?? 'Connected!'))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  if (message) return <Alert severity="success">{message}</Alert>;
  if (error) return <Alert severity="error">{error}</Alert>;
  return <Alert severity="info">Connecting…</Alert>;
};

export const MyPluginPage = ({ pluginName }: PluginRouteProps) => (
  <PluginRoot>
    <Stack spacing={3} sx={{ p: 4, maxWidth: 960 }}>
      <Box>
        <Typography variant="h4" gutterBottom>
          Hello from My Plugin!
        </Typography>
        <Typography color="text.secondary">
          This page is served by a dynamically loaded plugin module running inside OpenEverest.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Plugin: {pluginName}
        </Typography>
      </Box>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Backend status
          </Typography>
          <BackendStatus />
        </CardContent>
      </Card>

      <EventStreamCard />

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Next steps
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {NEXT_STEPS.map((step) => (
              <Typography component="li" key={step}>
                {step}
              </Typography>
            ))}
          </Box>
        </CardContent>
      </Card>
    </Stack>
  </PluginRoot>
);
