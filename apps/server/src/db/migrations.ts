export interface Migration {
  version: number;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS book_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  host_key TEXT NOT NULL UNIQUE,
  group_name TEXT NOT NULL DEFAULT '',
  type INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  enabled_explore INTEGER NOT NULL DEFAULT 0,
  weight INTEGER NOT NULL DEFAULT 0,
  custom_order INTEGER NOT NULL DEFAULT 0,
  json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  flag TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  last_check_at TEXT,
  subscription_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sources_status ON book_sources(status);
CREATE INDEX IF NOT EXISTS idx_sources_group ON book_sources(group_name);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'bookSource',
  enabled INTEGER NOT NULL DEFAULT 1,
  etag TEXT NOT NULL DEFAULT '',
  last_modified TEXT NOT NULL DEFAULT '',
  last_fetch_at TEXT,
  last_hash TEXT NOT NULL DEFAULT '',
  auto_refresh INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_url TEXT NOT NULL,
  source_id INTEGER,
  name TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
  intro TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT '',
  last_chapter TEXT NOT NULL DEFAULT '',
  toc_url TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT '',
  origin_name TEXT NOT NULL DEFAULT '',
  group_id INTEGER NOT NULL DEFAULT 0,
  in_shelf INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(book_url, source_id)
);

CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  base_url TEXT NOT NULL DEFAULT '',
  is_vip INTEGER NOT NULL DEFAULT 0,
  is_volume INTEGER NOT NULL DEFAULT 0,
  UNIQUE(book_id, url)
);
CREATE INDEX IF NOT EXISTS idx_chapters_book ON chapters(book_id, idx);

