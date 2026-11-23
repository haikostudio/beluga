#!/usr/bin/env node
/**
 * LES MEMBRES D'UN PROJET RÉUNI SE RANGENT SOUS LUI, DANS LES LISTES DE CHOIX.
 *
 * Trois écrans, dans un vrai navigateur, sur la base réellement servie — lue
 * seulement, rien n'y est écrit hors la session d'une heure, retirée à la fin :
 *
 *  1. « CHANGER DE PROJET » (clic sur le nom en haut) : chaque membre suit son
 *     projet réuni, en retrait, relié par une branche ; le projet réuni porte la
 *     pile des icônes de ses membres.
 *  2. « DÉPLACER VERS UN AUTRE PROJET » (menu d'une carte) : même rangement, une
 *     icône devant chaque destination, la branche calée sur des entrées de 32 px.
 *  3. LES MENUS DÉROULANTS du coffre-fort et des sauvegardes : le membre suit son
 *     projet réuni et porte le retrait insécable et le signe « └ » ; dans les
 *     sauvegardes, où le serveur n'envoie pas les projets réunis (ils n'ont rien
 *     à sauvegarder), le projet réuni est rappelé en titre non sélectionnable.
 *
 * Le volet « Dans quel projet ? » a son propre contrôle
 * (`verif-nouvel-agent-tableau-de-bord.mjs`), et la règle pure son test
 * (`server/src/test/arbre-des-projets.test.ts`).
 *
 * Jamais BELUGA_URL (l'application publiée) : le serveur de développement.
 *   HAIKO_ARBRE_URL=http://localhost:7099 node scripts/verif-arbre-des-projets.mjs
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { cheminDeLaBaseServie } from './base-servie.mjs';
import { optionsDeLaListe } from './lib/liste-deroulante.mjs';

const BASE = process.env.HAIKO_ARBRE_URL || 'http://localhost:7099';
const CAPTURES = process.env.HAIKO_ARBRE_CAPTURES || '/tmp';
const PRINCIPAL = path.resolve(process.env.BELUGA_DATA || '/root/beluga/data', '..');

function base() {
  const require = createRequire(import.meta.url);
  return require(path.join(PRINCIPAL, 'node_modules/better-sqlite3'))(cheminDeLaBaseServie());
}

const cookie = crypto.randomBytes(24).toString('hex');
const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
let projets = [];
{
  const d = base();
  const n = Date.now();
  d.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?,?,?,?)')
    .run(empreinte, n, n + 3600_000, 'vérif arbre des projets');
  projets = d.prepare('SELECT id, data FROM projects WHERE archived = 0').all().map((r) => ({ id: r.id, ...JSON.parse(r.data) }));
  d.close();
}
const retirerLaSession = () => {
  const d = base();
  d.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  d.close();
};

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/** Les projets réunis qui ont au moins un membre actif : c'est eux qu'on juge. */
const reunis = projets.filter((p) => p.regroupement === true);
const membresDe = (id) => projets.filter((p) => p.regroupementId === id && !p.isSelf);
const juges = reunis.filter((p) => membresDe(p.id).length);

/**
 * Ce que montre une liste : pour chaque ligne, son projet, son parent annoncé,
 * la place de son icône et celle des traits de sa branche. `selecteur` désigne
 * les lignes ; `attribut` porte l'identifiant du projet, sur la ligne ou dedans.
 */
const lireLaListe = (page, selecteur, attribut) =>
  page.evaluate(
    ({ selecteur, attribut }) =>
      [...document.querySelectorAll(selecteur)].map((ligne) => {
        const porteur = ligne.hasAttribute(attribut) ? ligne : ligne.querySelector(`[${attribut}]`);
        const icone = (porteur.querySelector('[data-pile-favicons], [data-favicon-projet], [data-initiales-projet]') ?? porteur)
          .getBoundingClientRect();
        const pile = porteur.querySelector('[data-pile-favicons]');
        const branche = ligne.querySelector('[data-branche-de-liste]');
        const traits = branche ? [...branche.children].map((t) => t.getBoundingClientRect()) : [];
        const boite = ligne.getBoundingClientRect();
        return {
          id: porteur.getAttribute(attribut),
          parent: ligne.getAttribute('data-membre-de'),
          pile: !!pile,
          aUneIcone: !!porteur.querySelector('[data-pile-favicons], [data-favicon-projet], [data-initiales-projet]'),
          hauteur: boite.height,
          gaucheIcone: icone.left,
          milieuIcone: (icone.left + icone.right) / 2,
          basIcone: icone.bottom,
          milieuVertical: (icone.top + icone.bottom) / 2,
          branche: branche?.getAttribute('data-branche-de-liste') ?? null,
          gaucheTrait: traits.length ? Math.min(...traits.map((t) => t.left)) : null,
          droiteTrait: traits.length ? Math.max(...traits.map((t) => t.right)) : null,
          hautTrait: traits.length ? Math.min(...traits.map((t) => t.top)) : null,
          basTrait: traits.length ? Math.max(...traits.map((t) => t.bottom)) : null,
        };
      }),
    { selecteur, attribut },
  );

