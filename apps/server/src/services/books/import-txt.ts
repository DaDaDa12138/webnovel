import { createLocalBook, hashText, type LocalBookResult } from "./local-book.js";
import { splitTxtChapters } from "./txt-split.js";

export interface ImportTxtInput {
  name?: string;
  author?: string;
  content?: string;
}

export type ImportTxtResult = LocalBookResult;

/** 导入本地 TXT：切章后按内容哈希去重落库。 */
export function importTxtBook(input: ImportTxtInput): ImportTxtResult {
  const content = String(input.content ?? "");
  if (content.trim().length < 200) {
    return { ok: false, status: 400, body: { error: "too_short", message: "正文太短，至少 200 字" } };
  }
  const sections = splitTxtChapters(content);
  return createLocalBook({
    kind: "txt",
    name: input.name ?? "未命名 TXT",
    author: input.author,
    sections,
    hash: hashText(content),
  });
}
