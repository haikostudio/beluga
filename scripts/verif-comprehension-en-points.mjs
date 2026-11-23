#!/usr/bin/env node
/**
 * LE FIL D'UNE CARTE EN ICÔNES FINES, LA COMPRÉHENSION EN POINTS, LES SOMMAIRES SANS EMOJI.
 *
 * On ouvre, dans un vrai navigateur, la carte la plus récente dont une
 * compréhension est écrite en « **Intitulé** — texte », et on juge :
 *  - la dernière compréhension se lit en points (≥ 2 points avec intitulé) ;
 *  - chaque emplacement de sous-point porte l'icône de sa sorte (14 px, `data-sous-point-icone`)
 *    ou, sans sorte connue, un point de 5 px ; jamais un emplacement vide ;
 *  - les sortes distinctes du fil (commande, mémoire, compétence…) ont des icônes distinctes ;
 *  - un sommaire (plan long) ne porte plus aucun emoji, et chaque ligne a son icône ;
 *  - tout le bloc de compréhension tient dans UNE taille et UN interligne,
 *    volet technique déplié compris (état calculé, pas une hauteur).
 * Sur ordinateur (1440) puis téléphone (390). Lecture seule : rien n'est écrit
 * en base hormis la session d'une heure, retirée à la fin.
 *
 *   env -u BELUGA_TOKEN BELUGA_VERIF_URL=http://localhost:7099 node scripts/verif-comprehension-en-points.mjs
 *
 * On vise le serveur de DÉVELOPPEMENT : BELUGA_URL désigne l'application publiée.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { cheminDeLaBaseServie } from './base-servie.mjs';

const BASE = process.env.BELUGA_VERIF_URL || 'http://localhost:7099';
const SHOTS = `${process.env.BELUGA_DATA || '/root/beluga/data'}/verification`;
fs.mkdirSync(SHOTS, { recursive: true });

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

const db = new Database(cheminDeLaBaseServie());
/* `BELUGA_VERIF_CARTE=<id>` impose la carte jugée : la plus récente peut dormir
   loin dans l'archive, hors des vingt premières cartes que le tableau pose. */
const carte = process.env.BELUGA_VERIF_CARTE
  ? db.prepare('SELECT id, title, project_id FROM cards WHERE id = ?').get(process.env.BELUGA_VERIF_CARTE)
  : db
  .prepare(
    `SELECT c.id, c.title, c.project_id FROM card_journal j JOIN cards c ON c.id = j.card_id
     WHERE j.resultat LIKE '%**%—%' AND j.donnees LIKE '%hypotheses%' AND c.archived_at IS NULL
     ORDER BY j.at DESC LIMIT 1`,
  )
  .get();
if (!carte) {
  console.log('Aucune carte avec une compréhension structurée : rien à juger.');
  process.exit(1);
}
const token = crypto.randomBytes(32).toString('hex');
const empreinte = crypto.createHash('sha256').update(token).digest('hex');
db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
  empreinte,
  Date.now(),
  Date.now() + 3600_000,
  'vérification compréhension en points',
);
db.close();

