import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Image,
  StyleSheet,
  View,
} from 'react-native';

type Props = { onFinish: () => void };

const { width: W, height: H } = Dimensions.get('window');
const RING_DIAMETER = 210;

function RadarRing({ delay }: { delay: number }) {
  const scale = useRef(new Animated.Value(0.4)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulse = () => {
      scale.setValue(0.4);
      opacity.setValue(0.7);
      Animated.parallel([
        Animated.timing(scale, {
          toValue: 2.6,
          duration: 1800,
          useNativeDriver: false,
          easing: Easing.out(Easing.quad),
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 1800,
          useNativeDriver: false,
          easing: Easing.in(Easing.quad),
        }),
      ]).start();
    };

    const timeout = setTimeout(() => {
      pulse();
      const interval = setInterval(pulse, 1800);
      return () => clearInterval(interval);
    }, delay);

    return () => clearTimeout(timeout);
  }, []);

  return (
    <Animated.View
      style={[
        styles.radarRing,
        {
          transform: [{ scale }],
          opacity,
          width: RING_DIAMETER,
          height: RING_DIAMETER,
          borderRadius: RING_DIAMETER / 2,
        },
      ]}
    />
  );
}

export function AnimatedSplash({ onFinish }: Props) {
  const logoScale = useRef(new Animated.Value(0)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const auraOpacity = useRef(new Animated.Value(0)).current;
  const auraScale = useRef(new Animated.Value(0.8)).current;

  const scanY = useRef(new Animated.Value(-H)).current;
  const scanOpacity = useRef(new Animated.Value(0)).current;

  const textY = useRef(new Animated.Value(40)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const subTextOpacity = useRef(new Animated.Value(0)).current;

  const containerOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(200),

      Animated.parallel([
        Animated.spring(logoScale, {
          toValue: 1,
          tension: 65,
          friction: 7,
          useNativeDriver: false,
        }),
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: false,
          easing: Easing.out(Easing.quad),
        }),
        Animated.timing(auraOpacity, {
          toValue: 0.45,
          duration: 700,
          useNativeDriver: false,
        }),
        Animated.spring(auraScale, {
          toValue: 1,
          tension: 40,
          friction: 8,
          useNativeDriver: false,
        }),
      ]),

      Animated.delay(200),

      Animated.parallel([
        Animated.timing(scanOpacity, {
          toValue: 0.9,
          duration: 150,
          useNativeDriver: false,
        }),
        Animated.timing(scanY, {
          toValue: H * 1.2,
          duration: 900,
          useNativeDriver: false,
          easing: Easing.inOut(Easing.quad),
        }),
      ]),
      Animated.timing(scanOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: false,
      }),

      Animated.parallel([
        Animated.spring(textY, {
          toValue: 0,
          tension: 70,
          friction: 9,
          useNativeDriver: false,
        }),
        Animated.timing(textOpacity, {
          toValue: 1,
          duration: 450,
          useNativeDriver: false,
          easing: Easing.out(Easing.quad),
        }),
      ]),
      Animated.timing(subTextOpacity, {
        toValue: 1,
        duration: 350,
        useNativeDriver: false,
        easing: Easing.out(Easing.quad),
      }),

      Animated.delay(1200),

      Animated.timing(containerOpacity, {
        toValue: 0,
        duration: 550,
        useNativeDriver: false,
        easing: Easing.in(Easing.cubic),
      }),
    ]).start(() => onFinish());
  }, []);

  return (
    <Animated.View style={[styles.container, { opacity: containerOpacity }]}>
      <View style={styles.scene}>
        <RadarRing delay={0} />
        <RadarRing delay={600} />
        <RadarRing delay={1200} />

        <Animated.View
          style={[
            styles.aura,
            { opacity: auraOpacity, transform: [{ scale: auraScale }] },
          ]}
        />

        <Animated.View
          style={[
            styles.logoContainer,
            {
              opacity: logoOpacity,
              transform: [{ scale: logoScale }],
            },
          ]}
        >
          <View style={styles.logoInner}>
            <Image
              source={require('../assets/andrik/logo.png')}
              style={styles.logoImage}
              resizeMode="cover"
            />
          </View>
        </Animated.View>
      </View>

      <Animated.View
        style={[styles.scanLine, { top: scanY, opacity: scanOpacity }]}
      />

      <View style={styles.textBlock}>
        <Animated.Text
          style={[styles.appName, { opacity: textOpacity, transform: [{ translateY: textY }] }]}
        >
          ANDRIK GAME ZONE
        </Animated.Text>
        <Animated.Text
          style={[styles.tagline, { opacity: subTextOpacity }]}
        >
          SESSION COMMAND CENTER
        </Animated.Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...(StyleSheet.absoluteFill as object),
    backgroundColor: '#060813',
    zIndex: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  scene: {
    width: RING_DIAMETER,
    height: RING_DIAMETER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarRing: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: '#31d5c7',
  },
  aura: {
    position: 'absolute',
    width: RING_DIAMETER + 30,
    height: RING_DIAMETER + 30,
    borderRadius: (RING_DIAMETER + 30) / 2,
    backgroundColor: '#31d5c7',
  },
  logoContainer: {
    width: RING_DIAMETER,
    height: RING_DIAMETER,
    borderRadius: RING_DIAMETER / 2,
    borderWidth: 4,
    borderColor: '#31d5c7',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#060c1a',
  },
  logoInner: {
    width: RING_DIAMETER - 24,
    height: RING_DIAMETER - 24,
    borderRadius: 26,
    overflow: 'hidden',
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  scanLine: {
    position: 'absolute',
    left: -W * 0.1,
    width: W * 1.2,
    height: 3,
    backgroundColor: '#31d5c7',
    shadowColor: '#31d5c7',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 18,
  },
  textBlock: {
    position: 'absolute',
    bottom: H * 0.15,
    alignItems: 'center',
    gap: 6,
  },
  appName: {
    color: '#ffffff',
    fontSize: 21,
    fontWeight: '900',
    letterSpacing: 3,
    textAlign: 'center',
  },
  tagline: {
    color: '#31d5c7',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 4,
    textAlign: 'center',
    opacity: 0.8,
  },
});
