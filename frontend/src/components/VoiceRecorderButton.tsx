import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AudioModule, useAudioRecorder, RecordingPresets } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { theme } from '../theme';

async function uriToBase64(uri: string): Promise<string | null> {
  try {
    const res = await fetch(uri);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result as string);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch { return null; }
}

export function VoiceRecorderButton({
  onSend,
  disabled,
}: {
  onSend: (b64: string, durationSec: number) => void;
  disabled?: boolean;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startAt = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTick = () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } };

  useEffect(() => () => { clearTick(); if (recording) { recorder.stop().catch(() => {}); } }, []); // eslint-disable-line

  const start = async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Please allow microphone access.'); return; }
      await AudioModule.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      startAt.current = Date.now();
      setElapsed(0);
      intervalRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startAt.current) / 1000)), 250);
      try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
    } catch (e: any) {
      Alert.alert('Recording failed', e?.message || 'Try again');
      setRecording(false);
    }
  };

  const stop = async (send: boolean) => {
    clearTick();
    if (!recording) return;
    setRecording(false);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      const dur = Math.max(1, Math.floor((Date.now() - startAt.current) / 1000));
      setElapsed(0);
      if (!send || !uri || dur < 1) return;
      const b64 = await uriToBase64(uri);
      if (b64) onSend(b64, dur);
      try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
    } catch {}
  };

  if (Platform.OS === 'web') {
    // expo-audio recording is not supported on web; hide the button on web to avoid confusing UX
    return null;
  }

  return (
    <>
      {recording && (
        <View style={styles.recBanner} testID="voice-recording-banner">
          <View style={styles.recDot} />
          <Text style={styles.recTime}>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</Text>
          <Text style={styles.recHint}>Release to send · slide to cancel</Text>
        </View>
      )}
      <Pressable
        testID="voice-record-button"
        disabled={disabled}
        onPressIn={start}
        onPressOut={() => stop(true)}
        onLongPress={() => {}}
        style={({ pressed }) => [styles.btn, (pressed || recording) && styles.btnActive]}
      >
        <Ionicons name="mic" size={22} color={recording ? '#fff' : theme.color.brand} />
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  btn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  btnActive: { backgroundColor: theme.color.brand },
  recBanner: {
    position: 'absolute', left: 12, right: 12, bottom: 60,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: theme.color.brand, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 10,
    shadowColor: theme.color.brand, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff' },
  recTime: { color: '#fff', fontFamily: theme.font.body, fontWeight: '700', fontSize: 14 },
  recHint: { color: 'rgba(255,255,255,0.85)', fontFamily: theme.font.body, fontSize: 11, flex: 1 },
});
