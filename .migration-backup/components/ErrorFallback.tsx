import React, { useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type ErrorFallbackProps = {
  error: Error;
  resetError: () => void;
};

const C = {
  bg: '#060813',
  card: '#0d1626',
  text: '#e8f0fc',
  muted: '#6b8ab0',
  border: '#1a2d4a',
  cyan: '#31d5c7',
  red: '#ff4466',
};

export function ErrorFallback({ error, resetError }: ErrorFallbackProps) {
  const insets = useSafeAreaInsets();
  const [isModalVisible, setIsModalVisible] = useState(false);

  const formatErrorDetails = (): string => {
    let details = `Error: ${error.message}\n\n`;
    if (error.stack) {
      details += `Stack Trace:\n${error.stack}`;
    }
    return details;
  };

  const monoFont = Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: 'monospace',
  });

  return (
    <View style={[styles.container, { backgroundColor: C.bg }]}>
      {__DEV__ ? (
        <Pressable
          onPress={() => setIsModalVisible(true)}
          style={({ pressed }) => [
            styles.topButton,
            {
              top: insets.top + 16,
              backgroundColor: C.card,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Text style={{ color: C.red, fontSize: 20 }}>!</Text>
        </Pressable>
      ) : null}

      <View style={styles.content}>
        <Text style={[styles.title, { color: C.text }]}>
          Something went wrong
        </Text>
        <Text style={[styles.message, { color: C.muted }]}>
          Please reload the app to continue.
        </Text>
        <Pressable
          onPress={resetError}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: C.cyan, opacity: pressed ? 0.9 : 1 },
          ]}
        >
          <Text style={[styles.buttonText, { color: '#060813' }]}>
            Try Again
          </Text>
        </Pressable>
      </View>

      {__DEV__ ? (
        <Modal
          visible={isModalVisible}
          animationType="slide"
          transparent
          onRequestClose={() => setIsModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContainer, { backgroundColor: C.bg }]}>
              <View style={[styles.modalHeader, { borderBottomColor: C.border }]}>
                <Text style={[styles.modalTitle, { color: C.text }]}>Error Details</Text>
                <Pressable onPress={() => setIsModalVisible(false)} style={styles.closeButton}>
                  <Text style={{ color: C.muted, fontSize: 24 }}>✕</Text>
                </Pressable>
              </View>
              <ScrollView
                style={styles.modalScrollView}
                contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 16 }}
              >
                <View style={[styles.errorContainer, { backgroundColor: C.card }]}>
                  <Text style={[styles.errorText, { color: C.text, fontFamily: monoFont }]} selectable>
                    {formatErrorDetails()}
                  </Text>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    width: '100%',
    maxWidth: 600,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
  topButton: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  button: {
    paddingVertical: 16,
    borderRadius: 8,
    paddingHorizontal: 24,
    minWidth: 200,
  },
  buttonText: {
    fontWeight: '700',
    textAlign: 'center',
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    width: '100%',
    height: '85%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalScrollView: {
    flex: 1,
  },
  errorContainer: {
    borderRadius: 8,
    overflow: 'hidden',
    padding: 16,
  },
  errorText: {
    fontSize: 12,
    lineHeight: 18,
  },
});
