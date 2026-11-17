import zlib from "node:zlib";

/**
 * 极简 ZIP 读取器（只为 EPUB 服务）。
 *
 * 从中央目录读，而不是顺着本地文件头往后走：用 data descriptor 写出来的 ZIP
 * 在本地头里大小是 0，只有中央目录才是准的。ZIP64（>4GB）不处理 —— 电子书用不到。
 */

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export function readZipEntries(buffer: Buffer): ZipEntry[] {
  let eocd = -1;
  const start = Math.max(0, buffer.length - 66_000);
  for (let i = buffer.length - 22; i >= start; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("不是有效的 ZIP：找不到中央目录结尾");

  const count = buffer.readUInt16LE(eocd + 10);
  let pointer = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (pointer + 46 > buffer.length || buffer.readUInt32LE(pointer) !== CENTRAL) break;
    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const size = buffer.readUInt32LE(pointer + 24);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const offset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.toString("utf8", pointer + 46, pointer + 46 + nameLength);
    entries.push({ name, method, compressedSize, size, offset });
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function readZipFile(buffer: Buffer, entry: ZipEntry): Buffer {
  if (buffer.readUInt32LE(entry.offset) !== LOCAL) throw new Error(`ZIP 条目损坏：${entry.name}`);
  const nameLength = buffer.readUInt16LE(entry.offset + 26);
  const extraLength = buffer.readUInt16LE(entry.offset + 28);
  const start = entry.offset + 30 + nameLength + extraLength;
  const raw = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) return zlib.inflateRawSync(raw);
  throw new Error(`不支持的压缩方式 ${entry.method}：${entry.name}`);
}

export function readZipText(buffer: Buffer, entry: ZipEntry): string {
  return readZipFile(buffer, entry).toString("utf8");
}

export function findEntry(entries: ZipEntry[], name: string): ZipEntry | undefined {
  const target = name.toLowerCase();
  return entries.find((entry) => entry.name.toLowerCase() === target);
}
