import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import { theme } from '../theme';

// ---------- helpers ----------
function seededBars(seed: string, count = 22): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    const v = (h % 100) / 100;
    out.push(0.25 + v * 0.75);
  }
  return out;
}

export function estimateDurationSec(text: string): number {
  return Math.max(3, Math.min(59, Math.round((text || '').length / 14)));
}

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `0:${s.toString().padStart(2, '0')}`;
}

// ---------- speech hook ----------
type PlayState = { id: string | null; status: 'idle' | 'playing' | 'paused'; remaining: number; total: number };
const CAN_NATIVE_PAUSE = Platform.OS !== 'android';

export function useMessageSpeech() {
  const [state, setState] = useState<PlayState>({ id: null, status: 'idle', remaining: 0, total: 0 });
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTextRef = useRef<string>('');

  const clearTick = () => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  };
  const startTick = useCallback(() => {
    clearTick();
    tickRef.current = setInterval(() => {
      setState((s) => {
        if (s.status !== 'playing') return s;
        const r = Math.max(0, s.remaining - 1);
        if (r === 0) {
          clearTick();
          Speech.stop();
          return { id: null, status: 'idle', remaining: 0, total: 0 };
        }
        return { ...s, remaining: r };
      });
    }, 1000);
  }, []);

  const stop = useCallback(() => {
    Speech.stop();
    clearTick();
    setState({ id: null, status: 'idle', remaining: 0, total: 0 });
  }, []);

  useEffect(() => () => { Speech.stop(); clearTick(); }, []);

  const speakNow = useCallback((id: string, text: string, duration: number) => {
    lastTextRef.current = text;
    // Update UI immediately so the timer + pause icon are visible even if the device has no TTS voices.
    setState({ id, status: 'playing', remaining: duration, total: duration });
    startTick();
    // Fire-and-forget speak; small defer helps browsers restart cleanly after cancel().
    setTimeout(() => {
      try {
        Speech.speak(text, {
          rate: 1.0,
          pitch: 1.0,
          onDone: () => {
            setState((s) => (s.id === id ? { id: null, status: 'idle', remaining: 0, total: 0 } : s));
            clearTick();
          },
          // Deliberately NOT resetting state on error — the timer-driven UI still plays out,
          // so the UX remains consistent on devices without installed TTS voices.
          onError: () => {},
          onStopped: () => {},
        });
      } catch { /* ignore */ }
    }, 60);
  }, [startTick]);

  const toggle = useCallback((id: string, text: string, duration: number) => {
    // Tapping the currently-active bubble
    if (state.id === id) {
      if (state.status === 'playing') {
        if (CAN_NATIVE_PAUSE) Speech.pause();
        else Speech.stop();
        clearTick();
        setState((s) => ({ ...s, status: 'paused' }));
        return;
      }
      if (state.status === 'paused') {
        if (CAN_NATIVE_PAUSE) {
          Speech.resume();
          setState((s) => ({ ...s, status: 'playing' }));
          startTick();
        } else {
          // Android: restart from beginning (no native resume)
          Speech.stop();
          speakNow(id, lastTextRef.current || text, state.remaining || duration);
        }
        return;
      }
    }
    // Different (or first) bubble
    Speech.stop();
    clearTick();
    speakNow(id, text, duration);
  }, [state, speakNow, startTick]);

  return { state, toggle, stop };
}

// ---------- audio bubble UI ----------
export function AudioBubble({
  text,
  mine,
  seed,
  playState,
  onToggle,
  timeLabel,
}: {
  text: string;
  mine: boolean;
  seed: string;
  playState: PlayState;
  onToggle: (id: string, text: string, duration: number) => void;
  timeLabel: string;
}) {
  const bars = useMemo(() => seededBars(seed), [seed]);
  const totalDur = useMemo(() => estimateDurationSec(text), [text]);
  const isActive = playState.id === seed;
  const isPlaying = isActive && playState.status === 'playing';
  const isPaused = isActive && playState.status === 'paused';

  const shownSec = isActive ? playState.remaining : totalDur;
  const progress = isActive ? 1 - playState.remaining / Math.max(1, playState.total) : 0;
  const activeBars = Math.round(bars.length * (isActive ? progress : 0));

  const iconName: keyof typeof Ionicons.glyphMap = isPlaying ? 'pause' : 'play';

  return (
    <Pressable
      testID={`audio-bubble-${seed}`}
      onPress={() => onToggle(seed, text, totalDur)}
      style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther, isActive && (mine ? styles.activeMine : styles.activeOther)]}
    >
      <View style={[styles.playBtn, mine ? { backgroundColor: 'rgba(255,255,255,0.28)' } : { backgroundColor: theme.color.brand }]}>
        <Ionicons name={iconName} size={16} color="#fff" style={{ marginLeft: isPlaying ? 0 : 2 }} />
      </View>
      <View style={styles.waveWrap}>
        {bars.map((h, i) => {
          const played = i < activeBars;
          const color = mine
            ? (played ? '#fff' : 'rgba(255,255,255,0.5)')
            : (played ? theme.color.brand : theme.color.borderStrong);
          return <View key={i} style={[styles.bar, { height: Math.max(4, h * 22), backgroundColor: color }]} />;
        })}
      </View>
      <Text style={[styles.duration, mine && { color: 'rgba(255,255,255,0.9)' }, isPaused && { fontStyle: 'italic' }]}>
        {fmt(shownSec)}
      </Text>
      <Text style={[styles.time, mine && { color: 'rgba(255,255,255,0.6)' }]}>{timeLabel}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bubble: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 22,
    maxWidth: '78%',
  },
  bubbleMine: { backgroundColor: theme.color.brand, borderBottomRightRadius: 8 },
  bubbleOther: { backgroundColor: theme.color.surfaceSecondary, borderBottomLeftRadius: 8, borderWidth: 1, borderColor: theme.color.divider },
  activeMine: { shadowColor: theme.color.brand, shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  activeOther: { borderColor: theme.color.brand },
  playBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  waveWrap: { flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 90, height: 26 },
  bar: { width: 2.5, borderRadius: 2 },
  duration: { fontFamily: theme.font.body, fontSize: 11, color: theme.color.onSurfaceTertiary, fontWeight: '700', minWidth: 28 },
  time: { fontFamily: theme.font.body, fontSize: 10, color: theme.color.onSurfaceTertiary, marginLeft: 4 },
});
