/** Keyboard map, following the bindings Calibre/Foliate readers use so muscle memory works. */

export type ReaderKeyAction =
  | "prev-page"
  | "next-page"
  | "prev-chapter"
  | "next-chapter"
  | "menu"
  | "catalog"
  | "search"
  | "bookmarks"
  | "settings"
  | "fullscreen"
  | "speech"
  | "font-smaller"
  | "font-larger"
  | "chapter-top"
  | "chapter-bottom"
  | "help"
  | "escape";

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/** Text fields own their keystrokes; the reader must not steal arrows or spaces from them. */
export function isEditableTarget(target: { tagName?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function actionForKey(event: KeyLike): ReaderKeyAction | null {
  const key = event.key;
  if (!key) return null;
  const command = Boolean(event.ctrlKey || event.metaKey);
  const alt = Boolean(event.altKey);

  if (key === "Escape") return "escape";
  if (alt) return null;

  if (command) {
    if (key === "ArrowLeft") return "prev-chapter";
    if (key === "ArrowRight") return "next-chapter";
    // 浏览器自己也有 Ctrl+F，必须由阅读页 preventDefault，否则会盖上一层原生查找框。
    if (key.toLowerCase() === "f") return "search";
    return null;
  }

  switch (key) {
    case "ArrowLeft":
    case "PageUp":
      return "prev-page";
    case "ArrowRight":
    case "PageDown":
      return "next-page";
    case "ArrowUp":
      return "prev-page";
    case "ArrowDown":
      return "next-page";
    case " ":
      return event.shiftKey ? "prev-page" : "next-page";
    case "Home":
      return "chapter-top";
    case "End":
      return "chapter-bottom";
    default:
      break;
  }

  switch (key.toLowerCase()) {
    case "f":
      return "fullscreen";
    case "t":
      return "catalog";
    case "b":
      return "bookmarks";
    case "s":
      return "speech";
    case "m":
      return "menu";
    case "[":
      return "font-smaller";
    case "]":
      return "font-larger";
    case "/":
      return "search";
    case "?":
      return "help";
    default:
      return null;
  }
}
