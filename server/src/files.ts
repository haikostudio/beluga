import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { FileNode } from '@haikodev/shared';
import { PATHS } from './config.js';

const IGNORED = new Set(['.git', 'node_modules', 'dist', '.next', '.nuxt', '.venv', 'venv', '__pycache__', '.cache']);

/** Garde-fou : on ne sort JAMAIS du dossier du projet (PLAN §18, §30). */
export function safeJoin(root: string, relative: string): string | null {
  const cleaned = relative.replace(/^[/\\]+/, '');
  const full = path.resolve(root, cleaned);
  const normalizedRoot = path.resolve(root);
  if (full !== normalizedRoot && !full.startsWith(normalizedRoot + path.sep)) return null;
  return full;
}

export function listDir(root: string, relative = ''): FileNode[] {
  const full = safeJoin(root, relative);
  if (!full || !fs.existsSync(full)) return [];
  const entries = fs.readdirSync(full, { withFileTypes: true });
  const nodes: FileNode[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    if (IGNORED.has(entry.name)) continue;
    const childRel = path.posix.join(relative.replace(/\\/g, '/'), entry.name);
    let size: number | undefined;
    let mtime: number | undefined;
    try {
      const stat = fs.statSync(path.join(full, entry.name));
      size = stat.size;
      mtime = stat.mtimeMs;
    } catch {
      /* fichier disparu entre-temps */
    }
    nodes.push({
      name: entry.name,
      path: childRel,
      kind: entry.isDirectory() ? 'dir' : 'file',
      size,
      mtime,
    });
  }
  return nodes.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
}

const MAX_PREVIEW = 400 * 1024;

export function readFilePreview(
  root: string,
  relative: string,
): { kind: 'text' | 'image' | 'pdf' | 'binary' | 'too_big'; content?: string; mime?: string; size: number } {
  const full = safeJoin(root, relative);
  if (!full || !fs.existsSync(full)) return { kind: 'binary', size: 0 };
  const stat = fs.statSync(full);
  const ext = path.extname(full).toLowerCase();
  const images: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  };

  if (images[ext]) {
    if (stat.size > 4 * 1024 * 1024) return { kind: 'too_big', size: stat.size };
    return {
      kind: 'image',
      mime: images[ext],
      content: fs.readFileSync(full).toString('base64'),
      size: stat.size,
    };
  }
  if (ext === '.pdf') {
    if (stat.size > 12 * 1024 * 1024) return { kind: 'too_big', size: stat.size };
    return { kind: 'pdf', mime: 'application/pdf', content: fs.readFileSync(full).toString('base64'), size: stat.size };
  }
  if (stat.size > MAX_PREVIEW) return { kind: 'too_big', size: stat.size };

  const buffer = fs.readFileSync(full);
  if (buffer.subarray(0, 1024).includes(0)) return { kind: 'binary', size: stat.size };
  return { kind: 'text', content: buffer.toString('utf8'), size: stat.size };
}

/* ------------------------------------------------------------------ */
/* Archive ZIP écrite à la main (aucune dépendance externe)            */
/* ------------------------------------------------------------------ */

interface ZipEntry {
  name: string;
  data: Buffer;
}

function collectFiles(root: string, relative: string, out: ZipEntry[], base = ''): void {
  const full = safeJoin(root, relative);
  if (!full || !fs.existsSync(full)) return;
  const stat = fs.statSync(full);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(full)) {
      if (IGNORED.has(entry) || entry.startsWith('.git')) continue;
      collectFiles(root, path.posix.join(relative, entry), out, base);
    }
  } else if (stat.isFile() && stat.size < 80 * 1024 * 1024) {
    out.push({ name: relative.replace(/^\/+/, ''), data: fs.readFileSync(full) });
  }
}

function crc32(buffer: Buffer): number {
  let table = (crc32 as any).table as number[] | undefined;
  if (!table) {
    table = [];
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    (crc32 as any).table = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buffer[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

export function zipBuffer(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const compressed = zlib.deflateRawSync(entry.data, { level: 6 });
    const useDeflate = compressed.length < entry.data.length;
    const payload = useDeflate ? compressed : entry.data;
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // noms en UTF-8
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, payload);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(useDeflate ? 8 : 0, 10);
    dir.writeUInt16LE(0, 12);
    dir.writeUInt16LE(0, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(payload.length, 20);
    dir.writeUInt32LE(entry.data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt16LE(0, 30);
    dir.writeUInt16LE(0, 32);
    dir.writeUInt16LE(0, 34);
    dir.writeUInt16LE(0, 36);
    dir.writeUInt32LE(0, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, end]);
}

export async function makeZip(
  projectPath: string,
  relatives: string[],
  label: string,
): Promise<{ file: string; name: string; size: number }> {
  const entries: ZipEntry[] = [];
  for (const rel of relatives) {
    const safe = safeJoin(projectPath, rel);
    if (!safe) throw new Error(`chemin refusé : ${rel}`);
    collectFiles(projectPath, rel.replace(/^[/\\]+/, ''), entries);
  }
  if (!entries.length) throw new Error('aucun fichier trouvé');

  const buffer = zipBuffer(entries);
  const slug = label.replace(/[^a-zA-Z0-9-_]+/g, '-').slice(0, 40) || 'archive';
  const name = `${slug}-${new Date().toISOString().slice(0, 10)}.zip`;
  const file = path.join(PATHS.archives, `${crypto.randomBytes(8).toString('hex')}-${name}`);
  fs.mkdirSync(PATHS.archives, { recursive: true });
  fs.writeFileSync(file, buffer);
  return { file, name, size: buffer.length };
}

/** Les archives sont temporaires : effacées au bout de 24 h (PLAN §18). */
export function purgeOldArchives(): void {
  try {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    for (const entry of fs.readdirSync(PATHS.archives)) {
      const full = path.join(PATHS.archives, entry);
      if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
    }
  } catch {
    /* rien à purger */
  }
}
