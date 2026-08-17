import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';
const ID = 'd4a2f7c8-31a8-4e50-a37a-fe7cbea20bcc';
const db = new Database('/root/haikodev/data/haikodev.db');
const ligne = db.prepare('SELECT data FROM deploys WHERE id = ?').get(ID);
const run = JSON.parse(ligne.data);
run.state = 'stopped';
for (const etape of run.steps) {
  if (etape.state === 'running') {
    etape.state = 'failed';
    etape.log = (etape.log || '') + "\nPublication arrêtée à la main : l'agent de dépannage n'a jamais démarré (préparation bloquée), la fusion ne pouvait pas avancer.";
    delete etape.progress;
  }
}
const fin = Date.now();
run.endedAt = fin;
db.prepare('UPDATE deploys SET state = ?, data = ?, ended_at = ? WHERE id = ?').run('stopped', JSON.stringify(run), fin, ID);
console.log('publication refermée :', ID);
const v = db.prepare('SELECT state, ended_at FROM deploys WHERE id = ?').get(ID);
console.log('état :', v.state, '· fin :', new Date(v.ended_at).toLocaleTimeString('fr-FR'));
