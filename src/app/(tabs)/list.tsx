// 列表视图：打开列表 = 准备开工。默认推荐优先（AI 替用户翻），支持搜索与状态筛选。
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { colors, STATUS, type IdeaStatus } from '@/theme';
import { listIdeas, getSetting, setSetting, type Idea } from '@/lib/db';
import { runAiOrganize } from '@/lib/pipeline';
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
  const [organizing, setOrganizing] = useState(false);
  const [lastOrganize, setLastOrganize] = useState('');

  useFocusEffect(
    useCallback(() => {
      setIdeas(listIdeas());
      setLastOrganize(getSetting('last_ai_organize') ?? '');
    }, []),
  );

  // 「AI 整理」：批量升级关键词 → 重算候选 → 限量终审 → 清陈旧候选（成本护栏在 pipeline 里）
  async function organize() {
    if (organizing) return;
    setOrganizing(true);
    try {
      const s = await runAiOrganize();
      const stamp = `${new Date().toLocaleString()} 提取 ${s.extracted} · 候选 ${s.candidates} · 终审 ${s.judged}`;
      setSetting('last_ai_organize', stamp);
      setLastOrganize(stamp);
      setIdeas(listIdeas());
      Alert.alert(
        'AI 整理完成',
        `提取/升级关键词 ${s.extracted} 条\n新增候选 ${s.candidates} 对\n终审判定 ${s.judged} 对\n清理陈旧候选 ${s.pruned} 对\n\n候选在灵感详情页「AI 建议关联」里等你确认。`,
      );
    } catch (e) {
      Alert.alert('无法整理', e instanceof Error ? e.message : '网络异常，请重试');
    } finally {
      setOrganizing(false);
    }
  }

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
        placeholder="🔍 搜索标题或原文…"
        placeholderTextColor={colors.textDim}
        value={q}
        onChangeText={setQ}
      />

      <View style={styles.segment}>
        {SORTS.map((s) => (
          <Pressable
            key={s.key}
            style={[styles.segmentItem, sort === s.key && styles.segmentItemActive]}
            onPress={() => setSort(s.key)}
          >
            <Text style={[styles.segmentText, sort === s.key && styles.segmentTextActive]}>
              {s.label}
            </Text>
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

      <View style={styles.organizeRow}>
        <Pressable style={styles.organizeBtn} onPress={organize} disabled={organizing}>
          {organizing ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <Text style={styles.organizeBtnText}>✨ AI 整理</Text>
          )}
        </Pressable>
        {!!lastOrganize && (
          <Text style={styles.organizeInfo} numberOfLines={1}>
            上次：{lastOrganize}
          </Text>
        )}
      </View>

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
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 18,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
    marginTop: 12,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 3,
    marginTop: 12,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 999,
    alignItems: 'center',
  },
  segmentItemActive: {
    backgroundColor: colors.accentSoft,
  },
  segmentText: {
    fontSize: 13,
    color: colors.textDim,
    letterSpacing: 1,
  },
  segmentTextActive: {
    color: colors.accent,
    fontWeight: '700',
  },
  filterRow: {
    flexDirection: 'row',
    marginTop: 10,
    flexGrow: 0,
  },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginRight: 8,
  },
  chipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  chipText: {
    fontSize: 13,
    color: colors.textDim,
  },
  chipTextActive: {
    color: colors.accent,
    fontWeight: '600',
  },
  organizeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  organizeBtn: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 7,
    minWidth: 96,
    alignItems: 'center',
  },
  organizeBtnText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
  },
  organizeInfo: {
    flex: 1,
    color: colors.textDim,
    fontSize: 11,
  },
  listContent: {
    paddingTop: 14,
    paddingBottom: 24,
    gap: 12,
  },
  empty: {
    color: colors.textDim,
    textAlign: 'center',
    marginTop: 60,
    fontSize: 15,
  },
});
