import type { Session } from '../types';

export async function setupRunningChannel(): Promise<void> {
  // Android-only notification channel — stubbed for compatibility.
}

export async function updateRunningNotification(
  sessions: Session[],
  _now: number,
): Promise<void> {
  // Foreground notification for running sessions.
  // Stubbed — would use expo-notifications on Android.
  void sessions;
}
