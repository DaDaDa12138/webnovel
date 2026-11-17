import type { DisplayBlock } from "./reader-blocks";

/** 在块内按绝对字符区间构造 Range；找不到时返回 null。 */
export function rangeAtOffset(blockEl: HTMLElement, start: number, end: number): Range | null {
  const parts = Array.from(blockEl.querySelectorAll<HTMLElement>("[data-start]"));
  if (!parts.length) return null;
  const startPart = parts.find((el) => {
    const a = Number(el.dataset.start);
    const b = Number(el.dataset.end);
    return Number.isFinite(a) && Number.isFinite(b) && start >= a && start < b;
  }) ?? parts.find((el) => Number(el.dataset.start) >= start) ?? parts[parts.length - 1];
  const endPart = parts.find((el) => {
    const a = Number(el.dataset.start);
    const b = Number(el.dataset.end);
    return Number.isFinite(a) && Number.isFinite(b) && end <= b && end > a;
  }) ?? startPart;
  const range = document.createRange();
  const startNode = textNodeAt(startPart, Math.max(0, start - Number(startPart.dataset.start)));
  const endNode = textNodeAt(endPart, Math.max(0, end - Number(endPart.dataset.start)));
  if (!startNode || !endNode) return null;
  range.setStart(startNode.node, startNode.offset);
  range.setEnd(endNode.node, endNode.offset);
  return range;
}

function textNodeAt(root: HTMLElement, localOffset: number): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, Math.floor(localOffset));
  let last: Text | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    last = node;
    if (remaining <= node.data.length) return { node, offset: remaining };
    remaining -= node.data.length;
  }
  return last ? { node: last, offset: last.data.length } : null;
}

export function offsetWithin(container: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(container);
  range.setEnd(node, offset);
  return range.toString().length;
}

/** 视口点 → 章节内绝对偏移。优先 caretRangeFromPoint，再 caretPositionFromPoint。 */
export function offsetFromPoint(x: number, y: number, flow: HTMLElement): number | null {
  let node: Node | null = null;
  let offset = 0;
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  } else if (typeof doc.caretPositionFromPoint === "function") {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  }
  if (!node || !flow.contains(node)) return null;
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
  const part = el?.closest<HTMLElement>("[data-start]");
  if (!part || !flow.contains(part)) return null;
  const base = Number(part.dataset.start);
  if (!Number.isFinite(base)) return null;
  return base + offsetWithin(part, node, offset);
}

export function firstVisibleOffsetFromRects(
  rects: Array<{ start: number; bottom: number }>,
  top: number,
  blocks: Array<{ start: number; end: number }>,
): number {
  for (const rect of rects) {
    if (rect.bottom > top) return rect.start;
  }
  const last = blocks[blocks.length - 1];
  return last ? last.end : blocks[0]?.start ?? 0;
}

export function firstVisibleOffset(blocks: DisplayBlock[], section: HTMLElement, flow: HTMLElement, scroller: HTMLElement): number {
  const flowRect = flow.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  const probe = offsetFromPoint(flowRect.left + 4, scrollerRect.top + 12, flow);
  if (probe !== null) return probe;
  // 章末卡片、整页插图这类元素没有 data-start，光标探针会落空。
  // 这时找第一个底边还在视口内的正文段；如果后面已经没有正文（读到最后），
  // 就返回最后一段的结尾，而不是把进度重置成章首。
  const top = scrollerRect.top + 12;
  const rects: Array<{ start: number; bottom: number }> = [];
  for (const part of section.querySelectorAll<HTMLElement>("[data-start]")) {
    const start = Number(part.dataset.start);
    if (Number.isFinite(start)) rects.push({ start, bottom: part.getBoundingClientRect().bottom });
  }
  return firstVisibleOffsetFromRects(rects, top, blocks);
}
