import React from 'react';
import { Modal, View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { ReactionsBar } from './Reactions';
import { theme } from '../theme';

export function MessageActionsSheet({
  visible, onClose, canEdit, canDelete, canReply, messageText, onEdit, onDelete, onReply, onReact, reactions, currentUserId,
}: {
  visible: boolean;
  onClose: () => void;
  canEdit: boolean;
  canDelete: boolean;
  canReply?: boolean;
  messageText: string | null | undefined;
  reactions?: Record<string, string[]>;
  currentUserId?: string;
  onEdit: () => void;
  onDelete: () => void;
  onReply?: () => void;
  onReact?: (emoji: string) => void;
}) {
  const onCopy = async () => {
    if (messageText) {
      try { await Clipboard.setStringAsync(messageText); } catch {}
    }
    onClose();
  };

  const myReactions = Object.entries(reactions || {}).filter(([, u]) => currentUserId && u.includes(currentUserId)).map(([e]) => e);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="msg-actions-backdrop">
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          {onReact && (
            <View style={styles.reactionsWrap}>
              <ReactionsBar currentUserReactions={myReactions} onPick={(e) => onReact(e)} />
            </View>
          )}
          <View style={styles.handle} />
          {canReply && onReply ? (
            <Pressable testID="msg-action-reply" onPress={() => { onClose(); setTimeout(onReply, 60); }} style={styles.item}>
              <Ionicons name="return-up-back" size={22} color={theme.color.onSurface} />
              <Text style={styles.label}>Reply</Text>
            </Pressable>
          ) : null}
          {messageText ? (
            <Pressable testID="msg-action-copy" onPress={onCopy} style={styles.item}>
              <Ionicons name="copy-outline" size={22} color={theme.color.onSurface} />
              <Text style={styles.label}>Copy</Text>
            </Pressable>
          ) : null}
          {canEdit && messageText ? (
            <Pressable testID="msg-action-edit" onPress={() => { onClose(); setTimeout(onEdit, 60); }} style={styles.item}>
              <Ionicons name="create-outline" size={22} color={theme.color.onSurface} />
              <Text style={styles.label}>Edit</Text>
            </Pressable>
          ) : null}
          {canDelete ? (
            <Pressable testID="msg-action-delete" onPress={() => { onClose(); setTimeout(onDelete, 60); }} style={styles.item}>
              <Ionicons name="trash-outline" size={22} color={theme.color.error} />
              <Text style={[styles.label, { color: theme.color.error }]}>Delete</Text>
            </Pressable>
          ) : null}
          <Pressable testID="msg-action-cancel" onPress={onClose} style={[styles.item, styles.cancel]}>
            <Text style={[styles.label, { color: theme.color.onSurfaceTertiary, textAlign: 'center', flex: 1 }]}>Cancel</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: theme.color.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 8, paddingBottom: Platform.OS === 'ios' ? 24 : 16, paddingTop: 8 },
  reactionsWrap: { alignSelf: 'center', marginTop: -30, marginBottom: 8 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: theme.color.borderStrong, marginBottom: 12, marginTop: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 20 },
  cancel: { marginTop: 4, borderTopWidth: 1, borderTopColor: theme.color.divider, justifyContent: 'center' },
  label: { fontFamily: theme.font.body, fontSize: 16, color: theme.color.onSurface, fontWeight: '500' },
});
