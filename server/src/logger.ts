import fs from 'node:fs';
import path from 'node:path';

function stamp(): string {
  return new Date().toISOString();
}

function write(level: string, args: unknown[]): void {
  const line = args
    .map((a) => (typeof a === 'string' ? a : a instanceof Error ? `${a.message}\n${a.stack}` : JSON.stringify(a)))
    .join(' ');
  const out = `[${stamp()}] ${level} ${line}`;
  if (level === 'ERROR') console.error(out);
  else console.log(out);
}

export const log = {
  info: (...args: unknown[]) => write('INFO', args),
  warn: (...args: unknown[]) => write('WARN', args),
  error: (...args: unknown[]) => write('ERROR', args),
  debug: (...args: unknown[]) => {
    if (process.env.BELUGA_DEBUG) write('DEBUG', args);
  },
};

/** Un fichier de journal par agent, conservé pour rejouer un tour (PLAN §12). */
export function agentLog(dir: string, agentId: string, chunk: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${agentId}.log`), chunk.endsWith('\n') ? chunk : chunk + '\n');
  } catch {
    /* un journal ne doit jamais faire tomber le démon */
  }
}
