'use client';

import { Badge } from './ui/Badge';

export function ConnectionIndicator({ connected }: { connected: boolean }) {
  return <Badge variant={connected ? 'ok' : 'err'}>{connected ? '● live' : '○ offline'}</Badge>;
}
