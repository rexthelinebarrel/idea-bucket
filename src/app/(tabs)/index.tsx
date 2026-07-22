// 主界面：只有一个大按钮。按住说话，松手即走，整个投入 ≤ 5 秒。
// 三种转写模式（设置页可切）：
// - 离线引擎（默认）：内置 sherpa-onnx 本地模型，全程不联网、无需任何 Key
// - 系统识别：识别模块自己采集音频并实时转写，松手直接出文字
// - 云端 API：录音先落盘即确认，转写走异步流水线（OpenAI 兼容接口）
// 注意：系统识别与其他两种互斥，绝不同时占用麦克风（多数设备不允许多路采集）。
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
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
import { countIdeas, createIdea, genId, setSetting, logEvent } from '@/lib/db';
import { moveRecording, deleteAudioFile } from '@/lib/files';
import { generateTitle, placeholderTitle } from '@/lib/title';
import { processIdea } from '@/lib/pipeline';
import { getAISettings, type AISettings } from '@/lib/ai';
import { getActiveModelId, getModelState } from '@/lib/offline-stt';

export default function HomeScreen() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [count, setCount] = useState(0);
  const [recording, setRecording] = useState(false);
  const [toast, setToast] = useState('');
  // 上滑取消：手指从按下位置上移超过阈值即进入"松手取消"状态
  const [cancelArmed, setCancelArmed] = useState(false);
  const cancelArmedRef = useRef(false);
  const pressStartYRef = useRef(0);
  const startAt = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();

  // —— 系统识别模式的会话状态（全走 ref，避免高频识别事件触发重渲染）——
  const modeRef = useRef<AISettings['transcribeMode']>('cloud');
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
    logEvent('speech', `${ev.error}: ${ev.message}`, 'error');
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

  function armCancel(v: boolean) {
    cancelArmedRef.current = v;
    setCancelArmed(v);
  }

  async function handlePressIn(e: GestureResponderEvent) {
    pressStartYRef.current = e.nativeEvent.pageY;
    armCancel(false);
    const mode = getAISettings().transcribeMode;
    if (mode === 'offline' && getModelState(getActiveModelId()) !== 'ready') {
      Alert.alert('需要先下载离线模型', '离线识别首次使用前要下载模型（轻量版仅 22MB）。', [
        { text: '取消', style: 'cancel' },
        { text: '去下载', onPress: () => router.push('/settings') },
      ]);
      return;
    }
    modeRef.current = mode;
    if (mode === 'system') await startSystemRecognition();
    else await startRecorder();
  }

  function handleTouchMove(e: GestureResponderEvent) {
    if (!recording) return;
    const dy = e.nativeEvent.pageY - pressStartYRef.current;
    const armed = dy < -70;
    if (armed !== cancelArmedRef.current) armCancel(armed);
  }

  async function handlePressOut() {
    const cancelled = cancelArmedRef.current;
    armCancel(false);
    if (modeRef.current === 'system') {
      if (cancelled) cancelSystemRecognition();
      else await stopSystemRecognition();
    } else {
      if (cancelled) await cancelRecorder();
      else await stopRecorder();
    }
  }

  // ---- 上滑取消：两种模式共用收尾——停采集、弃产物、不入桶 ----

  function cancelSystemRecognition() {
    if (!recording) return;
    setRecording(false);
    ExpoSpeechRecognitionModule.abort();
    logEvent('speech', '用户上滑取消录音');
    showToast('已取消');
  }

  async function cancelRecorder() {
    if (!recording) return;
    setRecording(false);
    try {
      await recorder.stop();
    } catch {
      // 停止失败也继续清理
    }
    setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    if (recorder.uri) deleteAudioFile(recorder.uri);
    logEvent('idea', '用户上滑取消录音');
    showToast('已取消');
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
      logEvent('speech', '系统识别启动失败（设备无可用识别服务）', 'error');
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
      logEvent('speech', `未识别到文本（${duration}ms）${err ? ` ${err}` : ''}`, 'warn');
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
    logEvent('idea', `入桶（system 模式，${duration}ms，${text.length} 字）`);
    setCount(countIdeas());
    showToast('已入桶 ✓');
  }

  // ---- 录音模式（离线引擎 / 云端 API 共用：录音落盘，转写走异步流水线）----

  async function startRecorder() {
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

  async function stopRecorder() {
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
    logEvent('idea', `入桶（${modeRef.current} 模式，${duration}ms）`);
    // 转写与标题生成走异步流水线，不阻塞下一次投入
    processIdea(id).catch(() => {});
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 20, paddingBottom: 12 }]}>
      <View style={styles.brand}>
        <Text style={styles.logo}>灵感桶</Text>
        <View style={styles.brandRule} />
        <Text style={styles.slogan}>按住说话，松手即走</Text>
      </View>

      <View style={styles.middle}>
        <Text style={styles.counter}>
          {count > 0 ? `桶里攒了 ${count} 个点子` : '桶还是空的，丢第一个进来'}
        </Text>
        <View style={styles.micWrap}>
          <View
            style={[
              styles.micRingOuter,
              recording && !cancelArmed && styles.micRingOuterActive,
              cancelArmed && styles.micRingOuterCancel,
            ]}
          />
          <View
            style={[
              styles.micRing,
              recording && !cancelArmed && styles.micRingActive,
              cancelArmed && styles.micRingCancel,
            ]}
          />
          <Pressable
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            onTouchMove={handleTouchMove}
            // 关键：扩大按压保持区域，手指大幅滑动不提前触发 onPressOut，
            // 否则上滑到一半就会被误判为松手（取消/提交全乱）
            pressRetentionOffset={{ top: 1000, bottom: 500, left: 500, right: 500 }}
            style={({ pressed }) => [
              styles.micButton,
              pressed && !recording && styles.micButtonPressed,
              recording && styles.micButtonActive,
              cancelArmed && styles.micButtonCancel,
            ]}
          >
            <Text style={styles.micIcon}>{cancelArmed ? '🗑' : '🎤'}</Text>
          </Pressable>
        </View>
        <Text style={[styles.hint, cancelArmed && styles.hintCancel]}>
          {recording ? (cancelArmed ? '松手取消' : '正在录音 · 上滑取消') : ''}
        </Text>
        {toast ? <Text style={styles.toast}>{toast}</Text> : null}
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
  brand: {
    alignItems: 'center',
  },
  logo: {
    fontSize: 42,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: 12,
    textAlign: 'center',
    marginLeft: 12, // 抵消末字 letterSpacing 造成的视觉偏移
  },
  brandRule: {
    width: 44,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.accent,
    marginTop: 14,
  },
  slogan: {
    fontSize: 13,
    color: colors.textDim,
    letterSpacing: 4,
    textAlign: 'center',
    marginTop: 12,
    marginLeft: 4,
  },
  middle: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counter: {
    fontSize: 14,
    color: colors.textDim,
    letterSpacing: 1,
    marginBottom: 28,
  },
  micWrap: {
    width: 264,
    height: 264,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micRingOuter: {
    position: 'absolute',
    width: 264,
    height: 264,
    borderRadius: 132,
    borderWidth: 1,
    borderColor: colors.accentSoft,
    opacity: 0.5,
  },
  micRingOuterActive: {
    borderColor: colors.danger,
    opacity: 0.3,
  },
  micRingOuterCancel: {
    borderColor: colors.danger,
    opacity: 0.7,
  },
  micRing: {
    position: 'absolute',
    width: 216,
    height: 216,
    borderRadius: 108,
    borderWidth: 1,
    borderColor: colors.accent,
    opacity: 0.35,
  },
  micRingActive: {
    borderColor: colors.danger,
    opacity: 0.6,
  },
  micRingCancel: {
    borderColor: colors.danger,
    opacity: 1,
  },
  micButton: {
    width: 184,
    height: 184,
    borderRadius: 92,
    backgroundColor: colors.card,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButtonPressed: {
    transform: [{ scale: 0.97 }],
  },
  micButtonActive: {
    backgroundColor: colors.dangerSoft,
    borderColor: colors.danger,
    transform: [{ scale: 1.05 }],
  },
  micButtonCancel: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
    transform: [{ scale: 0.94 }],
  },
  micIcon: {
    fontSize: 74,
  },
  hint: {
    fontSize: 14,
    color: colors.accent,
    marginTop: 30,
    minHeight: 22,
    letterSpacing: 2,
  },
  hintCancel: {
    color: colors.danger,
    fontWeight: '700',
  },
  toast: {
    fontSize: 14,
    color: colors.accent,
    marginTop: 14,
  },
});
