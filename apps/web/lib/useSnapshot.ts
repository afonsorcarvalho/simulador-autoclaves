'use client';

import { useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../server/runtime/snapshot';

const RING_CAPACITY = 600; // ~60 s at 10 Hz

export interface UseSnapshotResult {
  snapshot: Snapshot | null;
  history: Snapshot[];
  connected: boolean;
}

export function useSnapshot(): UseSnapshotResult {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const historyRef = useRef<Snapshot[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);

  useEffect(() => {
    const es = new EventSource('/api/snapshot/stream');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (ev) => {
      try {
        const snap = JSON.parse(ev.data) as Snapshot;
        setSnapshot(snap);
        historyRef.current.push(snap);
        if (historyRef.current.length > RING_CAPACITY) historyRef.current.shift();
        setHistoryVersion((v) => v + 1);
      } catch {
        /* ignore malformed */
      }
    };
    return () => {
      es.close();
    };
  }, []);

  // historyVersion forces re-render when history mutates; consumed via closure
  void historyVersion;
  return { snapshot, history: historyRef.current, connected };
}
