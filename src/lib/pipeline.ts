// 投入后的异步流水线：转写 → 标题 → 关键词 → 连接检测。
// 设计原则：松手即入桶（音频已落盘），后续全部异步，失败只改状态不打扰用户。
// 连接检测分层：第 0 层关键词倒排索引匹配（零成本）→ 第 2 层 LLM 终审（有 key 才跑，限量）。
// 规模设计（用户拍板）：不做两两全遍历——倒排索引只跟共享关键词的灵感比，零重合整批跳过；
// 每条灵感候选 Top-K 截断；已连接的不重复建议；「AI 整理」每次限 20 条提取 + 10 对终审。
import {
  getIdea,
  updateIdea,
  listIdeas,
  logEvent,
  updateIdeaKeywords,
  listIdeasMissingKeywords,
  listIdeasForAiUpgrade,
  addCandidate,
  listUnverdictedCandidates,
  setCandidateVerdict,
  dismissCandidate,
  dismissStaleCandidates,
  listAllConnections,
  type Idea,
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

/** 关键词重合度阈值：约 1/3 重合才进入候选（第 0 层，宽进严出，终审兜底） */
const JACCARD_THRESHOLD = 0.34;
/** 每条灵感最多保留的候选数：防枢纽灵感刷屏，也控制终审总量 */
const TOP_K_CANDIDATES = 5;

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const inter = a.filter((w) => setB.has(w)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

interface MatchIndex {
  byId: Map<string, Idea>;
  keywordToIds: Map<string, Set<string>>;
  connected: Set<string>;
}

function pairKey(x: string, y: string): string {
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}

/** 建匹配索引：关键词 → 灵感集合（倒排），外加已连接对集合。千条规模也只是内存里几张 Map */
function buildIndex(ideas: Idea[]): MatchIndex {
  const byId = new Map<string, Idea>();
  const keywordToIds = new Map<string, Set<string>>();
  for (const idea of ideas) {
    if (idea.keywords.length === 0) continue;
    byId.set(idea.id, idea);
    for (const kw of idea.keywords) {
      let set = keywordToIds.get(kw);
      if (!set) {
        set = new Set();
        keywordToIds.set(kw, set);
      }
      set.add(idea.id);
    }
  }
  const connected = new Set<string>();
  for (const c of listAllConnections()) connected.add(pairKey(c.a, c.b));
  return { byId, keywordToIds, connected };
}

/** 给一条灵感找候选：倒排索引取共享关键词的对手 → Jaccard 过阈值 → 分数 Top-K。返回新增候选数 */
function detectWithIndex(id: string, index: MatchIndex): number {
  const idea = index.byId.get(id);
  if (!idea || idea.keywords.length === 0) return 0;
  // 共享任一关键词的对手（零重合的整批跳过，这是抗规模的关键）
  const rivalIds = new Set<string>();
  for (const kw of idea.keywords) {
    for (const otherId of index.keywordToIds.get(kw) ?? []) {
      if (otherId !== id && !index.connected.has(pairKey(id, otherId))) rivalIds.add(otherId);
    }
  }
  const scored: { otherId: string; score: number }[] = [];
  for (const otherId of rivalIds) {
    const other = index.byId.get(otherId);
    if (!other) continue;
    const score = jaccard(idea.keywords, other.keywords);
    if (score >= JACCARD_THRESHOLD) scored.push({ otherId, score });
  }
  scored.sort((x, y) => y.score - x.score);
  const top = scored.slice(0, TOP_K_CANDIDATES);
  for (const s of top) addCandidate(id, s.otherId, s.score);
  return top.length;
}

function buildIndexForBucket(): MatchIndex {
  return buildIndex(listIdeas().filter((i) => i.keywords.length > 0));
}

/** 提取关键词入库，并对全桶做第 0 层匹配 + 触发终审。
 *  关键词优先用第三方 API（语义更准），没配 key 或请求失败回退本地词频算法。 */
export async function extractAndDetect(id: string): Promise<void> {
  const idea = getIdea(id);
  if (!idea?.transcript) return;
  const settings = getAISettings();
  let keywords: string[] = [];
  let source: 'ai' | 'local' = 'local';
  if (settings.apiKey) {
    try {
      keywords = await extractKeywordsAI(idea.title, idea.transcript, settings);
      source = 'ai';
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
  updateIdeaKeywords(id, keywords, source);
  if (keywords.length === 0) return;

  const found = detectWithIndex(id, buildIndexForBucket());
  if (found > 0) logEvent('connect', `第 0 层发现 ${found} 个候选（${id.slice(-4)}）`);
  await judgePendingBatch(5, id);
}

/** LLM 终审批次：没配 key 直接跳过；一次最多判 limit 对，控成本。返回实际判定数 */
export async function judgePendingBatch(limit = 5, forIdeaId?: string): Promise<number> {
  const settings = getAISettings();
  if (!settings.apiKey) return 0;
  const pending = listUnverdictedCandidates(limit, forIdeaId);
  let judged = 0;
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
      judged += 1;
      logEvent('connect', `终审 ${ia.id.slice(-4)}×${ib.id.slice(-4)} → ${v.relation}`);
    } catch (e) {
      logEvent('connect', `终审失败: ${e instanceof Error ? e.message : String(e)}`, 'error');
      break; // API 异常时停止本批，下次再续
    }
  }
  return judged;
}

/** 冷启动回填：给老灵感补关键词并做第 0 层匹配（没配 key 时终审自动跳过） */
export async function backfillKeywordsAndDetect(): Promise<void> {
  const missing = listIdeasMissingKeywords();
  if (missing.length > 0) {
    for (const row of missing) {
      const kw = extractKeywords(row.transcript, 8);
      if (kw.length > 0) updateIdeaKeywords(row.id, kw, 'local');
    }
    logEvent('connect', `回填关键词 ${missing.length} 条`);
    const index = buildIndexForBucket();
    for (const row of missing) detectWithIndex(row.id, index);
  }
  await judgePendingBatch(3);
}

// ---- 「AI 整理」按钮：批量升级关键词 + 重算候选 + 限量终审 + 清陈旧候选 ----

export interface OrganizeStats {
  /** 本次 AI 提取/升级关键词的灵感数 */
  extracted: number;
  /** 本次新增候选对数 */
  candidates: number;
  /** 本次 LLM 终审判定数 */
  judged: number;
  /** 本次清理的 30 天陈旧候选数 */
  pruned: number;
}

/**
 * 一键 AI 整理。成本护栏：每次最多提取 extractLimit 条、终审 judgeLimit 对。
 * AI 提取失败的灵感保留本地关键词，不阻塞整批。
 */
export async function runAiOrganize(extractLimit = 20, judgeLimit = 10): Promise<OrganizeStats> {
  const settings = getAISettings();
  if (!settings.apiKey) {
    throw new Error('AI 整理需要 API Key：先到「设置」点一个服务商预设，填 Key 保存');
  }

  // ① 把本地关键词升级为 AI 关键词（新的在前，限量）
  const targets = listIdeasForAiUpgrade(extractLimit);
  let extracted = 0;
  const touched: string[] = [];
  for (const t of targets) {
    try {
      const kw = await extractKeywordsAI(t.title, t.transcript, settings);
      updateIdeaKeywords(t.id, kw, 'ai');
      extracted += 1;
      touched.push(t.id);
    } catch (e) {
      logEvent(
        'connect',
        `AI 关键词失败（${t.id.slice(-4)}）: ${e instanceof Error ? e.message : String(e)}`,
        'warn',
      );
    }
  }

  // ② 倒排索引只建一次，本次碰过的灵感逐条重算候选
  let candidates = 0;
  if (touched.length > 0) {
    const index = buildIndexForBucket();
    for (const id of touched) candidates += detectWithIndex(id, index);
  }

  // ③ 限量终审（没判完的留到下次，防手滑烧 token）
  const judged = await judgePendingBatch(judgeLimit);

  // ④ 清理 30 天无人理的旧候选
  const pruned = dismissStaleCandidates(30 * 24 * 3600_000);

  logEvent('connect', `AI 整理：提取 ${extracted} / 候选 ${candidates} / 终审 ${judged} / 清理 ${pruned}`);
  return { extracted, candidates, judged, pruned };
}
