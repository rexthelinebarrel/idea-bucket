// 投入后的异步流水线：转写 → 生成标题。
// 设计原则：松手即入桶（音频已落盘），转写不阻塞投入；失败只改状态，详情页可重试。
import { getIdea, updateIdea } from './db';
import { getAISettings, transcribeAudio } from './ai';
import { generateTitle, fallbackTitle } from './title';

export async function processIdea(id: string): Promise<void> {
  const idea = getIdea(id);
  if (!idea || !idea.audioUri) return;
  try {
    const text = await transcribeAudio(idea.audioUri, getAISettings());
    updateIdea(id, {
      transcript: text,
      title: generateTitle(text, new Date(idea.createdAt)),
      transcribeState: 'ok',
    });
  } catch {
    // 转写失败不打扰用户：标题退化为兜底格式，状态标记 failed 供详情页重试
    updateIdea(id, { transcribeState: 'failed', title: fallbackTitle(new Date(idea.createdAt)) });
  }
}
