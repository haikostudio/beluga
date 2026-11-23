#!/usr/bin/env node
/**
 * Les pièces jointes AVANT l'envoi, sur un écran de téléphone :
 *  1. l'image jointe s'affiche en vignette, pas en nom de fichier ;
 *  2. un clic sur la vignette ouvre l'aperçu en grand (la visionneuse) ;
 *  3. l'ancre du fichier s'écrit dans la barre d'écriture, à l'endroit du
 *     curseur, se déplace si on glisse son drapeau, et disparaît quand on
 *     retire le fichier ;
 *  4. la barre d'écriture reste utilisable : les vignettes ne mangent pas sa
 *     hauteur.
 *
 * UNE PIÈCE NE MONTRE À L'ÉCRAN QUE SON ALIAS (« #1a0c », `etiquetteDePiece`) :
 * la vignette, sa pastille, son tag dans le champ et le titre de l'aperçu
 * disent tous « #1a0c », plus le nom du fichier. Le texte ENREGISTRÉ, lui,
 * cite le nom ET l'alias — « [fichier: capture.png #1a0c] » — : c'est lui que
 * l'agent lit. Le contrôle reconnaît donc une pièce à son alias, et lit le
 * tag complet dans le brouillon parti au serveur.
 *
 * DÉMON JETABLE (base neuve, dossier temporaire, aucun quota) : ce contrôle
 * écrit dans un champ, dépose des fichiers et enregistre un brouillon. Il ne
 * se lance donc JAMAIS contre une interface branchée sur le démon en service
 * — lancé ainsi, il laissait son texte et son fichier dans le brouillon d'une
 * vraie conversation dès qu'il tombait en route. À lancer depuis la copie de
 * travail de la carte, jamais depuis le dépôt principal :
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-pieces-jointes-composeur.mjs
 *
 * Pour juger le code SOURCE plutôt que la construction : une interface de
 * développement à soi, branchée sur CE démon (`BELUGA_DEMON_PORT=<port>`), et
 * son adresse dans `BELUGA_VERIF_URL`. La base reste celle du démon d'essai.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';
import { creerResultats } from './lib/verif-resultats.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7242);
// PIÈGE : BELUGA_URL désigne le démon (version publiée). L'essai a son nom.
const BASE = process.env.BELUGA_VERIF_URL || `http://127.0.0.1:${PORT}`;
const { TMP, DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-pieces-jointes-', port: PORT });

/*
 * LE CHAMP ÉCRIT SES TAGS AVEC DES ESPACES INSÉCABLES (shared/src/ancres.ts) :
 * c'est ce qui empêche « [fichier: nom] » d'être coupé en fin de ligne. Toute
 * lecture du champ est donc ramenée aux espaces ordinaires avant comparaison.
 */
/*
 * LE TAG EST AUSSI MASQUÉ DANS LE CHAMP : entre ⁢ et ⁣, seule
 * l'ÉTIQUETTE de la pièce reste lisible — son alias, « #1a0c » —, et c'est le
 * CALQUE qui la dessine en pastille. On le DÉMASQUE ici, plutôt que de
 * réécrire chaque constat : un tag du champ se lit « [fichier: #1a0c] ».
 */
const TAG_MASQUE = /⁢[^⁢⁣\n]*⁣/g;
const lisible = (valeur) =>
  (valeur || '')
    .replace(TAG_MASQUE, (brut) => {
      // Le remplissage (espaces, liants) entoure l'étiquette : une fois retiré,
      // ce qui reste EST l'étiquette de la pièce.
      const etiquette = brut.slice(1, -1).replace(/[⁠   ]/g, '');
      return `[fichier: ${etiquette}]`;
    })
    .replace(/ /g, ' ');

