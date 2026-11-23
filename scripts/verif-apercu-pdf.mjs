#!/usr/bin/env node
/**
 * LES PDF ET LES FICHIERS CITÉS, DANS UN VRAI NAVIGATEUR.
 *
 *   npm run build && node scripts/verif-apercu-pdf.mjs
 *
 * Démon d'essai à soi (base neuve, aucun moteur appelé). Le PDF de contrôle
 * est écrit à la main (une page, table des renvois calculée) : aucun fichier
 * binaire n'est versionné pour l'occasion.
 *
 * Ce qui est vérifié :
 *   1. la vignette d'un PDF est l'image PNG de sa première page ;
 *   2. un PDF joint par l'agent entre dans la bande « Ce que l'agent a vu »,
 *      marqué PDF, et son clic ouvre la visionneuse sur le document ;
 *   3. la pastille du PDF dans le fil ouvre l'aperçu, sa flèche télécharge ;
 *   4. un chemin cité en `code` dans la réponse s'ouvre dans la visionneuse,
 *      par la route en lecture seule ;
 *   5. un chemin cité introuvable ouvre la fenêtre qui le DIT ;
 *   6. la route refuse ce qui sort des dossiers du projet.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_APERCU_PDF_PORT || 7249);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort, nettoyer } = demarrerDemonDEssai({
  prefixe: 'verif-apercu-pdf-',
  port: PORT,
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET = 'p-pdf';
const CARTE = 'c-pdf';
const AGENT = 'ag-pdf';
const TITRE = 'Carte d’aperçu PDF';
const CITE = 'docs/rapport-cite.pdf';
const ABSENT = '/tmp/dossier-absent/inexistant.pdf';

/** Un PDF d'une page, écrit à la main. */
function petitPdf() {
  const objets = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 4 0 R >>',
    '<< /Length 33 >>\nstream\n0 0 1 rg 50 50 500 700 re f\nendstream',
  ];
  let corps = '%PDF-1.4\n';
  const positions = [];
  objets.forEach((o, i) => {
    positions.push(Buffer.byteLength(corps));
    corps += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(corps);
  corps += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`;
  for (const p of positions) corps += `${String(p).padStart(10, '0')} 00000 n \n`;
  corps += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(corps);
}

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton), maintenant, maintenant + 3600_000, 'vérification aperçu PDF',
  );
  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET, name: 'Essai PDF', path: DEPOT, defaultEngine: 'claude', isSelf: false,
    rank: 1, archived: false, createdAt: maintenant, updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(PROJET, projet.name, DEPOT, JSON.stringify(projet), maintenant, maintenant);
  const agent = {
    id: AGENT, projectId: PROJET, cardId: CARTE, role: 'task', title: TITRE,
    run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'idle',
    createdAt: maintenant, updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(AGENT, PROJET, CARTE, 'task', 'idle', JSON.stringify(agent), maintenant, maintenant);
  const carte = {
    id: CARTE, projectId: PROJET, title: TITRE, description: 'Essai des PDF.', labels: [],
    column: 'to_deploy', position: 1, origin: 'agent', agentId: AGENT,
    run: { engine: 'claude', thinking: 'none', mode: 'direct' }, excludedFromDeploy: false, horsTache: false,
    scheduling: { asap: false, attempts: 0, restarts: 0 }, createdAt: maintenant, updatedAt: maintenant,
  };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(CARTE, PROJET, 'to_deploy', 1, TITRE, JSON.stringify(carte), maintenant, maintenant);
  db.close();
}

function poserLaReponse(pieceId) {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  const message = {
    id: 'm-pdf', agentId: AGENT, role: 'assistant',
    content: `Le rapport est prêt. Le fichier cité : \`${CITE}\`. Un autre, absent : \`${ABSENT}\`. Un site : [exemple](https://exemple.fr).`,
    steps: [], todos: [], proposals: [], questions: [], downloads: [], attachments: [pieceId], streaming: false,
    createdAt: maintenant,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    message.id, AGENT, 'assistant', JSON.stringify(message), maintenant,
  );
  // Une DEMANDE qui joint le même PDF : c'est la pastille du point « Demande ».
  const demande = { ...message, id: 'm-pdf-demande', role: 'user', content: 'Voici le PDF de départ', createdAt: maintenant - 60_000 };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    demande.id, AGENT, 'user', JSON.stringify(demande), demande.createdAt,
  );
  db.prepare(
    `INSERT INTO card_journal (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle, resultat, donnees)
     VALUES (?, ?, 0, 'execution', 'jalon', ?, ?, 'execution', 'tour-pdf', 'Demande', ?, ?)`,
  ).run('j-pdf-demande', CARTE, demande.createdAt, AGENT, demande.content, JSON.stringify({ pieces: [pieceId] }));
  // La MÊME réponse, telle que la ligne de temps de la carte la montre (point « Rapport »).
  db.prepare(
    `INSERT INTO card_journal (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle, resultat, reussie, donnees)
     VALUES (?, ?, 1, 'rapport', 'jalon', ?, ?, 'task', ?, 'Réponse rendue', ?, 1, ?)`,
  ).run('j-pdf', CARTE, maintenant, AGENT, message.id, message.content, JSON.stringify({ pieces: [pieceId] }));
  db.close();
}