CREATE TABLE IF NOT EXISTS chapter_contents (
  chapter_id INTEGER PRIMARY KEY REFERENCES chapters(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  cached_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reading_progress (
  book_id INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  chapter_id INTEGER,
  chapter_index INTEGER NOT NULL DEFAULT 0,
  offset INTEGER NOT NULL DEFAULT 0,
  percent REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_id INTEGER,
  chapter_index INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  excerpt TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS replace_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pattern TEXT NOT NULL,
  replacement TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT 'content',
  is_regex INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  order_no INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS source_variables (
  source_id INTEGER NOT NULL REFERENCES book_sources(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (source_id, key)
);

CREATE TABLE IF NOT EXISTS source_cookies (
  source_id INTEGER NOT NULL REFERENCES book_sources(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  cookie TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (source_id, url)
);

CREATE TABLE IF NOT EXISTS source_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES book_sources(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0,
  code TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS search_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_search_history_time ON search_history(created_at DESC);
`,
  },
  {
    version: 2,
    sql: `
ALTER TABLE books ADD COLUMN auto_switched INTEGER NOT NULL DEFAULT 0;
ALTER TABLE books ADD COLUMN auto_switch_note TEXT NOT NULL DEFAULT '';
`,
  },
  {
    // Chapter bodies cached by 0.1.1 kept only the first paragraph (content rules are list
    // rules). Drop them once so every chapter is re-extracted with the fixed engine.
    version: 3,
    sql: `DELETE FROM chapter_contents;`,
  },
  {
    // 0.2.0: character-anchored progress, shelf grouping/notes, reading sessions.
    version: 4,
    sql: `
ALTER TABLE books ADD COLUMN note TEXT NOT NULL DEFAULT '';
ALTER TABLE books ADD COLUMN last_checked_at TEXT;
ALTER TABLE books ADD COLUMN new_chapters INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reading_progress ADD COLUMN char_offset INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reading_progress ADD COLUMN chapter_percent REAL NOT NULL DEFAULT 0;
UPDATE reading_progress SET chapter_percent = percent WHERE chapter_percent = 0;
ALTER TABLE bookmarks ADD COLUMN char_offset INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS book_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  order_no INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reading_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  chapters INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(book_id, day)
);
CREATE INDEX IF NOT EXISTS idx_reading_sessions_day ON reading_sessions(day);
`,
  },
  {
    // 0.4.0: chapter_percent is a 0..1 fraction. v4 backfilled the legacy 0..100 percent
    // value into it, so normalize any out-of-range rows once.
    version: 5,
    sql: `UPDATE reading_progress SET chapter_percent = chapter_percent / 100.0 WHERE chapter_percent > 1;`,
  },
  {
    // 0.5.0: searches can carry an author, and sources without an exploreUrl must not be
    // advertised as discoverable (142 of 707 used to fail before sending a request).
    version: 6,
    sql: `
ALTER TABLE search_history ADD COLUMN author TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_search_history_author ON search_history(keyword, author);
UPDATE book_sources SET enabled_explore = 0
 WHERE enabled_explore = 1 AND json_valid(json)
   AND TRIM(COALESCE(json_extract(json, '$.exploreUrl'), '')) = '';
`,
  },
  {
    // 0.6.0: user-curated book lists (owllook 的书单) — many-to-many, independent of shelf groups.
    version: 7,
    sql: `
CREATE TABLE IF NOT EXISTS book_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS book_list_items (
  list_id INTEGER NOT NULL REFERENCES book_lists(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  order_no INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (list_id, book_id)
);
CREATE INDEX IF NOT EXISTS idx_book_list_items_book ON book_list_items(book_id);
`,
  },
  {
    // 0.7.0: remember how long a source took on the last check, and persist the
    // discovery audit so the ranking tab can show verified groups instead of
    // scanning the same thirty sources on every visit.
    version: 8,
    sql: `
ALTER TABLE book_sources ADD COLUMN last_ms INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS explore_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL,
  source_name TEXT NOT NULL DEFAULT '',
  group_title TEXT NOT NULL DEFAULT '',
  group_url TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'other',
  score INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT -1,
  error TEXT NOT NULL DEFAULT '',
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_id, group_url, group_title)
);
CREATE INDEX IF NOT EXISTS idx_explore_audit_kind ON explore_audit(kind, item_count DESC);
CREATE INDEX IF NOT EXISTS idx_explore_audit_source ON explore_audit(source_id);
`,
  },
  {
    // 0.7.0: book detail pages show the word count reported by the source; keep the
    // raw label ("120万字") because every site formats it differently.
    version: 9,
    sql: `
ALTER TABLE books ADD COLUMN word_count TEXT NOT NULL DEFAULT '';
`,
  },
  {
    // 0.7.0: the ranking tab shows the first three books of each group. Without
    // persisting them the tiles go blank as soon as the process restarts and the
    // tab falls back to explore_audit.
    version: 10,
    sql: `
ALTER TABLE explore_audit ADD COLUMN sample TEXT NOT NULL DEFAULT '';
`,
  },
  {
    // 0.7.1: a single timeout says nothing about a source (mobile networks flap),
    // so count consecutive failures and only mark a source broken after two.
    version: 11,
    sql: `
ALTER TABLE book_sources ADD COLUMN fail_count INTEGER NOT NULL DEFAULT 0;
`,
  },
  {
    // 0.9.0: highlights and notes. The id is generated on the client so a note can be
    // created offline and still land on the same row later; `deleted` is a tombstone so a
    // device that was offline cannot resurrect a note that was deleted elsewhere.
    version: 12,
    sql: `
CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'highlight' CHECK (type IN ('highlight', 'note', 'bookmark')),
  chapter_index INTEGER NOT NULL DEFAULT 0,
  chapter_title TEXT NOT NULL DEFAULT '',
  start_offset INTEGER NOT NULL DEFAULT 0,
  end_offset INTEGER NOT NULL DEFAULT 0,
  quote TEXT NOT NULL DEFAULT '',
  prefix TEXT NOT NULL DEFAULT '',
  suffix TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'yellow',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_annotations_book ON annotations(book_id, chapter_index, start_offset);
CREATE INDEX IF NOT EXISTS idx_annotations_updated ON annotations(book_id, updated_at);
`,
  },
  {
    // 0.9.0: 位置历史。reading_progress 只回答「我在哪」，回答不了「我曾经在哪」——
    // 误点目录、切设备、翻页翻过头都需要能退回去。同一章 30 分钟内的连续保存合并成一行，
    // 否则滚动时每 800ms 一次防抖保存会把表刷爆。
    version: 13,
    sql: `
CREATE TABLE IF NOT EXISTS reading_progress_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_index INTEGER NOT NULL DEFAULT 0,
  chapter_title TEXT NOT NULL DEFAULT '',
  char_offset INTEGER NOT NULL DEFAULT 0,
  chapter_percent REAL NOT NULL DEFAULT 0,
  percent REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_progress_history_book ON reading_progress_history(book_id, updated_at DESC);
`,
  },
  {
    // 0.18.0: 换源候选缓存。换源要横扫几百个书源，每次都从零搜一遍要一两分钟；
    // 探到的候选（章数、章名是否对得上、本章字数）几乎不会秒级变化，落库后再次打开
    // 直接先展示上次结果，并跳过刚检测过的源，只复查过期的和没搜过的。
    version: 14,
    sql: `
CREATE TABLE IF NOT EXISTS switch_candidates (
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL,
  book_url TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  chapters INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  title_ok INTEGER NOT NULL DEFAULT 0,
  author_ok TEXT NOT NULL DEFAULT 'unknown',
  ms INTEGER NOT NULL DEFAULT 0,
  chars INTEGER,
  chapter_title TEXT NOT NULL DEFAULT '',
  matched INTEGER,
  match_reason TEXT NOT NULL DEFAULT '',
  match_score REAL,
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (book_id, source_id)
);
CREATE INDEX IF NOT EXISTS idx_switch_candidates_book ON switch_candidates(book_id, checked_at DESC);
`,
  },
  {
    // 0.21.0: 换源缓存拆成两层。目录（哪些源有这本书、多少章）按书缓存；但「这一章在
    // 对方站上多少字 / 章名对不对得上」只对那一章有效——读者换个章节再看换源面板，
    // 拿第 3 章的字数去比第 40 章会得出完全错误的结论，所以实测结果单独按
    // (书, 源, 章节) 存，换章后只重测字，不重扫目录。
    version: 15,
    sql: `
CREATE TABLE IF NOT EXISTS switch_chapter_measures (
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL,
  chapter_key TEXT NOT NULL,
  chars INTEGER,
  chapter_title TEXT NOT NULL DEFAULT '',
  matched INTEGER,
  match_reason TEXT NOT NULL DEFAULT '',
  match_score REAL,
  error TEXT NOT NULL DEFAULT '',
  ms INTEGER NOT NULL DEFAULT 0,
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (book_id, source_id, chapter_key)
);
CREATE INDEX IF NOT EXISTS idx_switch_measures_book ON switch_chapter_measures(book_id, chapter_key);
`,
  },
  {
    // 0.24.0: 换源历史（换回原源）。换源以前是单程票：换到一个目录残缺/正文有错的源，
    // 读者只能自己再搜一遍找回来。这里只记「换之前是什么样」——源、地址、章数、
    // 当时的阅读位置——undo 就是拿这条记录再换一次。只留最近 5 条，来回折腾不会无限长。
    version: 16,
    sql: `
CREATE TABLE IF NOT EXISTS switch_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  source_id INTEGER,
  book_url TEXT NOT NULL DEFAULT '',
  book_name TEXT NOT NULL DEFAULT '',
  chapters INTEGER NOT NULL DEFAULT 0,
  chapter_index INTEGER NOT NULL DEFAULT 0,
  chapter_title TEXT NOT NULL DEFAULT '',
  char_offset INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_switch_history_book ON switch_history(book_id, id DESC);
`,
  },
  {
    // 0.24.1: 探测阶段本来就拿到了目录地址（ruleBookInfo.tocUrl）。记在候选上，
    // 测字时就不用再抓一次详情页——慢站在换源面板满载时详情页要 5–8 秒，
    // 一次测字光「找目录」就吃掉半个 25 秒窗口。
    version: 17,
    sql: `
ALTER TABLE switch_candidates ADD COLUMN toc_url TEXT NOT NULL DEFAULT '';
`,
  },
  {
    // 0.28.0: 正文插图。图片本身不进库（走 /api/img 磁盘缓存），这里只存
    // 「第几段之后有哪张图」的 JSON；旧缓存没有这一列时按空数组处理，读到空串会重新抓。
    version: 18,
    sql: `
ALTER TABLE chapter_contents ADD COLUMN images TEXT NOT NULL DEFAULT '';
`,
  },
  {
    // 0.39.0: 目录已读标记。只记「哪本书的哪一章打开过」，不存字数与时间线；
    // INSERT OR IGNORE 让重复打开不重复写，读得多的书也只多一行一千条。
    version: 19,
    sql: `
CREATE TABLE IF NOT EXISTS chapter_reads (
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_index INTEGER NOT NULL,
  read_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (book_id, chapter_index)
);
CREATE INDEX IF NOT EXISTS idx_chapter_reads_book ON chapter_reads(book_id, chapter_index);
`,
  },
  {
    // 0.47.0: 换源试读。测字本来就把那一章正文抓回来了，只多存 120 字开头；
    // 旧缓存没有这一列时按空串处理，面板会等下一次实测。
    version: 20,
    sql: `
ALTER TABLE switch_chapter_measures ADD COLUMN excerpt TEXT NOT NULL DEFAULT '';
`,
  },
  {
    // 0.47.1: 换源试读开头。测字已经把整章正文抓回来了，再多存 600 字（保留段落）供面板
    // 展开对比；旧缓存没有这一列时按空串处理，面板会退回 120 字摘要。
    version: 21,
    sql: `
ALTER TABLE switch_chapter_measures ADD COLUMN preview TEXT NOT NULL DEFAULT '';
`,
  },
  {
    // 0.47.2: 阅读统计从「打开过的章节全文」改为「实际读到的字符」。
    // 只加一列并回填历史位置：没有历史的章节视为 0，宁可少算也不虚报。
    version: 22,
    sql: `
ALTER TABLE chapter_reads ADD COLUMN max_char_offset INTEGER NOT NULL DEFAULT 0;
UPDATE chapter_reads
SET max_char_offset = COALESCE((
  SELECT MAX(h.char_offset) FROM reading_progress_history h
  WHERE h.book_id = chapter_reads.book_id AND h.chapter_index = chapter_reads.chapter_index
), 0);
UPDATE chapter_reads
SET max_char_offset = MAX(max_char_offset, COALESCE((
  SELECT p.char_offset FROM reading_progress p
  WHERE p.book_id = chapter_reads.book_id AND p.chapter_index = chapter_reads.chapter_index
), 0));
`,
  },
  {
    // 0.51.0: 换源位置跨设备接续。客户端原本只在 sessionStorage 里存锚点，换台设备就丢；
    // 这里按书存最近一次换源前的那一句，GET /api/books/:id 在 24 小时内返回。
    version: 23,
    sql: `
CREATE TABLE IF NOT EXISTS switch_anchors (
  book_id INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  chapter_index INTEGER NOT NULL DEFAULT 0,
  chapter_title TEXT NOT NULL DEFAULT '',
  char_offset INTEGER NOT NULL DEFAULT 0,
  chapter_percent REAL NOT NULL DEFAULT 0,
  quote TEXT NOT NULL,
  prefix TEXT NOT NULL DEFAULT '',
  suffix TEXT NOT NULL DEFAULT '',
  quote_start INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`,
  },
  {
    // 0.56.0: 书源健康度 2.0。只加物化列，不重建表；source_checks 从 0 引用的空表
    // 升级成阶段体检历史（kind='health'，meta 存阶段摘要，不存响应体）。
    version: 24,
    sql: `
ALTER TABLE book_sources ADD COLUMN health_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE book_sources ADD COLUMN health_state TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE book_sources ADD COLUMN health_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE book_sources ADD COLUMN health_checks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE book_sources ADD COLUMN health_ok INTEGER NOT NULL DEFAULT 0;
ALTER TABLE book_sources ADD COLUMN avg_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE book_sources ADD COLUMN last_ok_at TEXT;
ALTER TABLE book_sources ADD COLUMN last_fail_at TEXT;
ALTER TABLE book_sources ADD COLUMN last_stage TEXT NOT NULL DEFAULT '';
ALTER TABLE book_sources ADD COLUMN last_stage_error TEXT NOT NULL DEFAULT '';
ALTER TABLE book_sources ADD COLUMN last_stage_at TEXT;
ALTER TABLE source_checks ADD COLUMN meta TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_source_checks_source ON source_checks(source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_checks_kind ON source_checks(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sources_health ON book_sources(health_state, health_score DESC);
`,
  },
  {
    // 0.57.0: 换源正文质量。测字本来就把整章抓回来了，顺手评估占位、防盗提示、
    // HTML 残留和重复段落；只加列，旧缓存按空串处理，下一次实测自动补齐。
    version: 25,
    sql: `
ALTER TABLE switch_chapter_measures ADD COLUMN quality TEXT NOT NULL DEFAULT '';
ALTER TABLE switch_chapter_measures ADD COLUMN quality_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE switch_chapter_measures ADD COLUMN quality_reason TEXT NOT NULL DEFAULT '';
`,
  },
  {
    // 0.58.0: 自动换源从「试一次就永久锁死」改成可重试。旧版在搜索前就置
    // auto_switched=1，失败的书永远不再尝试；这里把非成功记录复位，并把成功过的
    // 旧记录补成 1 次尝试，避免升级后把所有旧书重新扫一遍。
    version: 26,
    sql: `
ALTER TABLE books ADD COLUMN auto_switch_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE books ADD COLUMN auto_switch_last_at TEXT;
UPDATE books SET auto_switch_attempts = 1, auto_switch_last_at = updated_at
WHERE auto_switched = 1 AND auto_switch_note LIKE 'auto:%';
UPDATE books SET auto_switched = 0
WHERE auto_switched = 1 AND auto_switch_note NOT LIKE 'auto:%';
`,
  },
  {
    // 0.62.0: 换源 3.0 的「标注/书签重贴」。换源会整表换目录，旧章节号在新源里不再对应
    // 同一章；换源前把标注与书签的文本锚点存进历史，换过去后按引文重新定位。
    // 快照同时用于撤销：undo 时精确还原换源前的位置，不再二次猜测。
    version: 27,
    sql: `
ALTER TABLE switch_history ADD COLUMN reanchor_snapshot TEXT;
`,
  },
  {
    // 0.66.0: 换源 3.1。自动换源以前不写历史，读者看到「已自动切换到 X」却无法换回去；
    // 记录 kind 让换源面板能区分手动/自动，也让自动换源进入同一套撤销流程。
    version: 28,
    sql: `
ALTER TABLE switch_history ADD COLUMN kind TEXT NOT NULL DEFAULT 'manual';
CREATE INDEX IF NOT EXISTS idx_switch_history_book ON switch_history(book_id, id DESC);
`,
  },
];
