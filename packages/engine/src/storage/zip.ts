/**
 * Reads .zip files without loading them into memory. Stored entries come
 * back as slices of the original file, so opening a project zip with
 * gigabytes of footage costs almost nothing; deflated entries are inflated
 * as a stream by the browser. ZIP64 is supported for files over 4 GB.
 */

export class ZipError extends Error {
  override name = "ZipError";
}

export interface ZipEntry {
  /** Path inside the archive, with forward slashes. */
  name: string;
  /** Size once extracted. */
  size: number;
  /** The entry's contents. */
  blob(): Promise<Blob>;
}

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const ZIP64_EXTRA = 0x0001;
const STORED = 0;
const DEFLATED = 8;
/** End record (22 bytes) plus the longest possible comment. */
const MAX_EOCD_SEARCH = 22 + 0xffff;

export async function readZip(file: Blob): Promise<ZipEntry[]> {
  const tailStart = Math.max(0, file.size - MAX_EOCD_SEARCH);
  const tail = await view(file, tailStart, file.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("This isn't a zip file.");

  let count = tail.getUint16(eocd + 10, true);
  let directorySize = tail.getUint32(eocd + 12, true);
  let directoryStart = tail.getUint32(eocd + 16, true);
  if (count === 0xffff || directorySize === 0xffffffff || directoryStart === 0xffffffff) {
    // ZIP64: a locator just before the end record points at the real one.
    const locatorAt = tailStart + eocd - 20;
    const locator = await view(file, locatorAt, locatorAt + 20);
    if (locator.getUint32(0, true) !== ZIP64_LOCATOR) throw new ZipError("This zip file is damaged.");
    const recordAt = u64(locator, 8);
    const record = await view(file, recordAt, recordAt + 56);
    if (record.getUint32(0, true) !== ZIP64_EOCD) throw new ZipError("This zip file is damaged.");
    count = u64(record, 32);
    directorySize = u64(record, 40);
    directoryStart = u64(record, 48);
  }

  const directory = await view(file, directoryStart, directoryStart + directorySize);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    if (directory.getUint32(at, true) !== CENTRAL) throw new ZipError("This zip file is damaged.");
    const method = directory.getUint16(at + 10, true);
    let compressedSize = directory.getUint32(at + 20, true);
    let size = directory.getUint32(at + 24, true);
    const nameLength = directory.getUint16(at + 28, true);
    const extraLength = directory.getUint16(at + 30, true);
    const commentLength = directory.getUint16(at + 32, true);
    let localAt = directory.getUint32(at + 42, true);
    const name = decoder.decode(new Uint8Array(directory.buffer, directory.byteOffset + at + 46, nameLength));

    // Sizes too big for 32 bits live in the ZIP64 extra field, in this order.
    let extra = at + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = directory.getUint16(extra, true);
      const length = directory.getUint16(extra + 2, true);
      if (id === ZIP64_EXTRA) {
        let field = extra + 4;
        if (size === 0xffffffff) {
          size = u64(directory, field);
          field += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = u64(directory, field);
          field += 8;
        }
        if (localAt === 0xffffffff) localAt = u64(directory, field);
      }
      extra += 4 + length;
    }
    at = extraEnd + commentLength;

    if (name.endsWith("/")) continue;
    if (method !== STORED && method !== DEFLATED) {
      throw new ZipError(`${name} is compressed in a way Akira can't read. Save the zip again without special compression.`);
    }
    entries.push({ name, size, blob: () => entryData(file, localAt, compressedSize, method) });
  }
  return entries;
}

async function entryData(file: Blob, localAt: number, compressedSize: number, method: number): Promise<Blob> {
  // The local header repeats the name and has its own extra field, so its length has to be read.
  const header = await view(file, localAt, localAt + 30);
  if (header.getUint32(0, true) !== LOCAL) throw new ZipError("This zip file is damaged.");
  const start = localAt + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const data = file.slice(start, start + compressedSize);
  if (method === STORED) return data;
  return new Response(data.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
}

async function view(file: Blob, start: number, end: number): Promise<DataView> {
  if (end > file.size) throw new ZipError("This zip file is cut short.");
  return new DataView(await file.slice(start, end).arrayBuffer());
}

function u64(data: DataView, at: number): number {
  const value = data.getBigUint64(at, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipError("This zip file is too large.");
  return Number(value);
}
