// 主界面：只有一个大按钮。按住说话，松手即走，整个投入 ≤ 5 秒。
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/theme';
import { countIdeas, createIdea, genId } from '@/lib/db';
import { moveRecording } from '@/lib/files';
import { placeholderTitle } from '@/lib/title';
import { processIdea } from '@/lib/pipeline';

export default function HomeScreen() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [count, setCount] = useState(0);
  const [recording, setRecording] = useState(false);
  const [toast, setToast] = useState('');
  const startAt = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();

  useFocusEffect(
    useCallback(() => {
      setCount(countIdeas());
    }, []),
  );

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  function showToast(text: string) {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2500);
  }

  async function startRecording() {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('需要麦克风权限', '请在系统设置中允许灵感桶使用麦克风。');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      startAt.current = Date.now();
      setRecording(true);
    } catch {
      showToast('录音启动失败，请重试');
    }
  }

  async function stopRecording() {
    if (!recording) return;
    setRecording(false);
    const duration = Date.now() - startAt.current;
    try {
      await recorder.stop();
    } catch {
      return;
    }
    setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    if (duration < 600) {
      showToast('太短了，按住说话');
      return;
    }
    const uri = recorder.uri;
    if (!uri) {
      showToast('录音保存失败，请重试');
      return;
    }
    const id = genId();
    try {
      const finalUri = moveRecording(uri, id);
      createIdea({ id, title: placeholderTitle(), audioUri: finalUri });
    } catch {
      showToast('保存失败，请重试');
      return;
    }
    setCount(countIdeas());
    showToast('已入桶 ✓');
    // 转写与标题生成走异步流水线，不阻塞下一次投入
    processIdea(id).catch(() => {});
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 20 }]}>
      <Text style={styles.logo}>灵感桶</Text>
      <Text style={styles.slogan}>按住说话，松手即走</Text>

      <View style={styles.middle}>
        <Pressable
          onPressIn={startRecording}
          onPressOut={stopRecording}
          style={[styles.micButton, recording && styles.micButtonActive]}
        >
          <Text style={styles.micIcon}>🎤</Text>
        </Pressable>
        <Text style={styles.hint}>{recording ? '正在录音，松手结束' : ''}</Text>
        <Text style={styles.counter}>
          {count > 0 ? `桶里攒了 ${count} 个点子` : '桶还是空的，丢第一个进来'}
        </Text>
        {toast ? <Text style={styles.toast}>{toast}</Text> : null}
      </View>

      <View style={styles.footer}>
        <Pressable style={styles.footerButton} onPress={() => router.push('/list')}>
          <Text style={styles.footerButtonText}>📋 灵感列表</Text>
        </Pressable>
        <Pressable style={styles.footerButton} onPress={() => router.push('/settings')}>
          <Text style={styles.footerButtonText}>⚙️ 设置</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 24,
  },
  logo: {
    fontSize: 34,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  slogan: {
    fontSize: 14,
    color: colors.textDim,
    textAlign: 'center',
    marginTop: 8,
  },
  middle: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButton: {
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: colors.card,
    borderWidth: 3,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButtonActive: {
    backgroundColor: '#3A2226',
    borderColor: colors.danger,
    transform: [{ scale: 1.08 }],
  },
  micIcon: {
    fontSize: 72,
  },
  hint: {
    fontSize: 15,
    color: colors.accent,
    marginTop: 22,
    minHeight: 22,
  },
  counter: {
    fontSize: 15,
    color: colors.textDim,
    marginTop: 6,
  },
  toast: {
    fontSize: 15,
    color: colors.accent,
    marginTop: 14,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
  },
  footerButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.card,
    alignItems: 'center',
  },
  footerButtonText: {
    fontSize: 16,
    color: colors.text,
  },
});