const entete = { cookie: `beluga_session=${jeton}` };

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  fs.mkdirSync(path.join(DEPOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(DEPOT, CITE), petitPdf());

  const envoi = await fetch(`${BASE}/api/upload?project=${PROJET}`, {
    method: 'POST',
    headers: { ...entete, 'content-type': 'application/pdf', 'x-file-name': 'rapport-joint.pdf' },
    body: petitPdf(),
  });
  const piece = (await envoi.json()).attachment;
  noter('le PDF est déposé', !!piece?.id && piece.mime === 'application/pdf');
  if (!piece?.id) return;
  poserLaReponse(piece.id);

  /* 1. La vignette d'un PDF est une image. */
  const vignette = await fetch(`${BASE}/api/attachment?id=${piece.id}&w=480`, { headers: entete });
  const octets = Buffer.from(await vignette.arrayBuffer());
  noter(
    'la vignette d’un PDF est l’image PNG de sa première page',
    vignette.headers.get('content-type') === 'image/png' && octets.subarray(1, 4).toString() === 'PNG',
    `${vignette.headers.get('content-type')}, ${octets.length} o`,
  );

  /* 6. La route des fichiers cités reste dans ses dossiers. */
  const fiche = await fetch(`${BASE}/api/fichier-cite?project=${PROJET}&path=${encodeURIComponent(CITE)}&info=1`, { headers: entete });
  noter('la route lit un fichier cité du projet', fiche.ok && (await fiche.json()).mime === 'application/pdf');
  const dehors = await fetch(`${BASE}/api/fichier-cite?project=${PROJET}&path=${encodeURIComponent('/etc/passwd')}`, { headers: entete });
  noter('la route refuse un fichier hors des dossiers du projet', dehors.status === 404, String(dehors.status));
  const remonte = await fetch(`${BASE}/api/fichier-cite?project=${PROJET}&path=${encodeURIComponent('../../etc/passwd')}`, { headers: entete });
  noter('la route refuse une remontée par « .. »', remonte.status === 404, String(remonte.status));
  const sansSession = await fetch(`${BASE}/api/fichier-cite?project=${PROJET}&path=${encodeURIComponent(CITE)}&info=1`);
  noter('la route est fermée sans session', !sansSession.ok, String(sansSession.status));

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 900 } });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE }]);
    const page = await contexte.newPage();
    await page.goto(`${BASE}/#projet/${PROJET}/tache/${CARTE}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    /* 2. La bande montre le PDF, et l'ouvre. */
    const dansLaBande = page.locator(`[data-capture-du-flux="jointe:${piece.id}"]`).first();
    await dansLaBande.waitFor({ timeout: 10_000 }).catch(() => {});
    const present = (await dansLaBande.count()) > 0;
    noter('le PDF de l’agent entre dans la bande « Ce que l’agent a vu »', present);
    if (!present) {
      await page.screenshot({ path: '/tmp/apercu-pdf-sans-bande.png', fullPage: true }).catch(() => {});
      console.log('--- écran ---\n' + (await page.evaluate(() => document.body.innerText)).slice(0, 2500));
      return;
    }
    noter('sa vignette est marquée PDF', (await dansLaBande.getAttribute('data-capture-media')) === 'pdf' && (await dansLaBande.locator('[data-capture-pdf]').count()) === 1);
    await page.waitForTimeout(1500);
    const largeur = await dansLaBande.locator('img').first().evaluate((img) => img.naturalWidth).catch(() => 0);
    noter('la vignette montre la première page', largeur > 0, `${largeur} px`);
    await dansLaBande.click();
    const cadre = page.locator('[data-visionneuse-total] iframe').first();
    await cadre.waitFor({ timeout: 8000 }).catch(() => {});
    noter('le clic sur la vignette ouvre le PDF dans la visionneuse', (await cadre.count()) > 0);
    await page.screenshot({ path: path.join(DATA, '..', 'apercu-pdf-visionneuse.png') }).catch(() => {});
    await page.locator('[data-fermer-visionneuse]').first().click();
    await page.waitForTimeout(800);

    // La réponse vit dans le point « Travail » de la ligne de temps : on le
    // déplie par son ÉTAT (`data-point`), jamais par un libellé.
    for (const etape of ['demande', 'travail', 'rapport']) {
      const point = page.locator(`[data-point="${etape}"]`).first();
      if (!(await point.count())) continue;
      if ((await point.getAttribute('data-point-ouvert')) !== 'oui') {
        await point.click({ position: { x: 60, y: 12 } }).catch(() => {});
      }
      await page.waitForTimeout(1500);
    }
    if (process.env.VERIF_DEBUG) {
      await page.screenshot({ path: '/tmp/apercu-pdf-fil.png', fullPage: true }).catch(() => {});
      console.log('--- écran ---\n' + (await page.evaluate(() => document.body.innerText)).slice(0, 3000));
      console.log([...new Set(await page.locator('[data-point]').evaluateAll((l) => l.map((e) => e.getAttribute('data-point') + ':' + e.getAttribute('data-point-ouvert'))))].join(' '));
    }
    /* 3. La pastille du fil ouvre l'aperçu. */
    const pastille = page.locator(`[data-apercu-pdf="${piece.id}"]`).first();
    if (await pastille.count()) {
      noter('la pastille du PDF garde sa flèche de téléchargement', (await page.locator(`[data-lien-piece="${piece.id}"][download]`).count()) > 0);
      await pastille.scrollIntoViewIfNeeded().catch(() => {});
      await pastille.click();
      const cadre2 = page.locator('[data-visionneuse-total] iframe').first();
      await cadre2.waitFor({ timeout: 8000 }).catch(() => {});
      noter('le clic sur la pastille du PDF ouvre l’aperçu', (await cadre2.count()) > 0);
      await page.locator('[data-fermer-visionneuse]').first().click();
      await page.waitForTimeout(800);
    } else {
      noter('la pastille du PDF s’affiche dans le fil', false);
    }

    /* 4. Un chemin cité s'ouvre dans la visionneuse. */
    const cite = page.locator(`[data-fichier-cite="${CITE}"]`).first();
    await cite.waitFor({ timeout: 8000 }).catch(() => {});
    noter('le chemin cité est cliquable', (await cite.count()) > 0);
    noter('un lien vers un site reste en nouvel onglet', (await page.locator('a[href="https://exemple.fr"][target="_blank"]').count()) > 0);
    if (await cite.count()) {
      await cite.scrollIntoViewIfNeeded().catch(() => {});
      await cite.click();
      const cadre3 = page.locator('[data-visionneuse-total] iframe').first();
      await cadre3.waitFor({ timeout: 8000 }).catch(() => {});
      const src = (await cadre3.getAttribute('src').catch(() => '')) ?? '';
      noter('le fichier cité s’ouvre dans la visionneuse, par la route en lecture seule', src.includes('/api/fichier-cite'), src);
      await page.locator('[data-fermer-visionneuse]').first().click();
      await page.waitForTimeout(800);
    }

    /* 5. Un chemin introuvable le dit. */
    const absent = page.locator(`[data-fichier-cite="${ABSENT}"]`).first();
    if (await absent.count()) {
      await absent.click();
      const erreur = page.locator('[data-visionneuse-erreur]').first();
      await erreur.waitFor({ timeout: 8000 }).catch(() => {});
      const phrase = await erreur.innerText().catch(() => '');
      noter('un fichier cité introuvable ouvre une fenêtre qui dit la vraie raison', /pas encore/.test(phrase), phrase.slice(0, 120));
      await page.keyboard.press('Escape');
    } else {
      noter('le chemin absent est cliquable', false);
    }
  } finally {
    await navigateur.close();
  }
}

try {
  await main();
} catch (err) {
  noter('déroulé sans exception', false, err?.stack ?? String(err));
  console.error(journal.slice(-30).join(''));
}
nettoyer();
const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications passées.`);
process.exit(echecs ? 1 : 0);
