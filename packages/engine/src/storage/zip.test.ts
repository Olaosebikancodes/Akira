import { downloadZip } from "client-zip";
import { describe, expect, it } from "vitest";
import { readZip, ZipError } from "./zip";

const text = new TextEncoder();

async function contents(blob: Blob): Promise<string> {
  return new TextDecoder().decode(await blob.arrayBuffer());
}

type Bytes = Uint8Array<ArrayBuffer>;

interface Part {
  name: string;
  /** What's stored: the bytes, already deflated when `deflated` is set. */
  data: Bytes;
  size: number;
  deflated?: boolean;
}

/**
 * Builds a zip by hand, so the tests can cover what client-zip never
 * writes for small files: ZIP64 records and deflated entries.
 */
function buildZip(parts: Part[], zip64: boolean): Blob {
  const chunks: Bytes[] = [];
  const central: Bytes[] = [];
  let offset = 0;
  for (const part of parts) {
    const name = text.encode(part.name);
    const method = part.deflated ? 8 : 0;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 45, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, method, true);
    local.setUint32(18, part.data.length, true);
    local.setUint32(22, part.size, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, part.data);

    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, 0x02014b50, true);
    header.setUint16(4, 45, true);
    header.setUint16(6, 45, true);
    header.setUint16(8, 0x0800, true);
    header.setUint16(10, method, true);
    header.setUint32(20, zip64 ? 0xffffffff : part.data.length, true);
    header.setUint32(24, zip64 ? 0xffffffff : part.size, true);
    header.setUint16(28, name.length, true);
    header.setUint16(30, zip64 ? 28 : 0, true);
    header.setUint32(42, zip64 ? 0xffffffff : offset, true);
    central.push(new Uint8Array(header.buffer), name);
    if (zip64) {
      const extra = new DataView(new ArrayBuffer(28));
      extra.setUint16(0, 0x0001, true);
      extra.setUint16(2, 24, true);
      extra.setBigUint64(4, BigInt(part.size), true);
      extra.setBigUint64(12, BigInt(part.data.length), true);
      extra.setBigUint64(20, BigInt(offset), true);
      central.push(new Uint8Array(extra.buffer));
    }
    offset += 30 + name.length + part.data.length;
  }
  const directorySize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const directoryStart = offset;
  chunks.push(...central);

  if (zip64) {
    const record = new DataView(new ArrayBuffer(56));
    record.setUint32(0, 0x06064b50, true);
    record.setBigUint64(4, 44n, true);
    record.setBigUint64(24, BigInt(parts.length), true);
    record.setBigUint64(32, BigInt(parts.length), true);
    record.setBigUint64(40, BigInt(directorySize), true);
    record.setBigUint64(48, BigInt(directoryStart), true);
    const locator = new DataView(new ArrayBuffer(20));
    locator.setUint32(0, 0x07064b50, true);
    locator.setBigUint64(8, BigInt(directoryStart + directorySize), true);
    locator.setUint32(16, 1, true);
    chunks.push(new Uint8Array(record.buffer), new Uint8Array(locator.buffer));
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, zip64 ? 0xffff : parts.length, true);
  end.setUint16(10, zip64 ? 0xffff : parts.length, true);
  end.setUint32(12, zip64 ? 0xffffffff : directorySize, true);
  end.setUint32(16, zip64 ? 0xffffffff : directoryStart, true);
  chunks.push(new Uint8Array(end.buffer));
  return new Blob(chunks);
}

async function deflate(data: Bytes): Promise<Bytes> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("readZip", () => {
  it("reads what client-zip writes", async () => {
    const zip = await downloadZip([
      { name: "project.json", input: '{"app":"akira"}' },
      { name: "media/a1/clip one.mp4", input: new Uint8Array([1, 2, 3, 4]) },
    ]).blob();
    const entries = await readZip(zip);
    expect(entries.map((e) => [e.name, e.size])).toEqual([
      ["project.json", 15],
      ["media/a1/clip one.mp4", 4],
    ]);
    expect(await contents(await entries[0]!.blob())).toBe('{"app":"akira"}');
    expect([...new Uint8Array(await (await entries[1]!.blob()).arrayBuffer())]).toEqual([1, 2, 3, 4]);
  });

  it("reads ZIP64 records, used for files over 4 GB", async () => {
    const data = text.encode("big footage");
    const zip = buildZip([{ name: "a.mp4", data, size: data.length }, { name: "b.mp4", data, size: data.length }], true);
    const entries = await readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(["a.mp4", "b.mp4"]);
    expect(await contents(await entries[1]!.blob())).toBe("big footage");
  });

  it("inflates deflated entries", async () => {
    const original = text.encode("compressed ".repeat(50));
    const zip = buildZip([{ name: "notes.txt", data: await deflate(original), size: original.length, deflated: true }], false);
    const [entry] = await readZip(zip);
    expect(await contents(await entry!.blob())).toBe("compressed ".repeat(50));
  });

  it("explains when a file isn't a zip", async () => {
    await expect(readZip(new Blob(["just text"]))).rejects.toThrow(ZipError);
  });
});
