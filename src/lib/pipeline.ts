// 投入后的异步流水线：转写 → 生成标题。
// 设计原则：松手即入桶（音频已落盘），转写不阻塞投入；失败只改状态，详情页可重试。
// offline 模式走本地 sherpa-onnx 引擎；cloud 模式走 OpenAI 兼容接口；
// system 模式在录音时已实时出文字，不经过这里。
import { getIdea, updateIdea, logEvent } from './db';
import { getAISettings, transcribeAudio } from './ai';
import { transcribeOffline } from './offline-stt';
import { generateTitle, fallbackTitle } from './title';

export async function processIdea(id: string): Promise<void> {
  const idea = getIdea(id);
  if (!idea || !idea.audioUri) return;
  const mode = getAISettings().transcribeMode;
  const tag = mode === 'offline' ? 'stt' : 'transcribe';
  try {
    logEvent(tag, `开始转写 ${id}（${mode}）`);
    const text =
      mode === 'offline'
        ? await transcribeOffline(idea.audioUri)
        : await transcribeAudio(idea.audioUri, getAISettings());
    if (!text) throw new Error('转写结果为空');
    logEvent(tag, `转写成功 ${id}（${text.length} 字）`);
    updateIdea(id, {
      transcript: text,
      title: generateTitle(text, new Date(idea.createdAt)),
      transcribeState: 'ok',
    });
  } catch (e) {
    // 转写失败不打扰用户：标题退化为兜底格式，状态标记 failed 供详情页重试
    logEvent(
      tag,
      `转写失败 ${id}: ${e instanceof Error ? e.message : String(e)}`,
      'error',
    );
    updateIdea(id, { transcribeState: 'failed', title: fallbackTitle(new Date(idea.createdAt)) });
  }
}
