import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, STATUS } from '@/theme';
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
  const statusColor = (STATUS[idea.status] ?? STATUS.raw).color;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
    >
      <View style={[styles.bar, { backgroundColor: statusColor }]} />
      <View style={styles.body}>
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
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    overflow: 'hidden',
  },
  cardPressed: {
    opacity: 0.75,
  },
  bar: {
    width: 4,
  },
  body: {
    flex: 1,
    padding: 16,
    gap: 8,
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
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  excerpt: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 20,
  },
});
