import { DOMParser } from "@xmldom/xmldom";
import * as xpath from "xpath";
import { normalizeText } from "./text.js";

/**
 * 取 XPath 命中的元素本身（序列化成 HTML），而不是它们的文字。
 *
 * Legado 的 `java.getElements("@XPath://ul[@id='legado-toc']/li")` 要的是元素：
 * 后续 chapterName/chapterUrl 还要在每个 <li> 上取 a@text / a@href。以前这里
 * 直接当 CSS 解析，css-what 抛 "Expected name, found ://ul[...]"，整个目录报废。
 */
/** xmldom 把 text/html 解析成 XHTML 命名空间，导致 `//div` 这类不带前缀的
 *  XPath 一条都选不到（`//*[local-name()="div"]` 却可以）。清掉命名空间后
 *  书源里常见的 `//ul[@class="list"]/li` 才能按字面匹配。 */
function stripNamespaces(root: unknown): void {
  const node = root as {
    nodeType?: number;
    namespaceURI?: string | null;
    prefix?: string | null;
    firstChild?: unknown;
    nextSibling?: unknown;
  } | null;
  if (!node) return;
  if (node.nodeType === 1) {
    try {
      node.namespaceURI = null;
      node.prefix = null;
    } catch {
      /* 只读实现忽略 */
    }
  }
  for (let child = node.firstChild as typeof node; child; child = child.nextSibling as typeof node) {
    stripNamespaces(child);
  }
}

export function queryXpathElements(expr: string, html: string): string[] {
  const doc = new DOMParser({
    onError: () => {
      /* tolerate malformed html */
    },
  }).parseFromString(html, "text/html");
  stripNamespaces(doc.documentElement);
  let nodes: unknown;
  try {
    nodes = xpath.select(expr, doc as unknown as Node);
  } catch {
    return [];
  }
  const list = Array.isArray(nodes) ? nodes : [nodes];
  const out: string[] = [];
  for (const node of list) {
    if (node === null || node === undefined) continue;
    const anyNode = node as { nodeType?: number; toString?: () => string; textContent?: string | null };
    // 1 = ELEMENT_NODE；文本/属性节点退回文字，保持和 queryXpath 一致。
    if (anyNode.nodeType === 1 && typeof anyNode.toString === "function") {
      const markup = String(anyNode.toString());
      if (markup && markup.includes("<")) out.push(markup);
      continue;
    }
    const text = normalizeText(String(anyNode.textContent ?? anyNode.toString?.() ?? ""));
    if (text) out.push(text);
  }
  return out;
}

export function queryXpath(expr: string, html: string): string[] {
  const doc = new DOMParser({
    onError: () => {
      /* tolerate malformed html */
    },
  }).parseFromString(html, "text/html");
  stripNamespaces(doc.documentElement);
  let nodes: unknown;
  try {
    nodes = xpath.select(expr, doc as unknown as Node);
  } catch {
    return [];
  }
  const list = Array.isArray(nodes) ? nodes : [nodes];
  const out: string[] = [];
  for (const node of list) {
    if (node === null || node === undefined) continue;
    if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
      out.push(String(node));
      continue;
    }
    const anyNode = node as { nodeValue?: string | null; textContent?: string | null; toString?: () => string };
    if (typeof anyNode.nodeValue === "string" && anyNode.nodeValue) {
      out.push(anyNode.nodeValue);
      continue;
    }
    if (typeof anyNode.textContent === "string") {
      const text = normalizeText(anyNode.textContent);
      if (text) out.push(text);
      continue;
    }
    if (typeof anyNode.toString === "function") {
      const text = normalizeText(anyNode.toString());
      if (text) out.push(text);
    }
  }
  return out;
}
