// 设置：转写模式 / 识别服务 / AI 服务 / 数据 / 更新 / 诊断信息。
// 诊断信息卡片是排障入口：一屏装齐所有关键状态，一键分享，免去来回描述报错。
import { useCallback, useState } from 'react';
import {
  Alert,
  Linking,
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
import * as IntentLauncher from 'expo-intent-launcher';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { File, Paths } from 'expo-file-system';
import { getSpeechRecognitionServices } from '@jamsch/expo-speech-recognition';

import { colors } from '@/theme';
import { listDeletedIdeas, getSetting, setSetting, listLogs } from '@/lib/db';
import { getAISettings, saveAISettings, type AISettings } from '@/lib/ai';
import {
  OFFLINE_MODELS,
  downloadModel,
  getActiveModelId,
  setActiveModelId,
  getModelState,
  type ModelState,
} from '@/lib/offline-stt';
import { APP_VERSION } from '@/version';
import { fetchLatestRelease, hasNewerRelease, type ReleaseInfo } from '@/lib/release';

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
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [services, setServices] = useState<string[]>([]);
  const [diag, setDiag] = useState<[string, string][]>([]);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [activeId, setActiveId] = useState(() => getActiveModelId());
  const [modelStates, setModelStates] = useState<Record<string, ModelState>>({});
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number | null>>({});

  function buildDiag(s: AISettings, svcCount: number): [string, string][] {
    return [
      ['App 版本', APP_VERSION],
      ['运行时版本', Updates.runtimeVersion ?? '未知'],
      ['更新批次', Updates.updateId ? Updates.updateId.slice(0, 8) : '内嵌包（未应用过 OTA）'],
      ['更新通道', Updates.channel || '未知'],
      ['转写模式', s.transcribeMode === 'offline' ? '离线引擎' : s.transcribeMode === 'system' ? '系统识别' : '云端 API'],
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
      setLogLines(formatLogs(8));
      setActiveId(getActiveModelId());
      setModelStates(Object.fromEntries(OFFLINE_MODELS.map((m) => [m.id, getModelState(m.id)])));
    }, []),
  );

  function formatLogs(n: number): string[] {
    return listLogs(n).map((l) => {
      const t = new Date(l.ts);
      const p = (x: number) => String(x).padStart(2, '0');
      return `${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())} [${l.level}] ${l.tag} ${l.message}`;
    });
  }

  function save() {
    saveAISettings({ ...form, baseUrl: form.baseUrl.trim(), apiKey: form.apiKey.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  // 标准安卓更新流程：拉版本清单 → 下载 APK → 系统安装器确认（不做静默自更新）
  async function checkUpdate() {
    setUpdateState('检查中…');
    setRelease(null);
    const stamp = () => new Date().toLocaleString();
    try {
      const info = await fetchLatestRelease();
      if (hasNewerRelease(info)) {
        setRelease(info);
        setUpdateState(`发现新版本 ${info.version}`);
        setSetting('last_update_check', `${stamp()} 发现新版本 ${info.version}`);
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

  async function downloadAndInstall() {
    if (!release || downloading) return;
    setDownloading(true);
    setUpdateState('下载中…（包较大，请保持前台）');
    try {
      const dest = new File(Paths.cache, `idea-bucket-${release.version}.apk`);
      if (dest.exists) dest.delete();
      const apk = await File.downloadFileAsync(release.apkUrl, dest);
      if ((apk.size ?? 0) === 0) throw new Error('下载内容为空');
      setUpdateState('下载完成，调起安装…');
      const contentUri = await FileSystemLegacy.getContentUriAsync(apk.uri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        type: 'application/vnd.android.package-archive',
        // FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK，弹出系统安装确认
        flags: 1 | 268435456,
      });
      setUpdateState('请在系统弹窗中确认安装');
    } catch (e) {
      setUpdateState('下载/安装失败');
      Alert.alert('更新失败', e instanceof Error ? e.message : '网络异常，请稍后重试');
    } finally {
      setDownloading(false);
    }
  }

  async function startDownload(id: string) {
    setDownloadProgress((p) => ({ ...p, [id]: 0 }));
    try {
      await downloadModel(id, (prog) => setDownloadProgress((p) => ({ ...p, [id]: prog })));
      setModelStates(Object.fromEntries(OFFLINE_MODELS.map((m) => [m.id, getModelState(m.id)])));
      setActiveModelId(id);
      setActiveId(id);
      Alert.alert('下载完成', '离线模型已就绪，可以离线识别了。');
    } catch (e) {
      Alert.alert('下载失败', e instanceof Error ? e.message : '网络异常，请重试');
    } finally {
      setDownloadProgress((p) => ({ ...p, [id]: null }));
    }
  }

  async function shareDiag() {
    const text = ['【灵感桶诊断信息】', ...diag.map(([k, v]) => `${k}：${v}`)].join('\n');
    try {
      await Share.share({ message: text });
    } catch {
      // 用户取消分享，忽略
    }
  }

  function buildReport(): string {
    const body = [
      '## 问题描述',
      '（请在这里补充你遇到的现象）',
      '',
      '## 诊断信息',
      ...diag.map(([k, v]) => `- **${k}**：${v}`),
      '',
      '## 最近日志',
      '```',
      ...formatLogs(40).reverse(),
      '```',
    ].join('\n');
    return body.length > 5500 ? `${body.slice(0, 5500)}\n…（日志过长已截断）` : body;
  }

  // 一键上报：诊断 + 日志打包。国内手机访问不了 GitHub，
  // 所以提供「分享到微信/文件传输」和「GitHub issue」两条路。
  function reportBug() {
    Alert.alert('上报问题', '诊断信息和最近日志已打包好，选择上报方式：', [
      {
        text: '分享到微信/文件传输',
        onPress: () => {
          Share.share({ message: `【灵感桶问题上报】\n\n${buildReport()}` }).catch(() => {});
        },
      },
      {
        text: 'GitHub issue（需能访问）',
        onPress: () => {
          const url =
            'https://github.com/rexthelinebarrel/idea-bucket/issues/new' +
            `?title=${encodeURIComponent('[Bug] App 内上报')}&body=${encodeURIComponent(buildReport())}`;
          Linking.openURL(url).catch(() => {
            Alert.alert('无法打开浏览器', '可改用「分享到微信/文件传输」。');
          });
        },
      },
      { text: '取消', style: 'cancel' },
    ]);
  }

  const isCloud = form.transcribeMode === 'cloud';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>转写模式</Text>
      <View style={styles.modeRowWrap}>
        {(
          [
            { key: 'offline', label: '离线引擎（内置）' },
            { key: 'system', label: '系统识别' },
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
        {form.transcribeMode === 'offline'
          ? '离线引擎：内置 sherpa-onnx 本地模型，识别全程不联网、无需任何 Key；首次使用需下载一次模型。'
          : form.transcribeMode === 'system'
            ? '系统识别：调用手机自带的语音识别服务，免配置；识别不了时可换离线引擎或云端 API。'
            : '云端 API：OpenAI 兼容转写接口，需在下方配置；效果稳定但走网络。'}
      </Text>

      {form.transcribeMode === 'offline' && (
        <View>
          <Text style={styles.sectionTitle}>离线模型</Text>
          {OFFLINE_MODELS.map((m) => {
            const state = modelStates[m.id] ?? 'missing';
            const progress = downloadProgress[m.id];
            return (
              <Pressable
                key={m.id}
                style={[styles.modelCard, activeId === m.id && styles.modelCardActive]}
                onPress={() => {
                  setActiveModelId(m.id);
                  setActiveId(m.id);
                }}
              >
                <View style={styles.modelMain}>
                  <Text style={styles.modelLabel}>
                    {m.label}
                    {activeId === m.id ? ' ✓' : ''}
                  </Text>
                  <Text style={styles.modelDesc}>{m.desc}</Text>
                  <Text style={styles.modelState}>
                    {state === 'ready' ? '已下载' : state === 'partial' ? '下载不完整' : '未下载'}
                  </Text>
                </View>
                {state !== 'ready' &&
                  (progress != null ? (
                    <Text style={styles.dlProgress}>{Math.round(progress * 100)}%</Text>
                  ) : (
                    <Pressable
                      style={styles.dlButton}
                      onPress={() => startDownload(m.id)}
                      disabled={Object.values(downloadProgress).some((v) => v != null)}
                    >
                      <Text style={styles.dlButtonText}>下载</Text>
                    </Pressable>
                  ))}
              </Pressable>
            );
          })}
          <Text style={styles.note}>模型只下载一次，之后识别全程离线；首次加载模型需几秒钟。</Text>
        </View>
      )}

      {form.transcribeMode === 'system' && (
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
      {release && (
        <View style={styles.diagCard}>
          <Text style={styles.releaseTitle}>新版本 {release.version}</Text>
          {!!release.notes && <Text style={styles.note}>{release.notes}</Text>}
          <Pressable
            style={styles.saveButton}
            onPress={downloadAndInstall}
            disabled={downloading}
          >
            <Text style={styles.saveButtonText}>
              {downloading ? '下载中…' : '下载并安装'}
            </Text>
          </Pressable>
        </View>
      )}
      <Text style={styles.note}>
        当前版本 {APP_VERSION}。更新走标准安卓流程：下载安装包 → 系统弹窗确认 → 完成安装，App
        不会自动重启替换。
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
      <Pressable style={styles.saveButton} onPress={reportBug}>
        <Text style={styles.saveButtonText}>🐞 上报问题（带日志）</Text>
      </Pressable>
      <Text style={styles.note}>
        点了会让你选上报方式：国内手机选「分享到微信/文件传输」，转到电脑发给开发者即可；
        能访问 GitHub 的可以直接提 issue。日志只含事件与错误，不含灵感内容和 Key。
      </Text>
      {logLines.length > 0 && (
        <View style={styles.diagCard}>
          <Text style={styles.diagTitle}>最近日志</Text>
          {logLines.map((line, i) => (
            <Text key={i} style={styles.logLine} selectable>
              {line}
            </Text>
          ))}
        </View>
      )}
      <Pressable style={styles.shareButton} onPress={shareDiag}>
        <Text style={styles.shareButtonText}>📤 分享诊断信息</Text>
      </Pressable>
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
  diagTitle: { color: colors.textDim, fontSize: 13, fontWeight: '600', marginBottom: 2 },
  logLine: { color: colors.text, fontSize: 11, lineHeight: 16, fontFamily: 'monospace' },
  shareButton: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  shareButtonText: { color: colors.accent, fontWeight: '600', fontSize: 14 },
  modelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  modelCardActive: { borderColor: colors.accent },
  modelMain: { flex: 1 },
  modelLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  modelDesc: { color: colors.textDim, fontSize: 12, marginTop: 2, lineHeight: 17 },
  modelState: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  dlButton: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  dlButtonText: { color: '#1A1206', fontWeight: '600', fontSize: 13 },
  dlProgress: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  releaseTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
});
