// 回收站：反悔期 30 天，到期自动彻底清除（连同音频文件）。
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { colors } from '@/theme';
import {
  listDeletedIdeas,
  purgeExpiredDeleted,
  purgeIdea,
  restoreIdea,
  type Idea,
} from '@/lib/db';
import { deleteAudioFile } from '@/lib/files';
import { fmtDateTime } from '@/lib/format';

const EXPIRE_MS = 30 * 24 * 3600_000;

export default function RecycleBinScreen() {
  const [ideas, setIdeas] = useState<Idea[]>([]);

  useFocusEffect(
    useCallback(() => {
      // 每次进入时顺手清掉过反悔期的
      const expired = purgeExpiredDeleted(EXPIRE_MS);
      expired.forEach((i) => deleteAudioFile(i.audioUri));
      setIdeas(listDeletedIdeas());
    }, []),
  );

  function confirmPurge(item: Idea) {
    Alert.alert('彻底删除', `「${item.title}」将永久删除，无法恢复。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '彻底删除',
        style: 'destructive',
        onPress: () => {
          purgeIdea(item.id);
          deleteAudioFile(item.audioUri);
          setIdeas(listDeletedIdeas());
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.note}>删除的灵感保留 30 天，到期自动彻底清除。灵感只是时机未到。</Text>
      <FlatList
        data={ideas}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.rowTime}>删除于 {fmtDateTime(item.deletedAt ?? 0)}</Text>
            </View>
            <Pressable
              style={styles.actionButton}
              onPress={() => {
                restoreIdea(item.id);
                setIdeas(listDeletedIdeas());
              }}
            >
              <Text style={styles.restoreText}>恢复</Text>
            </Pressable>
            <Pressable style={styles.actionButton} onPress={() => confirmPurge(item)}>
              <Text style={styles.purgeText}>彻底删除</Text>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>回收站是空的</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16 },
  note: { fontSize: 13, color: colors.textDim, marginTop: 12, lineHeight: 19 },
  listContent: { paddingTop: 12, paddingBottom: 24, gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  rowMain: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: 15 },
  rowTime: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  actionButton: { paddingHorizontal: 8, paddingVertical: 6 },
  restoreText: { color: colors.primary, fontSize: 14 },
  purgeText: { color: colors.danger, fontSize: 14 },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: 60, fontSize: 15 },
});