const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  for (const [largeur, hauteur, nom] of [
    [1440, 900, 'ordinateur'],
    [390, 844, 'telephone'],
  ]) {
    const contexte = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, serviceWorkers: 'block' });
    await contexte.addCookies([
      { name: 'beluga_session', value: token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
    ]);
    const page = await contexte.newPage();
    await page.goto(`${BASE}/#projet/${carte.project_id}`, { waitUntil: 'domcontentloaded' });
    const article = page.locator('article').filter({ hasText: carte.title }).first();
    const vue = await article.waitFor({ state: 'visible', timeout: 120000 }).then(() => true).catch(() => false);
    if (!vue) {
      noter(`[${nom}] la carte « ${carte.title} » est au tableau`, false);
      await contexte.close();
      continue;
    }
    /* Clic par l'élément : sur téléphone, un volet peut couvrir le tableau. */
    await article.evaluate((el) => el.click());
    const point = page.locator('[role="dialog"] [data-point="comprehension"]').first();
    await point.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
    /* Une carte lancée replie ses étapes de cadrage : on ouvre la compréhension, comme un lecteur. */
    /* (La compréhension n'est plus dans la carte du passage : elle se lit dessous, sans rien ouvrir.) */
    if (
      (await point.getAttribute('data-point-ouvert').catch(() => null)) === 'non' &&
      (await point.locator('[data-point-bascule]').count()) > 0
    ) {
      await point.locator('[data-point-bascule]').first().evaluate((el) => el.click());
    }
    await page.locator('[data-moment="comprehension"]').last().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1200);

    const lu = await page.evaluate(() => {
      const moments = [...document.querySelectorAll('[data-moment="comprehension"]')];
      const derniere = moments.at(-1);
      const rondes = [...document.querySelectorAll('[data-sous-point-rond]')];
      const points = [...document.querySelectorAll('[data-point-du-fil]:not([data-sous-point-icone]):not([data-point-de-la-carte] *)')];
      /* Hors de la carte d'un passage, la discussion masque le rond du premier
      niveau : seules les icônes qui occupent de la place sont jugées. */
      const icones = [...document.querySelectorAll('[data-sous-point-rond] [data-sous-point-icone]')].filter((i) => i.getBoundingClientRect().width > 0);
      const tailles = points.map((p) => Math.round(p.getBoundingClientRect().width * 10) / 10).filter((w) => w > 0);
      const couleurs = new Set(points.map((p) => getComputedStyle(p).backgroundColor));
      return {
        moments: moments.length,
        forme: derniere?.querySelector('[data-comprehension-contenu]')?.getAttribute('data-comprehension-forme') ?? null,
        pointsCompris: derniere?.querySelectorAll('[data-point-comprehension]').length ?? 0,
        hypotheses: !!derniere?.querySelector('[data-hypotheses]'),
        rondsVides: rondes.filter((r) => !r.querySelector('[data-point-du-fil]')).length,
        ronds: rondes.length,
        icones: icones.length,
        taillesIcones: icones.filter((i) => Math.abs(i.getBoundingClientRect().width - 14) > 0.6).length,
        sortes: [...new Set(icones.map((i) => i.getAttribute('data-sous-point-icone')))],
        sorteParLigne: Object.fromEntries(
          [...document.querySelectorAll('[data-sous-point-flux]')].flatMap((l) => {
            const i = l.querySelector(':scope > [data-sous-point-rond] [data-sous-point-icone]');
            return i && i.getBoundingClientRect().width > 0 ? [[l.getAttribute('data-sous-point-flux'), i.getAttribute('data-sous-point-icone')]] : [];
          }),
        ),
        taillesHorsCinq: tailles.filter((w) => Math.abs(w - 5) > 0.6).length,
        points: tailles.length,
        transparents: [...couleurs].filter((c) => c === 'rgba(0, 0, 0, 0)').length,
      };
    });
    noter(`[${nom}] la dernière compréhension se lit en points`, lu.forme === 'points' && lu.pointsCompris >= 2, JSON.stringify({ forme: lu.forme, points: lu.pointsCompris, hypotheses: lu.hypotheses }));
    noter(`[${nom}] chaque emplacement de sous-point porte une icône ou un point`, lu.ronds > 0 && lu.rondsVides === 0, `${lu.ronds} emplacement(s), ${lu.rondsVides} vide(s), ${lu.icones} icône(s)`);
    noter(`[${nom}] chaque icône du fil mesure 14 px`, lu.taillesIcones === 0, `${lu.icones} icône(s), sortes : ${lu.sortes.join(', ') || 'aucune'}`);
    /* Une icône par sorte de ligne du fil : deux sortes ne partagent jamais la leur. */
    const rendues = Object.values(lu.sorteParLigne);
    noter(`[${nom}] des sortes différentes portent des icônes différentes`, new Set(rendues).size === rendues.length, JSON.stringify(lu.sorteParLigne));
    /* Une carte dont toutes les lignes ont leur icône n'a aucun point de repli : zéro est juste. */
    noter(`[${nom}] chaque point de repli mesure 5 px et se voit`, lu.taillesHorsCinq === 0 && lu.transparents === 0, `${lu.points} point(s) de repli`);

    /* UNE SEULE TAILLE, UN SEUL INTERLIGNE DANS TOUT LE BLOC.
       Le volet technique est déplié d'abord : ses rubriques font partie du
       bloc, donc du contrôle. On sonde l'ÉTAT calculé de chaque porteur de
       texte (`getComputedStyle`), jamais une hauteur. */
    const dernier = page.locator('[data-moment="comprehension"]').last();
    const basculeTechnique = dernier.locator('[data-comprehension-technique-bascule]').first();
    if (await basculeTechnique.count()) {
      const volet = dernier.locator('[data-comprehension-technique]').first();
      if ((await volet.getAttribute('data-comprehension-technique')) === 'replie') {
        await basculeTechnique.evaluate((el) => el.click());
        await page.waitForTimeout(400);
      }
      noter(
        `[${nom}] le volet des détails techniques s'ouvre et entre dans le contrôle`,
        (await volet.getAttribute('data-comprehension-technique')) === 'ouvert',
      );
    }
    const typo = await page.evaluate(() => {
      const contenu = [...document.querySelectorAll('[data-comprehension-contenu]')].at(-1);
      if (!contenu) return null;
      const tailles = new Map();
      const interlignes = new Map();
      const porteurs = [contenu, ...contenu.querySelectorAll('*')].filter((el) => {
        if (el instanceof SVGElement) return false;
        /* Seuls les éléments qui portent EUX-MÊMES du texte comptent. */
        return [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 1);
      });
      for (const el of porteurs) {
        const style = getComputedStyle(el);
        const etiquette = `${el.tagName.toLowerCase()}:${(el.textContent ?? '').trim().slice(0, 24)}`;
        if (!tailles.has(style.fontSize)) tailles.set(style.fontSize, etiquette);
        if (!interlignes.has(style.lineHeight)) interlignes.set(style.lineHeight, etiquette);
      }
      return {
        porteurs: porteurs.length,
        tailles: [...tailles.entries()].map(([valeur, exemple]) => `${valeur} (${exemple})`),
        interlignes: [...interlignes.entries()].map(([valeur, exemple]) => `${valeur} (${exemple})`),
      };
    });
    if (typo) {
      noter(
        `[${nom}] tout le bloc de compréhension tient dans une seule taille`,
        typo.porteurs >= 3 && typo.tailles.length === 1,
        `${typo.porteurs} porteur(s) de texte · ${typo.tailles.join(' · ')}`,
      );
      noter(
        `[${nom}] tout le bloc de compréhension tient dans un seul interligne`,
        typo.porteurs >= 3 && typo.interlignes.length === 1,
        `${typo.porteurs} porteur(s) de texte · ${typo.interlignes.join(' · ')}`,
      );
    } else {
      noter(`[${nom}] le bloc de compréhension est affiché`, false, 'aucun contenu déplié');
    }
    /* LA COMPRÉHENSION EST UN TEXTE DÉTACHÉ (12/10/2026) : posée sous le bloc de travail,
       sur le fond de la page, sans en-tête gris ni panneau, à 95 % de la colonne (13/10/2026),
       quand la bulle de l'utilisateur garde ses 85 %. */
    const detachee = await page.evaluate(() => {
      const moment = [...document.querySelectorAll('[data-moment="comprehension"]')].at(-1);
      if (!moment) return null;
      const transparent = (c) => !c || c === 'transparent' || /rgba\(0,\s*0,\s*0,\s*0\)/.test(c);
      const fonds = [moment, ...moment.querySelectorAll('*')].filter((el) => !transparent(getComputedStyle(el).backgroundColor));
      const bulleAgent = moment.querySelector('[data-bulle="agent"]');
      const bulleUtilisateur = [...document.querySelectorAll('[data-bulle="utilisateur"]')].at(-1);
      return {
        horsDeLaCarte: !moment.closest('[data-carte-du-passage]'),
        sansEnTete: !moment.querySelector('[data-en-tete-de-panneau], [data-comprehension-bascule]'),
        sansPanneau: !moment.querySelector('[data-panneau]'),
        fondsPeints: fonds.map((el) => el.tagName.toLowerCase()).slice(0, 4),
        largeurAgent: bulleAgent ? Math.round(bulleAgent.getBoundingClientRect().width) : null,
        largeurUtilisateur: bulleUtilisateur ? Math.round(bulleUtilisateur.getBoundingClientRect().width) : null,
        colonne: bulleAgent?.parentElement ? Math.round(bulleAgent.parentElement.getBoundingClientRect().width) : null,
        colonneUtilisateur: bulleUtilisateur?.parentElement
          ? Math.round(bulleUtilisateur.parentElement.getBoundingClientRect().width)
          : null,
      };
    });
    if (detachee) {
      noter(
        `[${nom}] la compréhension est un texte posé sous le bloc, sans en-tête ni panneau`,
        detachee.horsDeLaCarte && detachee.sansEnTete && detachee.sansPanneau,
        JSON.stringify(detachee),
      );
      noter(`[${nom}] elle est posée sur le fond de la page, sans aucun fond propre`, detachee.fondsPeints.length === 0, detachee.fondsPeints.join(', '));
      noter(
        `[${nom}] elle occupe 95 % de la colonne, sans la dépasser`,
        detachee.largeurAgent !== null &&
          detachee.colonne !== null &&
          detachee.largeurAgent <= Math.round(detachee.colonne * 0.95) + 2 &&
          detachee.largeurAgent > Math.round(detachee.colonne * 0.85) + 2,
        `agent ${detachee.largeurAgent} px · colonne ${detachee.colonne} px`,
      );
      noter(
        `[${nom}] la bulle de l'utilisateur garde ses 85 %`,
        detachee.largeurUtilisateur === null ||
          (detachee.colonneUtilisateur !== null &&
            detachee.largeurUtilisateur <= Math.round(detachee.colonneUtilisateur * 0.85) + 2),
        `bulle utilisateur ${detachee.largeurUtilisateur} px · colonne ${detachee.colonneUtilisateur} px`,
      );
    } else {
      noter(`[${nom}] la compréhension est affichée`, false, 'aucun moment de compréhension');
    }

    await page.locator('[data-moment="comprehension"]').last().scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: `${SHOTS}/comprehension-en-points-${nom}.png` });

    /* LE PLAN SE LIT COMME UNE RÉPONSE (12/10/2026) : du texte à titres nus,
       sans sommaire, sans carte ni icône par partie, sans emoji. Visé DANS le
       tiroir de la carte : sur téléphone, le tableau derrière porte aussi des
       blocs. */
    const plan = page.locator('[role="dialog"] [data-bloc-du-plan]').last();
    if (await plan.count()) {
      await plan.scrollIntoViewIfNeeded().catch(() => {});
      const mesure = await plan.evaluate((bloc) => {
        const emoji = /\p{Extended_Pictographic}/u;
        const titres = [...bloc.querySelectorAll('h1, h2, h3')];
        return {
          sommaires: bloc.querySelectorAll('nav').length,
          cartes: bloc.querySelectorAll('section').length,
          titres: titres.length,
          emojis: titres.filter((h) => emoji.test(h.textContent ?? '')).length,
          horsDeLaCarte: !bloc.closest('[data-carte-du-passage]'),
        };
      });
      noter(
        `[${nom}] le plan est un texte à titres nus, hors de la carte du passage, sans emoji`,
        mesure.sommaires === 0 && mesure.cartes === 0 && mesure.titres > 0 && mesure.emojis === 0 && mesure.horsDeLaCarte,
        JSON.stringify(mesure),
      );
      await page.screenshot({ path: `${SHOTS}/plan-en-texte-${nom}.png` });
    }
    await contexte.close();
  }
} finally {
  await navigateur.close();
  const fin = new Database(cheminDeLaBaseServie());
  fin.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  fin.close();
}

const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôle(s) tenus.`);
process.exit(echecs ? 1 : 0);
