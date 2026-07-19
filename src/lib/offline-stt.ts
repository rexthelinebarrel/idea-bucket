// 离线 STT：sherpa-onnx 本地引擎（react-native-sherpa-onnx TurboModule）。
// 模型按需下载到 document/models/，识别全程不联网、不依赖系统识别服务和任何 API Key。
// 下载源优先 hf-mirror（国内可达），失败回退 huggingface。
import { createSTT, type SttEngine } from 'react-native-sherpa-onnx/stt';
import { File, Directory, Paths } from 'expo-file-system';

import { getSetting, setSetting, logEvent } from './db';

export interface OfflineModel {
  id: string;
  label: string;
  desc: string;
  repo: string;
  files: { name: string; bytes: number }[];
  totalMB: number;
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

function stripScheme(uri: string): string {
  return uri.replace(/^file:\/\//, '');
}

export type ModelState = 'ready' | 'partial' | 'missing';

export function getModelState(id: string): ModelState {
  const model = getModel(id);
  const dir = modelDir(id);
  let existing = 0;
  for (const f of model.files) {
    const file = new File(dir, f.name);
    if (file.exists && (file.size ?? 0) > 0) existing += 1;
  }
  if (existing === 0) return 'missing';
  return existing === model.files.length ? 'ready' : 'partial';
}

/** 下载模型全部文件（逐文件尝试多个镜像源）。onProgress(0~1) */
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
    const dest = new File(dir, f.name);
    if (dest.exists && (dest.size ?? 0) > 0) {
      done += f.bytes;
      onProgress?.(done / total);
      continue;
    }
    let ok = false;
    let lastErr: unknown = null;
    for (const mirror of MIRRORS) {
      const url = `${mirror}/${model.repo}/resolve/main/${f.name}`;
      try {
        logEvent('stt', `下载 ${f.name}（${mirror}）`);
        const tmp = new File(Paths.cache, `${f.name}.tmp`);
        if (tmp.exists) tmp.delete();
        const result = await File.downloadFileAsync(url, tmp);
        if ((result.size ?? 0) === 0) throw new Error('空文件');
        if (dest.exists) dest.delete();
        result.move(dest);
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

// —— 引擎单例：模型加载耗时几秒，加载一次常驻复用 ——
let engine: SttEngine | null = null;
let engineModelId: string | null = null;

export async function transcribeOffline(audioUri: string): Promise<string> {
  const modelId = getActiveModelId();
  if (getModelState(modelId) !== 'ready') {
    throw new Error('离线模型未下载，请先到「设置」下载模型');
  }
  if (!engine || engineModelId !== modelId) {
    if (engine) {
      await engine.destroy().catch(() => {});
      engine = null;
    }
    const path = stripScheme(modelDir(modelId).uri);
    logEvent('stt', `加载离线模型 ${modelId}`);
    engine = await createSTT({
      modelPath: { type: 'file', path },
      modelType: 'auto',
      preferInt8: true,
    });
    engineModelId = modelId;
  }
  const t0 = Date.now();
  const result = await engine.transcribeFile(stripScheme(audioUri));
  logEvent('stt', `离线识别完成（${Date.now() - t0}ms）`);
  return (result.text ?? '').trim();
}
