// LES DROITS D'UN ORDINATEUR ET LA FENÊTRE D'ACCORD (carte « Piloter le Mac depuis Beluga », 21/11/2026).
//
// Ouvre Réglages › Extension, clique le premier ordinateur, relève ses cinq interrupteurs (tout allumé sauf le
// terminal), puis pose par `belugaEssai.decisions` deux demandes d'accord FABRIQUÉES (terminal : trois boutons ;
// suppression : deux) — aucun agent, aucun Mac, aucun interrupteur cliqué. Captures 1440/390, clair et sombre.
//   VERIF_URL=http://localhost:7311 VERIF_CAPTURES=<dossier> node scripts/verif-droits-ordinateur.mjs
// Session d'une heure fabriquée en base (jeton haché), retirée à la fin. Ne reprend jamais BELUGA_URL.
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
const URL = process.env.VERIF_URL || 'http://localhost:7311';
const OUT = process.env.VERIF_CAPTURES || '/tmp/verif-droits-ordinateur';
const BASE = process.env.VERIF_BASE || '/root/beluga/data/beluga.db';
fs.mkdirSync(OUT, { recursive: true });
const db = new Database(BASE);
const cookie = crypto.randomBytes(24).toString('hex');
const token = crypto.createHash('sha256').update(cookie).digest('hex');
const now = Date.now();
const cols = db.prepare('pragma table_info(sessions)').all().map((c) => c.name);
const row = { token, created_at: now, expires_at: now + 3600_000, label: 'essai-droits-ordinateur', user_id: 'admin-premier' };
const keys = Object.keys(row).filter((k) => cols.includes(k));
db.prepare(`insert into sessions (${keys.join(',')}) values (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => row[k]));
const traces = [];
try {
  const b = await chromium.launch({ channel: 'chrome' });
  for (const theme of ['clair', 'sombre']) {
    for (const [nom, vp, mob] of [['1440', { width: 1440, height: 900 }, false], ['390', { width: 390, height: 844 }, true]]) {
      const ctx = await b.newContext({ viewport: vp, isMobile: mob, hasTouch: mob, serviceWorkers: 'block', deviceScaleFactor: 2 });
      await ctx.addCookies([{ name: 'beluga_session', value: cookie, url: URL }]);
      const p = await ctx.newPage();
      const erreurs = [];
      p.on('pageerror', (e) => erreurs.push(String(e)));
      await p.goto(`${URL}/#reglages/extension`);
      await p.waitForFunction(() => window.belugaEssai?.pret?.(), null, { timeout: 30000 });
      await p.evaluate((t) => window.belugaEssai.reglages({ theme: t }), theme === 'clair' ? 'clair' : 'sombre');
      await p.waitForSelector('[data-ouvrir-ordinateur]', { timeout: 30000 });
      const lignes = await p.locator('[data-ouvrir-ordinateur]').count();
      await p.locator('[data-ouvrir-ordinateur]').first().click();
      await p.waitForSelector('[data-page-ordinateur]');
      await p.waitForTimeout(600);
      const droits = await p.locator('[data-droit]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-droit')}=${e.getAttribute('data-actif')}`));
      const deborde = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      await p.screenshot({ path: `${OUT}/page-ordinateur-${nom}-${theme}.png` });
      if (mob) {
        await p.mouse.wheel(0, 2000);
        await p.waitForTimeout(400);
        await p.screenshot({ path: `${OUT}/page-ordinateur-${nom}-${theme}-bas.png` });
      }
      /* La fenêtre d'accord, sur une décision fabriquée (aucun agent, aucun Mac). */
      await p.locator('[data-retour-ordinateurs]').click();
      await p.keyboard.press('Escape');
      await p.waitForTimeout(400);
      await p.evaluate(
        ({ compteId }) =>
          window.belugaEssai.decisions([
            {
              projectId: 'essai',
              agentId: 'agent-essai',
              cardId: 'carte-essai',
              genre: 'question',
              reglee: false,
              poseeA: Date.now(),
              messageId: 'message-essai',
              questionId: 'question-essai',
              source: 'question-outil',
              texte: 'Une commande attend votre accord',
              projectName: 'Beluga',
              lieuTitre: 'Fabriquer l’app iPhone',
              accordOrdinateur: {
                genre: 'terminal',
                compteId,
                ordinateurId: 'o-essai',
                ordinateurNom: 'MacBook Pro de Haiko',
                phrase: 'Fabriquer l’application iPhone avec les outils d’Apple installés sur ce Mac.',
                commande: 'xcodebuild -scheme Beluga -configuration Release archive',
                supprime: false,
              },
            },
          ]),
        { compteId: 'admin-premier' },
      );
      await p.waitForSelector('[data-fenetre-accord-ordinateur]', { timeout: 10000 });
      await p.waitForTimeout(700);
      const boutons = await p.locator('[data-accord-reponse]').evaluateAll((els) => els.map((e) => e.getAttribute('data-accord-reponse')));
      await p.screenshot({ path: `${OUT}/fenetre-accord-${nom}-${theme}.png` });
      /* Une suppression : deux boutons seulement. */
      await p.evaluate(() =>
        window.belugaEssai.decisions([
          {
            projectId: 'essai',
            agentId: 'agent-essai',
            cardId: 'carte-essai',
            genre: 'question',
            reglee: false,
            poseeA: Date.now(),
            messageId: 'message-essai-2',
            questionId: 'question-essai-2',
            source: 'question-outil',
            lieuTitre: 'Ranger le bureau',
            accordOrdinateur: {
              genre: 'suppression',
              compteId: 'admin-premier',
              ordinateurId: 'o-essai',
              ordinateurNom: 'Mac mini du bureau',
              phrase: 'Jeter le brouillon resté sur le bureau.',
              commande: '~/Desktop/brouillon.txt',
              supprime: true,
            },
          },
        ]),
      );
      await p.waitForSelector('[data-fenetre-accord-ordinateur="suppression"]', { timeout: 10000 });
      await p.waitForTimeout(700);
      const boutons2 = await p.locator('[data-accord-reponse]').evaluateAll((els) => els.map((e) => e.getAttribute('data-accord-reponse')));
      await p.screenshot({ path: `${OUT}/fenetre-suppression-${nom}-${theme}.png` });
      traces.push({ theme, nom, lignes, droits, deborde, boutons, boutons2, erreurs });
      await p.evaluate(() => window.belugaEssai.decisions([]));
      await ctx.close();
    }
  }
  await b.close();
} finally {
  db.prepare('delete from sessions where token = ?').run(token);
}
/* LES TRACES JUGÉES : une ligne d'ordinateur au moins, les cinq droits par défaut, trois puis deux boutons, rien qui
   déborde ni ne plante. */
let refus = 0;
const attendu = 'applications=oui,reglages=oui,pilotage_apps=oui,ecran=oui,terminal=non';
for (const t of traces) {
  const ok = t.lignes > 0 && t.droits.join(',') === attendu && t.boutons.join(',') === 'refuser,pour-la-carte,accepter' && t.boutons2.join(',') === 'refuser,accepter' && t.deborde === 0 && !t.erreurs.length;
  if (!ok) refus += 1;
  console.log(`${ok ? '✓' : '✗'} ${t.nom} ${t.theme} : ${t.lignes} ordinateur(s), ${t.droits.join(' ')}, boutons ${t.boutons.join('/')} puis ${t.boutons2.join('/')}, débord ${t.deborde}${t.erreurs.length ? `, erreurs ${t.erreurs.join(' | ')}` : ''}`);
}
console.log(refus ? `${refus} refus.` : `Tout est bon. Captures dans ${OUT}`);
process.exit(refus ? 1 : 0);
