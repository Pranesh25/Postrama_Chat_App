import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer } from 'expo-audio';
import { theme } from '../theme';

function seededBars(seed: string, count = 24): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    out.push(0.25 + ((h % 100) / 100) * 0.75);
  }
  return out;
}

function fmt(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function VoiceMessageBubble({
  b64,
  duration,
  mine,
  seed,
}: {
  b64: string;
  duration: number;
  mine: boolean;
  seed: string;
}) {
  const player = useAudioPlayer(b64);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const bars = useRef(seededBars(seed)).current;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  const toggle = async () => {
    try {
      if (playing) {
        player.pause();
        setPlaying(false);
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      } else {
        // If finished, restart from beginning
        if (pos >= duration) { await player.seekTo(0); setPos(0); }
        player.play();
        setPlaying(true);
        intervalRef.current = setInterval(() => {
          setPos((p) => {
            const np = p + 0.25;
            if (np >= duration) {
              if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
              setPlaying(false);
              return 0;
            }
            return np;
          });
        }, 250);
      }
    } catch {}
  };

  const progress = duration > 0 ? Math.min(1, pos / duration) : 0;
  const activeBars = Math.round(bars.length * progress);
  const shownSec = playing ? Math.max(0, duration - pos) : duration;

  return (
    <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
      <Pressable onPress={toggle} testID={`voice-play-${seed}`} style={[styles.playBtn, mine ? { backgroundColor: 'rgba(255,255,255,0.25)' } : { backgroundColor: theme.color.brand }]}>
        <Ionicons name={playing ? 'pause' : 'play'} size={16} color="#fff" style={{ marginLeft: playing ? 0 : 2 }} />
      </Pressable>
      <View style={styles.waveWrap}>
        {bars.map((h, i) => {
          const played = i < activeBars;
          const color = mine
            ? (played ? '#fff' : 'rgba(255,255,255,0.5)')
            : (played ? theme.color.brand : theme.color.borderStrong);
          return <View key={i} style={[styles.bar, { height: Math.max(4, h * 22), backgroundColor: color }]} />;
        })}
      </View>
      <Text style={[styles.dur, mine && { color: 'rgba(255,255,255,0.9)' }]}>{fmt(shownSec)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 22, maxWidth: '78%' },
  bubbleMine: { backgroundColor: theme.color.brand, borderBottomRightRadius: 8 },
  bubbleOther: { backgroundColor: theme.color.surfaceSecondary, borderBottomLeftRadius: 8, borderWidth: 1, borderColor: theme.color.divider },
  playBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  waveWrap: { flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 100, height: 26 },
  bar: { width: 2.5, borderRadius: 2 },
  dur: { fontFamily: theme.font.body, fontSize: 11, color: theme.color.onSurfaceTertiary, fontWeight: '700', minWidth: 32 },
});
