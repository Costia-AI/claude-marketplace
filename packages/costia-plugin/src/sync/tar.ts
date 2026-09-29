import { gunzipSync } from "node:zlib";

/**
 * Reads the regular files of a gzipped ustar archive into memory. Only used for
 * blob bundles, whose entries are named by hash and never used as paths.
 */
export function readTarGz(data: Buffer, maxBytes = 50 * 1024 * 1024): Map<string, Buffer> {
  const tar = gunzipSync(data, { maxOutputLength: maxBytes });
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(header.subarray(124, 136).toString("utf8").replace(/\0.*$/s, "").trim() || "0", 8);
    const type = String.fromCharCode(header[156] ?? 48);
    offset += 512;
    if (type === "0" || type === "\0") entries.set(name.split("/").pop()!, Buffer.from(tar.subarray(offset, offset + size)));
    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}
