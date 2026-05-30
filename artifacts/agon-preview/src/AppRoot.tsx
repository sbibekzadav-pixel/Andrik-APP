import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  ViewStyle,
  ActivityIndicator,
} from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppImage } from './components/AppImage';
import { seedData } from './data/seed';
import { normalizePhotoUri, resolveBundledImageKey } from './utils/images';
import { configureAlarms, ringAlarm, scheduleSessionAlarm, stopAlarm } from './services/alarm';
import { setupRunningChannel, updateRunningNotification } from './services/foregroundService';
import {
  firebaseAuthErrorMessage,
  firebaseChangePassword,
  firebaseCreateAuthErrorMessage,
  firebaseCreateUser,
  firebaseEnabled,
  firebaseSignIn,
  firebaseSignOut,
  loadBusiness,
  saveBusiness,
  subscribeBusiness,
  updateBusinessField,
  uploadBusinessImage,
  BUSINESS_SYNC_ID,
} from './services/firebase';
import { loadBusinessApi, saveBusinessApi, subscribeBusinessApi, SYNC_KEY } from './services/apiSync';
import { colors, radius } from './theme';
import type {
  BillingMode,
  BusinessData,
  InventoryItem,
  ReportRange,
  Session,
  Station,
  TabKey,
  UserProfile,
} from './types';
import { elapsedMs, formatDuration, formatMoney, nowTime, reportTotals, sessionTotals } from './utils/billing';

const iconMap: Record<string, string> = {
  Banknote: 'cash-outline',
  BarChart3: 'bar-chart-outline',
  Camera: 'camera-outline',
  ChevronLeft: 'chevron-back-outline',
  Download: 'download-outline',
  Gamepad2: 'game-controller-outline',
  Grid3X3: 'grid-outline',
  KeyRound: 'key-outline',
  LogOut: 'log-out-outline',
  Mail: 'mail-outline',
  Menu: 'menu-outline',
  Minus: 'remove-outline',
  Package: 'cube-outline',
  Pause: 'pause-outline',
  Pencil: 'pencil-outline',
  Play: 'play-outline',
  Plus: 'add-outline',
  PlusCircle: 'add-circle-outline',
  ReceiptText: 'receipt-outline',
  RotateCcw: 'refresh-outline',
  Save: 'save-outline',
  Settings: 'settings-outline',
  Square: 'stop-outline',
  Trash2: 'trash-outline',
  TrendingUp: 'trending-up-outline',
  Upload: 'cloud-upload-outline',
  UserCircle: 'person-circle-outline',
  UserMinus: 'person-remove-outline',
  UserPlus: 'person-add-outline',
  Users: 'people-outline',
  Utensils: 'restaurant-outline',
  VolumeX: 'volume-mute-outline',
  Wallet: 'wallet-outline',
  Wrench: 'build-outline',
  X: 'close-outline',
};

type IconName = keyof typeof iconMap;

const STORE_KEY = SYNC_KEY; // shared with apiSync for cross-tab localStorage sync
const AUTH_KEY = 'andrik-game-zone:user';
const localPasswords: Record<string, string> = {
  'administrator@gmail.com': 'admin123',
  'staff@gmail.com': 'staff123',
};

// SplashScreen handled in App.tsx

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
};

type EditorMode<T> = { mode: 'add'; value?: undefined } | { mode: 'edit'; value: T };

type StationDraft = {
  name: string;
  category: string;
  ratePerHour: number;
  extraControllerRate: number;
  includedControllers: number;
  imageKey: string;
  photoUri?: string;
};

type InventoryDraft = {
  name: string;
  category: string;
  price: number;
  stock: number;
  alertAt: number;
  imageKey: string;
  photoUri?: string;
};

type ExpenseDraft = {
  note: string;
  category: string;
  amount: number;
};

type AccountDraft = {
  name: string;
  email: string;
  password: string;
  role: UserProfile['role'];
};

function normalizeSession(session: Session): Session {
  return {
    ...session,
    items: session.items ?? [],
    controllers: session.controllers ?? 1,
    includedControllers: session.includedControllers ?? 1,
    extraControllerRate: session.extraControllerRate ?? 0,
    ratePerHour: session.ratePerHour ?? 0,
    accumulatedMs: session.accumulatedMs ?? 0,
    lastResumedAt: session.lastResumedAt ?? session.startedAt ?? Date.now(),
    limitMinutes: session.limitMinutes ?? null,
  };
}

function normalizeStation(station: Station): Station {
  return {
    ...station,
    imageKey: resolveBundledImageKey(station.imageKey),
    photoUri: normalizePhotoUri(station.photoUri),
  };
}

function normalizeInventoryItem(item: InventoryItem): InventoryItem {
  return {
    ...item,
    imageKey: resolveBundledImageKey(item.imageKey),
    photoUri: normalizePhotoUri(item.photoUri),
  };
}

const DEFAULT_ADMIN: UserProfile = {
  id: 'local_admin',
  name: 'administrator',
  email: 'administrator@gmail.com',
  role: 'admin',
};

function normalizeUsers(raw: unknown): Record<string, UserProfile> {
  if (!raw || typeof raw !== 'object') return {};
  const users: Record<string, UserProfile> = {};
  Object.entries(raw as Record<string, unknown>).forEach(([key, value]) => {
    if (!value || typeof value !== 'object') return;
    const item = value as UserProfile;
    if (!item.email || typeof item.email !== 'string') return;
    const userId = item.id ?? key;
    users[userId] = {
      id: userId,
      name: item.name?.trim() || item.email.split('@')[0],
      email: item.email.trim().toLowerCase(),
      role: item.role === 'admin' ? 'admin' : 'staff',
    };
  });
  return users;
}

function mergeSyncedBusiness(local: BusinessData, remote: BusinessData): BusinessData {
  const remoteNorm = normalizeData(remote);
  const localNorm = normalizeData(local);
  // Remote wins for all live operational data; local fills any gap not yet on remote
  return ensureDefaultAdmin({
    ...remoteNorm,
    users: { ...normalizeUsers(remoteNorm.users), ...normalizeUsers(localNorm.users) },
    credentials: { ...localPasswords, ...(remoteNorm.credentials ?? {}), ...(localNorm.credentials ?? {}) },
    sessions: { ...localNorm.sessions, ...remoteNorm.sessions },
    stations: { ...localNorm.stations, ...remoteNorm.stations },
    inventory: { ...localNorm.inventory, ...remoteNorm.inventory },
    expenses: { ...localNorm.expenses, ...remoteNorm.expenses },
    customers: { ...localNorm.customers, ...remoteNorm.customers },
  });
}

function ensureDefaultAdmin(data: BusinessData): BusinessData {
  const users = normalizeUsers(data.users);
  const credentials = { ...localPasswords, ...(data.credentials ?? {}) };
  const adminEmail = DEFAULT_ADMIN.email.toLowerCase();
  const adminKey = Object.keys(users).find((key) => users[key].email.toLowerCase() === adminEmail);
  if (!adminKey) {
    users[DEFAULT_ADMIN.id] = DEFAULT_ADMIN;
  } else {
    users[adminKey] = { ...users[adminKey], role: 'admin' };
  }
  credentials[adminEmail] = localPasswords[adminEmail];
  return { ...data, users, credentials };
}

function normalizeData(raw?: Partial<BusinessData>): BusinessData {
  const base = ensureDefaultAdmin({
    ...seedData,
    settings: { ...seedData.settings },
    users: { ...seedData.users },
    stations: { ...seedData.stations },
    customers: {} as BusinessData['customers'],
    inventory: { ...seedData.inventory },
    sessions: {} as BusinessData['sessions'],
    expenses: {} as BusinessData['expenses'],
    auditLogs: {} as BusinessData['auditLogs'],
    credentials: { ...localPasswords },
  });

  if (!raw) return base;

  const sessions = Object.fromEntries(
    Object.entries(raw.sessions ?? {}).map(([key, session]) => [key, normalizeSession(session as Session)]),
  );
  const stations = Object.fromEntries(
    Object.entries({ ...seedData.stations, ...(raw.stations ?? {}) }).map(([key, station]) => [
      key,
      normalizeStation(station as Station),
    ]),
  );
  const inventory = Object.fromEntries(
    Object.entries({ ...seedData.inventory, ...(raw.inventory ?? {}) }).map(([key, item]) => [
      key,
      normalizeInventoryItem(item as InventoryItem),
    ]),
  );

  // NEVER wipe customers — preserve whatever remote/local has
  const customers = raw.customers ?? {};

  return ensureDefaultAdmin({
    ...base,
    ...raw,
    businessId: raw.businessId ?? seedData.businessId,
    settings: { ...seedData.settings, ...(raw.settings ?? {}) },
    users: normalizeUsers(raw.users),
    stations,
    customers,
    inventory,
    sessions,
    expenses: { ...(raw.expenses ?? {}) },
    auditLogs: { ...(raw.auditLogs ?? {}) },
    credentials: { ...localPasswords, ...(raw.credentials ?? {}) },
  });
}

