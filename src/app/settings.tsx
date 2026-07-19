// 设置：转写模式 / 识别服务 / AI 服务 / 数据 / 更新 / 诊断信息。
// 诊断信息卡片是排障入口：一屏装齐所有关键状态，一键分享，免去来回描述报错。
import { useCallback, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import { getSpeechRecognitionServices } from '@jamsch/expo-speech-recognition';

import { colors } from '@/theme';
import { listDeletedIdeas, getSetting, setSetting } from '@/lib/db';
import { getAISettings, saveAISettings, type AISettings } from '@/lib/ai';

const FIELDS: {
  key: keyof AISettings;
  label: string;
  placeholder: string;
  secure?: boolean;
  /** 仅云端 API 转写模式下显示 */
  cloudOnly?: boolean;
}[] = [
  { key: 'baseUrl', label: 'API 地址（Base URL）', placeholder: 'https://api.openai.com/v1' },
  { key: 'apiKey', label: 'API Key', placeholder: 'sk-…', secure: true },
  { key: 'chatModel', label: '对话模型', placeholder: 'gpt-4o-mini' },
  { key: 'transcribeModel', label: '转写模型', placeholder: 'whisper-1', cloudOnly: true },
];

export default function SettingsScreen() {
  const [form, setForm] = useState<AISettings>(() => getAISettings());
  const [saved, setSaved] = useState(false);
  const [binCount, setBinCount] = useState(0);
  const [updateState, setUpdateState] = useState('');
  const [services, setServices] = useState<string[]>([]);
  const [diag, setDiag] = useState<[string, string][]>([]);

  function buildDiag(s: AISettings, svcCount: number): [string, string][] {
    return [
      ['App 版本', Constants.expoConfig?.version ?? '未知'],
      ['运行时版本', Updates.runtimeVersion ?? '未知'],
      ['更新批次', Updates.updateId ? Updates.updateId.slice(0, 8) : '内嵌包（未应用过 OTA）'],
      ['更新通道', Updates.channel || '未知'],
      ['转写模式', s.transcribeMode === 'system' ? '系统识别' : '云端 API'],
      ['识别服务数', String(svcCount)],
      ['最近识别错误', getSetting('last_speech_error') ?? '无'],
      ['最近更新检查', getSetting('last_update_check') ?? '无'],
    ];
  }

  useFocusEffect(
    useCallback(() => {
      const s = getAISettings();
      setForm(s);
      setBinCount(listDeletedIdeas().length);
      let svc: string[] = [];
      if (Platform.OS === 'android') {
        try {
          svc = getSpeechRecognitionServices();
        } catch {
          svc = [];
        }
      }
      setServices(svc);
      setDiag(buildDiag(s, svc.length));
    }, []),
  );

  function save() {
    saveAISettings({ ...form, baseUrl: form.baseUrl.trim(), apiKey: form.apiKey.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  // OTA 热更新：拉取云端推送的新版本（仅限 JS/资源改动；原生改动仍需重装 APK）
  async function checkUpdate() {
    setUpdateState('检查中…');
    const stamp = () => new Date().toLocaleString();
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        setUpdateState('发现新版本，下载中…');
        await Updates.fetchUpdateAsync();
        setSetting('last_update_check', `${stamp()} 拉到新版本`);
        setUpdateState('');
        Alert.alert('更新就绪', '重启应用以完成更新。', [
          { text: '稍后', style: 'cancel' },
          { text: '立即更新', onPress: () => Updates.reloadAsync() },
        ]);
      } else {
        setUpdateState('已是最新');
        setSetting('last_update_check', `${stamp()} 已是最新`);
      }
    } catch (e) {
      setUpdateState('检查失败');
      setSetting(
        'last_update_check',
        `${stamp()} 检查失败：${e instanceof Error ? e.message : '网络异常'}`,
      );
    }
    setDiag(buildDiag(form, services.length));
  }

  async function shareDiag() {
    const text = ['【灵感桶诊断信息】', ...diag.map(([k, v]) => `${k}：${v}`)].join('\n');
    try {
      await Share.share({ message: text });
    } catch {
      // 用户取消分享，忽略
    }
  }

  const isCloud = form.transcribeMode === 'cloud';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>转写模式</Text>
      <View style={styles.modeRow}>
        {(
          [
            { key: 'system', label: '系统识别（免配置）' },
            { key: 'cloud', label: '云端 API' },
          ] as const
        ).map((m) => (
          <Pressable
            key={m.key}
            style={[styles.modeChip, form.transcribeMode === m.key && styles.modeChipActive]}
            onPress={() => setForm({ ...form, transcribeMode: m.key })}
          >
            <Text
              style={[
                styles.modeChipText,
                form.transcribeMode === m.key && styles.modeChipTextActive,
              ]}
            >
              {m.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.note}>
        系统识别：调用手机自带的语音识别服务，无需配置任何 Key，装好就能用（国产机自带中文引擎）。
        识别不了时，或想要更稳定的效果，再配下面的云端 API。
      </Text>

      {!isCloud && (
        <View>
          <Text style={styles.sectionTitle}>识别服务</Text>
          {services.length === 0 ? (
            <Text style={styles.note}>未发现可用的识别服务，请改用「云端 API」模式。</Text>
          ) : (
            <View style={styles.modeRowWrap}>
              {['', ...services].map((pkg) => (
                <Pressable
                  key={pkg || 'default'}
                  style={[
                    styles.modeChip,
                    form.speechServicePackage === pkg && styles.modeChipActive,
                  ]}
                  onPress={() => setForm({ ...form, speechServicePackage: pkg })}
                >
                  <Text
                    style={[
                      styles.modeChipText,
                      form.speechServicePackage === pkg && styles.modeChipTextActive,
                    ]}
                  >
                    {pkg === '' ? '系统默认' : pkg.split('.').pop()}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          <Text style={styles.note}>
            识别报"网络错误"时换一个服务试试：国内手机选国产厂商的服务（讯飞/小米/华为等）通常能走通，Google
            的服务在国内网络不可用。选完记得点保存。
          </Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>{isCloud ? 'AI 服务' : 'AI 服务（可选）'}</Text>
      <Text style={styles.note}>
        {isCloud
          ? '云端转写和 AI 讨论都用这组配置；Key 仅保存在本机数据库。国内推荐硅基流动（siliconflow.cn，免费额度）：地址填 https://api.siliconflow.cn/v1，转写模型以控制台为准（如 FunAudioLLM/SenseVoiceSmall）；海外可选 Groq 或 OpenAI。'
          : '系统识别已够用，这里不用配。想体验「AI 讨论」（对灵感展开/追问/对话）时再配：国内推荐硅基流动（siliconflow.cn，有免费模型）。'}
      </Text>
      {FIELDS.filter((f) => isCloud || !f.cloudOnly).map((f) => (
        <View key={f.key} style={styles.field}>
          <Text style={styles.label}>{f.label}</Text>
          <TextInput
            style={styles.input}
            value={form[f.key]}
            placeholder={f.placeholder}
            placeholderTextColor={colors.textDim}
            secureTextEntry={f.secure}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(v) => setForm({ ...form, [f.key]: v })}
          />
        </View>
      ))}
      <Pressable style={styles.saveButton} onPress={save}>
        <Text style={styles.saveButtonText}>{saved ? '已保存 ✓' : '保存'}</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>数据</Text>
      <Pressable style={styles.row} onPress={() => router.push('/recycle-bin')}>
        <Text style={styles.rowText}>🗑 回收站（{binCount}）</Text>
        <Text style={styles.rowArrow}>›</Text>
      </Pressable>
      <Text style={styles.note}>删除的灵感保留 30 天，到期自动彻底清除。灵感和音频均保存在本机。</Text>

      <Text style={styles.sectionTitle}>更新</Text>
      <Pressable style={styles.row} onPress={checkUpdate}>
        <Text style={styles.rowText}>🔄 检查更新{updateState ? `（${updateState}）` : ''}</Text>
        <Text style={styles.rowArrow}>›</Text>
      </Pressable>
      <Text style={styles.note}>
        当前版本 {Constants.expoConfig?.version ?? '未知'}。日常改进会通过云端推送，点这里即可拉取；
        涉及原生功能的升级才需要重新安装 APK。
      </Text>

      <Text style={styles.sectionTitle}>诊断信息</Text>
      <View style={styles.diagCard}>
        {diag.map(([k, v]) => (
          <View key={k} style={styles.diagRow}>
            <Text style={styles.diagKey}>{k}</Text>
            <Text style={styles.diagValue} selectable>
              {v}
            </Text>
          </View>
        ))}
      </View>
      <Pressable style={styles.saveButton} onPress={shareDiag}>
        <Text style={styles.saveButtonText}>📤 分享诊断信息</Text>
      </Pressable>
      <Text style={styles.note}>遇到任何异常：点上面按钮把诊断信息发给开发者（或直接截图本页），一次说清。</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 16, marginBottom: 6 },
  note: { fontSize: 13, color: colors.textDim, lineHeight: 19, marginBottom: 8 },
  field: { marginBottom: 12 },
  label: { fontSize: 13, color: colors.textDim, marginBottom: 6 },
  input: {
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
  },
  saveButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  saveButtonText: { color: '#1A1206', fontWeight: '700', fontSize: 15 },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  modeRowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  modeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: colors.card,
  },
  modeChipActive: { backgroundColor: colors.accent },
  modeChipText: { fontSize: 13, color: colors.textDim },
  modeChipTextActive: { color: '#1A1206', fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  rowText: { flex: 1, color: colors.text, fontSize: 15 },
  rowArrow: { color: colors.textDim, fontSize: 18 },
  diagCard: {
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    gap: 6,
  },
  diagRow: { flexDirection: 'row', gap: 10 },
  diagKey: { color: colors.textDim, fontSize: 13, width: 92 },
  diagValue: { color: colors.text, fontSize: 13, flex: 1 },
});