/** L'alias du PREMIER tag d'un texte démasqué (« #1a0c »), ou `null`. */
const aliasDuTag = (texte) => texte.match(/\[fichier: (#[0-9a-z]{4,})\]/i)?.[1] ?? null;

const { results, record } = creerResultats();

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET = 'p-jointes';
const CARTE = 'c-jointes';
const AGENT = 'ag-jointes';

/** Le décor : une session d'une heure (jeton HACHÉ), un projet, une carte et sa conversation. */
function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), t, t + 3600_000, 'vérification pièces jointes');
  db.prepare('DELETE FROM projects').run();
  const p = { id: PROJET, name: 'Pièces jointes', path: DEPOT, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: t, updatedAt: t };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(p.id, p.name, p.path, JSON.stringify(p), t, t);
  const c = {
    id: CARTE, projectId: PROJET, title: 'Carte du champ', description: 'Une carte pour écrire.', labels: [], column: 'planned', position: 1,
    origin: 'user', attachments: [], run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    excludedFromDeploy: false, horsTache: false, codeDejaEnregistre: false, createdAt: t - 3600_000, updatedAt: t - 3600_000,
  };
  db.prepare('INSERT INTO cards (id, project_id, column_key, position, title, data, deployed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    c.id, c.projectId, c.column, 1, c.title, JSON.stringify(c), null, c.createdAt, c.updatedAt,
  );
  const a = { id: AGENT, projectId: PROJET, cardId: CARTE, role: 'cadrage', title: 'Cadrage', run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'done', createdAt: t - 3600_000, updatedAt: t - 3600_000 };
  db.prepare(`INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, 'done', ?, ?, ?)`).run(
    a.id, a.projectId, a.cardId, a.role, JSON.stringify(a), a.createdAt, a.updatedAt,
  );
  db.close();
}

