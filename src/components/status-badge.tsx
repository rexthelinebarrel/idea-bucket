import { StyleSheet, Text } from 'react-native';

import { STATUS, type IdeaStatus } from '@/theme';

export function StatusBadge({ status }: { status: IdeaStatus }) {
  const meta = STATUS[status] ?? STATUS.raw;
  return (
    <Text style={[styles.badge, { color: meta.color, borderColor: meta.color }]}>{meta.label}</Text>
  );
}

const styles = StyleSheet.create({
  badge: {
    fontSize: 11,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    overflow: 'hidden',
  },
});
