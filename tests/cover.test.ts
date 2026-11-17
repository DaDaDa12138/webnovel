import { describe, expect, it } from "vitest";
import { imgUrl, isJunkCover } from "../apps/web/src/lib/img";

describe("cover url filter", () => {
  it("treats empty and placeholder names as junk", () => {
    expect(isJunkCover("")).toBe(true);
    expect(isJunkCover("https://m.u9mm.com/baidu.png")).toBe(true);
    expect(isJunkCover("https://x.com/images/header-back.gif")).toBe(true);
    expect(isJunkCover("https://x.com/static/logo.jpg")).toBe(true);
  });

  it("treats broken template output as junk", () => {
    expect(isJunkCover("https://pic.cooks.tw/NaN/undefined/undefineds.jpg")).toBe(true);
    expect(isJunkCover("https://x.com/null/cover.jpg")).toBe(true);
  });

  it("keeps real cover urls", () => {
    expect(isJunkCover("https://m.jakxs.net/cover/3/3361/3361s.jpg")).toBe(false);
    expect(isJunkCover("https://x.com/covers/123.png?from=list")).toBe(false);
    expect(isJunkCover("https://x.com/api/img?u=logo.png")).toBe(false);
  });
});

describe("cover proxy", () => {
  it("leaves locally served images alone and proxies remote ones", () => {
    expect(imgUrl("/api/local-images/abc/def.png")).toBe("/api/local-images/abc/def.png");
    expect(imgUrl("/api/img?u=x.png")).toBe("/api/img?u=x.png");
    expect(imgUrl("https://x.com/a.png", 7)).toBe("/api/img?u=https%3A%2F%2Fx.com%2Fa.png&s=7");
  });
});
