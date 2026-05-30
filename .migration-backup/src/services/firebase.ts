import type { BusinessData } from '../types';

// Fixed sync path — all devices running this app connect to the same Firebase namespace
export const BUSINESS_SYNC_ID = 'andrik-gamezone';

let _db: unknown = null;
let _dbInitialized = false;

const firebaseConfig = {
  apiKey: 'AIzaSyBCFQjbRSZdLqvSdsinh043pHIC0a5tfr8',
  authDomain: 'andrik-94bb6.firebaseapp.com',
  databaseURL: 'https://andrik-94bb6-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'andrik-94bb6',
  storageBucket: 'andrik-94bb6.firebasestorage.app',
  messagingSenderId: '1041553409790',
  appId: '1:1041553409790:web:d5d65b5159e2d6db1907af',
};

export const firebaseEnabled = true;
export const auth = null;

function dbPath(syncId?: string) {
  const id = (syncId || BUSINESS_SYNC_ID).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || BUSINESS_SYNC_ID;
  return `businesses/${id}`;
}

async function getDB(): Promise<unknown> {
  if (_db) return _db;
  if (_dbInitialized) return null;
  _dbInitialized = true;
  try {
    // @ts-ignore
    const { initializeApp, getApps, getApp } = await import('firebase/app');
    // @ts-ignore
    const { getDatabase } = await import('firebase/database');
    const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    _db = getDatabase(app);
    return _db;
  } catch {
    _dbInitialized = false;
    return null;
  }
}

export async function firebaseSignIn(_email: string, _password: string) { return null; }
export function firebaseCreateAuthErrorMessage(_error: unknown): string { return ''; }
export function firebaseAuthErrorMessage(_error: unknown): string { return ''; }
export async function firebaseCreateUser(_email: string, _password: string): Promise<null> { return null; }
export async function firebaseSignOut(): Promise<void> { return; }
export async function firebaseChangePassword(_e: string, _c: string, _n: string): Promise<void> { return; }

export async function loadBusiness(syncId?: string): Promise<BusinessData | null> {
  try {
    const db = await getDB();
    if (!db) return null;
    // @ts-ignore
    const { ref, onValue, off } = await import('firebase/database') as any;
    const path = dbPath(syncId);
    return await new Promise<BusinessData | null>((resolve) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      }, 2500);

      const dbRef = ref(db, path);
      onValue(
        dbRef,
        (snapshot: any) => {
          clearTimeout(timeout);
          if (!resolved) {
            resolved = true;
            try { off(dbRef); } catch {}
            const val = snapshot.val() as BusinessData | null;
            resolve(val ?? null);
          }
        },
        () => {
          clearTimeout(timeout);
          if (!resolved) {
            resolved = true;
            resolve(null);
          }
        },
        { onlyOnce: true },
      );
    });
  } catch {
    return null;
  }
}

export async function saveBusiness(data: BusinessData, syncId?: string): Promise<void> {
  try {
    const db = await getDB();
    if (!db) return;
    // @ts-ignore
    const { ref, set } = await import('firebase/database') as any;
    const clean = JSON.parse(JSON.stringify(data)) as BusinessData;
    await set(ref(db, dbPath(syncId)), clean);
  } catch {
    // ignore — local state still updated
  }
}

export function subscribeBusiness(
  onData: (data: BusinessData) => void,
  syncId?: string,
): () => void {
  let unsubscribed = false;
  let cleanupFn: (() => void) | null = null;
  const path = dbPath(syncId);

  getDB().then(async (db) => {
    if (!db || unsubscribed) return;
    try {
      // @ts-ignore
      const { ref, onValue, off } = await import('firebase/database') as any;
      const dbRef = ref(db, path);
      onValue(dbRef, (snapshot: any) => {
        const val = snapshot.val() as BusinessData | null;
        if (val) onData(val);
      }, () => {});
      cleanupFn = () => off(dbRef);
    } catch {
      // ignore
    }
  }).catch(() => {});

  return () => {
    unsubscribed = true;
    cleanupFn?.();
  };
}

// Listen to Firebase connection state (.info/connected)
export function subscribeConnected(cb: (online: boolean) => void): () => void {
  let unsubscribed = false;
  let cleanupFn: (() => void) | null = null;

  getDB().then(async (db) => {
    if (!db || unsubscribed) return;
    try {
      // @ts-ignore
      const { ref, onValue, off } = await import('firebase/database') as any;
      const connRef = ref(db, '.info/connected');
      onValue(connRef, (snap: any) => { cb(!!snap.val()); }, () => cb(false));
      cleanupFn = () => off(connRef);
    } catch {
      cb(false);
    }
  }).catch(() => cb(false));

  return () => {
    unsubscribed = true;
    cleanupFn?.();
  };
}

export async function updateBusinessField(path: string, value: unknown, syncId?: string): Promise<void> {
  try {
    const db = await getDB();
    if (!db) return;
    // @ts-ignore
    const { ref, update } = await import('firebase/database') as any;
    await update(ref(db, `${dbPath(syncId)}/${path}`), value as Record<string, unknown>);
  } catch {}
}

export async function uploadBusinessImage(_uri: string, _folder: string): Promise<string | undefined> {
  return undefined;
}
