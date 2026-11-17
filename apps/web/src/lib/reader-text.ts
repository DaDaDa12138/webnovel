/** 正文纯文本 → 段落：书源常见「一句一行」，先只做去 CR、去 nbsp、trim、丢空行。 */
export function splitParagraphs(content: string): string[] {
  return String(content ?? "")
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((line) => line.replace(/\u00a0/g, " ").trim())
    .filter((line) => line.length > 0);
}

export function chapterText(paragraphs: string[]): string {
  return paragraphs.join("\n");
}
