import type { DatabaseSync } from "node:sqlite";

export interface KnowledgeDoc {
  id: number;
  botId: string;
  title: string;
  source: "text" | "file" | "url";
  sourceRef: string;
  chars: number;
  chunks: number;
  createdAt: number;
}

export interface KnowledgeHit {
  docId: number;
  title: string;
  sourceRef: string;
  text: string;
  score: number;
}

const CHUNK_CHARS = 900;
const CHUNK_OVERLAP = 150;
const MAX_DOC_CHARS = 2_000_000;

const STOPWORDS = new Set(
  "the and for are but not you your with that this from have has had was were what when where which who why how can could would should will about into than then them they their there here our out all any its it's also just does did doing done i'm you're please tell know want need like".split(
    " ",
  ),
);

/**
 * Per-bot knowledge base for Q&A bots. Documents are split into chunks and indexed with
 * SQLite FTS5 (trigram tokenizer, so it works for English, Chinese, Japanese and more,
 * with no embedding calls and no extra cost).
 */
export class KnowledgeStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS kb_docs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL,
        title TEXT NOT NULL, source TEXT NOT NULL, source_ref TEXT NOT NULL DEFAULT '',
        chars INTEGER NOT NULL, chunks INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kb_docs_bot ON kb_docs(bot_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks USING fts5(
        body, bot_id UNINDEXED, doc_id UNINDEXED, tokenize = 'trigram'
      );
    `);
  }

  addDocument(botId: string, title: string, source: KnowledgeDoc["source"], sourceRef: string, text: string): KnowledgeDoc {
    const clean = normalize(text).slice(0, MAX_DOC_CHARS);
    if (clean.length < 20) throw new Error("That document has almost no text in it.");
    const chunks = chunk(clean);
    const now = Date.now();
    const res = this.db
      .prepare(`INSERT INTO kb_docs (bot_id, title, source, source_ref, chars, chunks, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(botId, title.slice(0, 200) || "Untitled", source, sourceRef.slice(0, 500), clean.length, chunks.length, now);
    const docId = Number(res.lastInsertRowid);
    const ins = this.db.prepare(`INSERT INTO kb_chunks (body, bot_id, doc_id) VALUES (?, ?, ?)`);
    this.db.exec("BEGIN");
    try {
      for (const c of chunks) ins.run(c, botId, docId);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return this.getDoc(botId, docId)!;
  }

  getDoc(botId: string, id: number): KnowledgeDoc | undefined {
    const r = this.db.prepare(`SELECT * FROM kb_docs WHERE bot_id = ? AND id = ?`).get(botId, id);
    return r ? rowToDoc(r) : undefined;
  }

  docText(botId: string, id: number): string {
    const rows = this.db
      .prepare(`SELECT body FROM kb_chunks WHERE bot_id = ? AND doc_id = ? ORDER BY rowid`)
      .all(botId, id) as any[];
    // Chunks overlap; strip the repeated prefix for a readable preview.
    return rows.map((r, i) => (i === 0 ? r.body : String(r.body).slice(CHUNK_OVERLAP))).join("");
  }

  listDocs(botId: string): KnowledgeDoc[] {
    return (this.db.prepare(`SELECT * FROM kb_docs WHERE bot_id = ? ORDER BY created_at DESC`).all(botId) as any[]).map(rowToDoc);
  }

  deleteDoc(botId: string, id: number): void {
    this.db.prepare(`DELETE FROM kb_chunks WHERE bot_id = ? AND doc_id = ?`).run(botId, id);
    this.db.prepare(`DELETE FROM kb_docs WHERE bot_id = ? AND id = ?`).run(botId, id);
  }

  deleteBot(botId: string): void {
    this.db.prepare(`DELETE FROM kb_chunks WHERE bot_id = ?`).run(botId);
    this.db.prepare(`DELETE FROM kb_docs WHERE bot_id = ?`).run(botId);
  }

  count(botId: string): number {
    return Number((this.db.prepare(`SELECT COUNT(*) AS n FROM kb_docs WHERE bot_id = ?`).get(botId) as any).n);
  }

  /** Find the chunks most relevant to a question. */
  search(botId: string, query: string, limit = 4): KnowledgeHit[] {
    const { trigramTerms, shortCjk } = terms(query);
    let rows: any[] = [];
    if (trigramTerms.length) {
      const match = trigramTerms.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
      try {
        rows = this.db
          .prepare(
            `SELECT kb_chunks.body AS body, kb_chunks.doc_id AS doc_id, bm25(kb_chunks) AS score
             FROM kb_chunks WHERE kb_chunks MATCH ? AND bot_id = ? ORDER BY score LIMIT ?`,
          )
          .all(match, botId, limit * 3) as any[];
      } catch {
        rows = [];
      }
    }
    // Two-character CJK words (e.g. 退款) are shorter than a trigram: fall back to LIKE.
    if (rows.length < limit && shortCjk.length) {
      const like = this.db.prepare(`SELECT body, doc_id FROM kb_chunks WHERE bot_id = ? AND body LIKE ? LIMIT 50`);
      const scored = new Map<string, { body: string; doc_id: number; hits: number }>();
      for (const w of shortCjk) {
        for (const r of like.all(botId, `%${w}%`) as any[]) {
          const k = `${r.doc_id}:${r.body.slice(0, 40)}`;
          const cur = scored.get(k) ?? { body: r.body, doc_id: r.doc_id, hits: 0 };
          cur.hits++;
          scored.set(k, cur);
        }
      }
      const extra = [...scored.values()].sort((a, b) => b.hits - a.hits).map((r) => ({ ...r, score: -r.hits }));
      rows = [...rows, ...extra];
    }
    const seen = new Set<string>();
    const hits: KnowledgeHit[] = [];
    for (const r of rows) {
      const key = String(r.body).slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      const doc = this.getDoc(botId, Number(r.doc_id));
      if (!doc) continue;
      hits.push({ docId: doc.id, title: doc.title, sourceRef: doc.sourceRef, text: r.body, score: Number(r.score) });
      if (hits.length >= limit) break;
    }
    return hits;
  }
}

export function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split on paragraphs into ~900-char chunks with a little overlap, so answers that span a boundary aren't lost. */
export function chunk(text: string): string[] {
  const paras = text.split(/\n\n+/);
  const out: string[] = [];
  let cur = "";
  const push = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = cur.slice(-CHUNK_OVERLAP);
  };
  for (const p of paras) {
    if (p.length > CHUNK_CHARS) {
      // Long paragraph: split by sentences, then hard-wrap.
      for (const s of p.split(/(?<=[.!?。！？])\s*/)) {
        for (let i = 0; i < s.length; i += CHUNK_CHARS) {
          const piece = s.slice(i, i + CHUNK_CHARS);
          if (cur.length + piece.length > CHUNK_CHARS) push();
          cur += (cur ? " " : "") + piece;
        }
      }
      continue;
    }
    if (cur.length + p.length + 2 > CHUNK_CHARS) push();
    cur += (cur ? "\n\n" : "") + p;
  }
  if (cur.trim() && (!out.length || !out[out.length - 1].endsWith(cur.trim()))) out.push(cur.trim());
  return out.slice(0, 5000);
}

