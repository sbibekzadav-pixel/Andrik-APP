export type BillingMode = 'ceilMinute' | 'completedMinutes' | 'exact' | 'exactSeconds';

export type TabKey = 'stations' | 'inventory' | 'reports' | 'customers' | 'settings';

export type ReportRange = 'today' | 'week' | 'month' | 'all';

export type UserRole = 'admin' | 'staff';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface BusinessSettings {
  currency: string;
  silverDiscount: number;
  goldDiscount: number;
  loyaltyPerNpr: number;
  billingMode: BillingMode;
  bulkHoursRequired: number;
  bulkFreeHours: number;
  bulkSpendAmount: number;
  bulkDiscountAmount: number;
  syncId?: string;
}

export type StationStatus = 'idle' | 'live' | 'running' | 'alarm' | 'paused';

export interface Station {
  id: string;
  number: number;
  name: string;
  category: string;
  ratePerHour: number;
  includedControllers: number;
  extraControllerRate: number;
  status: StationStatus;
  activeSessionId?: string;
  imageKey?: string;
  photoUri?: string;
}

export interface SessionItem {
  id: string;
  inventoryId?: string;
  name: string;
  price: number;
  quantity: number;
}

export interface SessionPayment {
  cash?: number;
  wallet?: number;
  discount?: number;
  total: number;
  method?: string;
  paidAt?: number;
  loyaltyEarned?: number;
}

export interface Session {
  id: string;
  stationId: string;
  stationName: string;
  stationNumber?: number;
  ratePerHour: number;
  controllers: number;
  includedControllers: number;
  extraControllerRate: number;
  startedAt: number;
  endedAt?: number;
  lastResumedAt?: number;
  accumulatedMs: number;
  limitMinutes?: number | null;
  alarmedAt?: number;
  alarmSilenced?: boolean;
  overtime?: boolean;
  status: 'running' | 'paused' | 'alarm' | 'closed';
  customerId?: string;
  items?: SessionItem[];
  payment?: SessionPayment;
}

export type CustomerTier = 'regular' | 'silver' | 'gold';

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  tier: CustomerTier;
  loyaltyPoints: number;
  walletBalance: number;
  createdAt: number;
  lastVisit?: number;
  totalSpend?: number;
  visitCount?: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  alertAt: number;
  imageKey?: string;
  photoUri?: string;
}

export interface Expense {
  id: string;
  createdAt: number;
  amount: number;
  note: string;
  category?: string;
}

export interface AuditLog {
  id: string;
  createdAt: number;
  message: string;
  by?: string;
  data?: unknown;
}

export interface BusinessData {
  businessId: string;
  settings: BusinessSettings;
  users: Record<string, UserProfile>;
  stations: Record<string, Station>;
  customers: Record<string, Customer>;
  inventory: Record<string, InventoryItem>;
  sessions: Record<string, Session>;
  expenses: Record<string, Expense>;
  auditLogs: Record<string, AuditLog>;
  credentials?: Record<string, string>;
}
