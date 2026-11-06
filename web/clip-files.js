// Files through the RDP clipboard: what app.js needs that touches no page, so node can test it.
// FreeRDP takes the list of a copy as the protocol has it (CLIPRDR_FILELIST: a 32-bit count, then
// a 592-byte FILEDESCRIPTORW per file or folder, with "\" between folders), and the page answers
// and asks for the contents itself: only the main browser thread can read a File or write a save.
(function (root) {
  "use strict";
  const HEADER = 4, DESCRIPTOR = 592, NAME = 72, NAME_CHARS = 260;
  const FD_ATTRIBUTES = 0x4, FD_FILESIZE = 0x40, FD_PROGRESSUI = 0x4000;
  const ATTR_DIRECTORY = 0x10, ATTR_NORMAL = 0x80;
  const SIZE = 1, RANGE = 2;   // FILECONTENTS_SIZE, FILECONTENTS_RANGE
  const MAX_FILES = 100000;
  const TWO32 = 2 ** 32;

  // entries: { path: "folder/name", size, dir }, a folder before what is in it.
  // @return the CLIPRDR_FILELIST, or throws { tooLong: path } for a name the protocol can't hold
  function buildList(entries) {
    const out = new Uint8Array(HEADER + entries.length * DESCRIPTOR), v = new DataView(out.buffer);
    v.setUint32(0, entries.length, true);
    entries.forEach((e, i) => {
      const at = HEADER + i * DESCRIPTOR, name = e.path.replace(/\//g, "\\");
      if (name.length >= NAME_CHARS) throw { tooLong: e.path };
      v.setUint32(at, FD_ATTRIBUTES | FD_FILESIZE | FD_PROGRESSUI, true);
      v.setUint32(at + 36, e.dir ? ATTR_DIRECTORY : ATTR_NORMAL, true);
      const size = e.dir ? 0 : e.size;
      v.setUint32(at + 64, Math.floor(size / TWO32), true);
      v.setUint32(at + 68, size % TWO32, true);
      for (let c = 0; c < name.length; c++) v.setUint16(at + NAME + 2 * c, name.charCodeAt(c), true);
    });
    return out;
  }

  // A name from the server: a plain relative path, or nothing. It ends up in a folder this
  // visitor picked, or in a ZIP that some tool unpacks.
  function cleanPath(name) {
    const parts = name.split(/[\\/]/);
    for (const p of parts) {
      if (p === "" || p === "." || p === ".." || /[\x00-\x1f\x7f]/.test(p)) return null;
    }
    return parts.join("/");
  }

  // @return { entries: [{ index, path, size, dir }], size, files }, or null for a list that isn't
  // one: the wrong length, too many files, a name that would leave the folder
  function parseList(bytes) {
    if (!bytes || bytes.length < HEADER) return null;
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = v.getUint32(0, true);
    if (count === 0 || count > MAX_FILES || bytes.length !== HEADER + count * DESCRIPTOR) return null;
    const entries = [];
    let size = 0, files = 0;
    const words = new TextDecoder("utf-16le");
    for (let i = 0; i < count; i++) {
      const at = HEADER + i * DESCRIPTOR, raw = bytes.subarray(at + NAME, at + NAME + 2 * NAME_CHARS);
      let end = 0;
      while (end < raw.length && (raw[end] || raw[end + 1])) end += 2;
      const path = cleanPath(words.decode(raw.subarray(0, end)));
      if (!path) return null;
      const dir = (v.getUint32(at + 36, true) & ATTR_DIRECTORY) !== 0;
      const bytesOf = dir ? 0 : v.getUint32(at + 64, true) * TWO32 + v.getUint32(at + 68, true);
      if (!Number.isSafeInteger(bytesOf)) return null;
      entries.push({ index: i, path, size: bytesOf, dir });
      size += bytesOf; if (!dir) files++;
    }
    return { entries, size, files };
  }

  // What was dropped or pasted: a list of files, and of folders with all that is in them. The
  // browser hands over the entries only during the event: call it there, await it after.
  // items: the event's DataTransferItemList. @return [{ path, size, dir, file }]
  function fromItems(items) {
    const roots = [];
    for (const item of items) {
      if (item.kind !== "file") continue;
      const entry = item.webkitGetAsEntry?.();
      if (entry) roots.push(entry);
      else { const file = item.getAsFile(); if (file) roots.push(file); }
    }
    return (async () => {
      const out = [];
      for (const r of roots) await walk(r, "", out);
      return out;
    })();
  }
  const fromFiles = (files) => Array.from(files, (file) => ({ path: file.name, size: file.size, dir: false, file }));
  async function walk(entry, prefix, out) {
    if (entry.isDirectory) {
      const path = prefix + entry.name, reader = entry.createReader();
      out.push({ path, size: 0, dir: true });
      for (;;) {                                 // a folder comes in pieces, the last one empty
        const part = await new Promise((ok, no) => reader.readEntries(ok, no));
        if (!part.length) break;
        for (const child of part) await walk(child, path + "/", out);
      }
    } else if (entry.isFile) {
      const file = await new Promise((ok, no) => entry.file(ok, no));
      out.push({ path: prefix + file.name, size: file.size, dir: false, file });
    } else out.push({ path: prefix + entry.name, size: entry.size, dir: false, file: entry });   // a File
  }

  // "report.pdf" → "report (1).pdf": the first of those free in a folder
  function freeName(name, taken) {
    if (!taken(name)) return name;
    const dot = name.lastIndexOf("."), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
    for (let n = 1; ; n++) { const next = `${stem} (${n})${ext}`; if (!taken(next)) return next; }
  }

  const sizeText = (n) => {
    if (n < 1024) return n + " B";
    const units = ["KB", "MB", "GB", "TB"];
    let v = n, u = -1;
    do { v /= 1024; u++; } while (v >= 1024 && u < units.length - 1);
    return (v < 10 ? v.toFixed(1) : Math.round(v)) + " " + units[u];
  };

  // A ZIP without compression, for browsers that can save one file only and not a folder.
  // Headers as the format has them, UTF-8 names (bit 11); no ZIP64, so up to 2 GiB in all.
  const CRC = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  function crc32(crc, bytes) {                 // start at 0, feed the pieces in order
    let c = ~crc;
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return ~c >>> 0;
  }
  function zipRecord(signature, fixed, name) {
    const out = new Uint8Array(fixed + name.length), v = new DataView(out.buffer);
    v.setUint32(0, signature, true);
    out.set(name, fixed);
    return { out, v };
  }
  // @return the bytes before the file's data, and the record for the end of the archive
  function zipEntry(path, crc, size, offset, dir) {
    const name = new TextEncoder().encode(dir ? path + "/" : path);
    const shared = (v, at) => {
      v.setUint16(at, 20, true); v.setUint16(at + 2, 0x0800, true);
      v.setUint16(at + 8, 0x21, true);              // 1980-01-01: the page doesn't get the time
      v.setUint32(at + 10, crc, true); v.setUint32(at + 14, size, true); v.setUint32(at + 18, size, true);
      v.setUint16(at + 22, name.length, true);
    };
    const local = zipRecord(0x04034b50, 30, name); shared(local.v, 4);
    const central = zipRecord(0x02014b50, 46, name);
    central.v.setUint16(4, 20, true); shared(central.v, 6);
    central.v.setUint32(42, offset, true);
    return { local: local.out, central: central.out };
  }
  function zipEnd(count, centralSize, offset) {
    const end = zipRecord(0x06054b50, 22, new Uint8Array(0));
    end.v.setUint16(8, count, true); end.v.setUint16(10, count, true);
    end.v.setUint32(12, centralSize, true); end.v.setUint32(16, offset, true);
    return end.out;
  }

  const api = { SIZE, RANGE, buildList, parseList, cleanPath, fromItems, fromFiles, freeName, sizeText, crc32, zipEntry, zipEnd };
  root.FreeRDPClipFiles = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
