/**
 * 笔记中心的整库导出。
 *
 * 阅读页里的单本导出按「章」分组就够了；跨书导出必须多一层书，
 * 否则同一章标题（「第1章」）在不同书里会粘成一段。
 */
export interface NoteExportItem {
  bookName: string;
  chapterTitle: string;
  quote: string;
  comment: string;
  type?: string;
}

interface BookGroup {
  name: string;
  chapters: Array<{ title: string; entries: NoteExportItem[] }>;
}

export function groupNotes(items: NoteExportItem[]): BookGroup[] {
  const books: BookGroup[] = [];
  for (const item of items) {
    const name = item.bookName || "未命名书籍";
    let book = books.find((entry) => entry.name === name);
    if (!book) {
      book = { name, chapters: [] };
      books.push(book);
    }
    const title = item.chapterTitle || "未知章节";
    let chapter = book.chapters.find((entry) => entry.title === title);
    if (!chapter) {
      chapter = { title, entries: [] };
      book.chapters.push(chapter);
    }
    chapter.entries.push(item);
  }
  return books;
}

export function notesMarkdown(items: NoteExportItem[]): string {
  const books = groupNotes(items);
  const lines: string[] = ["# 我的笔记", "", `> 共 ${items.length} 条 · 来自 ${books.length} 本书 · 导出自 legado-web`, ""];
  for (const book of books) {
    lines.push(`## 《${book.name}》`, "");
    for (const chapter of book.chapters) {
      lines.push(`### ${chapter.title}`, "");
      for (const entry of chapter.entries) {
        const quote = entry.quote.replace(/\s+/g, " ").trim();
        lines.push(`> ${quote}`, "");
        const comment = entry.comment.trim();
        if (comment) lines.push(comment, "");
      }
    }
  }
  return lines.join("\n").replace(/\n+$/, "\n");
}