function id(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function shortName(name: string, max = 18) {
  return name.length > max ? `${name.slice(0, max - 3)}...` : name;
}

function findApprovedProfile(data: BusinessData, email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  return Object.values(data.users ?? {}).find((item) => item.email.toLowerCase() === normalizedEmail);
}

function getLoginPassword(data: BusinessData, email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  return data.credentials?.[normalizedEmail] ?? localPasswords[normalizedEmail];
}

function setLoginPassword(credentials: Record<string, string> | undefined, email: string, password: string) {
  return { ...(credentials ?? {}), [email.trim().toLowerCase()]: password };
}

function notify(title: string, message?: string) {
  if (Platform.OS === 'web') {
    const alertFn = (globalThis as unknown as { alert?: (text: string) => void }).alert;
    alertFn?.(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

function confirmAction({ title, message, confirmLabel = 'Remove', cancelLabel = 'Cancel', onConfirm }: ConfirmOptions) {
  if (Platform.OS === 'web') {
    const confirmFn = (globalThis as unknown as { confirm?: (text: string) => boolean }).confirm;
    if (!confirmFn || confirmFn(message ? `${title}\n\n${message}` : title)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: cancelLabel, style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}

function stopNestedPress(handler: () => void) {
  return (event: GestureResponderEvent) => {
    event.stopPropagation();
    handler();
  };
}

function AppIcon({ name, size = 20, color = colors.text, strokeWidth = 2.5 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const ionName = iconMap[name as string] ?? 'help-outline';
  return <Ionicons name={ionName as any} size={size} color={color} />;
}

function Card({ children, style, active = false }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; active?: boolean }) {
  return <View style={[styles.card, active && styles.cardActive, style]}>{children}</View>;
}

function AppButton({
  label,
  icon,
  onPress,
  variant = 'primary',
  disabled = false,
  style,
}: {
  label: string;
  icon?: IconName;
  onPress?: (event: GestureResponderEvent) => void;
  variant?: 'primary' | 'outline' | 'danger' | 'ghost' | 'yellow' | 'purple';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [styles.button, styles[`button_${variant}`], disabled && styles.buttonDisabled, pressed && !disabled && styles.pressed, style]}
    >
      {icon ? <AppIcon name={icon} size={17} color={variant === 'primary' ? colors.bg : variant === 'danger' ? colors.red : colors.cyan} /> : null}
      <Text style={[styles.buttonText, styles[`buttonText_${variant}`], disabled && styles.buttonTextDisabled]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function Stepper({ value, onChange, min = 0, max = 99 }: { value: number; onChange: (value: number) => void; min?: number; max?: number }) {
  return (
    <View style={styles.stepper}>
      <Pressable style={styles.stepButton} onPress={() => onChange(Math.max(min, value - 1))}>
        <AppIcon name="Minus" size={24} />
      </Pressable>
      <Text style={styles.stepValue}>{value}</Text>
      <Pressable style={styles.stepButton} onPress={() => onChange(Math.min(max, value + 1))}>
        <AppIcon name="Plus" size={24} />
      </Pressable>
    </View>
  );
}

function Sheet({ visible, title, children, onClose, footer }: { visible: boolean; title: string; children: React.ReactNode; onClose: () => void; footer?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle} numberOfLines={1}>{title}</Text>
            <Pressable style={styles.closeButton} onPress={onClose}>
              <AppIcon name="X" size={26} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.sheetScroller}
            contentContainerStyle={styles.sheetContent}
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            overScrollMode="never"
            bounces={false}
          >
            {children}
          </ScrollView>
          {footer ? <View style={styles.sheetFooter}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Stat({ label, value, icon, accent = colors.cyan, active = false }: { label: string; value: string; icon?: IconName; accent?: string; active?: boolean }) {
  return (
    <Card style={styles.stat} active={active}>
      {icon ? <AppIcon name={icon} size={20} color={accent} /> : null}
      <Text style={styles.muted}>{label}</Text>
      <Text style={[styles.statValue, { color: accent }]}>{value}</Text>
    </Card>
  );
}

function DataPill({ label, color = colors.cyan }: { label: string; color?: string }) {
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

export default function AppRoot() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <GameZoneApp />
    </SafeAreaProvider>
  );
}

function GameZoneApp() {
  const { width } = useWindowDimensions();
  const [data, setData] = useState<BusinessData>(() => normalizeData());
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [tab, setTab] = useState<TabKey>('stations');
  const [clock, setClock] = useState(Date.now());
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [stationEditor, setStationEditor] = useState<EditorMode<Station> | null>(null);
  const [inventoryEditor, setInventoryEditor] = useState<EditorMode<InventoryItem> | null>(null);
  const [createUserRole, setCreateUserRole] = useState<'staff' | 'admin' | null>(null);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showMaintenanceNote, setShowMaintenanceNote] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showAddItems, setShowAddItems] = useState(false);
  const [showCustomItem, setShowCustomItem] = useState(false);

  const containerWidth = Math.min(width, 860);

  // Refs for cross-effect sync state
  const lastWriteTsRef = useRef(0);
  const localJsonRef = useRef('');
  const firebaseUnsubRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(false);

  // Stable callback: apply data pushed from Firebase or BroadcastChannel
  const applyRemote = useCallback((remote: BusinessData) => {
    // Suppress our own Firebase echo for 2s (our writes bounce back from RTDB)
    if (Date.now() - lastWriteTsRef.current < 2000) return;
    setData((current) => {
      const merged = mergeSyncedBusiness(current, remote);
      const json = JSON.stringify(merged);
      if (json === localJsonRef.current) return current; // no real change
      localJsonRef.current = json;
      saveBusinessApi(merged).catch(() => undefined);
      return merged;
    });
  }, []);

  // ── Initial load + local/api subscription ──────────────────────────────────
  useEffect(() => {
    configureAlarms().catch(() => undefined);
    AsyncStorage.getItem(AUTH_KEY).then((stored) => stored && setUser(JSON.parse(stored) as UserProfile));

    const syncId = BUSINESS_SYNC_ID;

    // Load from Firebase FIRST — full cloud sync across all devices
    // Falls back to local cache only if Firebase is unreachable
    const init = async () => {
      try {
        const remote = await loadBusiness(syncId);
        if (remote) {
          const normalized = normalizeData(remote);
          localJsonRef.current = JSON.stringify(normalized);
          setData(normalized);
          saveBusinessApi(normalized).catch(() => undefined);
          return;
        }
      } catch { /* Firebase unreachable — fall back to local cache */ }
      const local = await loadBusinessApi().catch(() => null);
      if (local) {
        const normalized = normalizeData(local);
        localJsonRef.current = JSON.stringify(normalized);
        setData(normalized);
      } else {
        const seed = normalizeData();
        localJsonRef.current = JSON.stringify(seed);
        setData(seed);
        saveBusinessApi(seed).catch(() => undefined);
      }
    };
    init().catch(() => setData(normalizeData())).finally(() => { mountedRef.current = true; setReady(true); });

    // 3. Firebase RTDB real-time listener — fires instantly on all connected devices/ports
    firebaseUnsubRef.current = subscribeBusiness(applyRemote, syncId);
    // 4. BroadcastChannel / storage event — same-origin tab sync (web)
    const unsubscribeApi = subscribeBusinessApi(applyRemote);

    return () => {
      unsubscribeApi();
      firebaseUnsubRef.current?.();
    };
  }, [applyRemote]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // App is ready
  }, [ready]);

  // Foreground service: set up the "active sessions" notification channel on Android
  useEffect(() => {
    setupRunningChannel().catch(() => undefined);
  }, []);

  // Foreground service: update persistent notification whenever sessions change or every 30 s
  const lastNotifTimeRef = useRef(0);
  const lastRunningCountRef = useRef(-1);
  useEffect(() => {
    const runningSessions = Object.values(data.sessions).filter(
      (s) => s.status === 'running' || s.status === 'paused' || s.status === 'alarm',
    );
    const now = Date.now();
    const countChanged = runningSessions.length !== lastRunningCountRef.current;
    const timeExpired = now - lastNotifTimeRef.current >= 30000;
    if (countChanged || timeExpired) {
      lastRunningCountRef.current = runningSessions.length;
      lastNotifTimeRef.current = now;
      updateRunningNotification(runningSessions, now).catch(() => undefined);
    }
  }, [clock, data.sessions]);

  const persistBusiness = useCallback((next: BusinessData) => {
    const normalized = normalizeData(next);
    lastWriteTsRef.current = Date.now();
    localJsonRef.current = JSON.stringify(normalized);
    setData(normalized);
    saveBusinessApi(normalized).catch(() => undefined);
    saveBusiness(normalized, BUSINESS_SYNC_ID).catch(() => undefined);
    return Promise.resolve();
  }, []);

  const commit = useCallback(
    (updater: (current: BusinessData) => BusinessData) => {
      setData((current) => {
        const next = normalizeData(updater(current));
        // Stamp write time so applyRemote suppresses our own Firebase echo
        lastWriteTsRef.current = Date.now();
        localJsonRef.current = JSON.stringify(next);
        saveBusinessApi(next).catch(() => undefined);
        saveBusiness(next, BUSINESS_SYNC_ID).catch(() => undefined);
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    const expired = Object.values(data.sessions ?? {}).filter(
      (session) => session.status === 'running' && session.limitMinutes && elapsedMs(session, clock) >= session.limitMinutes * 60000,
    );
    expired.forEach((session) => {
      commit((current) => {
        const currentSession = current.sessions[session.id];
        if (!currentSession || currentSession.status !== 'running' || !currentSession.limitMinutes) return current;
        const limitMs = currentSession.limitMinutes * 60000;
        if (!currentSession.alarmSilenced) ringAlarm().catch(() => undefined);
        return {
          ...current,
          sessions: {
            ...current.sessions,
            [session.id]: {
              ...currentSession,
              status: 'alarm',
              accumulatedMs: limitMs,
              alarmedAt: Date.now(),
            },
          },
          stations: {
            ...current.stations,
            [currentSession.stationId]: {
              ...current.stations[currentSession.stationId],
              status: 'alarm',
            },
          },
        };
      });
    });
  }, [clock, commit, data.sessions]);

  const runningCount = Object.values(data.stations ?? {}).filter((station) => station.status === 'running' || station.status === 'alarm' || station.status === 'paused').length;
  const activeSession = activeSessionId ? data.sessions[activeSessionId] : null;

  const openAddItems = () => {
    setShowCustomItem(false);
    setShowAddItems(true);
  };

  const openCustomItem = () => {
    setShowAddItems(false);
    setShowCustomItem(true);
  };

  const signIn = async (email: string, password: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    const approvedProfile = findApprovedProfile(data, normalizedEmail);
    if (!approvedProfile) {
      notify('Account not found', 'Create an account first, or check your email.');
      return;
    }
    if (firebaseEnabled) {
      try {
        await firebaseSignIn(normalizedEmail, password);
      } catch {
        const expected = getLoginPassword(data, normalizedEmail);
        if (!expected || expected !== password) {
          notify('Sign in failed', 'Wrong password. Try again or create a new account.');
          return;
        }
      }
    } else {
      const expected = getLoginPassword(data, normalizedEmail);
      if (expected && expected !== password) {
        notify('Sign in failed', 'Wrong password.');
        return;
      }
    }
    setUser(approvedProfile);
    AsyncStorage.setItem(AUTH_KEY, JSON.stringify(approvedProfile)).catch(() => undefined);
  };

  const createUserAccount = async (draft: AccountDraft, confirmPassword: string) => {
    if (user?.role !== 'admin') return;
    const displayName = draft.name.trim();
    const normalizedEmail = draft.email.trim().toLowerCase();
    const password = draft.password;
    const role = draft.role;
    if (!displayName) {
      notify('Enter a name');
      return;
    }
    if (!normalizedEmail.includes('@')) {
      notify('Enter a valid email');
      return;
    }
    if (password.length < 6) {
      notify('Password needs 6+ characters');
      return;
    }
    if (password !== confirmPassword) {
      notify('Passwords do not match');
      return;
    }
    if (findApprovedProfile(data, normalizedEmail)) {
      notify('Email already exists');
      return;
    }

    let userId = id('user');
    let profile: UserProfile = { id: userId, name: displayName, email: normalizedEmail, role };

    if (firebaseEnabled) {
      try {
        const credential = await firebaseCreateUser(normalizedEmail, password);
        const uid = (credential as { user?: { uid?: string } } | null)?.user?.uid;
        if (uid) {
          userId = uid;
          profile = { ...profile, id: userId };
        }
      } catch (error) {
        notify(firebaseCreateAuthErrorMessage(error));
        return;
      }
    }

    const nextData = normalizeData({
      ...data,
      users: { ...(data.users ?? {}), [userId]: profile },
      credentials: setLoginPassword(data.credentials, normalizedEmail, password),
    });

    setCreateUserRole(null);
    try {
      await persistBusiness(nextData);
    } catch {
      setData(nextData);
      saveBusinessApi(nextData).catch(() => undefined);
    }
  };

  const removeUserAccount = (profile: UserProfile) => {
    const adminEmail = DEFAULT_ADMIN.email.toLowerCase();
    if (profile.email.toLowerCase() === adminEmail) {
      notify('Cannot remove', 'The default administrator account cannot be deleted.');
      return;
    }
    if (user && profile.email.toLowerCase() === user.email.toLowerCase()) {
      notify('Cannot remove yourself', 'Sign in as another admin to remove this account.');
      return;
    }
    confirmAction({
      title: 'Remove user?',
      message: `Remove ${profile.email}? They will not be able to sign in.`,
      onConfirm: () => {
        commit((current) => {
          const nextUsers = { ...(current.users ?? {}) };
          delete nextUsers[profile.id];
          const nextCredentials = { ...(current.credentials ?? {}) };
          delete nextCredentials[profile.email.toLowerCase()];
          return { ...current, users: nextUsers, credentials: nextCredentials };
        });
      },
    });
  };

  const changeApprovedPassword = async (
    email: string,
    oldPassword: string,
    newPassword: string,
    confirmPassword: string,
  ): Promise<boolean> => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.includes('@')) {
      notify('Invalid email', 'Enter the email for this account.');
      return false;
    }
    if (!findApprovedProfile(data, normalizedEmail)) {
      notify('Account not found', 'Ask an admin to create your account in Settings first.');
      return false;
    }
    if (!oldPassword) {
      notify('Old password required', 'Enter your current password.');
      return false;
    }
    if (newPassword.length < 6) {
      notify('Password too short', 'Use at least 6 characters.');
      return false;
    }
    if (newPassword !== confirmPassword) {
      notify('Passwords do not match', 'Confirm the new password again.');
      return false;
    }
    if (oldPassword === newPassword) {
      notify('Choose a new password', 'New password must be different from the old one.');
      return false;
    }

    const expected = getLoginPassword(data, normalizedEmail);
    const saveLocalPassword = () => {
      commit((current) => ({
        ...current,
        credentials: setLoginPassword(current.credentials, normalizedEmail, newPassword),
      }));
    };

    if (firebaseEnabled) {
      try {
        await firebaseChangePassword(normalizedEmail, oldPassword, newPassword);
        saveLocalPassword();
        notify('Password changed', 'Sign in with your new password.');
        return true;
      } catch (error) {
        const message = (error as Error).message === 'NO_AUTH' ? 'Online password change is not available.' : firebaseAuthErrorMessage(error);
        if (!expected || expected !== oldPassword) {
          notify('Change failed', message);
          return false;
        }
        saveLocalPassword();
        notify('Password saved', 'App password updated. Online login was not changed because no Firebase account exists for this email.');
        return true;
      }
    }

    if (!expected) {
      notify('Change failed', 'No saved password for this account. Ask an admin to recreate it in Settings.');
      return false;
    }
    if (expected !== oldPassword) {
      notify('Change failed', 'Old password is wrong.');
      return false;
    }
    saveLocalPassword();
    notify('Password changed', 'Sign in with your new password.');
    return true;
  };

  const signOutUser = async () => {
    await firebaseSignOut().catch(() => undefined);
    stopAlarm();
    setUser(null);
    await AsyncStorage.removeItem(AUTH_KEY);
  };

  const silenceSessionAlarm = (session: Session) => {
    stopAlarm();
    commit((current) => {
      const live = current.sessions[session.id];
      if (!live) return current;
      return {
        ...current,
        sessions: {
          ...current.sessions,
          [session.id]: { ...live, alarmSilenced: true },
        },
      };
    });
  };

  const startSession = (station: Station, controllers: number, limitMinutes: number | null) => {
    if (station.status !== 'idle') {
      notify('Station is active', 'Stop or checkout the current session before starting a new one.');
      return;
    }
    const sessionId = id('session');
    const startedAt = Date.now();
    const session: Session = {
      id: sessionId,
      stationId: station.id,
      stationName: station.name,
      ratePerHour: station.ratePerHour,
      includedControllers: station.includedControllers,
      extraControllerRate: station.extraControllerRate,
      controllers,
      startedAt,
      lastResumedAt: startedAt,
      accumulatedMs: 0,
      status: 'running',
      limitMinutes,
      items: [],
    };
    commit((current) => ({
      ...current,
      sessions: { ...current.sessions, [sessionId]: session },
      stations: { ...current.stations, [station.id]: { ...station, status: 'running', activeSessionId: sessionId } },
    }));
    if (limitMinutes) scheduleSessionAlarm(sessionId, station.name, limitMinutes).catch(() => undefined);
    setSelectedStation(null);
    setActiveSessionId(sessionId);
  };

  const pauseSession = (session: Session) => {
    commit((current) => {
      const live = current.sessions[session.id];
      if (!live) return current;
      return {
        ...current,
        sessions: {
          ...current.sessions,
          [live.id]: { ...live, status: 'paused', accumulatedMs: elapsedMs(live, clock) },
        },
        stations: { ...current.stations, [live.stationId]: { ...current.stations[live.stationId], status: 'paused' } },
      };
    });
  };

  const resumeSession = (session: Session) => {
    stopAlarm();
    const continuingAfterAlarm = session.status === 'alarm';
    const now = Date.now();
    commit((current) => {
      const live = current.sessions[session.id] ?? session;
      return {
        ...current,
        sessions: {
          ...current.sessions,
          [live.id]: {
            ...live,
            status: 'running',
            lastResumedAt: now,
            accumulatedMs: live.accumulatedMs,
            alarmedAt: undefined,
            alarmSilenced: continuingAfterAlarm ? true : live.alarmSilenced,
            limitMinutes: continuingAfterAlarm ? null : live.limitMinutes,
            overtime: continuingAfterAlarm ? true : live.overtime,
          },
        },
        stations: {
          ...current.stations,
          [live.stationId]: { ...current.stations[live.stationId], status: 'running' },
        },
      };
    });
  };

  const closeSession = (session: Session) => {
    stopAlarm();
    commit((current) => {
      const live = current.sessions[session.id] ?? session;
      const totals = sessionTotals(live, current.settings, undefined, clock);
      return {
        ...current,
        sessions: {
          ...current.sessions,
          [session.id]: {
            ...live,
            status: 'closed',
            endedAt: Date.now(),
            accumulatedMs: elapsedMs(live, clock),
            payment: { cash: totals.total, wallet: 0, discount: 0, total: totals.total },
          },
        },
        stations: {
          ...current.stations,
          [live.stationId]: {
            ...current.stations[live.stationId],
            status: 'idle',
            activeSessionId: undefined,
          },
        },
      };
    });
    setActiveSessionId(null);
  };

  const addItemsToSession = (session: Session, quantities: Record<string, number>) => {
    commit((current) => {
      const live = current.sessions[session.id] ?? session;
      const nextInventory = { ...current.inventory };
      const nextItems = [...(live.items ?? [])];
      Object.entries(quantities).forEach(([itemId, quantity]) => {
        if (quantity <= 0) return;
        const item = nextInventory[itemId];
        if (!item) return;
        const safeQty = Math.min(quantity, item.stock);
        if (safeQty <= 0) return;
        const existing = nextItems.find((line) => line.inventoryId === itemId);
        if (existing) existing.quantity += safeQty;
        else nextItems.push({ id: id('line'), inventoryId: itemId, name: item.name, price: item.price, quantity: safeQty });
        nextInventory[itemId] = { ...item, stock: item.stock - safeQty };
      });
      return {
        ...current,
        inventory: nextInventory,
        sessions: { ...current.sessions, [session.id]: { ...live, items: nextItems } },
      };
    });
  };

  const addCustomItem = (session: Session, name: string, price: number, quantity: number) => {
    if (!name.trim() || price <= 0 || quantity <= 0) return;
    commit((current) => {
      const live = current.sessions[session.id] ?? session;
      return {
        ...current,
        sessions: {
          ...current.sessions,
          [session.id]: {
            ...live,
            items: [...(live.items ?? []), { id: id('custom'), name: name.trim(), price, quantity, custom: true }],
          },
        },
      };
    });
  };

  const saveStationDraft = async (draft: StationDraft, existing?: Station) => {
    const stationId = existing?.id ?? id('station');
    const storedUri = draft.photoUri;
    if (draft.photoUri && !draft.photoUri.startsWith('https://')) {
      uploadBusinessImage(draft.photoUri, 'stations').then((remoteUri) => {
        if (remoteUri?.startsWith('https')) {
          commit((current) => ({
            ...current,
            stations: { ...current.stations, [stationId]: { ...current.stations[stationId], photoUri: remoteUri } },
          }));
          if (firebaseEnabled) updateBusinessField(`stations/${stationId}/photoUri`, remoteUri).catch(() => undefined);
        }
      }).catch(() => undefined);
    }
    commit((current) => {
      const nextNumber = existing?.number ?? Object.values(current.stations ?? {}).reduce((max, station) => Math.max(max, station.number ?? 0), 0) + 1;
      const previous = existing ? current.stations[existing.id] : undefined;
      return {
        ...current,
        stations: {
          ...current.stations,
          [stationId]: {
            id: stationId,
            number: nextNumber,
            name: draft.name.trim() || `STATION ${nextNumber}`,
            category: draft.category.trim() || 'Console',
            ratePerHour: Math.max(0, Math.round(draft.ratePerHour)),
            includedControllers: Math.max(0, Math.round(draft.includedControllers)),
            extraControllerRate: Math.max(0, Math.round(draft.extraControllerRate)),
            status: previous?.status ?? 'idle',
            activeSessionId: previous?.activeSessionId,
            imageKey: draft.imageKey,
            photoUri: storedUri,
          },
        },
      };
    });
    setStationEditor(null);
  };

  const deleteStation = (station: Station) => {
    if (user?.role !== 'admin') {
      notify('Staff access', 'Only admins can remove stations.');
      return;
    }
    if (station.activeSessionId || station.status !== 'idle') {
      notify('Station is active', 'Stop or checkout the running session before deleting this station.');
      return;
    }
    confirmAction({
      title: 'Remove station?',
      message: `Delete ${station.name}?`,
      onConfirm: () =>
        commit((current) => {
          const nextStations = { ...current.stations };
          delete nextStations[station.id];
          return { ...current, stations: nextStations };
        }),
    });
  };

  const saveInventoryDraft = async (draft: InventoryDraft, existing?: InventoryItem) => {
    if (existing && user?.role !== 'admin') {
      notify('Admin only', 'Only admins can edit inventory items.');
      return;
    }
    const itemId = existing?.id ?? id('item');
    const storedUri = draft.photoUri;
    if (draft.photoUri && !draft.photoUri.startsWith('https://')) {
      uploadBusinessImage(draft.photoUri, 'inventory').then((remoteUri) => {
        if (remoteUri?.startsWith('https')) {
          commit((current) => ({
            ...current,
            inventory: { ...current.inventory, [itemId]: { ...current.inventory[itemId], photoUri: remoteUri } },
          }));
          if (firebaseEnabled) updateBusinessField(`inventory/${itemId}/photoUri`, remoteUri).catch(() => undefined);
        }
      }).catch(() => undefined);
    }
    commit((current) => ({
      ...current,
      inventory: {
        ...current.inventory,
        [itemId]: {
          id: itemId,
          name: draft.name.trim() || 'New item',
          category: draft.category.trim() || 'Food',
          price: Math.max(0, Math.round(draft.price)),
          stock: Math.max(0, Math.round(draft.stock)),
          alertAt: Math.max(0, Math.round(draft.alertAt)),
          imageKey: draft.imageKey,
          photoUri: storedUri,
        },
      },
    }));
    setInventoryEditor(null);
  };

  const deleteInventoryItem = (item: InventoryItem) => {
    if (user?.role !== 'admin') {
      notify('Staff access', 'Only admins can remove inventory items.');
      return;
    }
    confirmAction({
      title: 'Remove item?',
      message: `Delete ${item.name}?`,
      onConfirm: () =>
        commit((current) => {
          const nextInventory = { ...current.inventory };
          delete nextInventory[item.id];
          return { ...current, inventory: nextInventory };
        }),
    });
  };

  const saveExpenseDraft = (draft: ExpenseDraft) => {
    const note = draft.note.trim();
    const category = draft.category.trim() || 'Operations';
    const amount = Math.max(0, Math.round(draft.amount));
    if (!note || amount <= 0) return;
    const expenseId = id('expense');
    commit((current) => ({
      ...current,
      expenses: {
        ...current.expenses,
        [expenseId]: { id: expenseId, note, category, amount, createdAt: Date.now() },
      },
    }));
    setShowAddExpense(false);
  };

  const saveMaintenanceNote = (stationIds: string[], note: string) => {
    const cleanNote = note.trim();
    if (!stationIds.length || !cleanNote) return;
    const stationNames = stationIds.map((stationId) => data.stations[stationId]?.name).filter(Boolean);
    const logId = id('log');
    commit((current) => ({
      ...current,
      auditLogs: {
        ...current.auditLogs,
        [logId]: {
          id: logId,
          message: `Maintenance note for ${stationNames.join(', ')}: ${cleanNote}`,
          createdAt: Date.now(),
        },
      },
    }));
    setShowMaintenanceNote(false);
  };

  const updateSettings = (settings: Partial<BusinessData['settings']>) => {
    commit((current) => ({ ...current, settings: { ...current.settings, ...settings } }));
  };

  const updatePhoto = async (kind: 'stations' | 'inventory', itemId: string) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      notify('Permission required', 'Please allow photo library access to upload images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.4 });
    if (result.canceled || !result.assets[0]?.uri) return;
    const localUri = result.assets[0].uri;
    const prev = kind === 'stations' ? data.stations[itemId] : data.inventory[itemId];
    if (prev?.photoUri === localUri) return;
    commit((current) => {
      if (kind === 'stations') {
        return {
          ...current,
          stations: { ...current.stations, [itemId]: { ...current.stations[itemId], photoUri: localUri } },
        };
      }
      return {
        ...current,
        inventory: { ...current.inventory, [itemId]: { ...current.inventory[itemId], photoUri: localUri } },
      };
    });
    uploadBusinessImage(localUri, kind).then((remoteUri) => {
      if (remoteUri?.startsWith('https')) {
        commit((current) => {
          if (kind === 'stations') {
            return {
              ...current,
              stations: { ...current.stations, [itemId]: { ...current.stations[itemId], photoUri: remoteUri } },
            };
          }
          return {
            ...current,
            inventory: { ...current.inventory, [itemId]: { ...current.inventory[itemId], photoUri: remoteUri } },
          };
        });
        if (firebaseEnabled) updateBusinessField(`${kind}/${itemId}/photoUri`, remoteUri).catch(() => undefined);
      }
    }).catch(() => undefined);
  };

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: '#060813', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#31d5c7" />
      </View>
    );
  }

  if (!user) {
    return <LoginScreen signIn={signIn} changePassword={changeApprovedPassword} />;
  }

  const isAdmin = user.role === 'admin';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.appFrame, { width: containerWidth }]}>
        {activeSession ? (
          <SessionDetail
            data={data}
            session={activeSession}
            clock={clock}
            onBack={() => setActiveSessionId(null)}
            onPause={() => pauseSession(activeSession)}
            onResume={() => resumeSession(activeSession)}
            onClose={() => closeSession(activeSession)}
            onSilenceAlarm={() => silenceSessionAlarm(activeSession)}
            onAddItems={openAddItems}
            onCustomItem={openCustomItem}
          />
        ) : (
          <>
            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
              {tab === 'stations' ? (
                <StationsScreen
                  data={data}
                  clock={clock}
                  runningCount={runningCount}
                  canManage={isAdmin}
                  onStart={setSelectedStation}
                  onOpenSession={setActiveSessionId}
                  onSilenceAlarm={silenceSessionAlarm}
                  onResumeSession={resumeSession}
                  onAddStation={() => setStationEditor({ mode: 'add' })}
                  onEditStation={(station) => isAdmin && setStationEditor({ mode: 'edit', value: station })}
                  onDeleteStation={deleteStation}
                />
              ) : null}
              {tab === 'inventory' ? (
                <InventoryScreen
                  data={data}
                  canManageInventory={isAdmin}
                  commit={commit}
                  updatePhoto={updatePhoto}
                  onAddItem={() => setInventoryEditor({ mode: 'add' })}
                  onEditItem={(item) => isAdmin && setInventoryEditor({ mode: 'edit', value: item })}
                  onDeleteItem={deleteInventoryItem}
                />
              ) : null}
              {tab === 'reports' ? <ReportsScreen data={data} rangeClock={clock} /> : null}
              {tab === 'settings' ? (
                <SettingsScreen
                  data={data}
                  user={user}
                  isAdmin={isAdmin}
                  signOut={signOutUser}
                  commit={commit}
                  updateSettings={updateSettings}
                  onAddStation={() => setStationEditor({ mode: 'add' })}
                  onCreateStaff={() => setCreateUserRole('staff')}
                  onCreateAdmin={() => setCreateUserRole('admin')}
                  onRemoveUser={removeUserAccount}
                  onAddExpense={() => setShowAddExpense(true)}
                  onMaintenance={() => setShowMaintenanceNote(true)}
                />
              ) : null}
            </ScrollView>
            <BottomTabs active={tab} onChange={setTab} />
          </>
        )}
      </View>
      <StartSessionSheet
        station={selectedStation}
        onClose={() => setSelectedStation(null)}
        onStart={(controllers, limit) => selectedStation && startSession(selectedStation, controllers, limit)}
      />
      <StationEditorSheet
        editor={stationEditor}
        onClose={() => setStationEditor(null)}
        onSave={(draft) => saveStationDraft(draft, stationEditor?.mode === 'edit' ? stationEditor.value : undefined)}
      />
      <InventoryEditorSheet
        editor={inventoryEditor}
        onClose={() => setInventoryEditor(null)}
        onSave={(draft) => saveInventoryDraft(draft, inventoryEditor?.mode === 'edit' ? inventoryEditor.value : undefined)}
      />
      <CreateAccountSheet
        role={createUserRole}
        onClose={() => setCreateUserRole(null)}
        onSave={(draft, confirmPassword) => createUserAccount(draft, confirmPassword)}
      />
      <AddExpenseSheet visible={showAddExpense} onClose={() => setShowAddExpense(false)} onSave={saveExpenseDraft} />
      <MaintenanceNoteSheet
        visible={showMaintenanceNote}
        stations={Object.values(data.stations ?? {}).sort((a, b) => (a.number ?? 0) - (b.number ?? 0))}
        onClose={() => setShowMaintenanceNote(false)}
        onSave={saveMaintenanceNote}
      />
      {activeSession ? (
        <>
          <AddItemsSheet visible={showAddItems} inventory={Object.values(data.inventory)} onClose={() => setShowAddItems(false)} onSwitchCustom={openCustomItem} onAdd={(qty) => addItemsToSession(activeSession, qty)} />
          <CustomItemSheet visible={showCustomItem} onClose={() => setShowCustomItem(false)} onSwitchInventory={openAddItems} onAdd={(name, price, qty) => addCustomItem(activeSession, name, price, qty)} />
        </>
      ) : null}
    </SafeAreaView>
  );
}

