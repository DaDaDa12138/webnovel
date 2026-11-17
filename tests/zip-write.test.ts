import { describe, expect, it } from "vitest";
import { crc32, writeZip } from "../apps/server/src/lib/zip-write";

describe("writeZip", () => {
  it("computes the standard CRC-32 of 123456789", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("writes a local header, central directory and end record", () => {
    const zip = writeZip([{ name: "mimetype", data: "application/epub+zip" }], new Date(2026, 0, 2, 3, 4, 6));
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt16LE(6)).toBe(0x0800);
    expect(zip.readUInt16LE(8)).toBe(0);
    const end = zip.length - 22;
    expect(zip.readUInt32LE(end)).toBe(0x06054b50);
    expect(zip.readUInt16LE(end + 8)).toBe(1);
    expect(zip.readUInt32LE(end + 16)).toBe(30 + "mimetype".length + "application/epub+zip".length);
  });

  it("keeps entry order and stores UTF-8 names", () => {
    const zip = writeZip([
      { name: "mimetype", data: "application/epub+zip" },
      { name: "OEBPS/第1章.xhtml", data: "<html />" },
    ]);
    const first = zip.indexOf(Buffer.from("mimetype"));
    const second = zip.indexOf(Buffer.from("OEBPS/第1章.xhtml"));
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(zip.readUInt16LE(zip.length - 22 + 10)).toBe(2);
  });
});
