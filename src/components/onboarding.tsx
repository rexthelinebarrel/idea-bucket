// 新手指南：首次启动自动弹出，设置页可重看。
// 四页讲完核心玩法：录音投入 → 转写模式 → AI 搭档 → 灵感图谱。
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius } from '@/theme';

const PAGES: { emoji: string; title: string; body: string }[] = [
  {
    emoji: '🎙',
    title: '按住说话，松手即走',
    body: '灵感冒出来，按住大按钮就说。松手自动入桶并转写，不用等；说错了——按住时上滑就取消。',
  },
  {
    emoji: '🧠',
    title: '转写三模式',
    body: '默认离线引擎：下载一次模型，之后识别全程不联网。追求准确率去设置页下载 Qwen3 高精度版；也可换系统识别或云端 API。',
  },
  {
    emoji: '✨',
    title: 'AI 搭档',
    body: '设置页配一个 API Key（点「硅基流动」预设，注册有免费额度），解锁 AI 讨论、AI 关键词提取和灵感智能关联。',
  },
  {
    emoji: '🕸',
    title: '灵感会自己连成网',
    body: '桶里的灵感会自动发现关联，底部「图谱」看你的灵感网络。桶越大，越不用自己翻——AI 替你翻。',
  },
];

export function Onboarding({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [page, setPage] = useState(0);
  const last = page === PAGES.length - 1;

  function close() {
    setPage(0);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.emoji}>{PAGES[page].emoji}</Text>
          <Text style={styles.title}>{PAGES[page].title}</Text>
          <Text style={styles.body}>{PAGES[page].body}</Text>

          <View style={styles.dots}>
            {PAGES.map((_, i) => (
              <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
            ))}
          </View>

          <View style={styles.actions}>
            {!last && (
              <Pressable onPress={close} style={styles.skipBtn}>
                <Text style={styles.skipText}>跳过</Text>
              </Pressable>
            )}
            <Pressable
              style={[styles.nextBtn, last && styles.nextBtnFull]}
              onPress={() => (last ? close() : setPage(page + 1))}
            >
              <Text style={styles.nextText}>{last ? '开始用' : '下一步'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 28,
    alignItems: 'center',
  },
  emoji: { fontSize: 56 },
  title: {
    fontSize: 21,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: 1,
    marginTop: 16,
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    color: colors.textDim,
    lineHeight: 23,
    marginTop: 12,
    textAlign: 'center',
  },
  dots: { flexDirection: 'row', gap: 8, marginTop: 22 },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.cardBorder,
  },
  dotActive: {
    backgroundColor: colors.accent,
    width: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
    width: '100%',
  },
  skipBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: radius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  skipText: { color: colors.textDim, fontSize: 15 },
  nextBtn: {
    flex: 2,
    paddingVertical: 13,
    borderRadius: radius.md,
    alignItems: 'center',
    backgroundColor: colors.accent,
  },
  nextBtnFull: { flex: 1 },
  nextText: { color: colors.onAccent, fontSize: 15, fontWeight: '700', letterSpacing: 1 },
});
