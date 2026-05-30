import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BusinessData } from '../types';

// Key must match across all tabs/devices on the same business
export const SYNC_KEY = 'andrik-game-zone:data';
const BROADCAST_CHANNEL = 'andrik-sync';

// ─── Load ─────────────────────────────────────────────────────────────────────
export async function loadBusinessApi(): Promise<BusinessData | null> {
  try {
    if (Platform.OS === 'web') {
      const raw = (globalThis as unknown as Window).localStorage?.getItem(SYNC_KEY);
      return raw ? (JSON.parse(raw) as BusinessData) : null;
    }
    const stored = await AsyncStorage.getItem(SYNC_KEY);
    return stored ? (JSON.parse(stored) as BusinessData) : null;
  } catch {
    return null;
  }
}

// ─── Save ─────────────────────────────────────────────────────────────────────
export async function saveBusinessApi(data: BusinessData): Promise<void> {
  try {
    const json = JSON.stringify(data);
    if (Platform.OS === 'web') {
      const w = globalThis as unknown as Window;
      w.localStorage?.setItem(SYNC_KEY, json);
      // BroadcastChannel: fires INSTANTLY in all same-origin tabs on same device
      try {
        const BC = (w as unknown as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
        if (BC) {
          const bc = new BC(BROADCAST_CHANNEL);
          bc.postMessage({ key: SYNC_KEY, data });
          bc.close();
        }
      } catch {
        // BroadcastChannel not supported — storage event is fallback
      }
    } else {
      await AsyncStorage.setItem(SYNC_KEY, json);
    }
  } catch {
    // ignore
  }
}

// ─── Real-time subscription ───────────────────────────────────────────────────
// Web:  BroadcastChannel (instant, same device tabs) + storage event (other tabs)
//       Firebase handles cross-device sync via subscribeBusiness()
// Native: Firebase handles everything via subscribeBusiness()
//         AsyncStorage poll is only a local fallback
export function subscribeBusinessApi(
  onData: (data: BusinessData) => void,
): () => void {
  const cleanups: Array<() => void> = [];

  if (Platform.OS === 'web') {
    const w = globalThis as unknown as Window;

    // 1. BroadcastChannel — INSTANT same-device cross-tab sync
    try {
      const BC = (w as unknown as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
      if (BC) {
        const bc = new BC(BROADCAST_CHANNEL);
        bc.onmessage = (e: MessageEvent) => {
          if (e.data?.key === SYNC_KEY && e.data?.data) {
            onData(e.data.data as BusinessData);
          }
        };
        cleanups.push(() => bc.close());
      }
    } catch {
      // not supported
    }

    // 2. storage event — fires in OTHER tabs when localStorage changes
    const storageHandler = (e: StorageEvent) => {
      if (e.key === SYNC_KEY && e.newValue) {
        try { onData(JSON.parse(e.newValue) as BusinessData); } catch {}
      }
    };
    w.addEventListener('storage', storageHandler as EventListener);
    cleanups.push(() => w.removeEventListener('storage', storageHandler as EventListener));

  } else {
    // Native: Firebase real-time listener handles cross-device sync instantly.
    // AsyncStorage poll as a local safety net (e.g. offline resume).
    let lastSeen = '';
    const poll = setInterval(async () => {
      try {
        const raw = await AsyncStorage.getItem(SYNC_KEY);
        if (raw && raw !== lastSeen) {
          lastSeen = raw;
          onData(JSON.parse(raw) as BusinessData);
        }
      } catch {}
    }, 3000);
    cleanups.push(() => clearInterval(poll));
  }

  return () => cleanups.forEach((fn) => fn());
}
