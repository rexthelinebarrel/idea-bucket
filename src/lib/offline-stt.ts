// 离线 STT：sherpa-onnx 本地引擎（react-native-sherpa-onnx TurboModule）。
// 模型按需下载到 document/models/，识别全程不联网、不依赖系统识别服务和任何 API Key。
// 下载源优先 hf-mirror（国内可达），失败回退 huggingface。
//
// 两类引擎（模型结构不同，识别路径不能混用，否则报维度错误）：
// - streaming：流式 zipformer（encoder/decoder/joiner + tokens.txt），走 OnlineRecognizer 分块喂样本
// - offline：Qwen3-ASR（conv_frontend/encoder/decoder + tokenizer/），走 OfflineRecognizer 一次解码
import {
  createSTT,
  createStreamingSTT,
  type SttEngine,
  type StreamingSttEngine,
} from 'react-native-sherpa-onnx/stt';
import { decodeAudioFileToFloatSamples } from 'react-native-sherpa-onnx/audio';
import { File, Directory, Paths } from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';

import { getSetting, setSetting, logEvent } from './db';

export interface OfflineModel {
  id: string;
  label: string;
  desc: string;
  repo: string;
  /** name 可带子目录（如 tokenizer/vocab.json），bytes 仅用于进度显示 */
  files: { name: string; bytes: number }[];
  totalMB: number;
  engine: 'streaming' | 'offline';
}

export const OFFLINE_MODELS: OfflineModel[] = [
  {
    id: 'zipformer-zh-14m',
    label: '轻量版（22MB）',
    desc: '中文识别，下载快、占用小；夹杂英文术语时偏弱',
    repo: 'csukuangfj/sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23',
    files: [
      { name: 'encoder-epoch-99-avg-1.int8.onnx', bytes: 21621684 },
      { name: 'decoder-epoch-99-avg-1.int8.onnx', bytes: 1888682 },
      { name: 'joiner-epoch-99-avg-1.int8.onnx', bytes: 1795562 },
      { name: 'tokens.txt', bytes: 322 },
    ],
    totalMB: 22,
    engine: 'streaming',
  },
  {
    id: 'zipformer-bilingual-188m',
    label: '双语版（188MB）',
    desc: '中英文夹杂识别更好；体积大，建议 WiFi 下载',
    repo: 'csukuangfj/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20',
    files: [
      { name: 'encoder-epoch-99-avg-1.int8.onnx', bytes: 181895032 },
      { name: 'decoder-epoch-99-avg-1.int8.onnx', bytes: 13091040 },
      { name: 'joiner-epoch-99-avg-1.int8.onnx', bytes: 3228404 },
      { name: 'tokens.txt', bytes: 340 },
    ],
    totalMB: 188,
    engine: 'streaming',
  },
  {
    id: 'qwen3-asr-0.6b',
    label: 'Qwen3 高精度版（940MB）',
    desc: '阿里 Qwen3-ASR 0.6B：准确率最高，多语言、方言、中英文混合都强；体积大，务必 WiFi 下载，首次加载需十几秒',
    repo: 'csukuangfj2/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25',
    files: [
      { name: 'conv_frontend.onnx', bytes: 44148281 },
      { name: 'encoder.int8.onnx', bytes: 182491662 },
      { name: 'decoder.int8.onnx', bytes: 755914231 },
      { name: 'tokenizer/vocab.json', bytes: 2776833 },
      { name: 'tokenizer/merges.txt', bytes: 1671853 },
      { name: 'tokenizer/tokenizer_config.json', bytes: 12487 },
    ],
    totalMB: 940,
    engine: 'offline',
  },
];

const MIRRORS = ['https://hf-mirror.com', 'https://huggingface.co'];
const ACTIVE_KEY = 'offline_model_id';

export function getActiveModelId(): string {
  return getSetting(ACTIVE_KEY) ?? OFFLINE_MODELS[0].id;
}

