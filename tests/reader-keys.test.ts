import { describe, expect, it } from "vitest";
import { actionForKey, isEditableTarget } from "../apps/web/src/lib/reader-keys";

describe("reader keyboard map", () => {
  it("maps page and chapter navigation", () => {
    expect(actionForKey({ key: "ArrowRight" })).toBe("next-page");
    expect(actionForKey({ key: "PageUp" })).toBe("prev-page");
    expect(actionForKey({ key: " " })).toBe("next-page");
    expect(actionForKey({ key: " ", shiftKey: true })).toBe("prev-page");
    expect(actionForKey({ key: "ArrowRight", ctrlKey: true })).toBe("next-chapter");
    expect(actionForKey({ key: "ArrowLeft", metaKey: true })).toBe("prev-chapter");
  });

  it("maps the single-letter shortcuts", () => {
    expect(actionForKey({ key: "f" })).toBe("fullscreen");
    expect(actionForKey({ key: "T" })).toBe("catalog");
    expect(actionForKey({ key: "b" })).toBe("bookmarks");
    expect(actionForKey({ key: "s" })).toBe("speech");
    expect(actionForKey({ key: "/" })).toBe("search");
    expect(actionForKey({ key: "[" })).toBe("font-smaller");
    expect(actionForKey({ key: "]" })).toBe("font-larger");
    expect(actionForKey({ key: "?" })).toBe("help");
    expect(actionForKey({ key: "Escape" })).toBe("escape");
  });

  it("opens search with ctrl/cmd+f instead of the browser find box", () => {
    expect(actionForKey({ key: "f", ctrlKey: true })).toBe("search");
    expect(actionForKey({ key: "F", metaKey: true })).toBe("search");
  });

  it("ignores modifiers it does not own", () => {
    expect(actionForKey({ key: "ArrowLeft", altKey: true })).toBeNull();
    expect(actionForKey({ key: "q" })).toBeNull();
  });

  it("leaves text fields alone", () => {
    expect(isEditableTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableTarget({ tagName: "textarea" })).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
