import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { findEntry, readZipEntries, readZipFile, readZipText } from "../apps/server/src/services/books/zip";

interface Fixture {
  name: string;
  data: string;
  deflate?: boolean;
}

/** 手搓一个最小 ZIP：测试只关心「读得回来」，所以 CRC 一律写 0。 */
function makeZip(files: Fixture[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const raw = Buffer.from(file.data, "utf8");
    const body = file.deflate ? deflateRawSync(raw) : raw;
    const name = Buffer.from(file.name, "utf8");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(file.deflate ? 8 : 0, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(file.deflate ? 8 : 0, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, eocd]);
}

describe("zip reader", () => {
  const buffer = makeZip([
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: "<container/>" },
    { name: "OEBPS/ch1.xhtml", data: "<html><body><p>第一章正文</p></body></html>", deflate: true },
  ]);

  it("列出全部条目", () => {
    const entries = readZipEntries(buffer);
    expect(entries.map((entry) => entry.name)).toEqual(["mimetype", "META-INF/container.xml", "OEBPS/ch1.xhtml"]);
  });

  it("读取未压缩与 deflate 压缩的条目", () => {
    const entries = readZipEntries(buffer);
    expect(readZipText(buffer, findEntry(entries, "mimetype")!)).toBe("application/epub+zip");
    expect(readZipFile(buffer, findEntry(entries, "OEBPS/ch1.xhtml")!).toString("utf8")).toContain("第一章正文");
  });

  it("按名字找条目时忽略大小写", () => {
    expect(findEntry(readZipEntries(buffer), "meta-inf/CONTAINER.xml")).toBeTruthy();
  });

  it("不是 ZIP 时报错", () => {
    expect(() => readZipEntries(Buffer.from("hello"))).toThrow(/ZIP/);
  });
});
