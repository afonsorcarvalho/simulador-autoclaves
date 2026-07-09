'use client';

import { useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../server/runtime/snapshot';

const RING_CAPACITY = 5000; // whole cycle at 1 Hz (~83 min)

export interface UseSnapshotResult {
  snapshot: Snapshot | null;
  history: Snapshot[];
  connected: boolean;
}

export function useSnapshot(): UseSnapshotResult {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const historyRef = useRef<Snapshot[]>([]);
  const lastSecRef = useRef(-1);
  const prevRunningRef = useRef(false);
  const [historyVersion, setHistoryVersion] = useState(0);

  useEffect(() => {
    const es = new EventSource('/api/snapshot/stream');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (ev) => {
      try {
        const snap = JSON.parse(ev.data) as Snapshot;
        setSnapshot(snap);

        // Clear the graph when a new cycle starts (rising edge of cycle_running).
        if (snap.cycle_running && !prevRunningRef.current) {
          historyRef.current = [];
          lastSecRef.current = -1;
        }
        prevRunningRef.current = snap.cycle_running;

        // Record one point per elapsed second while running → whole-cycle graph, keyed on cycle_elapsed_s.
        if (snap.cycle_running) {
          const sec = Math.floor(snap.cycle_elapsed_s);
          if (sec !== lastSecRef.current) {
            lastSecRef.current = sec;
            historyRef.current.push(snap);
            if (historyRef.current.length > RING_CAPACITY) historyRef.current.shift();
            setHistoryVersion((v) => v + 1);
          }
        }
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
