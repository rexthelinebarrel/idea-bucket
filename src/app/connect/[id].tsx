// 建立关联：从当前灵感出发，搜索/选中另一条灵感建立手动连接
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { colors, radius } from '@/theme';
import { listIdeas, addConnection, type Idea } from '@/lib/db';
import { StatusBadge } from '@/components/status-badge';
import { fmtDateTime } from '@/lib/format';

export default function ConnectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [q, setQ] = useState('');

  useFocusEffect(
    useCallback(() => {
      setIdeas(listIdeas().filter((i) => i.id !== id));
    }, [id]),
  );

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return ideas;
    return ideas.filter(
      (i) => i.title.toLowerCase().includes(kw) || i.transcript.toLowerCase().includes(kw),
    );
  }, [ideas, q]);

  function connect(otherId: string) {
    if (!id) return;
    addConnection(id, otherId);
    router.back();
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        placeholder="搜索要关联的灵感…"
        placeholderTextColor={colors.textDim}
        value={q}
        onChangeText={setQ}
      />
      <FlatList
        data={shown}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => connect(item.id)}>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.rowTime}>{fmtDateTime(item.createdAt)}</Text>
            </View>
            <StatusBadge status={item.status} />
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>没有可关联的灵感</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16 },
  search: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
    marginTop: 12,
  },
  listContent: { paddingTop: 14, paddingBottom: 24, gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 14,
    gap: 10,
  },
  rowMain: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: 15 },
  rowTime: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: 60, fontSize: 15 },
});
