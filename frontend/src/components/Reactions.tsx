import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { theme } from '../theme';

const EMOJIS = ['❤️', '👍', '😂', '😮', '😢', '🙏'];

export function ReactionsBar({
  currentUserReactions,
  onPick,
}: {
  currentUserReactions: string[]; // emojis I've already reacted with
  onPick: (emoji: string) => void;
}) {
  return (
    <View style={styles.bar}>
      {EMOJIS.map((e) => {
        const active = currentUserReactions.includes(e);
        return (
          <Pressable
            key={e}
            testID={`reaction-${e}`}
            onPress={() => onPick(e)}
            style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && { transform: [{ scale: 0.9 }] }]}
          >
            <Text style={styles.emoji}>{e}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ReactionsRow({
  reactions,
  currentUserId,
  onToggle,
}: {
  reactions: Record<string, string[]>;
  currentUserId: string;
  onToggle: (emoji: string) => void;
}) {
  const entries = Object.entries(reactions || {}).filter(([, users]) => users.length > 0);
  if (entries.length === 0) return null;
  return (
    <View style={styles.rowWrap}>
      {entries.map(([emoji, users]) => {
        const mine = users.includes(currentUserId);
        return (
          <Pressable
            key={emoji}
            testID={`reaction-chip-${emoji}`}
            onPress={() => onToggle(emoji)}
            style={[styles.reactionChip, mine && styles.reactionChipMine]}
          >
            <Text style={styles.reactionEmoji}>{emoji}</Text>
            {users.length > 1 && <Text style={[styles.reactionCount, mine && { color: theme.color.brand }]}>{users.length}</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', gap: 6, backgroundColor: theme.color.surfaceSecondary,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 30,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
    borderWidth: 1, borderColor: theme.color.border,
  },
  chip: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  chipActive: { backgroundColor: theme.color.brandTertiary },
  emoji: { fontSize: 22 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  reactionChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: theme.color.surfaceSecondary, borderRadius: 14, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: theme.color.border },
  reactionChipMine: { backgroundColor: theme.color.brandTertiary, borderColor: theme.color.brand },
  reactionEmoji: { fontSize: 13 },
  reactionCount: { fontFamily: theme.font.body, fontSize: 11, color: theme.color.onSurfaceTertiary, fontWeight: '600' },
});
