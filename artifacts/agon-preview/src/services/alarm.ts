import { Platform } from 'react-native';

// ── Web: HTML5 Audio ──────────────────────────────────────────────────────────
let _webAudio: HTMLAudioElement | null = null;

function ringWeb(): void {
  try {
    if (_webAudio) return;
    // On web, metro bundles the asset as a URL string via require()
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const src = require('../../assets/sounds/alarm.wav') as string;
    const audio = new Audio(typeof src === 'string' ? src : undefined);
    audio.loop = true;
    audio.volume = 1.0;
    audio.play().catch(() => {});
    _webAudio = audio;
  } catch {
    // ignore — audio not supported
  }
}

function stopWeb(): void {
  if (!_webAudio) return;
  _webAudio.pause();
  _webAudio.currentTime = 0;
  _webAudio = null;
}

// ── Native: expo-av ───────────────────────────────────────────────────────────
let _playing = false;
let _soundRef: { stopAsync: () => Promise<void>; unloadAsync: () => Promise<void> } | null = null;

async function ringNative(): Promise<void> {
  if (_playing) return;
  try {
    // Static import so metro resolves it correctly
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { Audio } = await import('expo-av') as any;
    if (!Audio) return;
    const { sound } = await Audio.Sound.createAsync(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../assets/sounds/alarm.wav'),
      { shouldPlay: true, isLooping: true, volume: 1.0 },
    );
    _soundRef = sound;
    _playing = true;
  } catch {
    // expo-av unavailable — silently skip
  }
}

function stopNative(): void {
  if (!_playing || !_soundRef) return;
  _playing = false;
  const ref = _soundRef;
  _soundRef = null;
  ref.stopAsync().catch(() => {});
  ref.unloadAsync().catch(() => {});
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function configureAlarms(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { Audio } = await import('expo-av') as any;
    if (!Audio) return;
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
    });
  } catch {
    // ignore
  }
}

export async function ringAlarm(): Promise<void> {
  if (Platform.OS === 'web') {
    ringWeb();
  } else {
    await ringNative();
  }
}

export function stopAlarm(): void {
  if (Platform.OS === 'web') {
    stopWeb();
  } else {
    stopNative();
  }
}

export async function scheduleSessionAlarm(
  _sessionId: string,
  _stationName: string,
  _limitMinutes: number,
): Promise<void> {
  // Alarm is triggered by the clock tick in AppRoot — this is a no-op.
}
