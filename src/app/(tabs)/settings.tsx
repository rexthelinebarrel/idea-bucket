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
import { getSpeechRecognitionServices } from '@jamsch/expo-speech-recognition';

import { colors, radius } from '@/theme';
import { listDeletedIdeas, getSetting, setSetting, listLogs, logEvent } from '@/lib/db';
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

// 常用服务商预设：一键填入地址和推荐模型，Key 仍需自己填。
// chatModel 用于 AI 讨论/关键词提取/连接终审；transcribeModel 仅云端转写模式用。
const PROVIDERS: {
  key: string;
  label: string;
  baseUrl: string;
  chatModel: string;
  transcribeModel?: string; // 缺省 = 这家没有转写服务，保持原值
  hint: string;
}[] = [
  {
    key: 'siliconflow',
    label: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    chatModel: 'deepseek-ai/DeepSeek-V3',
    transcribeModel: 'FunAudioLLM/SenseVoiceSmall',
    hint: '国内直连，有免费额度，转写+对话都全',
  },
  {
    key: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    chatModel: 'deepseek-chat',
    hint: '国内直连，便宜；没有转写服务（转写请用离线引擎或硅基流动）',
  },
  {
    key: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    chatModel: 'llama-3.3-70b-versatile',
    transcribeModel: 'whisper-large-v3-turbo',
    hint: '海外，速度极快，有免费额度',
  },
  {
    key: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    chatModel: 'gpt-4o-mini',
    transcribeModel: 'whisper-1',
    hint: '海外，官方接口',
  },
];

