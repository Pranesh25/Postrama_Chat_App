import React from 'react';
import { Modal, View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Contacts from 'expo-contacts';
import { theme } from '../theme';

const MAX_SIZE = 5 * 1024 * 1024; // 5MB

async function fileToBase64(uri: string): Promise<string | null> {
  try {
    const res = await fetch(uri);
    const blob = await res.blob();
    if (blob.size > MAX_SIZE) return null;
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

type Attach =
  | { kind: 'image'; data: string }
  | { kind: 'file'; name: string; mime: string; data: string; size: number }
  | { kind: 'contact'; name: string; phone?: string; email?: string };

export function AttachSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (a: Attach) => void;
}) {
  const pickPhoto = async () => {
    onClose();
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: true, quality: 0.6,
    });
    if (!res.canceled && res.assets[0]?.base64) {
      onPick({ kind: 'image', data: `data:image/jpeg;base64,${res.assets[0].base64}` });
    }
  };

  const pickFile = async () => {
    onClose();
    const res = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    if (asset.size && asset.size > MAX_SIZE) {
      alert('File too large (max 5MB).');
      return;
    }
    const data = await fileToBase64(asset.uri);
    if (!data) { alert('Could not read file (max 5MB).'); return; }
    onPick({
      kind: 'file',
      name: asset.name || 'file',
      mime: asset.mimeType || 'application/octet-stream',
      data,
      size: asset.size || 0,
    });
  };

  const pickContact = async () => {
    onClose();
    if (Platform.OS === 'web') { alert('Contact picker is not available on web.'); return; }
    const perm = await Contacts.requestPermissionsAsync();
    if (perm.status !== 'granted') return;
    const { data } = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails, Contacts.Fields.Name],
      sort: Contacts.SortTypes.FirstName,
      pageSize: 1000,
    });
    const first = (data || []).find((c) => c.name && (c.phoneNumbers?.length || c.emails?.length));
    // For MVP: just picks the first — real UI would offer selection. Show alert to pick manually.
    if (!first) { alert('No contacts found.'); return; }
    onPick({
      kind: 'contact',
      name: first.name || 'Unknown',
      phone: first.phoneNumbers?.[0]?.number,
      email: first.emails?.[0]?.email,
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="attach-backdrop">
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <View style={styles.handle} />
          <Text style={styles.title}>Share</Text>
          <View style={styles.grid}>
            <Tile testID="attach-photo" icon="image" label="Photo" color="#4CAF50" onPress={pickPhoto} />
            <Tile testID="attach-file" icon="document" label="File" color="#9C27B0" onPress={pickFile} />
            <Tile testID="attach-contact" icon="person" label="Contact" color="#FF9800" onPress={pickContact} />
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

function Tile({ icon, label, color, onPress, testID }: { icon: keyof typeof Ionicons.glyphMap; label: string; color: string; onPress: () => void; testID: string }) {
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]}>
      <View style={[styles.tileIcon, { backgroundColor: color }]}>
        <Ionicons name={icon} size={24} color="#fff" />
      </View>
      <Text style={styles.tileLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: theme.color.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 32, paddingTop: 8, paddingHorizontal: 16 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: theme.color.borderStrong, marginBottom: 12, marginTop: 4 },
  title: { fontFamily: theme.font.display, fontSize: 18, fontWeight: '700', color: theme.color.onSurface, marginBottom: 16, textAlign: 'center' },
  grid: { flexDirection: 'row', gap: 16, justifyContent: 'space-around' },
  tile: { alignItems: 'center', gap: 8, flex: 1 },
  tileIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontFamily: theme.font.body, fontSize: 12, color: theme.color.onSurface, fontWeight: '600' },
});

export type { Attach };