/** Une petite image PNG bien réelle, pour voir une vraie vignette. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAP0lEQVR42u3OMQEAAAgDoC252H0M' +
    'Ywm4mUryJgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgWQ0YMAAB8W8LqQAAAABJRU5ErkJggg==',
  'base64',
);

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'fr-CH',
    // Sinon c'est la version publiée qui s'affiche.
    serviceWorkers: 'block',
  });
  await context.addCookies([{ name: 'beluga_session', value: jeton, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' }]);

  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));
  /* Le brouillon tel qu'il PART AU SERVEUR : c'est là que le tag s'écrit en
     entier, nom et alias — le champ, lui, n'en garde que l'alias. */
  const brouillons = [];
  page.on('websocket', (canal) => {
    canal.on('framesent', ({ payload }) => {
      try {
        const trame = JSON.parse(String(payload));
        if (trame?.cmd?.type === 'prefs.set' && trame.cmd.key === `draft.${AGENT}`) brouillons.push(String(trame.cmd.value ?? '').replace(/ /g, ' '));
      } catch {
        /* un battement, pas une commande */
      }
    });
  });

  try {
    /* ON ENTRE PAR L'ADRESSE DU PROJET, puis on ouvre SA carte : la barre
       d'écriture jugée est celle de la page d'une carte, qui s'ouvre sur sa
       conversation. Une carte restée ouverte se rouvre seule : on ne la
       clique que si son champ n'est pas déjà là. */
    await page.goto(`${BASE}/#projet/${PROJET}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator(`[data-carte="${CARTE}"]`).first().waitFor({ state: 'visible', timeout: 30000 });

    // PIÈGE : plusieurs barres d'écriture coexistent (conversation, tiroir de
    // carte). On vise celle qu'on VOIT, champ de fichier compris.
    const barre = page.locator('[data-composer]').filter({ has: page.locator('textarea:visible') }).last();
    const zone = barre.locator('textarea').last();
    const dejaOuvert = await zone.waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false);
    if (!dejaOuvert) {
      await page.locator(`[data-carte="${CARTE}"]`).first().click();
      await zone.waitFor({ state: 'visible', timeout: 20000 });
    }
    await page.waitForTimeout(800);

    const hauteurAvant = (await zone.boundingBox())?.height ?? 0;

    /* ---- 3. L'ancre se pose à l'endroit du curseur ---- */
    await zone.click();
    await zone.fill('Premier paragraphe.\n\nSecond paragraphe.');
    // Curseur posé au clavier, comme une vraie personne : fin de la première
    // phrase, deux lignes plus haut que la fin du texte.
    await zone.press('Control+Home');
    await zone.press('End');

    const choix = barre.locator('input[data-composer-file]');
    await choix.setInputFiles({ name: 'capture-verif.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForFunction((el) => /#[0-9a-z]{4}/i.test(el.value), await zone.elementHandle(), { timeout: 20000 }).catch(() => {});
    // Le temps que l'enregistrement différé (600 ms) parte vers le serveur.
    await page.waitForTimeout(1800);

    const texte = lisible(await zone.inputValue());
    const alias = aliasDuTag(texte);
    record("L'ancre du fichier est écrite dans le texte, sous son alias", !!alias, texte.slice(0, 90));
    const enregistre = brouillons.at(-1) ?? '';
    record(
      'Le brouillon enregistré cite le nom ET l’alias : « [fichier: nom #alias] »',
      !!alias && enregistre.includes(`[fichier: capture-verif.png ${alias}]`),
      enregistre.replace(/\n/g, ' ').slice(0, 90),
    );
    record(
      "L'ancre est posée à l'endroit du curseur, pas à la fin",
      texte.includes('[fichier:') && texte.indexOf('[fichier:') < texte.indexOf('Second paragraphe'),
    );

    /* ---- 3 quater. La frappe reprend JUSTE APRÈS le tag ---- */
    // Le vrai symptôme : le tag rallonge la phrase, mais le champ gardait le
    // curseur au même numéro de caractère — la suite s'écrivait donc plusieurs
    // lettres trop tôt, au milieu des mots déjà là.
    await page.keyboard.type('SUITE');
    await page.waitForTimeout(500);
    const apresFrappe = lisible(await zone.inputValue());
    record(
      'La frappe reprend juste après le tag, pas au milieu des mots',
      !!alias && apresFrappe.includes(`[fichier: ${alias}]SUITE`),
      apresFrappe.replace(/\n/g, ' ').slice(0, 90),
    );

    /* ---- 1. Une vignette, pas un nom de fichier ---- */
    /* Le texte de remplacement de la vignette est l'étiquette de la pièce : son alias. */
    const vignette = barre.locator(`img[alt="${alias ?? '#'}"]`).first();
    record("Le fichier image s'affiche en vignette", (await vignette.count()) > 0);
    record(
      'La vignette, sa pastille et son tag portent la même étiquette, et nulle part le nom du fichier',
      !!alias &&
        (await barre.locator(`[data-piece-etiquette="${alias}"]`).count()) === 1 &&
        !((await barre.textContent()) ?? '').includes('capture-verif.png'),
      alias ?? 'aucun alias',
    );

    /* ---- 4. La barre d'écriture garde sa hauteur ---- */
    const hauteurApres = (await zone.boundingBox())?.height ?? 0;
    const boite = await vignette.boundingBox();
    record(
      "La vignette ne mange pas la hauteur du champ de texte",
      hauteurApres >= hauteurAvant - 2 && (boite?.height ?? 99) <= 56,
      `champ ${Math.round(hauteurApres)} px, vignette ${Math.round(boite?.height ?? 0)} px`,
    );

    await page.screenshot({ path: path.join(TMP, 'composeur-vignette-telephone.png') });

    /* ---- 3 ter. Glisser le drapeau le déplace dans la phrase ---- */
    const drapeau = page.locator('[data-prompt-file-flag]').first();
    record('Le fichier joint apparaît comme un drapeau dans le texte', (await drapeau.count()) > 0);
    if ((await drapeau.count()) > 0) {
      const avantGlisse = lisible(await zone.inputValue());
      /* Le drapeau épouse le texte du tag : quand la phrase le coupe en fin de
         ligne, il s'étale sur DEUX lignes et le centre de sa boîte englobante
         tombe dans le vide. On vise donc son PREMIER morceau. */
      const boiteDrapeau = await drapeau.evaluate((el) => {
        const r = el.getClientRects()[0] || el.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
      });
      const boiteZone = await zone.boundingBox();
      if (boiteDrapeau && boiteZone) {
        await page.mouse.move(boiteDrapeau.x + boiteDrapeau.width / 2, boiteDrapeau.y + boiteDrapeau.height / 2);
        await page.mouse.down();
        await page.mouse.move(boiteZone.x + 8, boiteZone.y + 10, { steps: 8 });
        await page.waitForTimeout(200);
        record(
          "Un trait d'insertion apparaît pendant le glissement",
          (await page.locator('[data-prompt-file-caret]').count()) > 0,
        );
        await page.mouse.up();
        await page.waitForTimeout(800);
        const apresGlisse = lisible(await zone.inputValue());
        record(
          'Glisser le drapeau le déplace dans la phrase, sans le retirer',
          apresGlisse.includes(`[fichier: ${alias}]`) && apresGlisse !== avantGlisse,
          apresGlisse.replace(/\n/g, ' ').slice(0, 90),
        );
        record(
          "L'aperçu au-dessus reste après le glissement",
          (await barre.locator(`img[alt="${alias}"]`).count()) > 0,
        );
      } else {
        record('Glisser le drapeau le déplace dans la phrase, sans le retirer', false, 'boîte invisible');
        record("Un trait d'insertion apparaît pendant le glissement", false, 'glissement non lancé');
        record("L'aperçu au-dessus reste après le glissement", false, 'glissement non lancé');
      }
    } else {
      record('Glisser le drapeau le déplace dans la phrase, sans le retirer', false, 'drapeau absent');
      record("Un trait d'insertion apparaît pendant le glissement", false, 'drapeau absent');
      record("L'aperçu au-dessus reste après le glissement", false, 'drapeau absent');
    }

    /* ---- 2. L'aperçu s'ouvre au clic, avant tout envoi ---- */
    /* LA VISIONNEUSE EST SA PROPRE FENÊTRE (`data-fenetre-visionneuse`). On ne
       la cherche plus par « un dialogue qui contient le nom » : la page d'une
       carte est elle-même un dialogue, et elle contient l'étiquette du tag. */
    await vignette.click();
    await page.waitForTimeout(1500);
    const dialogue = page.locator('[data-fenetre-visionneuse]').first();
    const ouvert = await dialogue.isVisible().catch(() => false);
    record("Un clic sur la vignette ouvre l'aperçu en grand", ouvert);
    if (ouvert) {
      const grande = dialogue.locator('img').first();
      record("L'aperçu montre bien l'image", (await grande.count()) > 0);
      record(
        'L’aperçu porte l’étiquette de la pièce, et son adresse',
        (((await dialogue.textContent()) ?? '').includes(alias ?? '—')) && /\/volet\/apercu-piece$/.test(await page.evaluate(() => window.location.hash)),
        await page.evaluate(() => window.location.hash),
      );
      await page.screenshot({ path: path.join(TMP, 'composeur-apercu-telephone.png') });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
      record(
        'Échap referme l’aperçu et rend la barre d’écriture',
        (await page.locator('[data-fenetre-visionneuse]').count()) === 0 && (await zone.isVisible().catch(() => false)),
      );
    }

    /* ---- 3 bis. Retirer le fichier retire son ancre ---- */
    await barre.locator('button[title="Retirer ce fichier"]').first().click();
    await page.waitForTimeout(1200);
    const apresRetrait = lisible(await zone.inputValue());
    record("Retirer le fichier retire son ancre du texte", !apresRetrait.includes('[fichier:'), apresRetrait.slice(0, 90));
    record("Le reste du texte est intact", apresRetrait.includes('Premier paragraphe.') && apresRetrait.includes('Second paragraphe.'));
    record("La vignette disparaît avec le fichier", (await barre.locator('img').count()) === 0);

    /* ---- Un fichier sans image garde son étiquette, et effacer son ancre le retire ---- */
    await zone.click();
    await zone.fill('');
    await choix.setInputFiles({ name: 'notes-verif.txt', mimeType: 'text/plain', buffer: Buffer.from(`Notes de vérification ${Date.now()}\n`) });
    await page.waitForFunction((el) => /#[0-9a-z]{4}/i.test(el.value), await zone.elementHandle(), { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const avecAncre = lisible(await zone.inputValue());
    const aliasTexte = aliasDuTag(avecAncre);
    /* SANS VIGNETTE POSSIBLE, la pièce garde sa pastille — son étiquette et son
       icône —, la même que celle du tag dans le champ. */
    const pastille = barre.locator(`[data-piece-etiquette="${aliasTexte ?? '#'}"]`);
    record(
      "Un fichier sans image garde son étiquette dans la barre, sans vignette",
      !!aliasTexte && (await pastille.count()) === 1 && (await barre.locator('img').count()) === 0,
      aliasTexte ?? `ancre absente : « ${avecAncre} »`,
    );
    record(
      'Son brouillon cite lui aussi le nom et l’alias',
      !!aliasTexte && /\[fichier: notes-verif[^\]]*\.txt #[0-9a-z]{4,}\]/i.test(brouillons.at(-1) ?? ''),
      (brouillons.at(-1) ?? '').slice(0, 90),
    );
    if (aliasTexte) {
      await zone.fill('rien du tout');
      await page.waitForTimeout(1200);
      record("Effacer l'ancre retire la pièce jointe", (await barre.locator('[data-piece-etiquette]').count()) === 0);
    } else {
      record("Effacer l'ancre retire la pièce jointe", false, `ancre absente : « ${avecAncre} »`);
    }

    /* ---- Un fichier lâché sur les mots s'ancre à cet endroit ---- */
    await zone.click();
    await zone.fill('Premier paragraphe.\n\nSecond paragraphe.');
    await page.waitForTimeout(400);
    // Quelques octets en plus après la fin du PNG : l'image reste lisible mais
    // le serveur ne la confond pas avec la première (il dédoublonne par contenu).
    const octets = [...PNG, 10, 11, 12];
    await zone.evaluate((node, contenu) => {
      const boite = node.getBoundingClientRect();
      const transfert = new DataTransfer();
      transfert.items.add(new File([new Uint8Array(contenu)], 'depot-verif.png', { type: 'image/png' }));
      // Tout au début de la PREMIÈRE ligne, loin de la fin du texte.
      const x = boite.left + 4;
      const y = boite.top + 10;
      for (const genre of ['dragover', 'drop']) {
        node.dispatchEvent(
          new DragEvent(genre, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: transfert }),
        );
      }
    }, octets);
    await page.waitForFunction((el) => /#[0-9a-z]{4}/i.test(el.value), await zone.elementHandle(), { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const apresDepot = lisible(await zone.inputValue());
    const aliasDepot = aliasDuTag(apresDepot);
    record(
      "Un fichier lâché sur les mots s'ancre à cet endroit, pas à la fin",
      !!aliasDepot && apresDepot.startsWith(`[fichier: ${aliasDepot}]`) && apresDepot.trim().endsWith('Second paragraphe.'),
      apresDepot.replace(/\n/g, ' ').slice(0, 80),
    );

    /* ---- Survoler une vignette fait défiler le texte jusqu'à son ancre ---- */
    /* On réécrit la première ligne TELLE QUE LE CHAMP LA PORTE (tag masqué
       compris) : la récrire démasquée poserait un autre tag que celui de la pièce. */
    const premiereLigne = (await zone.inputValue()).split('\n')[0];
    const lignes = Array.from({ length: 30 }, (_, i) => `Ligne ${i + 1} du texte de vérification.`).join('\n');
    await zone.fill(`${premiereLigne}\n${lignes}`);
    await page.waitForTimeout(600);
    const enBas = await zone.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
      return { scrollTop: node.scrollTop, possible: node.scrollHeight - node.clientHeight };
    });
    if (enBas.possible > 20 && aliasDepot) {
      await barre.locator(`img[alt="${aliasDepot}"]`).first().hover();
      await page.waitForTimeout(900);
      const remonte = await zone.evaluate((node) => node.scrollTop);
      record(
        "Survoler la vignette fait défiler le texte jusqu'à son ancre",
        remonte < enBas.scrollTop - 20,
        `de ${Math.round(enBas.scrollTop)} px à ${Math.round(remonte)} px`,
      );
    } else {
      record("Survoler la vignette fait défiler le texte jusqu'à son ancre", false, aliasDepot ? 'le champ ne défile pas' : 'aucune pièce déposée');
    }

    // On laisse la barre propre : aucun brouillon d'essai ne doit rester.
    await zone.fill('');
    await page.waitForTimeout(1200);

    record("Aucune erreur dans la page", erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } catch (souci) {
    await page.screenshot({ path: path.join(TMP, 'composeur-echec.png') }).catch(() => {});
    throw souci;
  } finally {
    await browser.close();
  }

  const echecs = results.filter((r) => !r.ok);
  console.log(`\n${results.length - echecs.length}/${results.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  console.error(journal.slice(-10).join(''));
  process.exit(1);
});