export default function SettingsScreen() {
  const [form, setForm] = useState<AISettings>(() => getAISettings());
  const [saved, setSaved] = useState(false);
  const [binCount, setBinCount] = useState(0);
  const [updateState, setUpdateState] = useState('');
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [apkProgress, setApkProgress] = useState<number | null>(null);
  const [services, setServices] = useState<string[]>([]);
  const [diag, setDiag] = useState<[string, string][]>([]);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [activeId, setActiveId] = useState(() => getActiveModelId());
  const [modelStates, setModelStates] = useState<Record<string, ModelState>>({});
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number | null>>({});
  const [providerHint, setProviderHint] = useState('');
  const [testState, setTestState] = useState<'' | 'testing' | 'ok' | 'fail'>('');
  const [testMsg, setTestMsg] = useState('');

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

  // 连接测试：真实发一笔最小 chat 请求（max_tokens=1），一次验通 地址+Key+模型 三项。
  // 成功绿色带延迟，失败红色带 HTTP 状态码或网络错误原因。
  async function testConnection() {
    const baseUrl = form.baseUrl.trim().replace(/\/+$/, '');
    if (!baseUrl) {
      setTestState('fail');
      setTestMsg('✗ 请先填 API 地址');
      return;
    }
    if (!form.apiKey.trim()) {
      setTestState('fail');
      setTestMsg('✗ 请先填 API Key');
      return;
    }
    setTestState('testing');
    setTestMsg('测试中…');
    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${form.apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: form.chatModel.trim() || 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
        signal: ctrl.signal,
      });
      const ms = Date.now() - t0;
      if (res.ok) {
        setTestState('ok');
        setTestMsg(`✓ 连接成功（HTTP ${res.status}，${ms}ms）`);
        logEvent('ai', `连接测试成功（${ms}ms）`);
      } else {
        const body = (await res.text()).slice(0, 120);
        setTestState('fail');
        setTestMsg(`✗ 失败（HTTP ${res.status}）：${body}`);
        logEvent('ai', `连接测试失败 HTTP ${res.status}`, 'warn');
      }
    } catch (e) {
      const err = e as Error;
      setTestState('fail');
      setTestMsg(
        err.name === 'AbortError'
          ? '✗ 失败（超时）：15 秒无响应，地址可能不通'
          : `✗ 失败（网络错误）：${err.message}`,
      );
      logEvent('ai', `连接测试网络错误: ${err.message}`, 'warn');
    } finally {
      clearTimeout(timer);
    }
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
    setApkProgress(0);
    setUpdateState('下载中…（包较大，慢网需几分钟）');
    const destUri = `${FileSystemLegacy.cacheDirectory}idea-bucket-${release.version}.apk`;
    try {
      let resultUri: string | null = null;
      // 慢网容错：可续传下载 + 失败自动重试一次
      for (let attempt = 1; attempt <= 2 && !resultUri; attempt++) {
        try {
          const task = FileSystemLegacy.createDownloadResumable(
            release.apkUrl,
            destUri,
            {},
            (p) => {
              if (p.totalBytesExpectedToWrite > 0) {
                setApkProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite);
              }
            },
          );
          const result = await task.downloadAsync();
          if (result?.uri) resultUri = result.uri;
        } catch (e) {
          logEvent(
            'update',
            `APK 下载第 ${attempt} 次失败: ${e instanceof Error ? e.message : String(e)}`,
            'warn',
          );
          if (attempt === 2) throw e;
        }
      }
      setUpdateState('下载完成，调起安装…');
      const contentUri = await FileSystemLegacy.getContentUriAsync(resultUri!);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        type: 'application/vnd.android.package-archive',
        // FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK，弹出系统安装确认
        flags: 1 | 268435456,
      });
      setUpdateState('请在系统弹窗中确认安装');
    } catch (e) {
      setUpdateState('下载失败');
      Alert.alert(
        '下载失败',
        '应用内下载被网络中断（安装包较大）。可重试，或改用浏览器下载——系统下载管理器支持断点续传，慢网更稳。',
        [
          { text: '重试', onPress: () => downloadAndInstall() },
          {
            text: '用浏览器下载',
            onPress: () => Linking.openURL(release.apkUrl).catch(() => {}),
          },
          { text: '取消', style: 'cancel' },
        ],
      );
    } finally {
      setDownloading(false);
      setApkProgress(null);
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
          <Text style={styles.note}>
            模型只下载一次，之后识别全程离线。追求准确率选 Qwen3 高精度版（体积大，建议 WiFi
            下载）；追求轻巧选轻量版。
          </Text>
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
          ? '云端转写和 AI 讨论都用这组配置；Key 仅保存在本机数据库。'
          : '配上后解锁：AI 讨论、AI 关键词提取、灵感智能关联。Key 仅保存在本机数据库。'}
      </Text>
      <View style={styles.modeRowWrap}>
        {PROVIDERS.map((p) => (
          <Pressable
            key={p.key}
            style={styles.modeChip}
            onPress={() => {
              setForm({
                ...form,
                baseUrl: p.baseUrl,
                chatModel: p.chatModel,
                ...(p.transcribeModel ? { transcribeModel: p.transcribeModel } : {}),
              });
              setProviderHint(`${p.label}：${p.hint}`);
            }}
          >
            <Text style={styles.modeChipText}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
      {!!providerHint && <Text style={styles.note}>{providerHint}（已填入地址和模型，Key 自己填，记得点保存）</Text>}
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
      <Pressable
        style={styles.testButton}
        onPress={testConnection}
        disabled={testState === 'testing'}
      >
        <Text style={styles.testButtonText}>
          {testState === 'testing' ? '测试中…' : '🔌 测试连接'}
        </Text>
      </Pressable>
      {!!testMsg && (
        <Text
          style={[
            styles.testResult,
            testState === 'ok' && styles.testOk,
            testState === 'fail' && styles.testFail,
          ]}
          selectable
        >
          {testMsg}
        </Text>
      )}

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
              {downloading
                ? apkProgress != null
                  ? `下载中 ${Math.round(apkProgress * 100)}%`
                  : '下载中…'
                : '下载并安装'}
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
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: 2,
    marginTop: 24,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    paddingLeft: 10,
  },
  note: { fontSize: 13, color: colors.textDim, lineHeight: 20, marginBottom: 8 },
  field: { marginBottom: 12 },
  label: { fontSize: 13, color: colors.textDim, marginBottom: 6 },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: colors.text,
    fontSize: 15,
  },
  saveButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 6,
  },
  saveButtonText: { color: colors.onAccent, fontWeight: '700', fontSize: 15, letterSpacing: 1 },
  testButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: 8,
  },
  testButtonText: { color: colors.primary, fontWeight: '600', fontSize: 14 },
  testResult: { fontSize: 13, lineHeight: 19, marginTop: 8 },
  testOk: { color: '#3EBD6E' },
  testFail: { color: colors.danger },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  modeRowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  modeChip: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  modeChipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  modeChipText: { fontSize: 13, color: colors.textDim },
  modeChipTextActive: { color: colors.accent, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 14,
    marginBottom: 8,
  },
  rowText: { flex: 1, color: colors.text, fontSize: 15 },
  rowArrow: { color: colors.textDim, fontSize: 18 },
  diagCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 14,
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
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  shareButtonText: { color: colors.accent, fontWeight: '600', fontSize: 14 },
  modelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 14,
    marginBottom: 8,
    gap: 10,
  },
  modelCardActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  modelMain: { flex: 1 },
  modelLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  modelDesc: { color: colors.textDim, fontSize: 12, marginTop: 3, lineHeight: 17 },
  modelState: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  dlButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  dlButtonText: { color: colors.onAccent, fontWeight: '700', fontSize: 13 },
  dlProgress: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  releaseTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
});
