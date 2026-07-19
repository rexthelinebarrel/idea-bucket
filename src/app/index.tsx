// 主界面：只有一个大按钮。按住说话，松手即走，整个投入 ≤ 5 秒。
// 转写两种模式（设置页可切）：
// - 系统识别（默认，免配置）：识别模块自己采集音频并实时转写，松手直接出文字
// - 云端 API：录音先落盘即确认，转写走异步流水线（OpenAI 兼容接口）
// 注意：两种模式互斥，绝不同时占用麦克风（多数设备不允许多路采集）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from '@jamsch/expo-speech-recognition';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/theme';
import { countIdeas, createIdea, genId, setSetting } from '@/lib/db';
import { moveRecording } from '@/lib/files';
import { generateTitle, placeholderTitle } from '@/lib/title';
import { processIdea } from '@/lib/pipeline';
import { getAISettings } from '@/lib/ai';

export default function HomeScreen() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [count, setCount] = useState(0);
  const [recording, setRecording] = useState(false);
  const [toast, setToast] = useState('');
  const startAt = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();

  // —— 系统识别模式的会话状态（全走 ref，避免高频识别事件触发重渲染）——
  const modeRef = useRef<'system' | 'cloud'>('cloud');
  const finalTextRef = useRef('');
  const interimTextRef = useRef('');
  const speechAudioRef = useRef<string | null>(null);
  const speechErrorRef = useRef<string | null>(null);
  const endSignalRef = useRef<(() => void) | null>(null);

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

  useSpeechRecognitionEvent('result', (ev) => {
    const t = ev.results[0]?.transcript ?? '';
    if (!t) return;
    // iOS 每次返回全量文本；Android 按段落返回，最终结果需要拼接
    if (Platform.OS === 'ios') {
      finalTextRef.current = t;
      interimTextRef.current = '';
    } else if (ev.isFinal) {
      finalTextRef.current = `${finalTextRef.current}${t}，`;
      interimTextRef.current = '';
    } else {
      interimTextRef.current = t;
    }
  });
  useSpeechRecognitionEvent('audioend', (ev) => {
    if (ev.uri) speechAudioRef.current = ev.uri;
  });
  useSpeechRecognitionEvent('error', (ev) => {
    speechErrorRef.current = ev.message || ev.error;
    setSetting('last_speech_error', `${new Date().toLocaleString()} ${ev.error}: ${ev.message}`);
  });
  useSpeechRecognitionEvent('end', () => {
    endSignalRef.current?.();
    endSignalRef.current = null;
  });

  function showToast(text: string) {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2500);
  }

  async function handlePressIn() {
    const mode = getAISettings().transcribeMode;
    modeRef.current = mode;
    if (mode === 'system') await startSystemRecognition();
    else await startCloudRecording();
  }

  async function handlePressOut() {
    if (modeRef.current === 'system') await stopSystemRecognition();
    else await stopCloudRecording();
  }

  // ---- 系统识别模式（免配置，松手即出文字）----

  async function startSystemRecognition() {
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('需要麦克风权限', '请在系统设置中允许灵感桶使用麦克风。');
        return;
      }
      finalTextRef.current = '';
      interimTextRef.current = '';
      speechAudioRef.current = null;
      speechErrorRef.current = null;
      const svcPkg = getAISettings().speechServicePackage;
      ExpoSpeechRecognitionModule.start({
        lang: 'zh-CN',
        interimResults: true,
        continuous: true,
        addsPunctuation: true,
        recordingOptions: { persist: true },
        ...(Platform.OS === 'android' && svcPkg
          ? { androidRecognitionServicePackage: svcPkg }
          : {}),
      });
      startAt.current = Date.now();
      setRecording(true);
    } catch {
      Alert.alert(
        '系统识别不可用',
        '这台手机没有可用的语音识别服务。请到「设置」把转写模式改为云端 API（国内推荐硅基流动，免费）。',
      );
    }
  }

  async function stopSystemRecognition() {
    if (!recording) return;
    setRecording(false);
    const duration = Date.now() - startAt.current;
    if (duration < 600) {
      ExpoSpeechRecognitionModule.abort();
      showToast('太短了，按住说话');
      return;
    }
    ExpoSpeechRecognitionModule.stop();
    // 等最终结果（end 事件），最多 3 秒；超时就用已有的文本
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3000);
      endSignalRef.current = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    const text = `${finalTextRef.current}${interimTextRef.current}`
      .trim()
      .replace(/[，。、！？]+$/, '');
    if (!text) {
      const err = speechErrorRef.current;
      showToast(
        err
          ? `识别失败：${err}（可在设置页换识别服务，或改用云端 API）`
          : '没听清，再说一次？',
      );
      return;
    }
    const id = genId();
    let finalUri = '';
    try {
      if (speechAudioRef.current) finalUri = moveRecording(speechAudioRef.current, id);
    } catch {
      // 音频移动失败不阻塞入桶
    }
    createIdea({ id, title: generateTitle(text), audioUri: finalUri, transcript: text });
    setCount(countIdeas());
    showToast('已入桶 ✓');
  }

  // ---- 云端 API 模式（录音落盘 + 异步转写）----

  async function startCloudRecording() {
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

  async function stopCloudRecording() {
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
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
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
