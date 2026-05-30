import type { BillingMode, BusinessData, BusinessSettings, Customer, Session, SessionItem } from '../types';

export function formatMoney(value: number, currency = 'NPR') {
  return `${currency} ${Math.max(0, Math.round(value)).toLocaleString('en-US')}`;
}

export function nowTime(ts = Date.now()) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(ts);
}

export function elapsedMs(session: Session, now = Date.now()) {
  if (session.status === 'running') {
    return session.accumulatedMs + Math.max(0, now - (session.lastResumedAt ?? now));
  }
  // Paused and time-over freeze the clock until staff resumes.
  return session.accumulatedMs ?? 0;
}

export function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':');
}

export function billableHours(ms: number, mode: BillingMode) {
  if (ms <= 0) return 0;
  if (mode === 'ceilMinute') return Math.ceil(ms / 60000) / 60;
  if (mode === 'completedMinutes') return Math.floor(ms / 60000) / 60;
  return ms / 3600000;
}

export function itemTotal(items: SessionItem[] | undefined) {
  return (items ?? []).reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function memberDiscount(customer: Customer | undefined, subtotal: number, settings: BusinessSettings) {
  if (!customer) return 0;
  const rate = customer.tier === 'gold' ? settings.goldDiscount : customer.tier === 'silver' ? settings.silverDiscount : 0;
  return Math.round((subtotal * rate) / 100);
}

export function sessionTotals(session: Session, settings: BusinessSettings | undefined, customer?: Customer, now = Date.now()) {
  const billingMode = settings?.billingMode ?? 'ceilMinute';
  const ms = elapsedMs(session, now);
  let hours = billableHours(ms, billingMode);
  const bulkHoursRequired = settings?.bulkHoursRequired ?? 0;
  const bulkFreeHours = settings?.bulkFreeHours ?? 0;
  if (bulkHoursRequired > 0 && bulkFreeHours > 0) {
    const cycles = Math.floor(hours / bulkHoursRequired);
    const freeHours = cycles * bulkFreeHours;
    hours = Math.max(0, hours - freeHours);
  }
  const time = Math.round(hours * session.ratePerHour);
  const extraControllers = Math.max(0, session.controllers - session.includedControllers);
  const extra = Math.round(hours * extraControllers * session.extraControllerRate);
  const items = itemTotal(session.items);
  const subtotal = time + extra + items;
  const discount = memberDiscount(customer, subtotal, settings ?? { currency: 'NPR', silverDiscount: 0, goldDiscount: 0, loyaltyPerNpr: 100, billingMode: 'ceilMinute', bulkHoursRequired: 0, bulkFreeHours: 0, bulkSpendAmount: 0, bulkDiscountAmount: 0 });
  const bulkSpendAmount = settings?.bulkSpendAmount ?? 0;
  const bulkDiscountAmount = settings?.bulkDiscountAmount ?? 0;
  const bulkDiscount = (bulkSpendAmount > 0 && bulkDiscountAmount > 0 && subtotal >= bulkSpendAmount) ? bulkDiscountAmount : 0;
  const total = Math.max(0, subtotal - discount - bulkDiscount);
  return { ms, hours, time, extra, items, subtotal, discount, bulkDiscount, total };
}

export function reportTotals(data: BusinessData, range: 'today' | 'week' | 'month' | 'all', now = Date.now()) {
  const start = rangeStart(range, now);
  const sessions = Object.values(data.sessions).filter((s) => s.status === 'closed' && (!start || (s.endedAt ?? 0) >= start));
  const expenses = Object.values(data.expenses).filter((e) => !start || e.createdAt >= start);
  const revenue = sessions.reduce(
    (sum, session) =>
      sum +
      (session.payment?.total ??
        sessionTotals(session, data.settings, data.customers?.[session.customerId ?? ''], session.endedAt).total),
    0,
  );
  const expenseTotal = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const sales = new Map<string, { name: string; quantity: number; total: number }>();
  sessions.forEach((session) => {
    (session.items ?? []).forEach((item) => {
      const prev = sales.get(item.name) ?? { name: item.name, quantity: 0, total: 0 };
      prev.quantity += item.quantity;
      prev.total += item.quantity * item.price;
      sales.set(item.name, prev);
    });
  });
  return { revenue, expenses: expenseTotal, net: revenue - expenseTotal, sessions, itemSales: Array.from(sales.values()) };
}

function rangeStart(range: 'today' | 'week' | 'month' | 'all', now: number) {
  if (range === 'all') return 0;
  const d = new Date(now);
  if (range === 'today') {
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (range === 'week') {
    d.setDate(d.getDate() - 6);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