const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/;

function terms(query: string): { trigramTerms: string[]; shortCjk: string[] } {
  const trigramTerms = new Set<string>();
  const shortCjk = new Set<string>();
  const q = query.toLowerCase();
  for (const w of q.match(/[a-z0-9][a-z0-9_.\-']*[a-z0-9]|[a-z0-9]/g) ?? []) {
    if (w.length >= 3 && !STOPWORDS.has(w)) trigramTerms.add(w);
  }
  for (const run of q.match(/[぀-ヿ㐀-䶿一-鿿가-힯]+/g) ?? []) {
    if (run.length >= 3) for (let i = 0; i + 3 <= run.length && trigramTerms.size < 40; i++) trigramTerms.add(run.slice(i, i + 3));
    for (let i = 0; i + 2 <= run.length; i++) if (CJK.test(run[i])) shortCjk.add(run.slice(i, i + 2));
  }
  return { trigramTerms: [...trigramTerms].slice(0, 40), shortCjk: [...shortCjk].slice(0, 20) };
}

function rowToDoc(r: any): KnowledgeDoc {
  return {
    id: Number(r.id),
    botId: r.bot_id,
    title: r.title,
    source: r.source,
    sourceRef: r.source_ref,
    chars: Number(r.chars),
    chunks: Number(r.chunks),
    createdAt: Number(r.created_at),
  };
}
