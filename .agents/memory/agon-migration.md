---
name: Agon Preview migration
description: Key decisions and file layout for the Andrik Game Zone Expo app migration
---

# Agon Preview (Andrik Game Zone)

## File Layout
- Source: `artifacts/agon-preview/src/` — all migrated TS/TSX files
- Assets: `artifacts/agon-preview/assets/andrik/` — PNG images (logo, stations, items)
- Sound: `artifacts/agon-preview/assets/alarm.wav`
- App entry: `app/(tabs)/index.tsx` just re-exports `@/src/AppRoot`

## Key Decisions
- AppRoot is a single 4101-line monolithic component — kept intact, not broken up
- `app/(tabs)/_layout.tsx` uses a bare Stack (no tab bar) — AppRoot manages its own bottom tabs
- `app/_layout.tsx` is minimal: SafeAreaProvider + GestureHandlerRootView + Stack, no fonts/QueryClient
- firebase package installed alongside expo-av for sync; both lazily imported with dynamic import()

**Why:** The original backup app was self-contained with no tab router from Expo Router — all navigation is internal state in AppRoot. Wrapping with Expo Router tabs would conflict.

## Packages Added
- `firebase` — realtime DB sync to andrik-94bb6
- `expo-av` — alarm sound playback (native); web uses HTML5 Audio

## What NOT to do
- Do not add reactCompiler experiment to app.json — causes build issues with this codebase
- Do not add QueryClient or Inter fonts to _layout.tsx — AppRoot doesn't use them
