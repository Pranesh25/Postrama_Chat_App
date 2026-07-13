import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, Platform, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { useChat } from '@/src/context/ChatContext';
import { api } from '@/src/api/client';
import { theme } from '@/src/theme';

export default function ScheduleMeeting() {
  const { token } = useAuth();
  const { chats } = useChat();
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string }>();
  const isReminder = params.mode === 'reminder';

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [when, setWhen] = useState(() => new Date(Date.now() + 60 * 60 * 1000));
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    if (!title.trim()) { Alert.alert('Missing title', 'Please enter a title'); return; }
    setSaving(true);
    try {
      if (isReminder) {
        await api('/api/reminders', token, {
          method: 'POST',
          body: JSON.stringify({ title, description, remind_at: when.toISOString() }),
        });
      } else {
        await api('/api/meetings', token, {
          method: 'POST',
          body: JSON.stringify({ title, description, starts_at: when.toISOString(), chat_id: chatId }),
        });
      }
      router.back();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  const formatDate = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const formatTime = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const openPicker = (mode: 'date' | 'time') => {
    if (Platform.OS === 'android') setPickerMode(mode);
    else setPickerMode(mode);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID={isReminder ? 'schedule-reminder-screen' : 'schedule-meeting-screen'}>
      <View style={styles.header}>
        <Pressable testID="schedule-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>{isReminder ? 'New Reminder' : 'Schedule Meeting'}</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: theme.space.lg, gap: theme.space.md }} keyboardShouldPersistTaps="handled">
        <View style={styles.field}>
          <Text style={styles.label}>Title</Text>
          <TextInput
            testID="schedule-title-input"
            value={title}
            onChangeText={setTitle}
            placeholder={isReminder ? 'e.g. Call mom' : 'e.g. Design sync'}
            placeholderTextColor={theme.color.onSurfaceTertiary}
            style={styles.input}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Description</Text>
          <TextInput
            testID="schedule-desc-input"
            value={description}
            onChangeText={setDescription}
            placeholder="Optional"
            placeholderTextColor={theme.color.onSurfaceTertiary}
            style={[styles.input, { minHeight: 80 }]}
            multiline
          />
        </View>

        <View style={styles.rowSplit}>
          <Pressable testID="pick-date-button" onPress={() => openPicker('date')} style={styles.dateBtn}>
            <Ionicons name="calendar-outline" size={20} color={theme.color.brand} />
            <Text style={styles.dateText}>{formatDate(when)}</Text>
          </Pressable>
          <Pressable testID="pick-time-button" onPress={() => openPicker('time')} style={styles.dateBtn}>
            <Ionicons name="time-outline" size={20} color={theme.color.brand} />
            <Text style={styles.dateText}>{formatTime(when)}</Text>
          </Pressable>
        </View>

        {!isReminder && (
          <View style={styles.field}>
            <Text style={styles.label}>Post to chat (optional)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
              <Pressable testID="chat-chip-none" onPress={() => setChatId(null)} style={[styles.chip, !chatId && styles.chipActive]}>
                <Text style={[styles.chipText, !chatId && { color: '#fff' }]}>None</Text>
              </Pressable>
              {chats.map((c) => {
                const label = c.is_group ? (c.name || 'Group') : (c.members.find((m) => m.user_id) || c.members[0])?.name?.split(' ')[0] || 'Chat';
                const active = chatId === c.chat_id;
                return (
                  <Pressable key={c.chat_id} testID={`chat-chip-${c.chat_id}`} onPress={() => setChatId(c.chat_id)} style={[styles.chip, active && styles.chipActive]}>
                    <Text style={[styles.chipText, active && { color: '#fff' }]} numberOfLines={1}>{label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        <Pressable testID="schedule-save-button" onPress={onSave} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>{isReminder ? 'Save Reminder' : 'Schedule Meeting'}</Text>}
        </Pressable>
      </ScrollView>

      {pickerMode !== null && (
        <DateTimePicker
          value={when}
          mode={pickerMode}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_e, d) => {
            if (Platform.OS === 'android') setPickerMode(null);
            if (d) setWhen(d);
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.space.sm },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontFamily: theme.font.display, fontSize: 20, fontWeight: '700', color: theme.color.onSurface },
  field: { gap: 6 },
  label: { fontFamily: theme.font.body, fontSize: 13, color: theme.color.onSurfaceTertiary, fontWeight: '600' },
  input: { backgroundColor: theme.color.surfaceSecondary, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontFamily: theme.font.body, fontSize: 15, color: theme.color.onSurface, borderWidth: 1, borderColor: theme.color.border },
  rowSplit: { flexDirection: 'row', gap: 12 },
  dateBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: theme.color.surfaceSecondary, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14, borderWidth: 1, borderColor: theme.color.border },
  dateText: { fontFamily: theme.font.body, color: theme.color.onSurface, fontSize: 14, fontWeight: '600' },
  chip: { paddingHorizontal: 16, height: 36, borderRadius: 18, backgroundColor: theme.color.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.color.border, flexShrink: 0 },
  chipActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  chipText: { fontFamily: theme.font.body, color: theme.color.onSurface, fontSize: 13, fontWeight: '600' },
  saveBtn: { height: 54, borderRadius: theme.radius.pill, backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center', marginTop: theme.space.lg },
  saveText: { color: '#fff', fontFamily: theme.font.body, fontWeight: '700', fontSize: 16 },
});
