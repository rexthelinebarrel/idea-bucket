// AI 模块：转写（Whisper 兼容接口）+ 灵感展开/追问 + 讨论对话。
// 全部走 OpenAI 兼容 API（baseUrl / key / 模型名在设置页可配），
// 因此 OpenAI、Groq、硅基流动等任何兼容服务都能接入。
import { getSetting, setSetting } from './db';

export interface AISettings {
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  transcribeModel: string;
  /** offline = 内置离线引擎（sherpa-onnx）；system = 手机系统识别；cloud = OpenAI 兼容转写接口 */
  transcribeMode: 'offline' | 'system' | 'cloud';
  /** Android 识别服务包名，空串 = 系统默认服务。识别报网络错误时可换国产厂商服务 */
  speechServicePackage: string;
}

const DEFAULT_SETTINGS: AISettings = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  chatModel: 'gpt-4o-mini',
  transcribeModel: 'whisper-1',
  transcribeMode: 'offline',
  speechServicePackage: '',
};

const SETTINGS_KEY = 'ai_settings';

export function getAISettings(): AISettings {
  try {
    const raw = getSetting(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AISettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveAISettings(s: AISettings): void {
  setSetting(SETTINGS_KEY, JSON.stringify(s));
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

function timeoutSignal(ms: number): AbortSignal {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

/** 语音转写：上传音频到 Whisper 兼容接口，返回文本。失败抛错（由调用方兜底）。 */
export async function transcribeAudio(audioUri: string, settings: AISettings): Promise<string> {
  if (!settings.apiKey) throw new Error('请先在「设置」中填写 API Key');
  const form = new FormData();
  // React Native 的 FormData 支持 { uri, name, type } 形式的文件上传
  form.append('file', { uri: audioUri, name: 'audio.m4a', type: 'audio/m4a' } as unknown as Blob);
  form.append('model', settings.transcribeModel);
  form.append('response_format', 'json');

  const res = await fetch(endpoint(settings.baseUrl, '/audio/transcriptions'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.apiKey}` },
    body: form,
    signal: timeoutSignal(120_000),
  });
  if (!res.ok) throw new Error(`转写请求失败（${res.status}）：${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (!data?.text) throw new Error('转写结果为空');
  return String(data.text).trim();
}

async function chatCompletions(
  settings: AISettings,
  messages: { role: string; content: string }[],
  maxTokens = 800,
): Promise<string> {
  if (!settings.apiKey) throw new Error('请先在「设置」中填写 API Key');
  const res = await fetch(endpoint(settings.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify({ model: settings.chatModel, messages, max_tokens: maxTokens, temperature: 0.7 }),
    signal: timeoutSignal(60_000),
  });
  if (!res.ok) throw new Error(`AI 请求失败（${res.status}）：${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI 返回为空');
  return String(content);
}

export interface IdeaAnalysis {
  summary: string;
  points: string[];
  questions: string[];
  expansions: string[];
}

/** AI 展开：对单条灵感做要点提炼 + 追问 + 展开方向。手动触发（不自动跑，省 token）。 */
export async function analyzeIdea(title: string, transcript: string, settings: AISettings): Promise<IdeaAnalysis> {
  const raw = await chatCompletions(settings, [
    {
      role: 'system',
      content:
        '你是用户的灵感搭档。针对用户语音记录的一条灵感，输出 JSON：' +
        '{"summary":"一句话总结","points":["核心要点，最多3条"],"questions":["能激发进一步思考的问题，最多3个"],"expansions":["可以展开的方向，最多2个"]}。' +
        '只输出 JSON 本身，不要输出其他内容。',
    },
    { role: 'user', content: `灵感标题：${title}\n灵感原文：${transcript}` },
  ], 1000);

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    return {
      summary: String(parsed.summary ?? ''),
      points: Array.isArray(parsed.points) ? parsed.points.map(String) : [],
      questions: Array.isArray(parsed.questions) ? parsed.questions.map(String) : [],
      expansions: Array.isArray(parsed.expansions) ? parsed.expansions.map(String) : [],
    };
  } catch {
    // 模型没按约定输出 JSON 时，把原文当总结展示，不丢内容
    return { summary: raw, points: [], questions: [], expansions: [] };
  }
}

/** 围绕一条灵感的多轮讨论（bounce ideas）。history 取最近若干轮控制 token。 */
export async function chatAboutIdea(
  idea: { title: string; transcript: string; aiAnalysis: string },
  history: { role: 'user' | 'assistant'; content: string }[],
  settings: AISettings,
): Promise<string> {
  const system = [
    '你是用户的灵感搭档，住在他的「灵感桶」App 里。你们正在围绕下面这条灵感讨论。',
    `灵感标题：${idea.title}`,
    `灵感原文：${idea.transcript || '（暂无转写）'}`,
    idea.aiAnalysis ? `此前的 AI 分析：${idea.aiAnalysis}` : '',
    '要求：用中文回复；像真正的搭档一样有观点、敢追问、给补充；每次回复控制在 200 字以内。',
  ]
    .filter(Boolean)
    .join('\n');
  return chatCompletions(settings, [{ role: 'system', content: system }, ...history.slice(-12)]);
}
