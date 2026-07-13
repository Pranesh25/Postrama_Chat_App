import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import { theme } from '../theme';

function seededBars(seed: string, count = 22): number[] {
  // Deterministic pseudo-random bars from seed string
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    const v = (h % 100) / 100; // 0..1
    out.push(0.25 + v * 0.75); // 0.25..1.0
  }
  return out;
}

function estimateDuration(text: string): string {
  // ~14 chars per second of speech
  const secs = Math.max(3, Math.min(59, Math.round((text || '').length / 14)));
  return `0:${secs.toString().padStart(2, '0')}`;
}

export function AudioBubble({
  text,
  mine,
  seed,
  currentPlayingId,
  onToggle,
  timeLabel,
}: {
  text: string;
  mine: boolean;
  seed: string;
  currentPlayingId: string | null;
  onToggle: (id: string, text: string) => void;
  timeLabel: string;
}) {
  const bars = useMemo(() => seededBars(seed), [seed]);
  const isPlaying = currentPlayingId === seed;
  const duration = useMemo(() => estimateDuration(text), [text]);

  return (
    <Pressable
      testID={`audio-bubble-${seed}`}
      onPress={() => onToggle(seed, text)}
      style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}
    >
      <View style={[styles.playBtn, mine ? { backgroundColor: 'rgba(255,255,255,0.25)' } : { backgroundColor: theme.color.brand }]}>
        <Ionicons name={isPlaying ? 'pause' : 'play'} size={16} color="#fff" style={{ marginLeft: isPlaying ? 0 : 2 }} />
      </View>
      <View style={styles.waveWrap}>
        {bars.map((h, i) => (
          <View
            key={i}
            style={[
              styles.bar,
              {
                height: Math.max(4, h * 22),
                backgroundColor: mine
                  ? (isPlaying && i < bars.length * 0.6 ? '#fff' : 'rgba(255,255,255,0.55)')
                  : (isPlaying && i < bars.length * 0.6 ? theme.color.brand : theme.color.borderStrong),
              },
            ]}
          />
        ))}
      </View>
      <Text style={[styles.duration, mine && { color: 'rgba(255,255,255,0.85)' }]}>{duration}</Text>
      <Text style={[styles.time, mine && { color: 'rgba(255,255,255,0.65)' }]}>{timeLabel}</Text>
    </Pressable>
  );
}

export function useMessageSpeech() {
  const [playingId, setPlayingId] = useState<string | null>(null);

  useEffect(() => {
    return () => { Speech.stop(); };
  }, []);

  const toggle = (id: string, text: string) => {
    if (playingId === id) {
      Speech.stop();
      setPlayingId(null);
      return;
    }
    Speech.stop();
    setPlayingId(id);
    Speech.speak(text, {
      rate: 1.0,
      pitch: 1.0,
      onDone: () => setPlayingId((p) => (p === id ? null : p)),
      onStopped: () => setPlayingId((p) => (p === id ? null : p)),
      onError: () => setPlayingId(null),
    });
  };

  const stop = () => { Speech.stop(); setPlayingId(null); };

  return { playingId, toggle, stop };
}

const styles = StyleSheet.create({
  bubble: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 22,
    maxWidth: '78%',
  },
  bubbleMine: { backgroundColor: theme.color.brand, borderBottomRightRadius: 8 },
  bubbleOther: { backgroundColor: theme.color.surfaceSecondary, borderBottomLeftRadius: 8, borderWidth: 1, borderColor: theme.color.divider },
  playBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  waveWrap: { flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 90, height: 26 },
  bar: { width: 2.5, borderRadius: 2 },
  duration: { fontFamily: theme.font.body, fontSize: 11, color: theme.color.onSurfaceTertiary, fontWeight: '600', minWidth: 28 },
  time: { fontFamily: theme.font.body, fontSize: 10, color: theme.color.onSurfaceTertiary, marginLeft: 4 },
});
