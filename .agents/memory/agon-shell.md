---
name: Agon app shell decisions
description: Non-obvious architectural decisions for the Andrik Game Zone Expo app in Replit
---

# Agon Preview — Durable Decisions

## App shell is app/_layout.tsx (not a separate App.tsx)
In the Expo Router setup, `app/_layout.tsx` IS the App.tsx equivalent.
It must include: useFonts (Inter + Ionicons), SplashScreen.preventAutoHideAsync + hideAsync,
2s safety timeout for fonts, 4.5s safety timeout for AnimatedSplash overlay, ErrorBoundary,
GestureHandlerRootView, SafeAreaProvider.
**Why:** The original backup had App.tsx with all of this; Expo Router's entry replaces it.

## Tabs are internal state, not Expo Router tabs
`app/(tabs)/_layout.tsx` is a bare Stack passthrough. `app/(tabs)/index.tsx` re-exports AppRoot.
AppRoot manages its own bottom tab bar with useState.
**Why:** AppRoot's navigation is all internal; using Expo Router Tabs would conflict.

## Auth bypass fix — firebaseSignIn must throw NO_AUTH
`firebaseSignIn` and `firebaseChangePassword` are stubs that throw Error('NO_AUTH').
This forces the catch block in AppRoot's signIn() to run local password validation.
If they returned null instead of throwing, the password check was entirely skipped.
**Why:** firebaseEnabled=true + stub returning null = anyone with a known email could sign in with any password.

## Asset paths from src/
- `src/services/alarm.ts` → `../../assets/sounds/alarm.wav` ✓
- `src/components/AnimatedSplash.tsx` → `../../assets/andrik/logo.png` ✓
- `src/data/assets.ts` → `../../assets/andrik/*.png` ✓

## shadow* props must use Platform.select
All shadowColor/shadowOpacity/shadowRadius must be wrapped in Platform.select with
ios/android/web branches (use boxShadow on web). Affects: AppRoot cardActive,
AnimatedSplash scanLine, ErrorFallback button.
