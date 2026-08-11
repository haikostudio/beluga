#!/usr/bin/env node
/**
 * LA CONVENTION D'AVANCEMENT, vérifiée dans un VRAI navigateur :
 * ORANGE pour ce qui est EN COURS, BLEU pour ce qui est TERMINÉ.
 *
 *  - la ligne d'un projet où un agent travaille porte un cadre ORANGE et un
 *    fond ORANGE léger — plus le bleu d'avant ;
 *  - le robot de cette ligne est orange, comme celui des onglets du tableau ;
 *  - la colonne « En cours » du tableau garde son cadre orange, et la ligne du
 *    projet emploie EXACTEMENT la même teinte (même jeton `--en-cours`) ;
 *  - la colonne « Terminé » porte un cadre bleu ;
 *  - la carte d'un travail en cours porte une roue ORANGE, celle d'un travail
 *    rendu une coche BLEUE, celle d'un travail rendu non lu un point BLEU ;
 *  - les autres états ne bougent pas : le point d'une publication en cours
 *    reste JAUNE, le triangle d'une décision reste orange d'alerte ;
 *  - tout cela tient en thème SOMBRE comme en thème CLAIR.
 *
 * Tout est SIMULÉ : cartes et agents sont injectés dans le canal temps réel,
 * comme dans `verif-colonne-en-cours.mjs`. Rien n'est écrit dans la base à part
 * la session d'essai, retirée en partant. Les captures vont dans /tmp.
 *
 *   HAIKO_COULEURS_URL=http://localhost:7099 node scripts/verif-couleurs-avancement.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/* La racine se déduit du script : lancé d'une copie de travail, il juge CE
   code-là, jamais le dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKO_COULEURS_URL || 'http://localhost:7099';
const CAPTURES = process.env.HAIKO_COULEURS_CAPTURES || '/tmp';
/* La base et ses dépendances natives vivent dans le dépôt PRINCIPAL. */
const DONNEES = process.env.HAIKODEV_DATA || '/root/haikodev/data';
const PRINCIPAL = path.resolve(DONNEES, '..');

function base() {
  const require = createRequire(import.meta.url);
  return require(path.join(PRINCIPAL, 'node_modules/better-sqlite3'))(
    path.join(DONNEES, 'haikodev.db'),
  );
}

/** Une session d'une heure : la colonne « token » garde le SHA-256 du cookie. */
function poserSession() {
  const db = base();
  const cookie = crypto.randomBytes(24).toString('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'vérification couleurs d’avancement',
  );
  db.close();
  return { cookie, retirer: () => retirerSession(cookie) };
}

function retirerSession(cookie) {
  const db = base();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
  );
  db.close();
}