export function setActiveModelId(id: string): void {
  setSetting(ACTIVE_KEY, id);
}

export function getModel(id: string): OfflineModel {
  return OFFLINE_MODELS.find((m) => m.id === id) ?? OFFLINE_MODELS[0];
}

function modelDir(id: string): Directory {
  return new Directory(Paths.document, 'models', id);
}

/** name 可能带子目录（tokenizer/vocab.json），拆开逐段拼接 */
function modelFile(dir: Directory, name: string): File {
  return new File(dir, ...name.split('/'));
}

function stripScheme(uri: string): string {
  return uri.replace(/^file:\/\//, '');
}

export type ModelState = 'ready' | 'partial' | 'missing';

export function getModelState(id: string): ModelState {
  const model = getModel(id);
  const dir = modelDir(id);
  let existing = 0;
  for (const f of model.files) {
    const file = modelFile(dir, f.name);
    if (file.exists && (file.size ?? 0) > 0) existing += 1;
  }
  if (existing === 0) return 'missing';
  return existing === model.files.length ? 'ready' : 'partial';
}

/** 单文件下载：可续传 + 断点续传一次。
 *  940MB 的 Qwen3 模型在慢网下必超时（File.downloadFileAsync 新 API 无续传），
 *  必须用 legacy 的 createDownloadResumable（APK 下载已验证过这条路）。 */
async function downloadOne(
  url: string,
  tmpUri: string,
  onBytes: (written: number) => void,
): Promise<string> {
  const task = FileSystemLegacy.createDownloadResumable(url, tmpUri, {}, (p) =>
    onBytes(p.totalBytesWritten),
  );
  try {
    const res = await task.downloadAsync();
    if (res && res.status === 200) return res.uri;
    throw new Error(`HTTP ${res?.status ?? '异常'}`);
  } catch (e) {
    // 网络中断时已下载的字节不浪费，断点续传再试一次
    try {
      const res = await task.resumeAsync();
      if (res && res.status === 200) return res.uri;
    } catch {
      // 落到外层换镜像
    }
    throw e;
  }
}

/** 下载模型全部文件（逐文件尝试多个镜像源）。onProgress(0~1)，字节级进度 */
export async function downloadModel(
  id: string,
  onProgress?: (progress: number) => void,
): Promise<void> {
  const model = getModel(id);
  const dir = modelDir(id);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });

  const total = model.files.reduce((s, f) => s + f.bytes, 0);
  let done = 0;
  for (const f of model.files) {
    const dest = modelFile(dir, f.name);
    if (dest.exists && (dest.size ?? 0) > 0) {
      done += f.bytes;
      onProgress?.(done / total);
      continue;
    }
    // 子目录（tokenizer/）先建出来
    if (f.name.includes('/')) {
      const parent = new Directory(dir, f.name.split('/')[0]);
      if (!parent.exists) parent.create({ intermediates: true, idempotent: true });
    }
    let ok = false;
    let lastErr: unknown = null;
    for (const mirror of MIRRORS) {
      const url = `${mirror}/${model.repo}/resolve/main/${f.name}`;
      try {
        logEvent('stt', `下载 ${f.name}（${mirror}）`);
        // 临时文件名不能含路径分隔符
        const tmpUri = `${FileSystemLegacy.cacheDirectory}${f.name.replace(/\//g, '_')}.tmp`;
        const tmpFile = new File(tmpUri);
        if (tmpFile.exists) tmpFile.delete();
        const uri = await downloadOne(url, tmpUri, (written) => {
          onProgress?.(Math.min((done + written) / total, 1));
        });
        const downloaded = new File(uri);
        if ((downloaded.size ?? 0) === 0) throw new Error('空文件');
        if (dest.exists) dest.delete();
        downloaded.move(dest);
        ok = true;
        break;
      } catch (e) {
        lastErr = e;
        logEvent('stt', `镜像失败 ${mirror}: ${e instanceof Error ? e.message : String(e)}`, 'warn');
      }
    }
    if (!ok) {
      throw new Error(
        `模型文件下载失败：${f.name}（${lastErr instanceof Error ? lastErr.message : '网络异常'}）`,
      );
    }
    done += f.bytes;
    onProgress?.(done / total);
  }
  logEvent('stt', `模型 ${id} 下载完成`);
}

