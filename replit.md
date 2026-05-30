# Agon Preview — Andrik Game Zone

A gaming center management system (session tracking, billing, inventory, customer CRM) built with Expo/React Native, targeting mobile and web.

## Run & Operate

- `pnpm --filter @workspace/agon-preview run dev` — run the Expo dev server
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Mobile/Web: Expo SDK 54, React Native 0.81, Expo Router
- Data sync: Firebase Realtime DB (`andrik-94bb6`) + AsyncStorage fallback + BroadcastChannel (web tabs)
- Alarm: expo-av (native) / HTML5 Audio (web)
- API: Express 5, PostgreSQL + Drizzle ORM

## Where things live

- `artifacts/agon-preview/` — the Expo app
- `artifacts/agon-preview/src/AppRoot.tsx` — monolithic app (4101 lines), all screens + state
- `artifacts/agon-preview/src/types.ts` — all TypeScript types
- `artifacts/agon-preview/src/theme.ts` — color palette and radius tokens
- `artifacts/agon-preview/src/services/firebase.ts` — Firebase sync
- `artifacts/agon-preview/src/services/apiSync.ts` — localStorage/AsyncStorage sync
- `artifacts/agon-preview/src/utils/billing.ts` — session billing calculations
- `artifacts/agon-preview/assets/andrik/` — app images
- `.migration-backup/` — original Expo source backup

## Architecture decisions

- AppRoot manages all navigation as internal state (no Expo Router tabs in use)
- `app/(tabs)/_layout.tsx` is a bare Stack passthrough — AppRoot renders its own bottom tab bar
- Firebase sync is lazy-imported (dynamic import) to avoid bundler issues
- expo-av alarm is lazy-imported for same reason; web uses HTML5 Audio directly
- App uses dark gaming theme: bg `#060813`, cyan `#31d5c7`, yellow `#ffd347`

## Product

Gaming center command center for staff and admins:
- **Stations** — start/stop/pause gaming sessions, live timers, billing by minute or hour
- **Inventory** — food/drink stock management, per-item alerts
- **Reports** — daily/weekly/monthly revenue, session history, item sales
- **Settings** — stations, users (admin/staff), bulk discounts, billing mode

## User preferences

_Populate as you build._

## Gotchas

- Do NOT add `reactCompiler` experiment to app.json — causes build issues
- AppRoot is intentionally monolithic — don't split it without a plan
- The Firebase config in firebase.ts is the real production config for Andrik

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See `.agents/memory/agon-migration.md` for migration decisions
