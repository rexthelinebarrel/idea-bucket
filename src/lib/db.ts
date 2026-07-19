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
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  /** 仅 listIdeas 带出 */
  connCount?: number;
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
`);

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
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  conn_count?: number;
}

function rowToIdea(r: IdeaRow): Idea {
  return {
    id: r.id,
    title: r.title,
    transcript: r.transcript,
    audioUri: r.audio_uri,
    status: r.status as IdeaStatus,
    transcribeState: r.transcribe_state as Idea['transcribeState'],
    aiAnalysis: r.ai_analysis,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    connCount: r.conn_count,
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

/** 未删除的全部灵感（带连接数），按创建时间倒序 */
export function listIdeas(): Idea[] {
  const rows = db.getAllSync<IdeaRow>(
    `SELECT i.*, (SELECT COUNT(*) FROM connections c WHERE c.a = i.id OR c.b = i.id) AS conn_count
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
