/**
 * Minimal ZIP reader (store + inflate via DecompressionStream when available).
 * Used to accept Access-like .zip wrapping a ReportPackage JSON.
 */

function readU16(view: DataView, o: number): number {
  return view.getUint16(o, true);
}

function readU32(view: DataView, o: number): number {
  return view.getUint32(o, true);
}

async function inflate(raw: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("ZIP с сжатием не поддерживается в этом браузере");
  }
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([raw]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function* iterateZipJsonEntries(
  buf: ArrayBuffer
): AsyncGenerator<{ name: string; text: string }> {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const sig = readU32(view, offset);
    if (sig !== 0x04034b50) break;
    const method = readU16(view, offset + 8);
    const compSize = readU32(view, offset + 18);
    const nameLen = readU16(view, offset + 26);
    const extraLen = readU16(view, offset + 28);
    const nameStart = offset + 30;
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    const data = bytes.subarray(dataStart, dataStart + compSize);
    offset = dataStart + compSize;
    if (!name.toLowerCase().endsWith(".json")) continue;
    let payload = data;
    if (method === 8) payload = await inflate(data);
    else if (method !== 0) {
      throw new Error(`Неподдерживаемый метод сжатия ZIP: ${method}`);
    }
    yield { name, text: new TextDecoder().decode(payload) };
  }
}

/** Extract text of the first package .json entry in a ZIP (skip manifest). */
export async function unzipFirstJson(buf: ArrayBuffer): Promise<string> {
  let firstAny: string | null = null;
  for await (const entry of iterateZipJsonEntries(buf)) {
    const base = entry.name.split("/").pop()?.toLowerCase() ?? entry.name.toLowerCase();
    if (!firstAny) firstAny = entry.text;
    if (base === "manifest.json") continue;
    return entry.text;
  }
  if (firstAny) return firstAny;
  throw new Error("В ZIP нет JSON-комплекта");
}

/** All .json entries except manifest.json (bulk package archive). */
export async function unzipAllPackageJson(
  buf: ArrayBuffer
): Promise<Array<{ name: string; text: string }>> {
  const out: Array<{ name: string; text: string }> = [];
  for await (const entry of iterateZipJsonEntries(buf)) {
    const base = entry.name.split("/").pop()?.toLowerCase() ?? entry.name.toLowerCase();
    if (base === "manifest.json") continue;
    out.push(entry);
  }
  if (!out.length) throw new Error("В ZIP нет JSON-комплектов");
  return out;
}
