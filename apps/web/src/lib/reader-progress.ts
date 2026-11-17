export function buildStarts(paragraphs: string[]): number[] {
  const starts: number[] = [];
  let cursor = 0;
  for (const para of paragraphs) {
    starts.push(cursor);
    cursor += para.length + 1;
  }
  return starts;
}

export function chapterLength(paragraphs: string[], starts: number[]): number {
  if (!paragraphs.length || !starts.length) return 0;
  const last = starts.length - 1;
  return starts[last] + paragraphs[last].length;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Index of the paragraph containing (or immediately preceding) a character offset. */
export function paragraphAt(starts: number[], charOffset: number): number {
  if (!starts.length) return 0;
  let low = 0;
  let high = starts.length - 1;
  let answer = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (starts[mid] <= charOffset) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return answer;
}

export function bookPercent(chapterIndex: number, chapterPercent: number, total: number): number {
  if (!total || total <= 0) return 0;
  const raw = ((Math.max(0, chapterIndex) + clamp01(chapterPercent)) / total) * 100;
  return Math.min(100, Math.max(0, raw));
}

export function readingMinutes(chars: number, charsPerMinute = 400): number {
  if (!Number.isFinite(chars) || chars <= 0) return 1;
  return Math.max(1, Math.ceil(chars / charsPerMinute));
}

export function remainingChars(paragraphs: string[], starts: number[], charOffset: number): number {
  const total = chapterLength(paragraphs, starts);
  return Math.max(0, total - Math.max(0, charOffset));
}