export function deleteModel(id: string): void {
  try {
    const dir = modelDir(id);
    if (dir.exists) dir.delete();
  } catch {
    // 忽略
  }
}

// —— 引擎单例：模型加载耗时几秒到十几秒，加载一次常驻复用；同时只驻留一个引擎 ——
// 教训：流式模型不能用 OfflineRecognizer（报维度错），反之亦然，必须按 engine 字段分流。
let streamingEngine: StreamingSttEngine | null = null;
let offlineEngine: SttEngine | null = null;
let engineModelId: string | null = null;

async function destroyEngines(): Promise<void> {
  if (streamingEngine) {
    await streamingEngine.destroy().catch(() => {});
    streamingEngine = null;
  }
  if (offlineEngine) {
    await offlineEngine.destroy().catch(() => {});
    offlineEngine = null;
  }
  engineModelId = null;
}

async function ensureEngine(model: OfflineModel): Promise<void> {
  if (engineModelId === model.id && (streamingEngine || offlineEngine)) return;
  await destroyEngines();
  const path = stripScheme(modelDir(model.id).uri);
  logEvent('stt', `加载离线模型 ${model.id}`);
  if (model.engine === 'streaming') {
    streamingEngine = await createStreamingSTT({
      modelPath: { type: 'file', path },
      modelType: 'auto',
      numThreads: 2,
    });
  } else {
    // Qwen3-ASR：maxTotalLen/maxNewTokens 默认值（512/128）只够十几秒短音频，
    // 灵感录音动辄 1~2 分钟，放大上限防止长录音被截断
    offlineEngine = await createSTT({
      modelPath: { type: 'file', path },
      modelType: 'qwen3_asr',
      numThreads: 4,
      modelOptions: { qwen3Asr: { maxTotalLen: 4096, maxNewTokens: 512 } },
    });
  }
  engineModelId = model.id;
}

export async function transcribeOffline(audioUri: string): Promise<string> {
  const modelId = getActiveModelId();
  if (getModelState(modelId) !== 'ready') {
    throw new Error('离线模型未下载，请先到「设置」下载模型');
  }
  const model = getModel(modelId);
  await ensureEngine(model);

  const t0 = Date.now();
  const { samples } = await decodeAudioFileToFloatSamples(stripScheme(audioUri), 16000);

  // Qwen3-ASR：一次整体解码
  if (model.engine === 'offline') {
    if (!offlineEngine) throw new Error('离线引擎未就绪');
    const result = await offlineEngine.transcribeSamples(samples, 16000);
    logEvent('stt', `离线识别完成（${Date.now() - t0}ms，qwen3）`);
    return (result.text ?? '').trim();
  }

  // 流式 zipformer：分块喂入（每块约 1 秒），避免超大数组一次过桥
  if (!streamingEngine) throw new Error('离线引擎未就绪');
  const stream = await streamingEngine.createStream();
  try {
    const CHUNK = 16000;
    for (let i = 0; i < samples.length; i += CHUNK) {
      await stream.acceptWaveform(samples.slice(i, i + CHUNK), 16000);
    }
    await stream.inputFinished();
    // 收尾：把剩余可解码的音频全部解码，再取最终结果
    while (await stream.isReady()) {
      await stream.decode();
    }
    const result = await stream.getResult();
    logEvent('stt', `离线识别完成（${Date.now() - t0}ms）`);
    return (result.text ?? '').trim();
  } finally {
    await stream.release().catch(() => {});
  }
}
