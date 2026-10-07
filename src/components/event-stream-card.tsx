import { Box, Button, Card, CardContent, Paper, Stack, Typography } from '@mui/material';
import { useEventStream, type StreamState } from '../hooks/use-event-stream';
import { CODE_BLOCK_SX } from './code-block.constants';

const STATE_COLOR: Record<StreamState, string> = {
  open: 'success.main',
  error: 'error.main',
  connecting: 'text.secondary',
};

export const EventStreamCard = () => {
  const { events, state, error, clear } = useEventStream();

  const status =
    state === 'open'
      ? `Connected. Capturing all event types. Stored in memory: ${events.length}`
      : state === 'error'
        ? (error ?? 'Disconnected')
        : 'Connecting to /v1/events…';

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="h6">Live event stream (SSE)</Typography>
          <Button size="small" variant="outlined" onClick={clear}>
            Clear
          </Button>
        </Stack>
        <Typography variant="body2" sx={{ color: STATE_COLOR[state] }}>
          {status}
        </Typography>

        {events.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            Waiting for events…
          </Typography>
        ) : (
          <Stack spacing={1} sx={{ mt: 1.5, maxHeight: 360, overflow: 'auto' }}>
            {events.map((event, index) => (
              <Paper key={`${event.resourceVersion ?? 'no-rv'}-${index}`} variant="outlined" sx={{ p: 1 }}>
                <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="subtitle2">{event.type ?? 'unknown'}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {event.occurredAt ?? 'unknown time'}
                    {event.namespace ? ` | ns: ${event.namespace}` : ''}
                  </Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {event.resource?.kind ?? 'Resource'}
                  {event.resource?.name ? `/${event.resource.name}` : ''}
                </Typography>
                <Box component="pre" sx={{ ...CODE_BLOCK_SX, mt: 1 }}>
                  {JSON.stringify(event, null, 2)}
                </Box>
              </Paper>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
};
