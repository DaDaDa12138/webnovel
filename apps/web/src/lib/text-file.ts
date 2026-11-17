/**
 * 本地 TXT 文件的编码嗅探。
 *
 * 中文 TXT 大多是 UTF-8 或 GBK：先按 BOM 判，再试严格 UTF-8（解不开就说明不是），
 * 最后退到 GBK。不要反过来先试 GBK —— GBK 几乎能「成功」解出任何字节，
 * 会把 UTF-8 文件解成乱码。
 */

export function decodeTextFile(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("gbk").decode(bytes);
    } catch {
      return new TextDecoder("utf-8").decode(bytes);
    }
  }
}

/** 文件名去掉扩展名当书名。 */
export function txtNameOf(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim().slice(0, 120);
}