const resultats = [];
function record(nom, ok, detail = '') {
  resultats.push({ nom, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/** « rgb(a, b, c) » → [a, b, c]. Une couleur absente rend null. */
function canaux(couleur) {
  const m = /rgba?\(([^)]+)\)/.exec(couleur ?? '');
  if (!m) return null;
  const parts = m[1].split(',').map((v) => Number.parseFloat(v));
  if (parts.length >= 4 && parts[3] === 0) return null; // transparent
  return [parts[0], parts[1], parts[2]];
}

/** Une teinte ORANGE : beaucoup de rouge, franchement plus que de bleu. */
function estOrange(couleur) {
  const c = canaux(couleur);
  if (!c) return false;
  const [r, v, b] = c;
  return r > b + 30 && v > b && r >= v;
}

/** Une teinte BLEUE : beaucoup de bleu, franchement plus que de rouge. */
function estBleu(couleur) {
  const c = canaux(couleur);
  if (!c) return false;
  const [r, , b] = c;
  return b > r + 30;
}

/** Une teinte JAUNE : rouge ET vert hauts, bleu bas — la publication. */
function estJaune(couleur) {
  const c = canaux(couleur);
  if (!c) return false;
  const [r, v, b] = c;
  return r > b + 30 && v > b + 30 && Math.abs(r - v) < 60;
}

async function main() {
  console.log(`Racine jugée : ${RACINE}`);
  console.log(`Application visée : ${BASE}`);
  const session = poserSession();
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  await context.addCookies([
    {
      name: 'haikodev_session',
      value: session.cookie,
      url: new URL(BASE).origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && erreurs.push(message.text()));

  await page.addInitScript(() => {
    window.__ecouteurs = [];
    const propriete = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
    Object.defineProperty(WebSocket.prototype, 'onmessage', {
      configurable: true,
      get() {
        return propriete.get.call(this);
      },
      set(ecouteur) {
        window.__ecouteurs.push(ecouteur);
        return propriete.set.call(this, ecouteur);
      },
    });
    window.__injecter = (evenement) => {
      const donnees = JSON.stringify(evenement);
      for (const ecouteur of window.__ecouteurs) ecouteur({ data: donnees });
    };
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  page.setDefaultTimeout(8000);

  /* On OUVRE l'espace de développement : les cartes d'essai doivent être posées
     dans le tableau RÉELLEMENT affiché, sinon elles n'apparaissent nulle part. */
  await page.click('[data-ouvrir-espace-dev]').catch(() => {});
  await page.waitForTimeout(1800);

  /* Le projet AFFICHÉ, et une LIGNE de la liste de gauche : ce n'est pas le
     même bloc (l'espace de développement a son bouton à lui), et c'est bien la
     LIGNE de projet que la carte demande de repeindre. */
  const projectId = await page.evaluate(
    () =>
      document.querySelector('[data-espace-dev]')?.getAttribute('data-espace-dev') ??
      document.querySelector('[data-drag-kind="project"]')?.getAttribute('data-drag-id') ??
      null,
  );
  const ligneId = await page.evaluate(
    () => document.querySelector('[data-drag-kind="project"]')?.getAttribute('data-drag-id') ?? null,
  );
  record('un projet est ouvert', !!projectId, projectId ?? 'aucun');
  if (!projectId) throw new Error('aucun projet dans la colonne de gauche');
  record('une ligne de projet est visible dans la liste', !!ligneId, ligneId ?? 'aucune');

  const maintenant = Date.now();

  /** Une carte d'essai, avec ou sans agent, dans le projet et sur la ligne. */
  const poser = async (suffixe, { column, titre, statutAgent, position, luA }) => {
    const cardId = `essai-couleurs-${suffixe}`;
    const agentId = `essai-couleurs-agent-${suffixe}`;
    await page.evaluate(
      ([projectId, cardId, agentId, titre, column, statutAgent, position, luA]) => {
        window.__injecter({
          type: 'card.upsert',
          card: {
            id: cardId,
            projectId,
            title: titre,
            description: '',
            labels: [],
            column,
            position,
            origin: 'user',
            run: { engine: 'codex', mode: 'direct' },
            excludedFromDeploy: false,
            horsTache: false,
            agentId: statutAgent ? agentId : undefined,
            lastReadAt: luA ?? undefined,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        });
        if (statutAgent) {
          window.__injecter({
            type: 'agent.upsert',
            agent: {
              id: agentId,
              projectId,
              cardId,
              role: 'task',
              title: titre,
              run: { engine: 'codex', mode: 'direct' },
              status: statutAgent,
              startedAt: Date.now() - 120000,
              endedAt: statutAgent === 'running' ? undefined : Date.now() - 60000,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          });
        }
      },
      [projectId, cardId, agentId, titre, column, statutAgent ?? null, position, luA ?? null],
    );
    return { cardId, agentId };
  };

  const enCours = { cardId: 'essai-couleurs-en-cours' };
  const termineNonLu = { cardId: 'essai-couleurs-termine-non-lu' };
  const termineLu = { cardId: 'essai-couleurs-termine-lu' };

  /*
   * UN TRAVAIL RÉELLEMENT EN COURS et DEUX TRAVAUX RÉELLEMENT TERMINÉS.
   * Rejoué avant CHAQUE série de contrôles : le serveur rediffuse la vraie
   * liste des cartes du projet quand il en a l'occasion, ce qui efface les
   * cartes d'essai injectées.
   */
  const poserTout = async () => {
    await poser('en-cours', {
      column: 'running',
      titre: 'Essai — un travail en cours',
      statutAgent: 'running',
      position: maintenant + 0.1,
    });
    await poser('termine-non-lu', {
      column: 'done',
      titre: 'Essai — un travail terminé, pas encore lu',
      statutAgent: 'done',
      position: maintenant + 0.2,
    });
    await poser('termine-lu', {
      column: 'done',
      titre: 'Essai — un travail terminé et lu',
      statutAgent: 'done',
      luA: maintenant,
      position: maintenant + 0.3,
    });

    /* L'agent au travail, posé AUSSI sur la LIGNE de projet de gauche : c'est
       le compte d'agents « running » du projet qui allume son cadre. */
    if (ligneId) {
      await page.evaluate(
        ([ligneId]) => {
          window.__injecter({
            type: 'agent.upsert',
            agent: {
              id: 'essai-couleurs-agent-ligne',
              projectId: ligneId,
              role: 'task',
              title: 'Essai — agent sur la ligne de gauche',
              run: { engine: 'codex', mode: 'direct' },
              status: 'running',
              startedAt: Date.now() - 30000,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          });
          /* Un travail RENDU non lu sur ce même projet : c'est le point qui
             clignote en BLEU, à ne pas confondre avec le cadre orange. */
          window.__injecter({ type: 'rendus', byProject: { [ligneId]: 1 } });
        },
        [ligneId],
      );
    }
    await page.waitForSelector(`[data-carte="${enCours.cardId}"]`, { timeout: 5000 });
    await page.waitForTimeout(400);
  };

  await poserTout();

  /** Le style calculé d'un élément, tel que le navigateur le peint. */
  const style = (selecteur, prop) =>
    page.evaluate(
      ([s, p]) => {
        const el = document.querySelector(s);
        if (!el) return null;
        const cs = getComputedStyle(el);
        return cs[p] ?? null;
      },
      [selecteur, prop],
    );

  /** Les contrôles de couleur, rejoués tels quels dans les deux thèmes. */
  const controles = async (theme) => {
    const t = (nom) => `${nom} (${theme})`;

    const cadreLigne = ligneId
      ? await style(`[data-drag-kind="project"][data-drag-id="${ligneId}"]`, 'borderTopColor')
      : null;
    const fondLigne = ligneId
      ? await style(`[data-drag-kind="project"][data-drag-id="${ligneId}"]`, 'backgroundColor')
      : null;
    record(t('la ligne d’un projet au travail a un cadre ORANGE'), estOrange(cadreLigne), cadreLigne ?? 'aucun');
    record(t('son fond est ORANGE, et léger'), estOrange(fondLigne), fondLigne ?? 'aucun');

    const cadreColonne = await style('[data-column="running"]', 'borderTopColor');
    record(t('la colonne « En cours » a un cadre ORANGE'), estOrange(cadreColonne), cadreColonne ?? 'aucun');
    record(
      t('la ligne du projet emploie EXACTEMENT la teinte de la colonne « En cours »'),
      !!cadreLigne && cadreLigne === cadreColonne,
      `${cadreLigne} / ${cadreColonne}`,
    );

    const cadreTermine = await style('[data-column="done"]', 'borderTopColor');
    record(t('la colonne « Terminé » a un cadre BLEU'), estBleu(cadreTermine), cadreTermine ?? 'aucun');

    const robot = await style('[data-repere-robot] svg', 'color');
    record(t('le robot « un agent au travail » est ORANGE'), estOrange(robot), robot ?? 'absent');

    const roue = await style(`[data-carte="${enCours.cardId}"] .animate-spin`, 'color');
    record(t('la carte d’un travail en cours porte une roue ORANGE'), estOrange(roue), roue ?? 'absente');

    /* Le travail rendu : point BLEU qui clignote tant qu'on ne l'a pas lu,
       coche BLEUE une fois lu — les deux disent « terminé », donc les deux
       sont bleus. */
    const pointNonLu = await style(`[data-carte-non-lue="${termineNonLu.cardId}"]`, 'backgroundColor');
    record(
      t('la carte d’un travail rendu, pas encore lu, porte un point BLEU'),
      estBleu(pointNonLu),
      pointNonLu ?? 'absent',
    );

    const coche = await page.evaluate((id) => {
      const carte = document.querySelector(`[data-carte="${id}"]`);
      const pastille = carte?.querySelector('span.rounded-full');
      return pastille ? getComputedStyle(pastille).color : null;
    }, termineLu.cardId);
    record(t('la carte d’un travail terminé et lu porte une coche BLEUE'), estBleu(coche), coche ?? 'absente');

    const pointRendu = await style('[data-signal-termine]', 'backgroundColor');
    record(
      t('le point « travail rendu, pas encore lu » reste BLEU'),
      estBleu(pointRendu),
      pointRendu ?? 'absent',
    );

    /* LES AUTRES ÉTATS NE BOUGENT PAS. Le jeton d'une publication en cours est
       JAUNE, celui d'une alerte reste l'orange d'avertissement : on les lit sur
       les variables du thème, présentes même sans publication en cours. */
    const jetons = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const sonde = (nom) => {
        const el = document.createElement('span');
        el.style.color = `hsl(${cs.getPropertyValue(nom)})`;
        document.body.appendChild(el);
        const c = getComputedStyle(el).color;
        el.remove();
        return c;
      };
      return {
        publie: sonde('--publie'),
        warning: sonde('--warning'),
        danger: sonde('--danger'),
        enCours: sonde('--en-cours'),
        termine: sonde('--termine'),
      };
    });
    record(t('la publication en cours garde son JAUNE'), estJaune(jetons.publie), jetons.publie);
    record(t('l’avertissement garde sa teinte propre'), estOrange(jetons.warning), jetons.warning);
    record(t('l’erreur reste ROUGE'), !estOrange(jetons.danger) && !estBleu(jetons.danger), jetons.danger);
    record(t('le jeton « en cours » est bien ORANGE'), estOrange(jetons.enCours), jetons.enCours);
    record(t('le jeton « terminé » est bien BLEU'), estBleu(jetons.termine), jetons.termine);
  };

  await controles('sombre');
  const captureSombre = path.join(CAPTURES, 'couleurs-avancement-sombre.png');
  await page.screenshot({ path: captureSombre });
  console.log(`  capture : ${captureSombre}`);

  /* THÈME CLAIR : le pref par défaut est « dark » et le JS pose la classe au
     chargement — pour le clair, on RETIRE la classe, jamais on ne l'ajoute. */
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.waitForTimeout(400);
  await poserTout();
  await controles('clair');
  const captureClair = path.join(CAPTURES, 'couleurs-avancement-clair.png');
  await page.screenshot({ path: captureClair });
  console.log(`  capture : ${captureClair}`);

  record('aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await browser.close();
  session.retirer();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés`);
  if (echecs.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
