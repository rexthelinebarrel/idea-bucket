import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme';
import type { Idea } from '@/lib/db';
import { fmtDateTime } from '@/lib/format';
import { StatusBadge } from './status-badge';

export function IdeaCard({ idea, onPress }: { idea: Idea; onPress: () => void }) {
  const excerpt =
    idea.transcribeState === 'failed'
      ? '⚠️ 转写失败，点进详情重试'
      : idea.transcribeState === 'pending'
        ? '转写中…'
        : idea.transcript.trim().slice(0, 60);

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.row}>
        <StatusBadge status={idea.status} />
        <Text style={styles.time}>{fmtDateTime(idea.createdAt)}</Text>
        {(idea.connCount ?? 0) > 0 && <Text style={styles.conn}>🔗 {idea.connCount}</Text>}
        {(idea.candCount ?? 0) > 0 && <Text style={styles.cand}>✨ {idea.candCount}</Text>}
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {idea.title}
      </Text>
      {!!excerpt && (
        <Text style={styles.excerpt} numberOfLines={2}>
          {excerpt}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  time: {
    color: colors.textDim,
    fontSize: 12,
  },
  conn: {
    color: colors.primary,
    fontSize: 12,
    marginLeft: 'auto',
  },
  cand: {
    color: colors.accent,
    fontSize: 12,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  excerpt: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 19,
  },
});
