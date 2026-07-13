import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { theme } from '../theme';

const PALETTE = ['#FF6B4A', '#F58F62', '#F0B67F', '#8FB3A4', '#7B9EA8', '#B48CB0', '#D89A6E'];

export function Avatar({ name, uri, size = 44, online, testID }: { name?: string; uri?: string | null; size?: number; online?: boolean; testID?: string }) {
  const initials = (name || '?').trim().split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  const color = PALETTE[(initials.charCodeAt(0) || 0) % PALETTE.length];
  return (
    <View style={{ width: size, height: size }} testID={testID}>
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
      ) : (
        <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
          <Text style={{ color: '#fff', fontFamily: theme.font.display, fontSize: size * 0.4 }}>{initials}</Text>
        </View>
      )}
      {online !== undefined && (
        <View style={[styles.dot, { backgroundColor: online ? theme.color.success : theme.color.muted, right: 0, bottom: 0 }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#fff' },
});
