// 投入后的异步流水线：转写 → 标题 → 关键词 → 连接检测。
// 设计原则：松手即入桶（音频已落盘），后续全部异步，失败只改状态不打扰用户。
// 连接检测分层：第 0 层本地关键词匹配（零成本）→ 第 2 层 LLM 终审（有 key 才跑，限量）。
import {
  getIdea,
  updateIdea,
  listIdeas,
  logEvent,
  updateIdeaKeywords,
  listIdeasMissingKeywords,
  addCandidate,
  listUnverdictedCandidates,
  setCandidateVerdict,
  dismissCandidate,
} from './db';
import { getAISettings, transcribeAudio, judgeConnection, extractKeywordsAI } from './ai';
import { transcribeOffline } from './offline-stt';
import { generateTitle, fallbackTitle, extractKeywords } from './title';

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
    logEvent(tag, `转写失败 ${id}: ${e instanceof Error ? e.message : String(e)}`, 'error');
    updateIdea(id, { transcribeState: 'failed', title: fallbackTitle(new Date(idea.createdAt)) });
    return;
  }
  // 转写成功后：提取关键词并做连接检测（均不阻塞入桶）
  try {
    await extractAndDetect(id);
  } catch (e) {
    logEvent('connect', `连接检测异常 ${id}: ${e instanceof Error ? e.message : String(e)}`, 'warn');
  }
}

// ---- AI 自动连接 ----

/** 关键词重合度阈值：约 1/3 重合才进入候选（第 0 层，宽进严出） */
const JACCARD_THRESHOLD = 0.34;

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const inter = a.filter((w) => setB.has(w)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

/** 提取关键词入库，并对全桶做第 0 层匹配 + 触发终审。
 *  关键词优先用第三方 API（语义更准），没配 key 或请求失败回退本地词频算法。 */
export async function extractAndDetect(id: string): Promise<void> {
  const idea = getIdea(id);
  if (!idea?.transcript) return;
  const settings = getAISettings();
  let keywords: string[] = [];
  if (settings.apiKey) {
    try {
      keywords = await extractKeywordsAI(idea.title, idea.transcript, settings);
      logEvent('connect', `AI 关键词 ${keywords.length} 个（${id.slice(-4)}）`);
    } catch (e) {
      logEvent(
        'connect',
        `AI 关键词失败回退本地算法: ${e instanceof Error ? e.message : String(e)}`,
        'warn',
      );
    }
  }
  if (keywords.length === 0) keywords = extractKeywords(idea.transcript, 8);
  updateIdeaKeywords(id, keywords);
  if (keywords.length === 0) return;

  const others = listIdeas().filter((i) => i.id !== id && i.keywords.length > 0);
  let found = 0;
  for (const other of others) {
    const score = jaccard(keywords, other.keywords);
    if (score >= JACCARD_THRESHOLD) {
      addCandidate(id, other.id, score);
      found += 1;
    }
  }
  if (found > 0) logEvent('connect', `第 0 层发现 ${found} 个候选（${id.slice(-4)}）`);
  await judgePendingBatch(5, id);
}

/** LLM 终审批次：没配 key 直接跳过；一次最多判 limit 对，控成本 */
export async function judgePendingBatch(limit = 5, forIdeaId?: string): Promise<void> {
  const settings = getAISettings();
  if (!settings.apiKey) return;
  const pending = listUnverdictedCandidates(limit, forIdeaId);
  for (const c of pending) {
    const ia = getIdea(c.a);
    const ib = getIdea(c.b);
    if (!ia || !ib) {
      dismissCandidate(c.a, c.b);
      continue;
    }
    try {
      const v = await judgeConnection(
        { title: ia.title, transcript: ia.transcript },
        { title: ib.title, transcript: ib.transcript },
        settings,
      );
      setCandidateVerdict(c.a, c.b, v.relation, v.reason);
      logEvent('connect', `终审 ${ia.id.slice(-4)}×${ib.id.slice(-4)} → ${v.relation}`);
    } catch (e) {
      logEvent('connect', `终审失败: ${e instanceof Error ? e.message : String(e)}`, 'error');
      break; // API 异常时停止本批，下次再续
    }
  }
}

/** 冷启动回填：给老灵感补关键词并做第 0 层匹配（没配 key 时终审自动跳过） */
export async function backfillKeywordsAndDetect(): Promise<void> {
  const missing = listIdeasMissingKeywords();
  if (missing.length > 0) {
    for (const row of missing) {
      const kw = extractKeywords(row.transcript, 8);
      if (kw.length > 0) updateIdeaKeywords(row.id, kw);
    }
    logEvent('connect', `回填关键词 ${missing.length} 条`);
    for (const row of missing) {
      const idea = getIdea(row.id);
      if (!idea || idea.keywords.length === 0) continue;
      const others = listIdeas().filter((i) => i.id !== row.id && i.keywords.length > 0);
      for (const other of others) {
        const score = jaccard(idea.keywords, other.keywords);
        if (score >= JACCARD_THRESHOLD) addCandidate(row.id, other.id, score);
      }
    }
  }
  await judgePendingBatch(3);
}
