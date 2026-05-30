import { Platform } from 'react-native';

type NotificationData = Record<string, string>;

// ── Permission & token registration ─────────────────────────────────────────

export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Notifications = await import('expo-notifications') as any;

    await Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return null;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('agon-alerts', {
        name: 'Agon Alerts',
        importance: Notifications.AndroidImportance?.MAX ?? 5,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#31d5c7',
      });
    }

    const tokenData = await Notifications.getExpoPushTokenAsync().catch(() => null);
    const token: string | null = tokenData?.data ?? null;

    if (token) {
      await registerTokenWithServer(token).catch(() => undefined);
    }

    return token;
  } catch {
    return null;
  }
}

async function registerTokenWithServer(token: string): Promise<void> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) return;
  const url = `https://${domain}/api/push-tokens`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, platform: Platform.OS }),
  });
}

// ── Local notifications ──────────────────────────────────────────────────────

export async function sendLocalNotification(
  title: string,
  body: string,
  data: NotificationData = {},
): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Notifications = await import('expo-notifications') as any;
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
        sound: true,
        ...(Platform.OS === 'android' ? { channelId: 'agon-alerts' } : {}),
      },
      trigger: null,
    });
  } catch {
    // notifications unavailable — silently skip
  }
}

// ── Deep link URL builder ────────────────────────────────────────────────────

export function buildDeepLink(screen: 'stations' | 'inventory', id?: string): string {
  return id ? `agon-preview://${screen}/${id}` : `agon-preview://${screen}`;
}

// ── Deep link parser ─────────────────────────────────────────────────────────

export type DeepLinkTarget =
  | { tab: 'stations'; stationId?: string }
  | { tab: 'inventory' }
  | null;

export function parseDeepLink(url: string): DeepLinkTarget {
  try {
    const parsed = new URL(url);

    // Custom scheme URLs (agon-preview://stations/5) have:
    //   hostname = "stations", pathname = "/5"
    // Fallback for triple-slash (agon-preview:///stations/5):
    //   hostname = "", pathname = "/stations/5"
    let screen: string;
    let id: string | undefined;

    if (parsed.hostname) {
      screen = parsed.hostname;
      id = parsed.pathname.split('/').filter(Boolean)[0];
    } else {
      const parts = parsed.pathname.split('/').filter(Boolean);
      screen = parts[0] ?? '';
      id = parts[1];
    }

    if (screen === 'stations') {
      return { tab: 'stations', stationId: id };
    }
    if (screen === 'inventory') {
      return { tab: 'inventory' };
    }
    return null;
  } catch {
    return null;
  }
}
