import { Box, Stack, Typography } from '@mui/material';
import type { ClusterDetailTabProps } from '@openeverest/plugin-sdk';
import { PluginRoot } from './plugin-root';
import { CODE_BLOCK_SX } from './code-block.constants';

export const MyPluginClusterTab = ({ instanceName, namespace, cluster }: ClusterDetailTabProps) => (
  <PluginRoot>
    <Stack spacing={1} sx={{ p: 2 }}>
      <Typography variant="h6">My Plugin Tab</Typography>
      <Typography>Instance: {instanceName}</Typography>
      <Typography>Namespace: {namespace}</Typography>
      <Box component="pre" sx={{ ...CODE_BLOCK_SX, maxHeight: 200 }}>
        {JSON.stringify(cluster, null, 2)}
      </Box>
    </Stack>
  </PluginRoot>
);
