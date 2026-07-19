// 标题生成：投入瞬间本地完成，不等 AI。
// 格式：[MM/DD] 关键词1·关键词2·关键词3
//
// 实现说明：纯启发式（停用词切分 + n-gram 词频×词长加权），不依赖分词词典，
// 因而没有真正的词性标注，用"词长与频率"近似"名词优先"的效果。
// 若后续要更准，可在此替换为 segmentit 等分词库，函数签名保持不变。

const STOPWORDS = new Set([
  '的', '了', '和', '是', '在', '我', '你', '他', '她', '它', '我们', '你们', '他们',
  '这', '那', '这个', '那个', '这些', '那些', '有', '没有', '不', '不是', '很', '都',
  '也', '就', '还', '又', '再', '跟', '把', '被', '让', '给', '从', '到', '对', '向',
  '比', '啊', '呀', '吧', '呢', '嘛', '哦', '嗯', '唉', '哎', '么', '什么', '为什么',
  '怎么', '怎么样', '如何', '哪', '哪里', '谁', '多少', '几', '好', '能不能', '可以',
  '可能', '应该', '要', '想要', '想', '我想', '感觉', '觉得', '知道', '希望', '比如',
  '例如', '反正', '其实', '基本上', '大概', '差不多', '也许', '一定', '肯定', '就是',
  '就是说', '然后', '接着', '之后', '之前', '现在', '今天', '明天', '昨天', '时候',
  '时间', '东西', '事情', '问题', '情况', '方面', '一下', '一点儿', '有点', '一些',
  '一种', '一个', '个', '种', '样', '这样', '那样', '的话', '来说', '以及', '或者',
  '而且', '但是', '可是', '不过', '因为', '所以', '如果', '虽然', '即使', '无论',
  '不管', '只要', '只有', '通过', '根据', '按照', '关于', '对于', '至于', '除了',
  '另外', '还有', '其中', '甚至', '特别', '非常', '十分', '相当', '挺', '最', '更',
  '真', '真的', '确实', '太', '可', '啦', '噢', '诶', '呃', '要不要', '是不是',
  '地', '得', '着', '过', '们', '之', '其', '此', '该', '每', '各', '某', '其他', '一',
]);

// 连接字：不算停用词，但作为切分点能把"下载文件夹里"切成"下载文件夹"
const GLUE = new Set(['里', '中', '内', '上', '下', '按', '用', '时', '来', '去', '起', '归', '成', '出', '入', '回']);

function mmdd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}`;
}

/** 刚入桶、等待转写时的占位标题 */
export function placeholderTitle(d: Date = new Date()): string {
  return `[${mmdd(d)}] 记录中…`;
}

/** 转写失败/无意义输入时的兜底标题 */
export function fallbackTitle(d: Date = new Date()): string {
  return `[${mmdd(d)}] 未命名灵感`;
}

/** 用停用词和连接字把一段连续中文切成候选词片段（最长停用词优先切）。
 *  连接字只在词中/词尾切（buf 非空），词首不切——否则"下载"会被"下"毁掉 */
function splitByStopwords(token: string): string[] {
  const result: string[] = [];
  let buf = '';
  let i = 0;
  outer: while (i < token.length) {
    for (let len = Math.min(3, token.length - i); len >= 1; len--) {
      const sub = token.slice(i, i + len);
      const isGlueCut = len === 1 && GLUE.has(sub) && buf.length > 0;
      if (STOPWORDS.has(sub) || isGlueCut) {
        if (buf) result.push(buf);
        buf = '';
        i += len;
        continue outer;
      }
    }
    buf += token[i];
    i += 1;
  }
  if (buf) result.push(buf);
  return result;
}

/** 两个词是否共享至少 2 个连续字符（用于过滤滑窗碎片） */
function overlap(a: string, b: string): boolean {
  if (a.includes(b) || b.includes(a)) return true;
  for (let i = 0; i + 2 <= a.length; i++) {
    if (b.includes(a.slice(i, i + 2))) return true;
  }
  return false;
}

/** 从原文提取 Top N 关键词，按原文出现顺序返回 */
export function extractKeywords(text: string, max = 5): string[] {
  const stat = new Map<string, { f: number; full: boolean }>();
  const firstPos = new Map<string, number>();
  let pos = 0;

  const bump = (w: string, p: number, full: boolean) => {
    if (w.length < 2 || w.length > 8 || STOPWORDS.has(w)) return;
    const s = stat.get(w) ?? { f: 0, full: false };
    s.f += 1;
    s.full = s.full || full;
    stat.set(w, s);
    if (!firstPos.has(w)) firstPos.set(w, p);
  };

  const clauses = text.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/i).filter(Boolean);
  for (const clause of clauses) {
    const tokens = clause.match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) ?? [];
    for (const token of tokens) {
      if (/^[a-z0-9]+$/.test(token)) {
        bump(token, pos++, true);
        continue;
      }
      for (const seg of splitByStopwords(token)) {
        const p = pos++;
        if (seg.length >= 2 && seg.length <= 4) {
          bump(seg, p, true);
        } else if (seg.length > 4) {
          // 长段拆 2~3 字 n-gram 参与词频统计（4 字滑窗极易出碎片，不要）
          for (let n = 3; n >= 2; n--) {
            for (let i = 0; i + n <= seg.length; i++) bump(seg.slice(i, i + n), p, false);
          }
        }
      }
    }
  }

  // 打分：词频 × 词长，完整片段 ×1.5。
  // 滑窗碎片必须出现 ≥2 次（跨片段复现）才有资格参选——单次碎片基本是噪音。
  const scored = [...stat.entries()]
    .filter(([, s]) => s.full || s.f >= 2)
    .map(([w, s]) => ({ w, score: s.f * w.length * (s.full ? 1.5 : 1), pos: firstPos.get(w)! }))
    .sort((a, b) => b.score - a.score || a.pos - b.pos);

  const picked: { w: string; pos: number }[] = [];
  for (const cand of scored) {
    if (picked.length >= max) break;
    if (picked.some((p) => overlap(p.w, cand.w))) continue;
    picked.push({ w: cand.w, pos: cand.pos });
  }
  return picked.sort((a, b) => a.pos - b.pos).map((p) => p.w);
}

export function generateTitle(transcript: string, date: Date = new Date()): string {
  const text = transcript.trim();
  const prefix = `[${mmdd(date)}]`;
  if (!text) return `${prefix} 未命名灵感`;
  // 边界：原文太短，直接取前 15 字
  if (text.length < 5) return `${prefix} ${text.slice(0, 15)}`;
  const keywords = extractKeywords(text, 5);
  if (keywords.length === 0) return `${prefix} 未命名灵感`;
  return `${prefix} ${keywords.slice(0, 5).join('·')}`;
}
