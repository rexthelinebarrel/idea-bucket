// 列表视图：打开列表 = 准备开工。默认推荐优先（AI 替用户翻），支持搜索与状态筛选。
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { colors, STATUS, type IdeaStatus } from '@/theme';
import { listIdeas, type Idea } from '@/lib/db';
import { IdeaCard } from '@/components/idea-card';

type SortKey = 'recommend' | 'time' | 'status';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recommend', label: '推荐优先' },
  { key: 'time', label: '时间倒序' },
  { key: 'status', label: '按状态' },
];

// v1 的"推荐"启发式：有 AI 分析、有关联、近期活跃的排前面。
// v2 接入 AI 自动连接后，这里换成真正的推荐信号。
function recommendScore(idea: Idea): number {
  let s = 0;
  if (idea.aiAnalysis) s += 4;
  s += (idea.connCount ?? 0) * 2;
  s += (idea.candCount ?? 0) * 3; // 有待确认 AI 建议的优先曝光
  if (Date.now() - idea.updatedAt < 3 * 24 * 3600_000) s += 1;
  return s;
}

export default function ListScreen() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('recommend');
  const [statusFilter, setStatusFilter] = useState<IdeaStatus | 'all'>('all');

  useFocusEffect(
    useCallback(() => {
      setIdeas(listIdeas());
    }, []),
  );

  const shown = useMemo(() => {
    let list = ideas;
    const kw = q.trim().toLowerCase();
    if (kw) {
      list = list.filter(
        (i) => i.title.toLowerCase().includes(kw) || i.transcript.toLowerCase().includes(kw),
      );
    }
    if (statusFilter !== 'all') list = list.filter((i) => i.status === statusFilter);
    const copy = [...list];
    if (sort === 'time') {
      copy.sort((a, b) => b.createdAt - a.createdAt);
    } else if (sort === 'status') {
      const order = Object.keys(STATUS) as IdeaStatus[];
      copy.sort(
        (a, b) => order.indexOf(a.status) - order.indexOf(b.status) || b.createdAt - a.createdAt,
      );
    } else {
      copy.sort((a, b) => recommendScore(b) - recommendScore(a) || b.updatedAt - a.updatedAt);
    }
    return copy;
  }, [ideas, q, sort, statusFilter]);

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        placeholder="搜索标题或原文…"
        placeholderTextColor={colors.textDim}
        value={q}
        onChangeText={setQ}
      />

      <View style={styles.sortRow}>
        {SORTS.map((s) => (
          <Pressable
            key={s.key}
            style={[styles.chip, sort === s.key && styles.chipActive]}
            onPress={() => setSort(s.key)}
          >
            <Text style={[styles.chipText, sort === s.key && styles.chipTextActive]}>{s.label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
        <Pressable
          style={[styles.chip, statusFilter === 'all' && styles.chipActive]}
          onPress={() => setStatusFilter('all')}
        >
          <Text style={[styles.chipText, statusFilter === 'all' && styles.chipTextActive]}>全部</Text>
        </Pressable>
        {(Object.keys(STATUS) as IdeaStatus[]).map((key) => (
          <Pressable
            key={key}
            style={[styles.chip, statusFilter === key && styles.chipActive]}
            onPress={() => setStatusFilter(key)}
          >
            <Text style={[styles.chipText, statusFilter === key && styles.chipTextActive]}>
              {STATUS[key].label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <FlatList
        data={shown}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <IdeaCard idea={item} onPress={() => router.push(`/idea/${item.id}`)} />
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {ideas.length === 0 ? '桶还是空的，回去按住说话丢一个进来' : '没有符合条件的灵感'}
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 16,
  },
  search: {
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
    marginTop: 12,
  },
  sortRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  filterRow: {
    flexDirection: 'row',
    marginTop: 10,
    flexGrow: 0,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.card,
    marginRight: 8,
  },
  chipActive: {
    backgroundColor: colors.accent,
  },
  chipText: {
    fontSize: 13,
    color: colors.textDim,
  },
  chipTextActive: {
    color: '#1A1206',
    fontWeight: '600',
  },
  listContent: {
    paddingTop: 12,
    paddingBottom: 24,
    gap: 10,
  },
  empty: {
    color: colors.textDim,
    textAlign: 'center',
    marginTop: 60,
    fontSize: 15,
  },
});