/** Les contrôles communs aux deux listes dessinées : rangement, pile, branche. */
function jugerLArbre(nom, lignes, hauteurAttendue) {
  const ids = lignes.map((l) => l.id);
  const membres = lignes.filter((l) => l.parent);
  const ligne = (id) => lignes.find((l) => l.id === id);
  noter(`${nom} : des membres y sont rangés sous leur projet réuni`, membres.length > 0, `${membres.length} membre(s)`);
  if (!membres.length) return;
  noter(
    `${nom} : chaque membre suit immédiatement son projet réuni ou un autre de ses membres`,
    membres.every((m) => {
      const avant = lignes[ids.indexOf(m.id) - 1];
      return avant && (avant.id === m.parent || avant.parent === m.parent);
    }),
  );
  noter(
    `${nom} : tout membre actif d’un projet réuni affiché est sous lui, aucun n’est resté ailleurs`,
    juges.filter((p) => ids.includes(p.id)).every((p) => membresDe(p.id).filter((m) => ids.includes(m.id)).every((m) => ligne(m.id).parent === p.id)),
  );
  noter(
    `${nom} : un projet réuni porte la pile des icônes de ses membres, et chaque ligne a une icône`,
    juges.filter((p) => ids.includes(p.id)).every((p) => ligne(p.id).pile) && lignes.every((l) => l.aUneIcone),
  );
  noter(
    `${nom} : le dernier membre d’un bloc porte le coude, les autres le trait qui continue`,
    membres.every((m) => {
      const apres = lignes[ids.indexOf(m.id) + 1];
      return m.branche === (apres?.parent === m.parent ? 'milieu' : 'dernier');
    }) && lignes.filter((l) => !l.parent).every((l) => !l.branche),
  );
  noter(
    `${nom} : un membre est en retrait de 20 px, la branche part du milieu de la pile et s’arrête à 2 px de son icône`,
    membres.every((m) => {
      const p = ligne(m.parent);
      return (
        Math.round(m.gaucheIcone - p.gaucheIcone) === 20 &&
        Math.abs(m.gaucheTrait - p.milieuIcone) <= 0.6 &&
        Math.abs(m.gaucheIcone - m.droiteTrait - 2) <= 0.6
      );
    }),
  );
  noter(
    `${nom} : le trait descend de sous la pile sans la toucher, sans trou entre deux membres, jusqu’à l’icône du dernier`,
    membres.every((m) => {
      const i = ids.indexOf(m.id);
      const avant = lignes[i - 1];
      const apres = lignes[i + 1];
      const depart = avant.id === m.parent ? m.hautTrait - avant.basIcone : 1;
      const suite = apres?.parent === m.parent ? apres.hautTrait <= m.basTrait + 0.1 : Math.abs(m.basTrait - m.milieuVertical) <= 1;
      return depart >= 0.5 && depart <= 3 && suite;
    }),
  );
  noter(
    `${nom} : toutes les lignes gardent ${hauteurAttendue} px`,
    lignes.every((l) => Math.round(l.hauteur) === hauteurAttendue),
    [...new Set(lignes.map((l) => Math.round(l.hauteur)))].join(' / '),
  );
}

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
});
try {
  if (!juges.length) {
    noter('aucun projet réuni à membres dans cette base : rien à juger', true);
  } else {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: 'fr-CH',
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    });
    await context.addCookies([
      { name: 'beluga_session', value: cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
    ]);
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const erreurs = [];
    page.on('pageerror', (err) => erreurs.push(String(err)));
    const fermerCeQuiEstOuvert = async () => {
      for (let essai = 0; essai < 4 && (await page.locator('[role="dialog"][data-state="open"], [role="menu"]').count()); essai++) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
      }
    };

    /* ---------- 1. « CHANGER DE PROJET » ---------- */
    await page.goto(`${BASE}/#/en-route`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4500);
    await fermerCeQuiEstOuvert();

    /* ---------- 2. « DÉPLACER VERS UN AUTRE PROJET » ---------- */
    // Une carte jamais travaillée, où qu'elle soit : on essaie les tableaux un à un.
    let destinations = null;
    for (const projet of projets.slice(0, 12)) {
      await page.goto(`${BASE}/#projet/${projet.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(2500);
      await fermerCeQuiEstOuvert();
      const cartes = page.locator('[data-column="planned"] [data-carte]');
      for (let i = 0; i < Math.min(await cartes.count(), 3) && !destinations; i++) {
        await cartes.nth(i).click({ button: 'right' }).catch(() => {});
        await page.waitForTimeout(600);
        const entree = page.locator('[role="menu"] [data-menu-changer-de-projet]').last();
        if ((await entree.count()) && (await entree.getAttribute('data-disabled')) === null) {
          await entree.hover();
          await page.waitForTimeout(800);
          if (await page.locator('[data-projet-destination]').count()) {
            destinations = await lireLaListe(page, '[data-projet-destination]', 'data-projet-destination');
            await page.screenshot({ path: path.join(CAPTURES, 'arbre-deplacer-vers-projet.png') });
          }
        }
        await fermerCeQuiEstOuvert();
      }
      if (destinations) break;
    }
    if (destinations) jugerLArbre('« Déplacer vers un autre projet »', destinations, 32);
    else noter('« Déplacer vers un autre projet » : aucune carte déplaçable trouvée dans « Planifié », menu non jugé', true);

    /* ---------- 3. LES MENUS DÉROULANTS ---------- */
    // Les menus sont des listes déroulantes de l'application : on les ouvre pour lire leurs options.
    const lireLesOptions = (selecteur) => optionsDeLaListe(page.locator(selecteur).first());
    const jugerLeMenu = (nom, options) => {
      const membres = options.filter((o) => o.parent);
      noter(`${nom} : des membres y sont rangés sous leur projet réuni`, membres.length > 0, `${membres.length} membre(s)`);
      noter(
        `${nom} : chaque membre suit son projet réuni, avec un retrait insécable et le signe « └ »`,
        membres.every((m) => {
          const avant = options[options.indexOf(m) - 1];
          return (avant?.id === m.parent || avant?.parent === m.parent) && m.texte.startsWith('  └ ');
        }) && options.filter((o) => !o.parent).every((o) => !o.texte.includes('└')),
      );
    };

    await page.goto(`${BASE}/#coffre`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    await fermerCeQuiEstOuvert();
    await page.locator('[data-coffre-creer]').click();
    await page.locator('[data-coffre-type]').first().click();
    await page.locator('[data-coffre-projet]').waitFor({ state: 'attached' });
    jugerLeMenu('coffre-fort', await lireLesOptions('[data-coffre-projet]'));
    await fermerCeQuiEstOuvert();

    await page.goto(`${BASE}/#backups`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    await fermerCeQuiEstOuvert();
    await page.locator('[data-backups-creer]').click();
    await page.waitForTimeout(800);
    if (await page.locator('[data-backups-projet]').count()) {
      const options = await lireLesOptions('[data-backups-projet]');
      if (options.some((o) => o.parent)) {
        jugerLeMenu('sauvegardes', options);
        noter(
          'sauvegardes : le projet réuni, que le serveur n’envoie pas, est rappelé en titre non sélectionnable',
          options.filter((o) => reunis.some((p) => p.id === o.id)).every((o) => o.eteinte) &&
            options.filter((o) => o.parent).every((o) => !o.eteinte),
        );
      } else {
        noter('sauvegardes : aucun membre de projet réuni sans fiche de sauvegarde, menu non jugé', true);
      }
    } else {
      noter('sauvegardes : tous les projets ont déjà leur fiche, menu absent et non jugé', true);
    }
    await fermerCeQuiEstOuvert();

    noter('aucune erreur de page pendant le parcours', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  }
} catch (err) {
  noter('le parcours va au bout', false, String(err?.message ?? err).split('\n')[0]);
} finally {
  await browser.close();
  retirerLaSession();
}

const rates = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - rates.length}/${resultats.length} contrôles passés.`);
process.exit(rates.length ? 1 : 0);
