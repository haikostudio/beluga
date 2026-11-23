import WebSocket from 'ws';

export async function login(base, username, password) {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('connexion refusée');
  return cookie;
}

export class Session {
  constructor(base, cookie) {
    this.base = base;
    this.cookie = cookie;
    this.pending = new Map();
    this.events = [];
    this.watchers = new Set();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${this.base.replace('http', 'ws')}/ws`, { headers: { cookie: this.cookie } });
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (raw) => {
        const event = JSON.parse(raw.toString());
        this.events.push(event);
        if (event.type === 'ack') {
          const entry = this.pending.get(event.id);
          if (entry) {
            this.pending.delete(event.id);
            event.ok ? entry.resolve(event.data) : entry.reject(new Error(event.error));
          }
        }
        for (const watcher of this.watchers) watcher(event);
      });
    });
  }

  call(cmd, timeoutMs = 180000) {
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2);
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, cmd }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`délai dépassé : ${cmd.type}`));
        }
      }, timeoutMs);
    });
  }

  /** Attend qu'une condition soit vraie sur les événements reçus. */
  waitFor(predicate, timeoutMs = 240000, label = 'événement') {
    return new Promise((resolve, reject) => {
      for (const event of this.events) {
        if (predicate(event, this.events.indexOf(event))) return resolve(event);
      }
      const watcher = (event) => {
        if (predicate(event, this.events.indexOf(event))) {
          this.watchers.delete(watcher);
          clearTimeout(timer);
          resolve(event);
        }
      };
      const timer = setTimeout(() => {
        this.watchers.delete(watcher);
        reject(new Error(`délai dépassé en attendant : ${label}`));
      }, timeoutMs);
      this.watchers.add(watcher);
    });
  }

  close() {
    this.ws?.close();
  }
}
