import React, { useState, useEffect } from "react";
import { View, StyleSheet, ActivityIndicator } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as SplashScreen from "expo-splash-screen";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { Ionicons } from "@expo/vector-icons";

import { ErrorBoundary } from "./components/ErrorBoundary";
import { AnimatedSplash } from "./components/AnimatedSplash";
import AppRoot from "./src/AppRoot";

// Prevent the splash screen from hiding automatically
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  const [splashDone, setSplashDone] = useState(false);
  const [forceFontsReady, setForceFontsReady] = useState(false);
  
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    ...Ionicons.font,
  });

  // Safety timeout to ensure we never get stuck on a black screen waiting for fonts
  useEffect(() => {
    const timer = setTimeout(() => {
      setForceFontsReady(true);
      SplashScreen.hideAsync().catch(() => {});
    }, 2000); // 2 seconds safety timeout

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  // Safety timeout to ensure AnimatedSplash finishes and reveals the app
  useEffect(() => {
    const splashTimer = setTimeout(() => {
      setSplashDone(true);
    }, 4500); // 4.5 seconds safety timeout

    return () => clearTimeout(splashTimer);
  }, []);

  const isReady = fontsLoaded || fontError || forceFontsReady;

  if (!isReady) {
    return (
      <View style={[styles.root, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#31d5c7" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <View style={styles.root}>
            <AppRoot />
            {!splashDone && (
              <AnimatedSplash onFinish={() => setSplashDone(true)} />
            )}
          </View>
        </GestureHandlerRootView>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#060813",
  },
});
