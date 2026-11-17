import { describe, expect, it } from "vitest";
import { assessContentQuality } from "../apps/server/src/services/content-quality";

const paragraph = "夜色从窗缝里慢慢压进来，他把灯芯挑亮了一点，继续翻看手里的旧信。";
const NL = String.fromCharCode(10);
const FFFD = String.fromCharCode(0xfffd);

describe("content quality", () => {
  it("rejects empty or very short content", () => {
    expect(assessContentQuality("").quality).toBe("bad");
    expect(assessContentQuality("短句").quality).toBe("bad");
    expect(assessContentQuality("   " + NL + "  ").quality).toBe("bad");
  });

  it("rejects placeholder and login/paywall pages", () => {
    expect(assessContentQuality("正在手打中，请稍后再来。").quality).toBe("bad");
    expect(assessContentQuality("请先登录后阅读本章。", 500).reason).toContain("登录/付费");
    expect(assessContentQuality("本章需购买，余额不足。", 500).quality).toBe("bad");
  });

  it("accepts ordinary prose", () => {
    const text = (paragraph + NL).repeat(6);
    const result = assessContentQuality(text);
    expect(result.quality).toBe("ok");
    expect(result.score).toBe(100);
    expect(result.reason).toBe("");
  });

  it("marks site notices and HTML residue as suspect", () => {
    const text = "防盗提醒：请勿转载，最新网址 example.com。" + NL + (paragraph + NL).repeat(5);
    const notice = assessContentQuality(text);
    expect(notice.quality).toBe("ok");
    expect(notice.score).toBe(80);

    const html = "<p>" + paragraph + "</p>" + NL + (paragraph + NL).repeat(5);
    const tags = assessContentQuality(html, 400);
    expect(tags.quality).toBe("suspect");
    expect(tags.reason).toContain("HTML 标签残留");

    const mixed = assessContentQuality("防盗提醒：请勿转载，最新网址 example.com。" + NL + paragraph + "<p>" + paragraph + "</p>", 400);
    expect(mixed.quality).toBe("suspect");
    expect(mixed.reason).toContain("站点声明");
  });

  it("penalizes URL-heavy and duplicated paragraphs", () => {
    const urls = "https://a.example/1 https://b.example/2 https://c.example/3 https://d.example/4" + NL + (paragraph + NL).repeat(5);
    expect(assessContentQuality(urls, 400).reason).toContain("链接较多");

    const repeated = "防盗提醒：请勿转载。" + NL + (paragraph + NL).repeat(3) + ("另一段完全不同的正文内容，用来凑够长度。" + NL).repeat(3);
    expect(assessContentQuality(repeated, 400).reason).toContain("重复段落");
  });

  it("uses the supplied character count when the source provides one", () => {
    expect(assessContentQuality("短文本", 500).quality).toBe("ok");
    expect(assessContentQuality(paragraph, 10).quality).toBe("bad");
  });

  it("flags replacement characters and private-use glyphs", () => {
    const long = (paragraph + NL).repeat(30);
    const one = assessContentQuality(long + FFFD);
    expect(one.quality).toBe("suspect");
    expect(one.flags?.replacement).toBe(1);
    expect(one.reason).toContain("替换字符");

    const three = assessContentQuality(long + FFFD + FFFD + FFFD);
    expect(three.quality).toBe("bad");
    expect(three.flags?.replacement).toBe(3);

    const privateUse = assessContentQuality(long + String.fromCharCode(0xe001, 0xe002, 0xe003));
    expect(privateUse.quality).toBe("suspect");
    expect(privateUse.flags?.privateUse).toBe(3);
    expect(privateUse.reason).toContain("私用区");
  });

  it("flags question-mark garbage and control characters", () => {
    const long = (paragraph + NL).repeat(30);
    const marks = assessContentQuality(long + "?? 第一卷：毒剂师 ??");
    expect(marks.quality).toBe("suspect");
    expect(marks.flags?.questionMarks).toBeGreaterThanOrEqual(4);

    const control = assessContentQuality(long + String.fromCharCode(1, 2, 3));
    expect(control.quality).toBe("suspect");
    expect(control.flags?.controlChars).toBe(3);
  });
});
