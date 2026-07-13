import React from 'react';
import { Modal, View, Text, StyleSheet, Pressable, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';

type Item = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; danger?: boolean };

export function OverflowMenu({
  visible, onClose, items, anchor = 'left',
}: { visible: boolean; onClose: () => void; items: Item[]; anchor?: 'left' | 'right' }) {
  const insets = useSafeAreaInsets();
  const top = (StatusBar.currentHeight || insets.top) + 56;
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable onPress={onClose} style={styles.backdrop} testID="overflow-backdrop">
        <View style={[styles.menu, { top }, anchor === 'left' ? { left: 12 } : { right: 12 }]} onStartShouldSetResponder={() => true}>
          {items.map((it, i) => (
            <Pressable
              key={it.key}
              testID={`overflow-item-${it.key}`}
              onPress={() => { onClose(); setTimeout(it.onPress, 60); }}
              style={({ pressed }) => [styles.item, pressed && { backgroundColor: theme.color.surfaceTertiary }, i === items.length - 1 && { borderBottomWidth: 0 }]}
            >
              <Ionicons name={it.icon} size={20} color={it.danger ? theme.color.error : theme.color.onSurface} />
              <Text style={[styles.label, it.danger && { color: theme.color.error }]}>{it.label}</Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.15)' },
  menu: {
    position: 'absolute', minWidth: 240, backgroundColor: theme.color.surfaceSecondary,
    borderRadius: 14, paddingVertical: 6,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
    elevation: 10, borderWidth: 1, borderColor: theme.color.border,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  label: { fontFamily: theme.font.body, fontSize: 15, color: theme.color.onSurface, fontWeight: '500' },
});
