// 数据层：expo-sqlite 同步 API。灵感、连接、讨论消息、设置四张表。
import * as SQLite from 'expo-sqlite';
import type { IdeaStatus } from '@/theme';

export interface Idea {
  id: string;
  title: string;
  transcript: string;
  audioUri: string;
  status: IdeaStatus;
  transcribeState: 'pending' | 'ok' | 'failed';
  /** JSON 字符串（IdeaAnalysis），空串 = 未分析 */
  aiAnalysis: string;
  /** 本地算法提取的关键词（AI 自动连接的第 0 层信号），JSON 数组字符串解析而来 */
  keywords: string[];
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  /** 仅 listIdeas 带出 */
  connCount?: number;
  /** 仅 listIdeas 带出：待确认的 AI 建议关联数 */
  candCount?: number;
}

export interface ChatMessage {
  id: string;
  ideaId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

const db = SQLite.openDatabaseSync('idea-bucket.db');

db.execSync(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS ideas (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    transcript TEXT NOT NULL DEFAULT '',
    audio_uri TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'raw',
    transcribe_state TEXT NOT NULL DEFAULT 'pending',
    ai_analysis TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS connections (
    a TEXT NOT NULL,
    b TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'manual',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (a, b)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    idea_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_idea ON messages(idea_id);
  CREATE INDEX IF NOT EXISTS idx_ideas_deleted ON ideas(deleted_at);
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    level TEXT NOT NULL DEFAULT 'info',
    tag TEXT NOT NULL,
    message TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts);
  CREATE TABLE IF NOT EXISTS connection_candidates (
    a TEXT NOT NULL,
    b TEXT NOT NULL,
    score REAL NOT NULL,
    verdict TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (a, b)
  );
`);

// 轻量迁移：老库补 keywords 列（AI 自动连接用）
{
  const cols = db.getAllSync<{ name: string }>('PRAGMA table_info(ideas)');
  if (!cols.some((c) => c.name === 'keywords')) {
    db.execSync("ALTER TABLE ideas ADD COLUMN keywords TEXT NOT NULL DEFAULT ''");
  }
  // 关键词来源标记：'ai' = AI 提取；'local' = 本地算法（待 AI 升级）；'' = 未提取
  if (!cols.some((c) => c.name === 'keywords_source')) {
    db.execSync("ALTER TABLE ideas ADD COLUMN keywords_source TEXT NOT NULL DEFAULT 'local'");
  }
}

export function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

interface IdeaRow {
  id: string;
  title: string;
  transcript: string;
  audio_uri: string;
  status: string;
  transcribe_state: string;
  ai_analysis: string;
  keywords: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  conn_count?: number;
  cand_count?: number;
}

function rowToIdea(r: IdeaRow): Idea {
  let keywords: string[] = [];
  try {
    keywords = r.keywords ? (JSON.parse(r.keywords) as string[]) : [];
  } catch {
    keywords = [];
  }
  return {
    id: r.id,
    title: r.title,
    transcript: r.transcript,
    audioUri: r.audio_uri,
    status: r.status as IdeaStatus,
    transcribeState: r.transcribe_state as Idea['transcribeState'],
    aiAnalysis: r.ai_analysis,
    keywords,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    connCount: r.conn_count,
    candCount: r.cand_count,
  };
}

export function createIdea(fields: {
  id: string;
  title: string;
  audioUri: string;
  transcript?: string;
}): void {
  const now = Date.now();
  db.runSync(
    'INSERT INTO ideas (id, title, transcript, audio_uri, transcribe_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      fields.id,
      fields.title,
      fields.transcript ?? '',
      fields.audioUri,
      fields.transcript ? 'ok' : 'pending',
      now,
      now,
    ],
  );
}

export function updateIdea(
  id: string,
  patch: Partial<Pick<Idea, 'title' | 'transcript' | 'status' | 'transcribeState' | 'aiAnalysis'>>,
): void {
  const column: Record<string, string> = {
    title: 'title',
    transcript: 'transcript',
    status: 'status',
    transcribeState: 'transcribe_state',
    aiAnalysis: 'ai_analysis',
  };
  const keys = Object.keys(patch).filter((k) => k in column);
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${column[k]} = ?`).join(', ');
  const vals = keys.map((k) => String(patch[k as keyof typeof patch] ?? ''));
  db.runSync(`UPDATE ideas SET ${sets}, updated_at = ? WHERE id = ?`, [...vals, Date.now(), id]);
}

export function getIdea(id: string): Idea | null {
  const row = db.getFirstSync<IdeaRow>('SELECT * FROM ideas WHERE id = ?', [id]);
  return row ? rowToIdea(row) : null;
}

/** 未删除的全部灵感（带连接数与待确认建议数），按创建时间倒序 */
export function listIdeas(): Idea[] {
  const rows = db.getAllSync<IdeaRow>(
    `SELECT i.*, (SELECT COUNT(*) FROM connections c WHERE c.a = i.id OR c.b = i.id) AS conn_count,
     (SELECT COUNT(*) FROM connection_candidates cc WHERE (cc.a = i.id OR cc.b = i.id) AND cc.status = 'pending') AS cand_count
     FROM ideas i WHERE i.deleted_at IS NULL ORDER BY i.created_at DESC`,
  );
  return rows.map(rowToIdea);
}

export function listDeletedIdeas(): Idea[] {
  const rows = db.getAllSync<IdeaRow>(
    'SELECT * FROM ideas WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC',
  );
  return rows.map(rowToIdea);
}

export function countIdeas(): number {
  const row = db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM ideas WHERE deleted_at IS NULL');
  return row?.n ?? 0;
}

export function softDeleteIdea(id: string): void {
  db.runSync('UPDATE ideas SET deleted_at = ? WHERE id = ?', [Date.now(), id]);
}

export function restoreIdea(id: string): void {
  db.runSync('UPDATE ideas SET deleted_at = NULL WHERE id = ?', [id]);
}

/** 物理删除（回收站"彻底删除"用），调用方负责删音频文件 */
export function purgeIdea(id: string): void {
  db.runSync('DELETE FROM ideas WHERE id = ?', [id]);
  db.runSync('DELETE FROM connections WHERE a = ? OR b = ?', [id, id]);
  db.runSync('DELETE FROM messages WHERE idea_id = ?', [id]);
}

/** 清理超过反悔期的已删除灵感，返回被清除的（调用方删音频） */
export function purgeExpiredDeleted(expireMs: number): Idea[] {
  const cutoff = Date.now() - expireMs;
  const rows = db.getAllSync<IdeaRow>(
    'SELECT * FROM ideas WHERE deleted_at IS NOT NULL AND deleted_at < ?',
    [cutoff],
  );
  for (const r of rows) purgeIdea(r.id);
  return rows.map(rowToIdea);
}

// ---- 连接（无向，a < b 归一化存储）----

export function addConnection(x: string, y: string): void {
  const [a, b] = x < y ? [x, y] : [y, x];
  db.runSync('INSERT OR IGNORE INTO connections (a, b, created_at) VALUES (?, ?, ?)', [a, b, Date.now()]);
}

export function removeConnection(x: string, y: string): void {
  const [a, b] = x < y ? [x, y] : [y, x];
  db.runSync('DELETE FROM connections WHERE a = ? AND b = ?', [a, b]);
}

export function listConnectedIdeas(id: string): Idea[] {
  const rows = db.getAllSync<IdeaRow>(
    `SELECT i.* FROM ideas i
     JOIN connections c ON (c.a = i.id OR c.b = i.id)
     WHERE (c.a = ? OR c.b = ?) AND i.id != ? AND i.deleted_at IS NULL
     ORDER BY i.created_at DESC`,
    [id, id, id],
  );
  return rows.map(rowToIdea);
}

/** 全量已确认连接（图谱视图用），两端灵感都未删除 */
export function listAllConnections(): { a: string; b: string }[] {
  return db.getAllSync<{ a: string; b: string }>(
    `SELECT c.a, c.b FROM connections c
     JOIN ideas ia ON ia.id = c.a AND ia.deleted_at IS NULL
     JOIN ideas ib ON ib.id = c.b AND ib.deleted_at IS NULL`,
  );
}

/** 待确认的 AI 建议关联（图谱虚线用），两端灵感都未删除 */
export function listActiveCandidates(): { a: string; b: string }[] {
  return db.getAllSync<{ a: string; b: string }>(
    `SELECT cc.a, cc.b FROM connection_candidates cc
     JOIN ideas ia ON ia.id = cc.a AND ia.deleted_at IS NULL
     JOIN ideas ib ON ib.id = cc.b AND ib.deleted_at IS NULL
     WHERE cc.status = 'pending'`,
  );
}

// ---- 关键词（AI 自动连接第 0 层）----

export function updateIdeaKeywords(id: string, keywords: string[], source: 'ai' | 'local' = 'local'): void {
  db.runSync('UPDATE ideas SET keywords = ?, keywords_source = ?, updated_at = ? WHERE id = ?', [
    JSON.stringify(keywords),
    source,
    Date.now(),
    id,
  ]);
}

/** 缺关键词但有转写文本的灵感（回填用） */
export function listIdeasMissingKeywords(): { id: string; transcript: string }[] {
  return db.getAllSync<{ id: string; transcript: string }>(
    "SELECT id, transcript FROM ideas WHERE keywords = '' AND transcript != '' AND deleted_at IS NULL",
  );
}

/** 关键词还不是 AI 提取的灵感（「AI 整理」按钮的升级对象），新的在前 */
export function listIdeasForAiUpgrade(
  limit: number,
): { id: string; title: string; transcript: string }[] {
  return db.getAllSync<{ id: string; title: string; transcript: string }>(
    `SELECT id, title, transcript FROM ideas
     WHERE transcript != '' AND deleted_at IS NULL AND keywords_source != 'ai'
     ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );
}

// ---- AI 建议连接候选（第 0 层产出，第 2 层判定，用户确认）----

export type CandidateVerdict = 'merge' | 'evolve' | 'collide' | 'none' | '';

export interface Candidate {
  a: string;
  b: string;
  otherId: string;
  otherTitle: string;
  score: number;
  verdict: CandidateVerdict;
  reason: string;
  status: 'pending' | 'confirmed' | 'dismissed';
  createdAt: number;
}

interface CandidateRow {
  a: string;
  b: string;
  score: number;
  verdict: string;
  reason: string;
  status: string;
  created_at: number;
}

function normPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

export function addCandidate(x: string, y: string, score: number): void {
  const [a, b] = normPair(x, y);
  db.runSync(
    `INSERT INTO connection_candidates (a, b, score, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(a, b) DO UPDATE SET score = excluded.score`,
    [a, b, score, Date.now()],
  );
}

/** 某灵感的待处理候选（带对方标题），按重合度降序 */
export function listCandidatesFor(id: string): Candidate[] {
  const rows = db.getAllSync<CandidateRow & { other_id: string; other_title: string }>(
    `SELECT cc.*, o.id AS other_id, o.title AS other_title FROM connection_candidates cc
     JOIN ideas o ON o.id = CASE WHEN cc.a = ? THEN cc.b ELSE cc.a END
     WHERE (cc.a = ? OR cc.b = ?) AND cc.status = 'pending' AND o.deleted_at IS NULL
     ORDER BY cc.score DESC`,
    [id, id, id],
  );
  return rows.map((r) => ({
    a: r.a,
    b: r.b,
    otherId: r.other_id,
    otherTitle: r.other_title,
    score: r.score,
    verdict: r.verdict as CandidateVerdict,
    reason: r.reason,
    status: r.status as Candidate['status'],
    createdAt: r.created_at,
  }));
}

/** 未判定的候选（终审队列），可选只取某灵感相关 */
export function listUnverdictedCandidates(limit: number, forIdeaId?: string): { a: string; b: string }[] {
  if (forIdeaId) {
    return db.getAllSync<{ a: string; b: string }>(
      `SELECT a, b FROM connection_candidates WHERE verdict = '' AND status = 'pending'
       AND (a = ? OR b = ?) ORDER BY score DESC LIMIT ?`,
      [forIdeaId, forIdeaId, limit],
    );
  }
  return db.getAllSync<{ a: string; b: string }>(
    `SELECT a, b FROM connection_candidates WHERE verdict = '' AND status = 'pending'
     ORDER BY score DESC LIMIT ?`,
    [limit],
  );
}

/** 写入终审结果；verdict=none 直接转为 dismissed，不再打扰用户 */
export function setCandidateVerdict(
  x: string,
  y: string,
  verdict: Exclude<CandidateVerdict, ''>,
  reason: string,
): void {
  const [a, b] = normPair(x, y);
  const status = verdict === 'none' ? 'dismissed' : 'pending';
  db.runSync('UPDATE connection_candidates SET verdict = ?, reason = ?, status = ? WHERE a = ? AND b = ?', [
    verdict,
    reason,
    status,
    a,
    b,
  ]);
}

/** 用户确认：建立正式连接并把候选标记为已确认 */
export function confirmCandidate(x: string, y: string): void {
  addConnection(x, y);
  const [a, b] = normPair(x, y);
  db.runSync("UPDATE connection_candidates SET status = 'confirmed' WHERE a = ? AND b = ?", [a, b]);
}

export function dismissCandidate(x: string, y: string): void {
  const [a, b] = normPair(x, y);
  db.runSync("UPDATE connection_candidates SET status = 'dismissed' WHERE a = ? AND b = ?", [a, b]);
}

/** 清理陈旧候选：超过 maxAgeMs 仍是待判定/待确认状态的，直接忽略，返回清理数 */
export function dismissStaleCandidates(maxAgeMs: number): number {
  const cutoff = Date.now() - maxAgeMs;
  const res = db.runSync(
    "UPDATE connection_candidates SET status = 'dismissed' WHERE status = 'pending' AND created_at < ?",
    [cutoff],
  );
  return res.changes;
}

/** 待处理候选总数（UI 展示用） */
export function countPendingCandidates(): number {
  const row = db.getFirstSync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM connection_candidates WHERE status = 'pending'",
  );
  return row?.n ?? 0;
}

// ---- 讨论消息 ----

export function addMessage(ideaId: string, role: ChatMessage['role'], content: string): void {
  db.runSync(
    'INSERT INTO messages (id, idea_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
    [genId(), ideaId, role, content, Date.now()],
  );
}

export function listMessages(ideaId: string): ChatMessage[] {
  const rows = db.getAllSync<{ id: string; idea_id: string; role: string; content: string; created_at: number }>(
    'SELECT * FROM messages WHERE idea_id = ? ORDER BY created_at ASC',
    [ideaId],
  );
  return rows.map((r) => ({
    id: r.id,
    ideaId: r.idea_id,
    role: r.role as ChatMessage['role'],
    content: r.content,
    createdAt: r.created_at,
  }));
}

// ---- 设置 ----

export function getSetting(key: string): string | null {
  const row = db.getFirstSync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.runSync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
}

// ---- 日志（排障用。铁律：只记事件与错误，绝不记录灵感原文和 API Key）----

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogRow {
  id: number;
  ts: number;
  level: LogLevel;
  tag: string;
  message: string;
}

export function logEvent(tag: string, message: string, level: LogLevel = 'info'): void {
  try {
    db.runSync('INSERT INTO logs (ts, level, tag, message) VALUES (?, ?, ?, ?)', [
      Date.now(),
      level,
      tag,
      message.slice(0, 500),
    ]);
    // 环形缓冲：只保留最近 500 条
    db.runSync('DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 500)');
  } catch {
    // 日志绝不影响主流程
  }
}

export function listLogs(limit = 200): LogRow[] {
  const rows = db.getAllSync<{ id: number; ts: number; level: string; tag: string; message: string }>(
    'SELECT * FROM logs ORDER BY id DESC LIMIT ?',
    [limit],
  );
  return rows.map((r) => ({ ...r, level: r.level as LogLevel }));
}