function LoginScreen({
  signIn,
  changePassword,
}: {
  signIn: (email: string, password: string) => void;
  changePassword: (email: string, oldPassword: string, newPassword: string, confirmPassword: string) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<'signin' | 'change'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const title = mode === 'change' ? 'Change password' : 'Sign in';

  const resetChangeForm = () => {
    setPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setMode('signin');
  };
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={[styles.loginWrap]} keyboardShouldPersistTaps="handled">
        <View style={styles.loginLines} />
        <AppImage imageKey="logo" style={styles.loginLogo} />
        <Text style={styles.brand}>ANDRIK</Text>
        <Text style={styles.brandZoneLine}>GAME ZONE</Text>
        <Card style={styles.loginCard} active>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.inputLabel}>EMAIL</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="you@example.com"
            placeholderTextColor={colors.subtle}
          />
          <Text style={styles.inputLabel}>{mode === 'change' ? 'OLD PASSWORD' : 'PASSWORD'}</Text>
          <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••" placeholderTextColor={colors.subtle} />
          {mode === 'change' ? (
            <>
              <Text style={styles.inputLabel}>NEW PASSWORD</Text>
              <TextInput style={styles.input} value={newPassword} onChangeText={setNewPassword} secureTextEntry placeholderTextColor={colors.subtle} />
              <Text style={styles.inputLabel}>CONFIRM NEW PASSWORD</Text>
              <TextInput style={styles.input} value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry placeholderTextColor={colors.subtle} />
            </>
          ) : null}
          {mode === 'signin' ? (
            <>
              <AppButton label="SIGN IN" icon="Mail" onPress={() => signIn(email, password)} style={styles.fullButton} />
              <AppButton label="CHANGE PASSWORD" icon="KeyRound" variant="ghost" onPress={() => setMode('change')} />
            </>
          ) : (
            <>
              <AppButton
                label="CHANGE PASSWORD"
                icon="KeyRound"
                disabled={busy}
                onPress={async () => {
                  setBusy(true);
                  const ok = await changePassword(email, password, newPassword, confirmPassword);
                  setBusy(false);
                  if (ok) resetChangeForm();
                }}
                style={styles.fullButton}
              />
              <AppButton label="BACK TO SIGN IN" variant="outline" disabled={busy} onPress={resetChangeForm} />
            </>
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function CreateAccountSheet({
  role,
  onClose,
  onSave,
}: {
  role: 'staff' | 'admin' | null;
  onClose: () => void;
  onSave: (draft: AccountDraft, confirmPassword: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (role) {
      setName('');
      setEmail('');
      setPassword('');
      setConfirmPassword('');
      setSaving(false);
    }
  }, [role]);
  if (!role) return null;
  const isStaff = role === 'staff';
  const title = isStaff ? 'Create staff account' : 'Create admin account';
  const canSave = Boolean(name.trim() && email.trim() && password.length >= 6 && password === confirmPassword);
  return (
    <Sheet visible={Boolean(role)} title={title} onClose={onClose}>
        <Text style={styles.inputLabel}>NAME</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder={isStaff ? 'Staff name' : 'Admin name'} placeholderTextColor={colors.subtle} />
        <Text style={styles.inputLabel}>EMAIL</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="name@example.com"
          placeholderTextColor={colors.subtle}
        />
        <Text style={styles.inputLabel}>PASSWORD</Text>
        <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholderTextColor={colors.subtle} />
        <Text style={styles.inputLabel}>CONFIRM PASSWORD</Text>
        <TextInput style={styles.input} value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry placeholderTextColor={colors.subtle} />
        <AppButton
          label={saving ? 'CREATING...' : isStaff ? 'CREATE STAFF' : 'CREATE ADMIN'}
          icon="UserPlus"
          disabled={!canSave || saving}
          onPress={async () => {
            setSaving(true);
            await onSave({ name, email, password, role }, confirmPassword);
            setSaving(false);
          }}
          style={styles.fullButton}
        />
    </Sheet>
  );
}

function AppHeader({ runningCount, totalStations }: { runningCount: number; totalStations: number }) {
  return (
    <View style={styles.appHeader}>
      <View style={styles.brandRow}>
        <AppImage imageKey="logo" style={styles.headerLogo} />
        <View style={styles.brandTextWrap}>
          <Text style={styles.brandSmall} numberOfLines={1}>ANDRIK</Text>
          <Text style={styles.brandTagline}>GAME ZONE</Text>
        </View>
        <DataPill label={`${runningCount} RUNNING`} color={runningCount > 0 ? colors.cyan : colors.muted} />
      </View>
      <Card style={styles.runningHero} active={runningCount > 0}>
        <View style={styles.runningHeroTop}>
          <AppIcon name="Gamepad2" size={22} color={colors.yellow} />
          <Text style={styles.runningHeroLabel} numberOfLines={1}>
            Active stations {runningCount}/{totalStations}
          </Text>
        </View>
      </Card>
    </View>
  );
}

function StationsScreen({
  data,
  clock,
  runningCount,
  canManage,
  onStart,
  onOpenSession,
  onSilenceAlarm,
  onResumeSession,
  onAddStation,
  onEditStation,
  onDeleteStation,
}: {
  data: BusinessData;
  clock: number;
  runningCount: number;
  canManage: boolean;
  onStart: (station: Station) => void;
  onOpenSession: (sessionId: string) => void;
  onSilenceAlarm: (session: Session) => void;
  onResumeSession: (session: Session) => void;
  onAddStation: () => void;
  onEditStation: (station: Station) => void;
  onDeleteStation: (station: Station) => void;
}) {
  const [mode, setMode] = useState<'list' | 'preview'>('preview');
  const stations = Object.values(data.stations ?? {}).sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  return (
    <View style={styles.screen}>
      <AppHeader runningCount={runningCount} totalStations={stations.length} />
      <View style={styles.toolbar}>
        <View style={styles.segmentSmall}>
          <Pressable style={[styles.segmentMini, mode === 'list' && styles.segmentMiniActive]} onPress={() => setMode('list')}>
            <AppIcon name="Menu" size={16} color={mode === 'list' ? colors.text : colors.muted} />
            <Text style={styles.segmentText}>LIST</Text>
          </Pressable>
          <Pressable style={[styles.segmentMini, mode === 'preview' && styles.segmentMiniActive]} onPress={() => setMode('preview')}>
            <AppIcon name="Grid3X3" size={16} color={mode === 'preview' ? colors.cyan : colors.muted} />
            <Text style={[styles.segmentText, mode === 'preview' && { color: colors.cyan }]}>PREVIEW</Text>
          </Pressable>
        </View>
        <AppButton label="ADD STATION" icon="PlusCircle" onPress={onAddStation} style={styles.addStationButton} />
      </View>
      <View style={mode === 'preview' ? styles.stationGrid : styles.listStack}>
        {stations.length === 0 ? (
          <Card style={styles.emptyCard}>
            <AppIcon name="Grid3X3" size={52} color={colors.border} />
            <Text style={styles.sectionTitle}>No stations yet</Text>
            <AppButton label="ADD STATION" icon="PlusCircle" onPress={onAddStation} />
          </Card>
        ) : (
          stations.map((station) => {
          const session = station.activeSessionId ? data.sessions[station.activeSessionId] : undefined;
          return (
            <StationCard
              key={station.id}
              station={station}
              session={session}
              settings={data.settings}
              clock={clock}
              mode={mode}
              onStart={() => onStart(station)}
              onOpen={() => session && onOpenSession(session.id)}
              onSilenceAlarm={() => session && onSilenceAlarm(session)}
              onResume={() => session && onResumeSession(session)}
              canManage={canManage}
              onEdit={() => onEditStation(station)}
              onDelete={() => onDeleteStation(station)}
            />
          );
          })
        )}
      </View>
    </View>
  );
}

function StationCard({
  station,
  session,
  settings,
  clock,
  mode,
  onStart,
  onOpen,
  onSilenceAlarm,
  onResume,
  canManage,
  onEdit,
  onDelete,
}: {
  station: Station;
  session?: Session;
  settings: BusinessData['settings'];
  clock: number;
  mode: 'list' | 'preview';
  onStart: () => void;
  onOpen: () => void;
  onSilenceAlarm: () => void;
  onResume: () => void;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const live = station.status === 'running' || station.status === 'alarm' || station.status === 'paused';
  const alarm = station.status === 'alarm';
  const paused = station.status === 'paused';
  const overtime = session?.overtime && station.status === 'running';
  const statusLabel = alarm ? 'ALARM' : overtime ? 'OVERTIME' : paused ? 'PAUSED' : live ? 'LIVE' : 'IDLE';
  const totals = session ? sessionTotals(session, settings, undefined, clock) : null;
  if (mode === 'list') {
    return (
      <Pressable onPress={live ? onOpen : undefined} style={[styles.stationListCard, live && styles.stationLive]}>
        <View style={styles.stationListMain}>
          <View style={styles.stationListMedia}>
            <Text style={[styles.stationNumber, live && { borderColor: colors.cyan, color: colors.cyan }]}>{station.number}</Text>
            <AppImage imageKey={station.imageKey} photoUri={station.photoUri} style={styles.stationListImage} />
          </View>
          <View style={styles.stationListBody}>
            <View style={styles.stationListHeader}>
              <Text style={styles.stationListName} numberOfLines={1}>
                {station.name}
              </Text>
              <Text style={[styles.stationStatus, live && styles.stationStatusLive, alarm && styles.stationStatusAlarm, overtime && styles.stationStatusOvertime]}>{statusLabel}</Text>
            </View>
            <Text style={styles.categoryBadge} numberOfLines={2}>
              {station.category.toUpperCase()}
            </Text>
          </View>
        </View>
        {live && session && totals ? (
          <View style={styles.liveMetaList}>
            <View style={styles.liveAmountBlock}>
            <Text style={styles.liveAmountLabel}>{alarm ? 'TIME OVER' : paused ? 'PAUSED' : 'RUNNING TOTAL'}</Text>
            </View>
            <View style={styles.liveTimingRow}>
              <Text style={styles.liveDuration}>{formatDuration(elapsedMs(session, clock))}</Text>
              {!paused ? <Text style={styles.liveTime}>since {nowTime(session.startedAt)}</Text> : null}
            </View>
            {alarm ? (
              <View style={styles.alarmActions}>
                <AppButton label="RESUME TIME" icon="Play" onPress={stopNestedPress(onResume)} style={styles.flex} />
                {!session.alarmSilenced ? (
                  <AppButton label="SILENCE" icon="VolumeX" variant="danger" onPress={stopNestedPress(onSilenceAlarm)} style={styles.flex} />
                ) : null}
              </View>
            ) : paused ? (
              <View style={styles.alarmActions}>
                <AppButton label="RESUME" icon="Play" onPress={stopNestedPress(onResume)} style={styles.flex} />
              </View>
            ) : null}
          </View>
        ) : (
          <AppButton label="START NOW" icon="Play" onPress={onStart} style={styles.stationListStart} />
        )}
        {canManage ? (
          <View style={styles.stationListActionRow}>
            <Pressable style={styles.editActionButton} onPress={stopNestedPress(onEdit)}>
              <AppIcon name="Pencil" size={22} color={colors.cyan} />
              <Text style={styles.editActionText}>EDIT</Text>
            </Pressable>
            <Pressable style={styles.removeStationButton} onPress={stopNestedPress(onDelete)}>
              <AppIcon name="Trash2" size={18} color={colors.red} />
              <Text style={styles.removeStationText}>REMOVE</Text>
            </Pressable>
          </View>
        ) : null}
      </Pressable>
    );
  }
  return (
    <Pressable onPress={live ? onOpen : undefined} style={[styles.stationCard, live && styles.stationLive]}>
      <View style={styles.stationTop}>
        <Text style={[styles.stationNumber, live && { borderColor: colors.cyan, color: colors.cyan }]}>{station.number}</Text>
        <Text style={[styles.stationStatus, live && styles.stationStatusLive, alarm && styles.stationStatusAlarm, overtime && styles.stationStatusOvertime]}>{statusLabel}</Text>
      </View>
      <AppImage imageKey={station.imageKey} photoUri={station.photoUri} style={styles.stationImage} />
      <Text style={styles.stationName} numberOfLines={1}>
        {station.name}
      </Text>
      {live && session && totals ? (
        <View style={styles.liveMeta}>
          <Text style={styles.liveAmountLabel}>{alarm ? 'TIME OVER' : paused ? 'PAUSED' : 'RUNNING'}</Text>
          <Text style={styles.liveDuration}>{formatDuration(elapsedMs(session, clock))}</Text>
          {alarm ? (
            <View style={styles.alarmActions}>
              <AppButton label="RESUME" icon="Play" onPress={stopNestedPress(onResume)} style={styles.flex} />
              {!session.alarmSilenced ? (
                <AppButton label="SILENCE" icon="VolumeX" variant="danger" onPress={stopNestedPress(onSilenceAlarm)} style={styles.flex} />
              ) : null}
            </View>
          ) : paused ? (
            <View style={styles.alarmActions}>
              <AppButton label="RESUME" icon="Play" onPress={stopNestedPress(onResume)} style={styles.flex} />
            </View>
          ) : null}
        </View>
      ) : (
        <AppButton label="START NOW" icon="Play" onPress={onStart} style={styles.startNow} />
      )}
      {canManage ? (
        <View style={styles.cardActions}>
          <Pressable style={styles.roundAction} onPress={stopNestedPress(onEdit)}>
            <AppIcon name="Pencil" size={20} color={colors.muted} />
          </Pressable>
          <Pressable style={styles.roundAction} onPress={stopNestedPress(onDelete)}>
            <AppIcon name="Trash2" size={20} color={colors.red} />
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}

function StartSessionSheet({
  station,
  onClose,
  onStart,
}: {
  station: Station | null;
  onClose: () => void;
  onStart: (controllers: number, limit: number | null) => void;
}) {
  const [controllers, setControllers] = useState(2);
  const [limit, setLimit] = useState<number | null>(null);
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(0);
  useEffect(() => {
    if (station) {
      setControllers(station.includedControllers);
      setLimit(null);
      setHours(0);
      setMinutes(0);
    }
  }, [station]);
  if (!station) return null;
  const customLimit = hours * 60 + minutes;
  const activeLimit = customLimit > 0 ? customLimit : limit;
  return (
    <Sheet visible={Boolean(station)} title="Start Session" onClose={onClose}>
        <Card style={styles.launchCard} active>
          <AppImage imageKey={station.imageKey} photoUri={station.photoUri} style={styles.launchImage} />
          <View style={styles.flex}>
            <Text style={styles.eyebrow}>READY TO LAUNCH</Text>
            <Text style={styles.launchTitle}>{station.name}</Text>
            <Text style={styles.muted}>{station.category} / NPR {station.ratePerHour}/hr</Text>
          </View>
        </Card>
        <Card>
          <Text style={styles.eyebrow}>SESSION SETUP</Text>
          <Text style={styles.sectionTitle}>Controllers</Text>
          <Stepper value={controllers} min={1} onChange={setControllers} />
          <View style={styles.triplet}>
            <MiniMetric label="INCLUDED" value={String(station.includedControllers)} />
            {(controllers - station.includedControllers) > 0 ? <>
              <MiniMetric label="EXTRA" value={String(Math.max(0, controllers - station.includedControllers))} />
              <MiniMetric label="ADDED / HR" value={`NPR ${Math.max(0, controllers - station.includedControllers) * station.extraControllerRate}`} />
            </> : null}
          </View>
        </Card>
        <Card>
          <Text style={styles.eyebrow}>TIME CONTROL</Text>
          <Text style={styles.sectionTitle}>Session Limit</Text>
          <View style={styles.limitGrid}>
            {[null, 30, 60, 90, 120].map((item) => (
              <Pressable key={String(item)} style={[styles.limitTile, limit === item && customLimit === 0 && styles.limitTileActive]} onPress={() => { setLimit(item); setHours(0); setMinutes(0); }}>
                <Text style={styles.limitTitle}>{item === null ? 'OPEN' : item === 30 ? '30M' : item === 60 ? '1H' : item === 90 ? '1H 30M' : '2H'}</Text>
                <Text style={styles.muted}>{item === null ? 'No alarm' : 'Alarm ready'}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.rowGap}>
            <Card style={styles.customTimeBox}>
              <Text style={styles.muted}>Hours</Text>
              <Stepper value={hours} min={0} max={12} onChange={setHours} />
            </Card>
            <Card style={styles.customTimeBox}>
              <Text style={styles.muted}>Minutes</Text>
              <Stepper value={minutes} min={0} max={59} onChange={setMinutes} />
            </Card>
          </View>
          <Card style={styles.summaryCard}>
            <Text style={styles.inputLabel}>LAUNCH SUMMARY</Text>
            <Text style={styles.mono}>Walk-in / {controllers} controllers / {activeLimit ? `${activeLimit}m limit` : 'Open time'}</Text>
          </Card>
          <AppButton label={activeLimit ? `START ${activeLimit}M SESSION` : 'START OPEN SESSION'} icon="Play" onPress={() => onStart(controllers, activeLimit)} style={styles.fullButton} />
        </Card>
    </Sheet>
  );
}

function billingUnitLabel(minutes: number) {
  if (minutes === 60) return '1 hr';
  if (minutes === 1) return '1 min';
  return `${minutes} min`;
}

function billingUnitSuffix(minutes: number) {
  if (minutes === 60) return '/hr';
  if (minutes === 1) return '/min';
  return `/${minutes} min`;
}

function billingUnitRateLabel(minutes: number) {
  if (minutes === 60) return 'RATE FOR 1 HR';
  if (minutes === 1) return 'RATE FOR 1 MIN';
  return `RATE FOR ${minutes} MIN`;
}

function rateForUnit(ratePerHour: number, minutes: number) {
  return Math.max(0, Math.round((ratePerHour * minutes) / 60));
}

function ratePerHourFromUnit(rate: number, minutes: number) {
  if (minutes <= 0) return 0;
  return Math.max(0, Math.round((rate * 60) / minutes));
}

function StationEditorSheet({
  editor,
  onClose,
  onSave,
}: {
  editor: EditorMode<Station> | null;
  onClose: () => void;
  onSave: (draft: StationDraft) => Promise<void>;
}) {
  const station = editor?.mode === 'edit' ? editor.value : undefined;
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Console');
  const [rate, setRate] = useState('250');
  const [extraRate, setExtraRate] = useState('20');
  const [freeControllers, setFreeControllers] = useState(2);
  const [customMinutes, setCustomMinutes] = useState(60);
  const [unit, setUnit] = useState(60);
  const [photoUri, setPhotoUri] = useState<string | undefined>();
  const [imageKey, setImageKey] = useState('stationStock');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editor) return;
    const hourlyRate = station?.ratePerHour ?? 250;
    setName(station?.name ?? '');
    setCategory(station?.category ?? 'Console');
    setUnit(60);
    setCustomMinutes(60);
    setRate(String(rateForUnit(hourlyRate, 60)));
    setExtraRate(String(station?.extraControllerRate ?? 20));
    setFreeControllers(station?.includedControllers ?? 2);
    setPhotoUri(station?.photoUri);
    setImageKey(station?.imageKey ?? 'stationStock');
    setSaving(false);
  }, [editor, station]);

  if (!editor) return null;

  const title = editor.mode === 'edit' ? `Edit ${station?.name ?? 'Station'}` : 'Add Station';
  const activeUnit = unit;

  const changeUnit = (nextUnit: number) => {
    const hourlyRate = ratePerHourFromUnit(Number(rate) || 0, activeUnit);
    setUnit(nextUnit);
    setCustomMinutes(nextUnit);
    setRate(String(rateForUnit(hourlyRate, nextUnit)));
  };

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.4 });
    if (!result.canceled && result.assets[0]?.uri) setPhotoUri(result.assets[0].uri);
  };

  const submit = async () => {
    setSaving(true);
    await onSave({
      name,
      category,
      ratePerHour: ratePerHourFromUnit(Number(rate) || 0, activeUnit),
      extraControllerRate: Number(extraRate) || 0,
      includedControllers: freeControllers,
      imageKey,
      photoUri,
    });
    setSaving(false);
  };

  return (
    <Sheet visible={Boolean(editor)} title={title} onClose={onClose}>
        <Text style={styles.inputLabel}>NAME</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="PS5 VIP, Projector Room..." placeholderTextColor={colors.subtle} />
        <Text style={styles.inputLabel}>TYPE</Text>
        <TextInput style={styles.input} value={category} onChangeText={setCategory} placeholder="Console" placeholderTextColor={colors.subtle} />

        <Card style={editor.mode === 'edit' ? styles.editorPhotoCardLarge : styles.editorPhotoCard}>
          <AppImage imageKey={imageKey} photoUri={photoUri} style={editor.mode === 'edit' ? styles.editorPhotoLarge : styles.editorPhotoThumb} />
          <View style={styles.flex}>
            <Text style={styles.itemName}>{editor.mode === 'edit' ? 'CUSTOM STATION PHOTO' : 'STOCK STATION TILE'}</Text>
            <Text style={styles.bodyText}>
              {editor.mode === 'edit' ? 'This photo is shown on station cards in every layout.' : 'The app will save a stock photo URL for this station unless you upload your own.'}
            </Text>
          </View>
        </Card>
        <View style={styles.rowGap}>
          <AppButton label={editor.mode === 'edit' ? 'CHANGE PHOTO' : 'UPLOAD PHOTO'} icon="Upload" onPress={pickPhoto} style={styles.flex} />
          {editor.mode === 'edit' ? (
            <AppButton
              label="USE DEFAULT TILE"
              icon="RotateCcw"
              variant="ghost"
              onPress={() => {
                setPhotoUri(undefined);
                setImageKey('stationStock');
              }}
              style={styles.flex}
            />
          ) : null}
        </View>

        <Card style={styles.priceEditorCard}>
          <View style={styles.rowBetween}>
            <View>
              <Text style={styles.eyebrow}>TIMER PRICE</Text>
              <Text style={styles.pricePreview}>
                NPR {Number(rate) || 0}
                {billingUnitSuffix(activeUnit)}
              </Text>
            </View>
            <View style={styles.unitBox}>
              <Text style={styles.inputLabel}>UNIT</Text>
              <Text style={styles.mono}>{billingUnitLabel(activeUnit)}</Text>
            </View>
          </View>
          <View style={styles.presetRow}>
            {[
              [1, '1 MIN'],
              [10, '10 MIN'],
              [30, '30 MIN'],
              [60, '1 HR'],
            ].map(([value, label]) => (
              <Pressable key={String(value)} style={[styles.presetButton, activeUnit === value && styles.presetButtonActive]} onPress={() => changeUnit(Number(value))}>
                <Text style={[styles.presetText, activeUnit === value && { color: colors.purple }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Card style={styles.customMinutesBox}>
            <Text style={styles.bodyText}>Custom minutes</Text>
            <Text style={styles.mono}>{customMinutes}</Text>
            <Stepper value={customMinutes} min={1} max={600} onChange={changeUnit} />
          </Card>
          <Text style={styles.inputLabel}>{billingUnitRateLabel(activeUnit)}</Text>
          <TextInput style={styles.input} keyboardType="number-pad" value={rate} onChangeText={setRate} />
        </Card>

        <Text style={styles.inputLabel}>EXTRA CONTROLLER / HR</Text>
        <TextInput style={styles.input} keyboardType="number-pad" value={extraRate} onChangeText={setExtraRate} />
        <View style={styles.quantityRow}>
          <View>
            <Text style={styles.bodyText}>Free controllers</Text>
            <Text style={styles.mono}>{freeControllers}</Text>
          </View>
          <Stepper value={freeControllers} min={0} max={8} onChange={setFreeControllers} />
        </View>
        <AppButton label={editor.mode === 'edit' ? 'UPDATE STATION' : 'SAVE STATION'} icon="Save" disabled={saving} onPress={submit} style={styles.fullButton} />
    </Sheet>
  );
}

function InventoryEditorSheet({
  editor,
  onClose,
  onSave,
}: {
  editor: EditorMode<InventoryItem> | null;
  onClose: () => void;
  onSave: (draft: InventoryDraft) => Promise<void>;
}) {
  const item = editor?.mode === 'edit' ? editor.value : undefined;
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Food');
  const [price, setPrice] = useState('100');
  const [stock, setStock] = useState(10);
  const [alertAt, setAlertAt] = useState(4);
  const [photoUri, setPhotoUri] = useState<string | undefined>();
  const [imageKey, setImageKey] = useState('campa');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editor) return;
    setName(item?.name ?? '');
    setCategory(item?.category ?? 'Food');
    setPrice(String(item?.price ?? 100));
    setStock(item?.stock ?? 10);
    setAlertAt(item?.alertAt ?? 4);
    setPhotoUri(item?.photoUri);
    setImageKey(item?.imageKey ?? 'campa');
    setSaving(false);
  }, [editor, item]);

  if (!editor) return null;

  const title = editor.mode === 'edit' ? `Edit ${item?.name ?? 'Item'}` : 'Add Inventory Item';
  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.4 });
    if (!result.canceled && result.assets[0]?.uri) setPhotoUri(result.assets[0].uri);
  };
  const submit = async () => {
    setSaving(true);
    await onSave({
      name,
      category,
      price: Number(price) || 0,
      stock,
      alertAt,
      imageKey,
      photoUri,
    });
    setSaving(false);
  };

  return (
    <Sheet visible={Boolean(editor)} title={title} onClose={onClose}>
        <Text style={styles.inputLabel}>NAME</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Burger, Coffee, Fries..." placeholderTextColor={colors.subtle} />
        <Text style={styles.inputLabel}>CATEGORY</Text>
        <TextInput style={styles.input} value={category} onChangeText={setCategory} placeholder="Food" placeholderTextColor={colors.subtle} />
        <Text style={styles.inputLabel}>PRICE</Text>
        <TextInput style={styles.input} keyboardType="number-pad" value={price} onChangeText={setPrice} />

        <Card style={editor.mode === 'edit' ? styles.editorMenuPhotoCard : styles.editorPhotoCard}>
          <AppImage
            imageKey={imageKey}
            photoUri={photoUri}
            style={editor.mode === 'edit' ? styles.editorMenuPhoto : styles.editorPhotoThumb}
            resizeMode={editor.mode === 'edit' ? 'contain' : 'cover'}
          />
          <View style={styles.flex}>
            <Text style={styles.itemName}>{editor.mode === 'edit' ? 'CUSTOM MENU PHOTO' : 'STOCK TILE'}</Text>
            <Text style={styles.bodyText}>
              {editor.mode === 'edit' ? 'This photo is shown on inventory cards and in the session snack picker.' : 'The app will save a stock photo URL for this item unless you upload your own.'}
            </Text>
          </View>
        </Card>
        <AppButton label="UPLOAD PHOTO" icon="Upload" onPress={pickPhoto} style={styles.fullButton} />

        <View style={styles.quantityRow}>
          <Text style={styles.bodyText}>Opening stock</Text>
          <Stepper value={stock} min={0} max={999} onChange={setStock} />
        </View>
        <View style={styles.quantityRow}>
          <Text style={styles.bodyText}>Low alert</Text>
          <Stepper value={alertAt} min={0} max={999} onChange={setAlertAt} />
        </View>
        <AppButton label={editor.mode === 'edit' ? 'UPDATE ITEM' : 'SAVE ITEM'} icon="Save" disabled={saving} onPress={submit} style={styles.fullButton} />
    </Sheet>
  );
}

function AddExpenseSheet({ visible, onClose, onSave }: { visible: boolean; onClose: () => void; onSave: (draft: ExpenseDraft) => void }) {
  const [note, setNote] = useState('');
  const [category, setCategory] = useState('Operations');
  const [amount, setAmount] = useState('100');
  useEffect(() => {
    if (visible) {
      setNote('');
      setCategory('Operations');
      setAmount('100');
    }
  }, [visible]);
  const amountValue = Number(amount) || 0;
  return (
    <Sheet visible={visible} title="Add Expense" onClose={onClose}>
        <Text style={styles.inputLabel}>LABEL</Text>
        <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="Electricity, snacks restock..." placeholderTextColor={colors.muted} />
        <Text style={styles.inputLabel}>CATEGORY</Text>
        <TextInput style={styles.input} value={category} onChangeText={setCategory} placeholder="Operations" placeholderTextColor={colors.muted} />
        <Text style={styles.inputLabel}>AMOUNT</Text>
        <TextInput style={styles.input} keyboardType="number-pad" value={amount} onChangeText={setAmount} />
        <AppButton
          label="SAVE EXPENSE"
          icon="ReceiptText"
          disabled={!note.trim() || amountValue <= 0}
          onPress={() => onSave({ note, category, amount: amountValue })}
          style={styles.fullButton}
        />
    </Sheet>
  );
}

function MaintenanceNoteSheet({
  visible,
  stations,
  onClose,
  onSave,
}: {
  visible: boolean;
  stations: Station[];
  onClose: () => void;
  onSave: (stationIds: string[], note: string) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (visible) {
      setSelectedIds([]);
      setNote('');
    }
  }, [visible]);
  const toggleStation = (stationId: string) => {
    setSelectedIds((current) => (current.includes(stationId) ? current.filter((idValue) => idValue !== stationId) : [...current, stationId]));
  };
  return (
    <Sheet visible={visible} title="Maintenance Note" onClose={onClose}>
        <View style={styles.stationChipGrid}>
          {stations.map((station) => {
            const selected = selectedIds.includes(station.id);
            return (
              <Pressable key={station.id} style={[styles.stationChip, selected && styles.stationChipActive]} onPress={() => toggleStation(station.id)}>
                <Text style={[styles.stationChipText, selected && styles.stationChipTextActive]}>{station.name.toUpperCase()}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.inputLabel}>NOTE</Text>
        <TextInput
          style={[styles.input, styles.noteInput]}
          value={note}
          onChangeText={setNote}
          multiline
          placeholder="Controller drift, HDMI issue..."
          placeholderTextColor={colors.muted}
        />
        <AppButton
          label="SAVE NOTE"
          icon="Wrench"
          disabled={!selectedIds.length || !note.trim()}
          onPress={() => onSave(selectedIds, note)}
          style={styles.fullButton}
        />
    </Sheet>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.miniMetric}>
      <Text style={styles.inputLabel}>{label}</Text>
      <Text style={styles.mono}>{value}</Text>
    </View>
  );
}

function SessionDetail({
  data,
  session,
  clock,
  onBack,
  onPause,
  onResume,
  onClose,
  onSilenceAlarm,
  onAddItems,
  onCustomItem,
}: {
  data: BusinessData;
  session: Session;
  clock: number;
  onBack: () => void;
  onPause: () => void;
  onResume: () => void;
  onClose: () => void;
  onSilenceAlarm: () => void;
  onAddItems: () => void;
  onCustomItem: () => void;
}) {
  const totals = sessionTotals(session, data.settings, undefined, clock);
  const limitText = session.overtime
    ? 'Overtime — time and billing continue until stop'
    : session.limitMinutes
      ? `${session.limitMinutes}m session limit`
      : session.status === 'alarm'
        ? ''
        : 'Open time';
  return (
    <>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.detailHeader}>
          <AppButton label="BACK" icon="ChevronLeft" variant="ghost" onPress={onBack} style={styles.backButton} />
          <View style={[styles.flex, { minWidth: 0, overflow: 'hidden' }]}>
            <Text style={styles.detailTitle} numberOfLines={1} ellipsizeMode="tail">{session.stationName.toUpperCase()}</Text>
            <Text style={[styles.muted, { fontSize: 12 }]} numberOfLines={1}>Started {nowTime(session.startedAt)}</Text>
          </View>
          <AppButton label="STOP" icon="Square" variant="danger" onPress={onClose} style={{ flexShrink: 0 }} />
        </View>
        <Card active style={styles.timerCard}>
          <DataPill label={session.status === 'alarm' ? 'TIME OVER' : session.status === 'paused' ? 'SESSION PAUSED' : 'SESSION RUNNING'} color={session.status === 'alarm' ? colors.red : colors.cyan} />
          <Text style={styles.sessionRunningTotal}>{formatMoney(totals.total)}</Text>
          <Text style={styles.bigTimer}>{formatDuration(totals.ms)}</Text>
          {session.status === 'running' ? (
            <AppButton label="PAUSE BILLING" icon="Pause" variant="ghost" onPress={onPause} />
          ) : (
            <AppButton
              label={session.status === 'alarm' ? 'RESUME & CONTINUE TIME' : 'RESUME BILLING'}
              icon="Play"
              onPress={onResume}
              style={session.status === 'alarm' ? styles.fullButton : undefined}
            />
          )}
          {session.status === 'alarm' && !session.alarmSilenced ? (
            <AppButton label="SILENCE ALARM" icon="VolumeX" variant="danger" onPress={onSilenceAlarm} style={styles.fullButton} />
          ) : null}
          {limitText ? <Text style={styles.subtitle}>{limitText}</Text> : null}
        </Card>
        <View style={styles.statsGrid}>
          <Stat label="Rate" value={`NPR ${session.ratePerHour}/hr`} icon="Banknote" />
          <Card style={styles.stat}>
            <AppIcon name="Users" size={20} color={colors.yellow} />
            <Text style={styles.muted}>Controllers</Text>
            <Text style={styles.statValue}>{session.controllers}</Text>
          </Card>
        </View>
        <View style={styles.sectionRow}>
          <Text style={[styles.sectionTitle, { flex: 1, flexShrink: 1, minWidth: 0 }]} numberOfLines={1} ellipsizeMode="tail">Snacks & Food</Text>
          <View style={[styles.rowGap, { flexShrink: 0, flexWrap: 'nowrap' }]}>
            <AppButton label="ADD" icon="Plus" variant="outline" onPress={onAddItems} />
            <AppButton label="CUSTOM" icon="Pencil" variant="outline" onPress={onCustomItem} />
          </View>
        </View>
        {(session.items ?? []).length === 0 ? (
          <Card style={styles.emptyCard}>
            <AppIcon name="Utensils" size={52} color={colors.border} />
            <Text style={styles.sectionTitle}>No items yet</Text>
            <Text style={styles.subtitle}>Add drinks, snacks, or food to this session.</Text>
          </Card>
        ) : (
          (session.items ?? []).map((item) => (
            <Card key={item.id} style={styles.itemLine}>
              <Text style={styles.itemName} numberOfLines={1} ellipsizeMode="tail">{item.name}</Text>
              <Text style={[styles.mono, { flexShrink: 0, fontSize: 13 }]} numberOfLines={1}>{item.quantity}×{item.price}</Text>
              <Text style={styles.itemTotal} numberOfLines={1}>{formatMoney(item.quantity * item.price)}</Text>
            </Card>
          ))
        )}
        <Card active style={styles.billCard}>
          <Text style={styles.inputLabel}>BILL SUMMARY</Text>
          <BillLine label={`Time (${totals.hours.toFixed(2)} hrs)`} value={totals.time} />
          <BillLine label="Extra controllers" value={totals.extra} />
          <BillLine label="Items" value={totals.items} />
          {totals.bulkDiscount > 0 ? <BillLine label="Bulk discount" value={-totals.bulkDiscount} /> : null}
          <View style={styles.totalRow}>
            <Text style={styles.inputLabel}>TOTAL</Text>
            <Text style={styles.totalValue}>{formatMoney(totals.total)}</Text>
          </View>
        </Card>
      </ScrollView>
    </>
  );
}

function BillLine({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.billLine}>
      <Text style={[styles.bodyText, { flex: 1, flexShrink: 1, fontSize: 14 }]} numberOfLines={1} ellipsizeMode="tail">{label}</Text>
      <Text style={[styles.mono, { flexShrink: 0, fontSize: 14 }]} numberOfLines={1}>NPR {Math.round(value)}</Text>
    </View>
  );
}

function AddItemsSheet({
  visible,
  inventory,
  onClose,
  onSwitchCustom,
  onAdd,
}: {
  visible: boolean;
  inventory: InventoryItem[];
  onClose: () => void;
  onSwitchCustom: () => void;
  onAdd: (quantities: Record<string, number>) => void;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  useEffect(() => {
    if (visible) setQuantities({});
  }, [visible]);
  return (
    <Sheet visible={visible} title="Add Items" onClose={onClose} footer={<AppButton label="ADD SELECTED ITEMS" icon="Plus" onPress={() => { onAdd(quantities); onClose(); }} style={styles.fullButton} />}>
        <View style={styles.segmentTabs}>
          <Text style={[styles.segmentBig, styles.segmentBigActive]}>INVENTORY</Text>
          <Pressable style={({ pressed }) => [styles.segmentButton, pressed && styles.pressed]} onPress={onSwitchCustom}>
            <Text style={styles.segmentBigText}>CUSTOM</Text>
          </Pressable>
        </View>
        {inventory.map((item) => {
          const quantity = quantities[item.id] ?? 0;
          return (
            <Card key={item.id} style={styles.addItemRow}>
              <AppImage imageKey={item.imageKey} photoUri={item.photoUri} style={styles.addItemImage} />
              <View style={[styles.flex, { minWidth: 0 }]}>
                <Text style={[styles.itemName, { fontSize: 13 }]} numberOfLines={2} ellipsizeMode="tail">
                  {item.name.toUpperCase()}
                </Text>
                <Text style={[styles.bodyText, { fontSize: 13 }]} numberOfLines={1}>NPR {item.price}</Text>
                <Text style={[styles.muted, { fontSize: 12 }]} numberOfLines={1}>Stock: {item.stock}</Text>
              </View>
              <Stepper value={quantity} min={0} max={item.stock} onChange={(value) => setQuantities((current) => ({ ...current, [item.id]: value }))} />
            </Card>
          );
        })}
    </Sheet>
  );
}

function CustomItemSheet({
  visible,
  onClose,
  onSwitchInventory,
  onAdd,
}: {
  visible: boolean;
  onClose: () => void;
  onSwitchInventory: () => void;
  onAdd: (name: string, price: number, quantity: number) => void;
}) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('0');
  const [quantity, setQuantity] = useState(1);
  useEffect(() => {
    if (visible) {
      setName('');
      setPrice('0');
      setQuantity(1);
    }
  }, [visible]);
  return (
    <Sheet visible={visible} title="Custom Item" onClose={onClose}>
        <View style={styles.segmentTabs}>
          <Pressable style={({ pressed }) => [styles.segmentButton, pressed && styles.pressed]} onPress={onSwitchInventory}>
            <Text style={styles.segmentBigText}>INVENTORY</Text>
          </Pressable>
          <Text style={[styles.segmentBig, styles.segmentBigYellow]}>CUSTOM</Text>
        </View>
        <Text style={styles.inputLabel}>ITEM NAME</Text>
        <TextInput style={styles.input} placeholder="e.g. Chips" placeholderTextColor={colors.subtle} value={name} onChangeText={setName} />
        <Text style={styles.inputLabel}>PRICE</Text>
        <TextInput style={styles.input} keyboardType="number-pad" value={price} onChangeText={setPrice} />
        <View style={styles.quantityRow}>
          <Text style={styles.bodyText}>Quantity</Text>
          <Stepper value={quantity} min={1} onChange={setQuantity} />
        </View>
        <AppButton
          label="ADD CUSTOM ITEM"
          icon="Pencil"
          disabled={!name.trim() || Number(price) <= 0}
          onPress={() => {
            onAdd(name, Number(price), quantity);
            onClose();
          }}
          style={styles.fullButton}
        />
    </Sheet>
  );
}

function InventoryScreen({
  data,
  canManageInventory,
  commit,
  updatePhoto,
  onAddItem,
  onEditItem,
  onDeleteItem,
}: {
  data: BusinessData;
  canManageInventory: boolean;
  commit: (updater: (current: BusinessData) => BusinessData) => void;
  updatePhoto: (kind: 'stations' | 'inventory', itemId: string) => Promise<void>;
  onAddItem: () => void;
  onEditItem: (item: InventoryItem) => void;
  onDeleteItem: (item: InventoryItem) => void;
}) {
  const items = Object.values(data.inventory);
  return (
    <View style={styles.screen}>
      <PageHeader title="Inventory" action={<AppButton label="ADD FOOD" icon="Plus" onPress={onAddItem} />} />
      <View style={styles.statsGridThree}>
        <Stat label="Items" value={String(items.length)} accent={colors.text} />
        <Stat label="Low Stock" value={String(items.filter((item) => item.stock <= item.alertAt).length)} accent={colors.text} />
        <Stat label="Photos" value={String(items.filter((item) => item.photoUri || item.imageKey).length)} accent={colors.purple} active />
      </View>
      {items.map((item) => (
        <Card key={item.id} style={styles.inventoryCard}>
          <AppImage imageKey={item.imageKey} photoUri={item.photoUri} style={styles.inventoryImage} />
          <View style={styles.flex}>
            <View style={styles.rowBetween}>
              <Text style={styles.inventoryName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={[styles.tag, item.stock <= item.alertAt ? styles.tagDanger : styles.tagPurple]}>{item.stock <= item.alertAt ? 'STOCK' : 'PHOTO'}</Text>
            </View>
            <Text style={styles.bodyText}>{item.category} / NPR {item.price}</Text>
            <Text style={styles.stockLine}>Stock {item.stock} / Alert {item.alertAt}</Text>
            <View style={styles.inventoryActions}>
              {canManageInventory ? (
                <>
                  <AppButton label="PHOTO" icon="Camera" variant="outline" onPress={() => updatePhoto('inventory', item.id)} />
                  <AppButton label="EDIT" icon="Pencil" variant="ghost" onPress={() => onEditItem(item)} />
                </>
              ) : null}
              <AppButton label="+ STOCK" variant="outline" onPress={() => commit((current) => ({ ...current, inventory: { ...current.inventory, [item.id]: { ...item, stock: item.stock + 1 } } }))} />
              {canManageInventory ? <AppButton label="REMOVE" icon="Trash2" variant="danger" onPress={() => onDeleteItem(item)} /> : null}
            </View>
          </View>
        </Card>
      ))}
    </View>
  );
}

function ReportsScreen({ data, rangeClock }: { data: BusinessData; rangeClock: number }) {
  const [range, setRange] = useState<ReportRange>('today');
  const totals = useMemo(() => reportTotals(data, range, rangeClock), [data, range, rangeClock]);
  const activeCount = Object.values(data.sessions ?? {}).filter((session) => session.status === 'running' || session.status === 'alarm' || session.status === 'paused').length;
  return (
    <View style={styles.screen}>
      <Text style={styles.pageTitle}>Reports</Text>
      <View style={styles.rangeTabs}>
        {(['today', 'week', 'month', 'all'] as ReportRange[]).map((item) => (
          <Pressable key={item} style={[styles.rangeTab, range === item && styles.rangeTabActive]} onPress={() => setRange(item)}>
            <Text style={[styles.rangeText, range === item && { color: colors.cyan }]}>{item.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.statsGrid}>
        <Stat label="Revenue" value={formatMoney(totals.revenue)} active />
        <Stat label="Expenses" value={formatMoney(totals.expenses)} accent={colors.red} />
      </View>
      <Card style={styles.netCard}>
        <Text style={styles.bodyText}>Net Cash</Text>
        <Text style={styles.netValue}>{formatMoney(totals.net)}</Text>
        <Text style={styles.muted}>{activeCount} active sessions right now</Text>
      </Card>
      <Text style={styles.sectionTitle}>Session History</Text>
      {totals.sessions.length === 0 ? (
        <Card style={styles.emptyCard}>
          <AppIcon name="ReceiptText" size={52} color={colors.border} />
          <Text style={styles.sectionTitle}>No closed sessions</Text>
          <Text style={styles.subtitle}>Closed sessions will appear here after payment.</Text>
        </Card>
      ) : (
        totals.sessions.map((session) => (
          <Card key={session.id} style={styles.historyLine}>
            <Text style={[styles.itemName, { fontSize: 13 }]} numberOfLines={1} ellipsizeMode="tail">{session.stationName}</Text>
            <Text style={[styles.muted, { fontSize: 12, flexShrink: 0 }]} numberOfLines={1}>{nowTime(session.startedAt)}-{session.endedAt ? nowTime(session.endedAt) : '?'}</Text>
            <Text style={[styles.itemTotal, { fontSize: 13, flexShrink: 0 }]} numberOfLines={1}>{formatMoney(session.payment?.total ?? 0)}</Text>
          </Card>
        ))
      )}
      <Text style={styles.sectionTitle}>Item Sales</Text>
      {totals.itemSales.length === 0 ? (
        <Card>
          <Text style={styles.bodyText}>No item sales for this period.</Text>
        </Card>
      ) : (
        totals.itemSales.map((sale) => (
          <Card key={sale.name} style={styles.historyLine}>
            <Text style={[styles.itemName, { fontSize: 13 }]} numberOfLines={1} ellipsizeMode="tail">{sale.name}</Text>
            <Text style={[styles.muted, { fontSize: 12, flexShrink: 0 }]} numberOfLines={1}>Qty {sale.quantity}</Text>
            <Text style={[styles.itemTotal, { fontSize: 13, flexShrink: 0 }]} numberOfLines={1}>{formatMoney(sale.total)}</Text>
          </Card>
        ))
      )}
    </View>
  );
}

function SettingsScreen({
  data,
  user,
  isAdmin,
  signOut,
  commit,
  updateSettings,
  onAddStation,
  onCreateStaff,
  onCreateAdmin,
  onRemoveUser,
  onAddExpense,
  onMaintenance,
}: {
  data: BusinessData;
  user: UserProfile;
  isAdmin: boolean;
  signOut: () => void;
  commit: (updater: (current: BusinessData) => BusinessData) => void;
  updateSettings: (settings: Partial<BusinessData['settings']>) => void;
  onAddStation: () => void;
  onCreateStaff: () => void;
  onCreateAdmin: () => void;
  onRemoveUser: (profile: UserProfile) => void;
  onAddExpense: () => void;
  onMaintenance: () => void;
}) {
  const clearReports = () => {
    confirmAction({
      title: 'Clear reports?',
      message: 'Delete closed sessions and expenses while keeping active sessions?',
      confirmLabel: 'Clear',
      onConfirm: () =>
        commit((current) => {
          const activeSessions = Object.fromEntries(Object.entries(current.sessions).filter(([, session]) => session.status !== 'closed'));
          return { ...current, sessions: activeSessions, expenses: {} };
        }),
    });
  };
  return (
    <View style={styles.screen}>
      <Text style={styles.pageTitle}>Settings</Text>

      {/* ── Signed-in card ── */}
      <Card active style={styles.signedCard}>
        <View style={styles.flex}>
          <Text style={styles.bodyText}>Signed in as</Text>
          <Text style={[styles.sectionTitle, { flexShrink: 1 }]} numberOfLines={1} ellipsizeMode="tail">{user.name}</Text>
          <Text style={styles.muted}>{user.role.toUpperCase()}</Text>
        </View>
        <AppButton label="SIGN OUT" icon="LogOut" variant="danger" onPress={signOut} />
      </Card>

      {/* ── Business Defaults (admin only) ── */}
      {isAdmin ? (
        <Card>
          <Text style={styles.sectionTitle}>Business Defaults</Text>
          <SettingsLine label="Currency" value={data.settings.currency} />
          <SettingsLine label="Silver discount" value={`${data.settings.silverDiscount}%`} />
          <SettingsLine label="Gold discount" value={`${data.settings.goldDiscount}%`} />
          <SettingsLine label="Loyalty" value={`1 pt / NPR ${data.settings.loyaltyPerNpr}`} />
        </Card>
      ) : null}

      {/* ── Bulk Discount (admin + staff) ── */}
      <Card>
        <Text style={styles.sectionTitle}>Bulk Discount</Text>
        {isAdmin ? (
          <>
            <Text style={styles.inputLabel}>HOURS REQUIRED FOR FREE HOUR</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={String(data.settings.bulkHoursRequired)}
              onChangeText={(v) => updateSettings({ bulkHoursRequired: Math.max(0, Number(v) || 0) })}
            />
            <Text style={styles.inputLabel}>FREE HOURS GIVEN</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={String(data.settings.bulkFreeHours)}
              onChangeText={(v) => updateSettings({ bulkFreeHours: Math.max(0, Number(v) || 0) })}
            />
            <Text style={styles.muted}>
              Every {data.settings.bulkHoursRequired} hrs played → {data.settings.bulkFreeHours} hr(s) free
            </Text>
            <View style={styles.divider} />
            <Text style={styles.inputLabel}>SPEND AMOUNT (NPR)</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={String(data.settings.bulkSpendAmount)}
              onChangeText={(v) => updateSettings({ bulkSpendAmount: Math.max(0, Number(v) || 0) })}
            />
            <Text style={styles.inputLabel}>DISCOUNT AMOUNT (NPR)</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={String(data.settings.bulkDiscountAmount)}
              onChangeText={(v) => updateSettings({ bulkDiscountAmount: Math.max(0, Number(v) || 0) })}
            />
            <Text style={styles.muted}>
              Spend NPR {data.settings.bulkSpendAmount} → get NPR {data.settings.bulkDiscountAmount} off
            </Text>
          </>
        ) : (
          <>
            <SettingsLine
              label="Play hours for free hour"
              value={`${data.settings.bulkHoursRequired} hrs → ${data.settings.bulkFreeHours} free`}
            />
            <SettingsLine
              label="Spend discount"
              value={`NPR ${data.settings.bulkSpendAmount} → NPR ${data.settings.bulkDiscountAmount} off`}
            />
          </>
        )}
      </Card>

      {/* ── Billing Mode (admin only) ── */}
      {isAdmin ? (
        <Card>
          <Text style={styles.sectionTitle}>Billing Mode</Text>
          <View style={styles.modeGrid}>
            {(['ceilMinute', 'exactSeconds', 'completedMinutes'] as BillingMode[]).map((m) => (
              <Pressable
                key={m}
                style={[styles.modeButton, data.settings.billingMode === m && styles.modeButtonActive]}
                onPress={() => updateSettings({ billingMode: m })}
              >
                <Text style={[styles.modeText, data.settings.billingMode === m && { color: colors.cyan }]}>
                  {m === 'ceilMinute' ? 'Ceil Minute' : m === 'exactSeconds' ? 'Exact Seconds' : 'Completed Minutes'}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}

      {/* ── Operations (admin + staff) ── */}
      <Text style={styles.sectionTitle}>Operations</Text>
      <View style={styles.opsGrid}>
        {isAdmin ? <AppButton label="ADD STATION" icon="PlusCircle" onPress={onAddStation} /> : null}
        <AppButton label="EXPENSE" icon="ReceiptText" variant="outline" onPress={onAddExpense} />
        <AppButton label="MAINTENANCE" icon="Wrench" variant="outline" onPress={onMaintenance} />
      </View>

      {/* ── Users (admin only) ── */}
      {isAdmin ? (
        <>
          <Text style={styles.sectionTitle}>Users</Text>
          <Card style={styles.userSectionCard}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Staff</Text>
              <AppButton label="CREATE" icon="UserPlus" onPress={onCreateStaff} />
            </View>
            {Object.values(data.users ?? {})
              .filter((p) => p.role === 'staff')
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((profile) => (
                <View key={profile.id} style={styles.userLine}>
                  <View style={styles.flex}>
                    <Text style={styles.itemName} numberOfLines={1} ellipsizeMode="tail">{profile.name}</Text>
                    <Text style={styles.muted} numberOfLines={1} ellipsizeMode="tail">{profile.email}</Text>
                  </View>
                  <AppButton label="REMOVE" icon="UserMinus" variant="danger" onPress={() => onRemoveUser(profile)} />
                </View>
              ))}
            {Object.values(data.users ?? {}).every((p) => p.role !== 'staff') ? (
              <Text style={styles.muted}>No staff accounts yet.</Text>
            ) : null}
          </Card>


        </>
      ) : null}

      {/* ── Reports Data (admin + staff) ── */}
      <Text style={styles.sectionTitle}>Reports Data</Text>
      <Card>
        <Text style={styles.bodyText}>Clear closed sessions and expenses. Active sessions are kept.</Text>
        <AppButton label="CLEAR REPORTS" icon="Trash2" variant="danger" onPress={clearReports} style={styles.fullButton} />
      </Card>
    </View>
  );
}

function SettingsLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.settingsLine}>
      <Text style={styles.bodyText}>{label}</Text>
      <Text style={styles.mono}>{value}</Text>
    </View>
  );
}

function PageHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <View style={styles.pageHeader}>
      <Text style={styles.pageTitle}>{title}</Text>
      {action}
    </View>
  );
}

function BottomTabs({ active, onChange }: { active: TabKey; onChange: (tab: TabKey) => void }) {
  const insets = useSafeAreaInsets();
  const tabs: { key: TabKey; label: string; icon: IconName }[] = [
    { key: 'stations', label: 'STATIONS', icon: 'Grid3X3' },
    { key: 'inventory', label: 'INVENTORY', icon: 'Utensils' },
    { key: 'reports', label: 'REPORTS', icon: 'BarChart3' },
    { key: 'settings', label: 'SETTINGS', icon: 'Settings' },
  ];
  return (
    <View style={[styles.bottomTabs, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {tabs.map((item) => {
        const selected = active === item.key;
        return (
          <Pressable key={item.key} style={styles.tabButton} onPress={() => onChange(item.key)}>
            <AppIcon name={item.icon} size={28} color={selected ? colors.cyan : colors.muted} />
            <Text style={[styles.tabLabel, selected && { color: colors.cyan }]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
  },
  appFrame: {
    flex: 1,
    backgroundColor: colors.bg,
    maxWidth: '100%',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 112,
    gap: 16,
    flexGrow: 1,
  },
  screen: {
    gap: 16,
  },
  loading: {
    color: colors.text,
    marginTop: 80,
    fontSize: 18,
    fontWeight: '800',
  },
  flex: {
    flex: 1,
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 14,
    gap: 10,
  },
  cardActive: {
    borderColor: colors.borderStrong,
    ...Platform.select({
      ios: { shadowColor: colors.cyan, shadowOpacity: 0.16, shadowRadius: 12 },
      android: { elevation: 4 },
      web: { boxShadow: `0 0 12px ${colors.cyan}29` },
    }),
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
  button: {
    minHeight: 44,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    borderWidth: 1,
    flexShrink: 1,
  },
  button_primary: {
    backgroundColor: colors.cyan,
    borderColor: colors.cyan,
  },
  button_outline: {
    backgroundColor: colors.cyanDark,
    borderColor: colors.cyan,
  },
  button_danger: {
    backgroundColor: colors.redDark,
    borderColor: colors.red,
  },
  button_ghost: {
    backgroundColor: colors.panel2,
    borderColor: colors.border,
  },
  button_yellow: {
    backgroundColor: colors.yellowDark,
    borderColor: colors.yellow,
  },
  button_purple: {
    backgroundColor: colors.purpleDark,
    borderColor: colors.purple,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: colors.bg,
    fontWeight: '900',
    fontSize: 12,
    flexShrink: 1,
    textAlign: 'center',
  },
  buttonText_primary: {
    color: colors.bg,
  },
  buttonText_outline: {
    color: colors.cyan,
  },
  buttonText_danger: {
    color: colors.red,
  },
  buttonText_ghost: {
    color: colors.text,
  },
  buttonText_yellow: {
    color: colors.yellow,
  },
  buttonText_purple: {
    color: colors.purple,
  },
  buttonTextDisabled: {
    color: colors.subtle,
  },
  rowGap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'nowrap',
    flexShrink: 0,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  loginWrap: {
    minHeight: '100%',
    justifyContent: 'center',
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    padding: 24,
    gap: 8,
  },
  loginLines: {
    ...(StyleSheet.absoluteFill as object),
    borderRightWidth: 2,
    borderRightColor: '#403421',
    transform: [{ skewY: '-15deg' }],
    opacity: 0.65,
  },
  loginLogo: {
    width: 112,
    height: 112,
    borderRadius: 24,
    alignSelf: 'center',
  },
  brand: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 2,
  },
  brandZoneLine: {
    color: colors.cyan,
    fontSize: 15,
    textAlign: 'center',
    fontWeight: '900',
    letterSpacing: 4,
    marginTop: 2,
    marginBottom: 10,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  loginCard: {
    marginTop: 12,
    gap: 8,
  },
  sectionTitleFlex: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0,
    flexShrink: 1,
    minWidth: 0,
  },
  pageTitle: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 0,
  },
  inputLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '900',
    marginTop: 10,
  },
  input: {
    width: '100%',
    minHeight: 48,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#41506a',
    backgroundColor: colors.panel2,
    color: colors.text,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }),
  },
  noteInput: {
    minHeight: 150,
    paddingTop: 16,
    textAlignVertical: 'top',
  },
  appHeader: {
    gap: 14,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  brandTextWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  brandTagline: {
    color: colors.cyan,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 3,
    marginTop: 0,
    flexShrink: 1,
    minWidth: 0,
  },
  brandZone: {
    color: colors.cyan,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 3,
    marginTop: -4,
    marginBottom: 8,
  },
  runningHero: {
    gap: 6,
  },
  runningHeroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  runningHeroLabel: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: '700',
  },
  sessionRunningTotal: {
    color: colors.cyan,
    fontSize: 34,
    fontWeight: '900',
    textAlign: 'center',
  },
  headerLogo: {
    width: 78,
    height: 78,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.cyan,
  },
  brandSmall: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '900',
    letterSpacing: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.panel2,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  pillText: {
    fontWeight: '900',
    fontSize: 12,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 14,
    flexWrap: 'wrap',
  },
  statsGridThree: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  stat: {
    flex: 1,
    minWidth: 150,
    minHeight: 116,
    justifyContent: 'center',
    gap: 8,
  },
  muted: {
    color: colors.muted,
    fontSize: 13,
    flexShrink: 1,
  },
  bodyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    flexShrink: 1,
  },
  statValue: {
    color: colors.text,
    fontSize: 37,
    fontWeight: '900',
  },
  runningLiteRow: {
    alignItems: 'flex-end',
  },
  runningLite: {
    minHeight: 86,
    width: 188,
    gap: 4,
    padding: 12,
  },
  runningLiteLabel: {
    color: colors.muted,
    fontSize: 15,
  },
  runningLiteValue: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '900',
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 14,
    flexWrap: 'wrap',
  },
  segmentSmall: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  segmentMini: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel2,
    minHeight: 52,
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  segmentMiniActive: {
    borderColor: colors.cyan,
    backgroundColor: colors.cyanDark,
  },
  segmentText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '900',
  },
  addStationButton: {
    minWidth: 160,
    minHeight: 48,
    flexGrow: 1,
  },
  stationGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  listStack: {
    gap: 12,
  },
  stationCard: {
    width: '48%',
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: '48%',
    minHeight: 242,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 14,
    alignItems: 'center',
    gap: 8,
  },
  stationListCard: {
    width: '100%',
    minHeight: 136,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 12,
    alignItems: 'stretch',
    gap: 10,
  },
  stationListMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stationListMedia: {
    width: 108,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  stationListImage: {
    width: 64,
    height: 64,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stationListBody: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  stationListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  stationListName: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 21,
    fontWeight: '900',
    letterSpacing: 0,
  },
  stationListRate: {
    color: colors.text,
    fontSize: 15,
    fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }),
  },
  categoryBadge: {
    alignSelf: 'flex-start',
    color: colors.yellow,
    borderColor: colors.yellow,
    backgroundColor: colors.yellowDark,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    overflow: 'hidden',
  },
  stationListStart: {
    width: '100%',
    minHeight: 44,
  },
  stationListActionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  editActionButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel3,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeActionButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.red,
    backgroundColor: colors.redDark,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editActionText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
  },
  removeActionText: {
    color: colors.red,
    fontSize: 12,
    fontWeight: '900',
  },
  removeStationButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.red,
    backgroundColor: colors.redDark,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  removeStationText: {
    color: colors.red,
    fontSize: 11,
    fontWeight: '900',
    flexShrink: 1,
  },
  removeStationCardButton: {
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.red,
    backgroundColor: colors.redDark,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 36,
  },
  removeStationCardText: {
    color: colors.red,
    fontSize: 10,
    fontWeight: '900',
  },
  stationLive: {
    borderColor: colors.cyan,
  },
  stationTop: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stationNumber: {
    color: colors.muted,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 9,
    paddingVertical: 6,
    fontSize: 14,
    fontWeight: '900',
  },
  stationStatus: {
    color: colors.muted,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    fontWeight: '900',
    fontSize: 11,
  },
  stationStatusLive: {
    color: colors.cyan,
    borderColor: colors.cyan,
  },
  stationStatusAlarm: {
    color: colors.red,
    borderColor: colors.red,
  },
  stationStatusOvertime: {
    color: colors.yellow,
    borderColor: colors.yellow,
  },
  stationImage: {
    width: 92,
    height: 78,
    borderRadius: 20,
  },
  stationName: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  rateLine: {
    color: colors.muted,
    fontSize: 14,
    fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }),
  },
  startNow: {
    width: '100%',
    marginTop: 6,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 14,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: 8,
    width: '100%',
    justifyContent: 'center',
  },
  roundAction: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.panel2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  liveAmountBlock: {
    width: '100%',
    gap: 4,
  },
  liveAmountLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  liveTimingRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  liveBillAlarm: {
    color: colors.red,
  },
  liveMeta: {
    width: '100%',
    alignItems: 'center',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
  },
  liveMetaList: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingTop: 8,
  },
  liveTime: {
    color: colors.cyan,
    fontSize: 16,
    fontWeight: '900',
  },
  liveBill: {
    color: colors.text,
    fontWeight: '900',
    fontSize: 24,
  },
  alarmActions: {
    width: '100%',
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  liveDuration: {
    color: colors.muted,
    fontSize: 12,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(3, 5, 12, 0.42)',
  },
  sheet: {
    width: '100%',
    maxWidth: 860,
    maxHeight: '92%',
    alignSelf: 'center',
    backgroundColor: colors.panel2,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 0,
    gap: 0,
    flexShrink: 1,
  },
  sheetContent: {
    gap: 12,
    paddingBottom: 20,
  },
  sheetFooter: {
    paddingTop: 10,
    paddingBottom: 16,
  },
  sheetHandle: {
    width: 74,
    height: 5,
    borderRadius: 4,
    backgroundColor: '#50607a',
    alignSelf: 'center',
    marginBottom: 8,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sheetTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 32,
    fontWeight: '900',
  },
  closeButton: {
    width: 54,
    height: 54,
    borderRadius: radius.sm,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  launchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  launchImage: {
    width: 112,
    height: 112,
    borderRadius: 24,
  },
  eyebrow: {
    color: colors.cyan,
    fontWeight: '900',
    fontSize: 14,
  },
  launchTitle: {
    color: colors.text,
    fontSize: 29,
    fontWeight: '900',
  },
  memberCard: {
    gap: 10,
    marginBottom: 12,
  },
  memberChoice: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel2,
    paddingHorizontal: 14,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberChoiceActive: {
    borderColor: colors.cyan,
  },
  memberChoiceText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  walkin: {
    color: colors.muted,
    fontSize: 18,
    lineHeight: 26,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    borderRadius: radius.md,
  },
  stepper: {
    height: 40,
    minWidth: 100,
    maxWidth: 110,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 3,
    flexShrink: 0,
  },
  stepButton: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepValue: {
    color: colors.cyan,
    fontSize: 18,
    fontWeight: '900',
    minWidth: 26,
    textAlign: 'center',
  },
  triplet: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  miniMetric: {
    flex: 1,
    minWidth: 104,
    backgroundColor: colors.panel2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 10,
  },
  mono: {
    color: colors.text,
    fontSize: 16,
    fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }),
    fontWeight: '700',
  },
  limitGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginVertical: 12,
  },
  limitTile: {
    width: '48%',
    minWidth: 136,
    flexGrow: 1,
    minHeight: 78,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel2,
    borderRadius: radius.lg,
    padding: 14,
    justifyContent: 'center',
  },
  limitTileActive: {
    borderColor: colors.cyan,
    backgroundColor: colors.cyanDark,
  },
  limitTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  customTimeBox: {
    flex: 1,
    padding: 10,
    gap: 8,
  },
  summaryCard: {
    marginTop: 12,
    marginBottom: 12,
    gap: 4,
  },
  fullButton: {
    width: '100%',
    marginTop: 12,
  },
  editorPhotoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 20,
    flexWrap: 'wrap',
  },
  editorPhotoThumb: {
    width: 150,
    height: 126,
    borderRadius: radius.lg,
  },
  editorPhotoCardLarge: {
    gap: 14,
    marginTop: 20,
    borderColor: colors.cyan,
  },
  editorPhotoLarge: {
    width: '100%',
    height: 280,
    borderRadius: radius.lg,
  },
  editorMenuPhotoCard: {
    gap: 14,
    marginTop: 20,
    borderColor: colors.cyan,
  },
  editorMenuPhoto: {
    width: '100%',
    height: 360,
    borderRadius: radius.lg,
    backgroundColor: '#ffffff',
  },
  priceEditorCard: {
    marginTop: 16,
    marginBottom: 16,
    backgroundColor: colors.panel3,
    gap: 14,
  },
  pricePreview: {
    color: colors.text,
    fontSize: 36,
    fontWeight: '900',
  },
  unitBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.panel2,
    padding: 12,
    minWidth: 84,
    alignItems: 'center',
  },
  presetRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  presetButton: {
    flex: 1,
    minWidth: 88,
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.panel2,
  },
  presetButtonActive: {
    borderColor: colors.purple,
    backgroundColor: colors.purpleDark,
  },
  presetText: {
    color: colors.text,
    fontWeight: '900',
    fontSize: 14,
  },
  customMinutesBox: {
    gap: 8,
    backgroundColor: colors.panel2,
  },
  detailHeader: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'nowrap',
    overflow: 'hidden',
  },
  backButton: {
    minWidth: 80,
    flexShrink: 0,
  },
  detailTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
    flexShrink: 1,
    minWidth: 0,
  },
  timerCard: {
    minHeight: 250,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  bigTimer: {
    color: colors.text,
    fontSize: 44,
    fontWeight: '900',
    fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }),
    letterSpacing: 1,
    includeFontPadding: false,
    flexShrink: 1,
  },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap',
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'nowrap',
    minWidth: 0,
  },
  emptyCard: {
    minHeight: 168,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  itemLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'nowrap',
    overflow: 'hidden',
  },
  itemName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    overflow: 'hidden',
  },
  itemTotal: {
    color: colors.cyan,
    fontSize: 14,
    fontWeight: '900',
    flexShrink: 0,
  },
  billCard: {
    gap: 14,
  },
  billLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'nowrap',
    overflow: 'hidden',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 12,
    flexWrap: 'wrap',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 14,
  },
  totalValue: {
    color: colors.cyan,
    fontSize: 28,
    fontWeight: '900',
    flexShrink: 1,
  },
  sheetScroller: {
    flex: 1,
    flexGrow: 1,
    flexShrink: 1,
  },
  segmentTabs: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
    flexWrap: 'wrap',
  },
  segmentBig: {
    color: colors.muted,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 22,
    paddingVertical: 12,
    fontWeight: '900',
    fontSize: 16,
  },
  segmentButton: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 22,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  segmentBigText: {
    color: colors.muted,
    fontWeight: '900',
    fontSize: 16,
  },
  segmentBigActive: {
    color: colors.cyan,
    borderColor: colors.cyan,
    backgroundColor: colors.cyanDark,
  },
  segmentBigYellow: {
    color: colors.yellow,
    borderColor: colors.yellow,
    backgroundColor: colors.yellowDark,
  },
  roleChoice: {
    minWidth: 120,
    minHeight: 58,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  roleChoiceActive: {
    borderColor: colors.cyan,
    backgroundColor: colors.cyanDark,
  },
  roleChoiceText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  roleChoiceTextActive: {
    color: colors.cyan,
  },
  stationChipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  stationChip: {
    minHeight: 58,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stationChipActive: {
    borderColor: colors.cyan,
    backgroundColor: colors.cyanDark,
  },
  stationChipText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  stationChipTextActive: {
    color: colors.cyan,
  },
  addItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    padding: 10,
    flexWrap: 'nowrap',
    overflow: 'hidden',
    minWidth: 0,
  },
  addItemImage: {
    width: 52,
    height: 52,
    borderRadius: 10,
    flexShrink: 0,
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    gap: 12,
    flexWrap: 'wrap',
  },
  pageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  customerCard: {
    gap: 14,
  },
  customerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flexWrap: 'wrap',
  },
  customerName: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '900',
  },
  customerBadges: {
    width: 150,
    gap: 8,
  },
  discountBadge: {
    color: colors.cyan,
    borderColor: colors.cyan,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: 10,
    textAlign: 'center',
    fontWeight: '900',
  },
  pointsBadge: {
    color: colors.yellow,
    borderColor: colors.yellow,
    backgroundColor: colors.yellowDark,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: 10,
    textAlign: 'center',
    fontWeight: '900',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  walletValue: {
    color: colors.cyan,
    fontSize: 36,
    fontWeight: '900',
  },
  inventoryCard: {
    flexDirection: 'row',
    gap: 16,
    flexWrap: 'wrap',
  },
  inventoryImage: {
    width: 100,
    height: 100,
    borderRadius: 16,
  },
  inventoryName: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '900',
    flex: 1,
    minWidth: 150,
  },
  tag: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontWeight: '900',
  },
  tagPurple: {
    color: colors.purple,
    borderColor: colors.purple,
    backgroundColor: colors.purpleDark,
  },
  tagDanger: {
    color: colors.red,
    borderColor: colors.red,
    backgroundColor: colors.redDark,
  },
  stockLine: {
    color: colors.cyan,
    fontSize: 17,
    fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }),
  },
  inventoryActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  rangeTabs: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
  },
  rangeTab: {
    flex: 1,
    minWidth: 120,
    minHeight: 58,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rangeTabActive: {
    borderColor: colors.cyan,
    backgroundColor: colors.cyanDark,
  },
  rangeText: {
    color: colors.text,
    fontWeight: '900',
  },
  netCard: {
    minHeight: 130,
    justifyContent: 'center',
    gap: 8,
  },
  netValue: {
    color: colors.cyan,
    fontSize: 40,
    fontWeight: '900',
  },
  historyLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'nowrap',
  },
  signedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  settingsLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
    paddingVertical: 10,
  },
  modeGrid: {
    gap: 8,
    marginTop: 8,
  },
  modeButton: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel2,
    borderRadius: radius.sm,
    padding: 12,
  },
  modeButtonActive: {
    borderColor: colors.cyan,
    backgroundColor: colors.cyanDark,
  },
  modeText: {
    color: colors.text,
    fontWeight: '900',
  },
  opsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  userSectionCard: {
    gap: 12,
  },
  userLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    paddingTop: 4,
  },
  backupInput: {
    minHeight: 130,
    marginTop: 12,
    textAlignVertical: 'top',
  },
  syncBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 4,
    backgroundColor: colors.panel3,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  syncDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  syncBarText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  bottomTabs: {
    backgroundColor: colors.panel3,
    paddingTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  tabButton: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    flex: 1,
  },
  tabLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '900',
  },
});
