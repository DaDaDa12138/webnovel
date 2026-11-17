/**
 * 书籍资料的写入校验。
 *
 * 这些字段以前只能由书源写入，用户改不了；现在允许手工修正书名/作者/简介/封面。
 * 校验放在服务端而不是只靠前端 maxlength：接口是公开的，空书名或 javascript: 封面
 * 都会把书架弄坏。空字符串是合法值（用来清空作者/简介/封面），但书名不允许空。
 */

export interface BookMetaPatch {
  name?: string;
  author?: string;
  intro?: string;
  coverUrl?: string;
}

export interface BookMetaResult {
  patch: BookMetaPatch;
  error: string;
}

const COVER_PREFIX = /^(https?:\/\/|\/api\/|data:image\/)/i;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export function normalizeBookMeta(body: Record<string, unknown>): BookMetaResult {
  const patch: BookMetaPatch = {};

  if (body.name !== undefined) {
    const name = text(body.name, 200);
    if (name === null) return { patch, error: "书名格式不对" };
    if (!name) return { patch, error: "书名不能为空" };
    patch.name = name;
  }

  if (body.author !== undefined) {
    const author = text(body.author, 100);
    if (author === null) return { patch, error: "作者格式不对" };
    patch.author = author;
  }

  if (body.intro !== undefined) {
    if (typeof body.intro !== "string") return { patch, error: "简介格式不对" };
    patch.intro = body.intro.trim().slice(0, 2000);
  }

  if (body.coverUrl !== undefined) {
    if (typeof body.coverUrl !== "string") return { patch, error: "封面地址格式不对" };
    const coverUrl = body.coverUrl.trim().slice(0, 1000);
    if (coverUrl && !COVER_PREFIX.test(coverUrl)) {
      return { patch, error: "封面地址要以 http(s)://、/api/ 或 data:image/ 开头" };
    }
    patch.coverUrl = coverUrl;
  }

  return { patch, error: "" };
}
