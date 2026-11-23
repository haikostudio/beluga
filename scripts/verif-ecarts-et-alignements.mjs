#!/usr/bin/env node
/**
 * LES ÉCARTS ET LES ALIGNEMENTS DE TOUS LES ÉCRANS, MESURÉS SUR TÉLÉPHONE
 * (demande du 22/10/2026 : « contrôle dans l'intégralité de l'application que
 * tous les gaps soient corrects et que les alignements soient corrects »).
 *
 * Le robot ouvre chaque écran principal en 390 × 844, en clair puis en
 * sombre : tableau de bord, tableau d'un projet, conversation d'une carte
 * (barre d'écriture, cahier des charges, tournage), chaque service du menu
 * « Services », les réglages, le menu « Services » ouvert. Sur chacun, il lit
 * dans la page les BLOCS DE PREMIER NIVEAU — un élément qui porte un fond ou
 * un cadre, au moins la moitié de la largeur de l'écran, et qui n'est pas dans
 * un autre bloc — puis il juge trois choses :
 *
 *   1. LA SYMÉTRIE : la marge de gauche d'un bloc vaut celle de droite (±1 px) —
 *      sauf une rangée de commandes plus courte (choix de période), calée à gauche.
 *   2. LA GOUTTIÈRE : la marge d'un bloc vaut 0 (pleine largeur) ou la marge
 *      de page du téléphone, 16 px (`CLASSE_MARGES_DE_PAGE`) — ±1 px.
 *   3. LES ÉCARTS : entre deux blocs empilés l'un sous l'autre, l'écart
 *      appartient à l'échelle (« L'ÉCHELLE DES ÉCARTS », `web/src/components/ui/index.tsx` : 0, 4, 8, 16 px, ±1) ;
 *      au-delà de 24 px, c'est une respiration de mise en page, pas un écart.
 *
 * Des blocs posés CÔTE À CÔTE se jugent comme une seule rangée, et ce qui
 * défile de côté (colonnes d'un tableau, vignettes) n'est pas jugé.
 *
 * Et, pour LE PIED D'UNE CONVERSATION (`CLASSE_BLOC_DU_PIED`), plus finement :
 * tous ses blocs ont les mêmes bords, et le même écart les sépare.
 *
 * LES ASYMÉTRIES VOULUES se déclarent dans la page, jamais ici : un élément
 * marqué `data-hors-ecarts` (et tout ce qu'il contient) n'est pas jugé. Les
 * contenus d'un fil (DEC-358 : les blocs de l'agent à 95 %, collés à gauche ;
 * la bulle de l'utilisateur à droite) en sont le cas principal — ils sont
 * repérés par `data-fil`, posé sur la zone qui défile.
 *
 * Aucune trace : la session d'une heure est fabriquée puis retirée (jeton
 * HACHÉ), et les écritures que la page enverrait au démon (préférences,
 * lecture d'une carte) sont arrêtées en route. La clarté est forcée sur la
 * page, jamais enregistrée.
 *
 *   HAIKO_ECARTS_URL=http://localhost:7099 node scripts/verif-ecarts-et-alignements.mjs
 *
 * `--releve` affiche toutes les mesures, même justes. Les captures de chaque
 * écran vont dans /tmp/ecarts-<clarte>-<ecran>.png.
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { cheminDeLaBaseServie, dossierDesDonnees } from './lib/base-servie.mjs';

const ADRESSE = process.env.HAIKO_ECARTS_URL || 'http://localhost:7099';
const DONNEES = dossierDesDonnees();
const RELEVE = process.argv.includes('--releve');
const require = createRequire(import.meta.url);
const ouvrirBase = (options) =>
  require(path.join(DONNEES, '../node_modules/better-sqlite3'))(cheminDeLaBaseServie(DONNEES), options);

const echecs = [];
const constats = [];
const verifier = (ok, message) => (ok ? constats.push(message) : echecs.push(message));

/* LES CARTES QUI MONTRENT LES ÉTATS DU PIED : une carte quelconque (barre
   d'écriture), un cahier des charges, un tournage — les plus récentes de la
   base servie. Un état absent de la base n'est pas jugé, et le rapport le dit. */
const lecture = ouvrirBase({ readonly: true });
const carteDe = (condition) =>
  lecture
    .prepare(
      `SELECT c.id, c.project_id AS projectId FROM cards c JOIN projects p ON p.id = c.project_id
       WHERE p.archived = 0 AND c.column_key != 'archived' AND ${condition} ORDER BY c.updated_at DESC LIMIT 1`,
    )
    .get();
const cartes = {
  ordinaire: carteDe("json_extract(c.data, '$.cahierDesCharges') IS NULL AND json_extract(c.data, '$.realisation') IS NULL"),
  cahier: carteDe("json_extract(c.data, '$.cahierDesCharges') IS NOT NULL"),
  tournage: carteDe("json_extract(c.data, '$.realisation') IS NOT NULL"),
};
lecture.close();
if (!cartes.ordinaire) {
  console.error('Aucune carte dans la base servie : rien à vérifier.');
  process.exit(1);
}

const cookie = crypto.randomBytes(24).toString('hex');
const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
{
  const db = ouvrirBase();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3_600_000,
    'vérification des écarts et alignements',
  );
  db.close();
}

const ECHELLE = [0, 4, 8, 16];
const GOUTTIERES = [0, 16];
/** Plus de place libre à droite qu'à gauche : une rangée calée à gauche, pas un bloc décentré. */
const LIBRE_A_DROITE = 0.25 * 390;
/**
 * UN MENU OUVERT EN FEUILLE DU BAS a sa propre marge : ses lignes surlignables
 * sont à 8 px des bords, et leur texte (8 + 10 px) tombe sur celui de la page.
 * C'est la marge de TOUS les menus, jugée pareil partout.
 */
const GOUTTIERES_D_UN_MENU = [0, 8];
const TOLERANCE = 1;
/** Au-delà, deux blocs ne sont plus « empilés » : c'est une respiration de la mise en page. */
const RESPIRATION = 24;

/**
 * Lu DANS la page : les blocs de premier niveau de la couche visible du dessus
 * (le menu ou la page ouverte, sinon l'écran), et le pied de la conversation.
 */
function lireLaPage() {
  const largeur = window.innerWidth;
  /* Une couleur MÉLANGÉE (`color-mix`, les en-têtes de panneau) se lit
     `color(srgb r g b / a)`, pas `rgb(…)` : sans elle, le bandeau « Ce que
     l'agent a vu » passait pour transparent. */
  const alpha = (couleur) => {
    const m = /^(?:rgba?|color|oklab|oklch|lab|lch|hsla?)\(([^)]+)\)$/.exec((couleur || '').trim());
    if (!m) return 0;
    const avecBarre = /\/\s*([\d.]+)(%?)\s*$/.exec(m[1]);
    if (avecBarre) return Number(avecBarre[1]) / (avecBarre[2] ? 100 : 1);
    const parts = m[1].replace(/^srgb\s+/, '').split(/[ ,]+/).filter(Boolean).map(Number);
    return parts.length >= 4 ? parts[3] : 1;
  };
  const nom = (el) => {
    const repere = [...el.attributes].find((a) => a.name.startsWith('data-') && a.name !== 'data-state' && a.name !== 'data-orientation');
    const texte = (el.innerText || '').trim().split('\n')[0].slice(0, 32);
    return `${el.tagName.toLowerCase()}${repere ? `[${repere.name}]` : ''}${texte ? ` « ${texte} »` : ''}`;
  };
  /* LA COUCHE DU DESSUS : un menu ouvert, sinon la dernière page ou fenêtre
     ouverte, sinon l'écran entier. On ne juge que ce qu'on voit. */
  const couches = [...document.querySelectorAll('[role="menu"][data-state="open"], [role="dialog"][data-state="open"]')].filter(
    (c) => c.getBoundingClientRect().width > 0,
  );
  const portee = couches.at(-1) ?? document.body;
  const EXCLUS =
    '[data-hors-ecarts], [data-fil], svg, img, canvas, video, iframe, [data-bande-du-voile], [data-bande-sous-l-heure], [data-voile-defilement], [data-voile-tiroir], [data-voile-de-fenetre], [role="tooltip"]';
  /* LE CADRE DE RÉFÉRENCE : l'écran, ou la couche ouverte (un menu du bas a
     ses propres bords). Les marges se mesurent depuis lui. */
  const reference = portee === document.body ? { left: 0, right: largeur } : portee.getBoundingClientRect();
  const large = reference.right - reference.left;
  /* CE QUI DÉFILE DE CÔTÉ n'a pas de bords fixes (colonnes d'un tableau,
     rangée de vignettes) : la rangée se juge, pas ce qu'elle fait défiler. */
  const dansUnDefilementLateral = (el) => {
    for (let n = el.parentElement; n && n !== portee; n = n.parentElement) {
      const o = getComputedStyle(n).overflowX;
      if ((o === 'auto' || o === 'scroll') && n.scrollWidth > n.clientWidth + 1) return true;
    }
    return false;
  };
  const candidats = [];
  for (const el of portee.querySelectorAll('*')) {
    if (el.closest(EXCLUS)) continue;
    const b = el.getBoundingClientRect();
    if (b.width < large * 0.5 || b.width >= large - 0.5 || b.height < 20) continue;
    if (b.bottom <= 0 || b.top >= window.innerHeight || b.right <= reference.left || b.left >= reference.right) continue;
    if (dansUnDefilementLateral(el)) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'contents' || Number(s.opacity) === 0) continue;
    const fond = alpha(s.backgroundColor) > 0.03 || (s.backgroundImage !== 'none' && !s.backgroundImage.startsWith('url'));
    const cadre =
      (parseFloat(s.borderTopWidth) > 0 && alpha(s.borderTopColor) > 0.05) ||
      (parseFloat(s.borderBottomWidth) > 0 && alpha(s.borderBottomColor) > 0.05) ||
      (s.boxShadow !== 'none' && /inset/.test(s.boxShadow));
    if (!fond && !cadre) continue;
    candidats.push(el);
  }
  const premiers = candidats.filter((el) => !candidats.some((autre) => autre !== el && autre.contains(el)));
  /* UNE RANGÉE SE JUGE ENTIÈRE : des blocs posés côte à côte (un champ de
     recherche et son bouton, un geste principal et « Auto ») forment un seul
     bloc, de la gauche du premier à la droite du dernier. */
  const boites = premiers
    .map((el) => ({ nom: nom(el), r: el.getBoundingClientRect() }))
    .sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);
  const rangees = [];
  for (const boite of boites) {
    const meme = rangees.find((rangee) => {
      const haut = Math.max(rangee.haut, boite.r.top);
      const bas = Math.min(rangee.bas, boite.r.bottom);
      return bas - haut > 0.5 * Math.min(rangee.bas - rangee.haut, boite.r.height);
    });
    if (meme) {
      meme.noms.push(boite.nom);
      meme.gauche = Math.min(meme.gauche, boite.r.left);
      meme.droiteX = Math.max(meme.droiteX, boite.r.right);
      meme.haut = Math.min(meme.haut, boite.r.top);
      meme.bas = Math.max(meme.bas, boite.r.bottom);
    } else {
      rangees.push({ noms: [boite.nom], gauche: boite.r.left, droiteX: boite.r.right, haut: boite.r.top, bas: boite.r.bottom });
    }
  }
  /* Ce qui se pose à côté d'un bloc sur sa ligne — la moitié collée des
     réglages, « Auto », un bouton à côté d'une recherche — fait partie de sa
     rangée, même plus étroit que lui. */
  const voisins = [];
  for (const el of portee.querySelectorAll('button, a, input, [role="button"], [data-rangee-de-boutons] > *')) {
    if (el.closest(EXCLUS) || dansUnDefilementLateral(el)) continue;
    const b = el.getBoundingClientRect();
    if (b.width < 20 || b.height < 20 || b.right <= reference.left || b.left >= reference.right) continue;
    voisins.push(b);
  }
  for (const rangee of rangees) {
    for (const b of voisins) {
      const haut = Math.max(rangee.haut, b.top);
      const bas = Math.min(rangee.bas, b.bottom);
      if (bas - haut <= 0.5 * Math.min(rangee.bas - rangee.haut, b.height)) continue;
      if (b.bottom > rangee.bas + 2 || b.top < rangee.haut - 2) continue;
      rangee.gauche = Math.min(rangee.gauche, b.left);
      rangee.droiteX = Math.max(rangee.droiteX, b.right);
    }
  }
  const blocs = rangees.map((r) => ({
    nom: r.noms.join(' + '),
    gauche: r.gauche - reference.left,
    droite: reference.right - r.droiteX,
    haut: r.haut,
    bas: r.bas,
  }));
  /* LE PIED DE LA CONVERSATION : ses blocs, dans l'ordre. Chacun se mesure à
     sa VRAIE BOÎTE vue à l'écran — la première, dans l'ordre du document, qui
     porte un fond ou un cadre sans couvrir toute la largeur (l'enveloppe d'un
     bloc, elle, n'a que ses marges). */
  const visible = (el) => {
    const s = getComputedStyle(el);
    return (
      alpha(s.backgroundColor) > 0.03 ||
      (s.backgroundImage !== 'none' && !s.backgroundImage.startsWith('url')) ||
      (parseFloat(s.borderTopWidth) > 0 && alpha(s.borderTopColor) > 0.05) ||
      (s.boxShadow !== 'none' && /inset/.test(s.boxShadow))
    );
  };
  const pied = [];
  for (const enfant of document.querySelectorAll('[data-pied-de-conversation] > *')) {
    const cadre = enfant.getBoundingClientRect();
    if (!cadre.height) continue;
    /* Ce qu'un bloc fait défiler en lui (le corps d'un panneau de décision)
       dépasse sa boîte sans se voir : chaque boîte se coupe au bloc. */
    const boites = [enfant, ...enfant.querySelectorAll('*')]
      .filter((el) => {
        const b = el.getBoundingClientRect();
        return b.height >= 20 && b.width >= 24 && b.width < largeur - 0.5 && visible(el);
      })
      .map((el) => {
        const b = el.getBoundingClientRect();
        return {
          top: Math.max(b.top, cadre.top),
          bottom: Math.min(b.bottom, cadre.bottom),
          left: Math.max(b.left, cadre.left),
          right: Math.min(b.right, cadre.right),
        };
      })
      .filter((b) => b.bottom - b.top >= 20);
    if (!boites.length) continue;
    pied.push({
      nom: nom(enfant),
      haut: Math.min(...boites.map((b) => b.top)),
      bas: Math.max(...boites.map((b) => b.bottom)),
      gauche: Math.min(...boites.map((b) => b.left)),
      droite: largeur - Math.max(...boites.map((b) => b.right)),
    });
  }
  return { blocs, pied, couche: portee === document.body ? 'écran' : nom(portee), menu: portee.getAttribute('role') === 'menu' };
}

const pres = (valeur, cibles) => cibles.some((cible) => Math.abs(valeur - cible) <= TOLERANCE);

function juger(intitule, lu) {
  const { blocs, pied } = lu;
  if (RELEVE) {
    console.log(`\n· ${intitule} (couche : ${lu.couche})`);
    for (const b of blocs) console.log(`    ${b.gauche.toFixed(1)} | ${b.droite.toFixed(1)}  ${b.haut.toFixed(0)}→${b.bas.toFixed(0)}  ${b.nom}`);
  }
  for (const b of blocs) {
    /* Une rangée de commandes plus courte que la page (choix de période,
       onglets) se cale à GAUCHE, sur la gouttière, comme le titre au-dessus :
       seule une rangée qui couvre l'essentiel de la largeur doit être symétrique. */
    const etroite = b.droite - b.gauche > LIBRE_A_DROITE;
    if (!etroite) verifier(Math.abs(b.gauche - b.droite) <= TOLERANCE, `${intitule} : ${b.nom} symétrique (${b.gauche.toFixed(1)} / ${b.droite.toFixed(1)} px)`);
    const gouttieres = lu.menu ? GOUTTIERES_D_UN_MENU : GOUTTIERES;
    verifier(pres(b.gauche, gouttieres), `${intitule} : ${b.nom} sur la gouttière (${b.gauche.toFixed(1)} px, attendu ${gouttieres.join(' ou ')})`);
  }
  /* Les écarts entre blocs empilés : chaque bloc et celui qui le suit
     directement dessous, quand ils se recouvrent en largeur. */
  const tries = [...blocs].sort((a, b) => a.haut - b.haut);
  for (let i = 0; i < tries.length; i += 1) {
    const a = tries[i];
    const suivant = tries.slice(i + 1).find((b) => b.haut >= a.bas - TOLERANCE);
    if (!suivant) continue;
    const ecart = suivant.haut - a.bas;
    if (ecart > RESPIRATION) continue;
    verifier(pres(ecart, ECHELLE), `${intitule} : écart ${ecart.toFixed(1)} px entre ${a.nom} et ${suivant.nom} (échelle : ${ECHELLE.join(', ')})`);
  }
  if (RELEVE && pied.length) for (const b of pied) console.log(`    pied : ${b.gauche.toFixed(1)} | ${b.droite.toFixed(1)}  ${b.haut.toFixed(0)}→${b.bas.toFixed(0)}  ${b.nom}`);
  if (pied.length >= 2) {
    const bords = pied.map((b) => `${b.gauche.toFixed(0)}/${b.droite.toFixed(0)}`);
    verifier(
      pied.every((b) => Math.abs(b.gauche - pied[0].gauche) <= TOLERANCE && Math.abs(b.droite - pied[0].droite) <= TOLERANCE),
      `${intitule} : pied de conversation, mêmes bords pour ses ${pied.length} blocs (${bords.join(' ; ')})`,
    );
    const ecarts = pied.slice(1).map((b, i) => b.haut - pied[i].bas);
    verifier(
      ecarts.every((e) => Math.abs(e - ecarts[0]) <= TOLERANCE),
      `${intitule} : pied de conversation, même écart entre ses blocs (${ecarts.map((e) => e.toFixed(1)).join(' / ')})`,
    );
  }
}

const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ecransVus = new Set();
try {
  for (const clarte of ['clair', 'sombre']) {
    const contexte = await navigateur.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await contexte.addCookies([{ name: 'beluga_session', value: cookie, domain: new URL(ADRESSE).hostname, path: '/' }]);
    await contexte.addInitScript((c) => {
      try {
        window.localStorage.setItem('beluga-theme-flash', c);
      } catch {
        /* sans stockage local, la pose d'après suffit */
      }
    }, clarte);
    const page = await contexte.newPage();
    /* AUCUNE TRACE : préférences, carte lue, projet lu ne partent pas au démon. */
    await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
      const serveur = ws.connectToServer();
      ws.onMessage((message) => {
        try {
          const lu = JSON.parse(String(message));
          if (['prefs.set', 'card.read', 'project.read'].includes(lu?.cmd?.type ?? lu?.type)) return;
        } catch {
          /* pas du JSON : passe tel quel */
        }
        serveur.send(message);
      });
    });
    const forcerLaClarte = () =>
      page.evaluate((c) => {
        const racine = document.documentElement;
        racine.dataset.theme = c;
        racine.classList.toggle('dark', c === 'sombre');
        racine.style.colorScheme = c === 'sombre' ? 'dark' : 'light';
      }, clarte);
    const aller = async (hash, attente) => {
      await page.goto(`${ADRESSE}/#${hash}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.belugaEssai?.pret?.(), null, { timeout: 60_000 });
      if (attente) await page.waitForSelector(attente, { timeout: 20_000 }).catch(() => {});
      for (let essai = 0; essai < 20; essai += 1) {
        if (await page.evaluate(() => !document.querySelector('.animate-silhouette'))) break;
        await page.waitForTimeout(400);
      }
      await forcerLaClarte();
      await page.waitForTimeout(700);
    };
    const mesurer = async (ecran) => {
      ecransVus.add(ecran);
      const intitule = `${clarte} · ${ecran}`;
      juger(intitule, await page.evaluate(lireLaPage));
      await page.screenshot({ path: `/tmp/ecarts-${clarte}-${ecran.replace(/[^a-z0-9]+/gi, '-')}.png` });
    };

    await aller('tableau-de-bord', '[data-entete-de-zone]');
    await mesurer('résumé');
    await aller('en-route', '[data-entete-de-zone]');
    await mesurer('tableaux de bord');
    await aller(`projet/${cartes.ordinaire.projectId}`, '[data-entete-de-zone]');
    await mesurer('tableau du projet');
    for (const [etat, carte] of Object.entries(cartes)) {
      if (!carte) {
        console.log(`  · aucune carte « ${etat} » dans la base : état non jugé`);
        continue;
      }
      await aller(`projet/${carte.projectId}/tache/${carte.id}`, `[data-page-carte="${carte.id}"]`);
      await mesurer(`carte ${etat}`);
    }
    for (const vue of ['statistiques', 'coffre', 'memoire', 'espace', 'backups', 'surveillance', 'taches-recurrentes', 'marketing', 'medias', 'notes', 'reglages']) {
      await aller(vue, '[data-entete-de-zone]');
      await mesurer(vue);
    }
    await aller('tableau-de-bord', '[data-entete-de-zone]');
    const services = page.locator('button[aria-label="Services"]:visible').first();
    if (await services.count()) {
      await services.click();
      await page.waitForTimeout(700);
      await mesurer('menu Services ouvert');
    }
    await contexte.close();
  }
} finally {
  await navigateur.close();
  const db = ouvrirBase();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  db.close();
}

if (RELEVE) for (const c of constats) console.log(`  ✔ ${c}`);
for (const e of echecs) console.error(`  ✘ ${e}`);
console.log(`\n${constats.length} contrôle(s) réussi(s), ${echecs.length} échec(s). Écrans vus : ${[...ecransVus].join(' ; ')}`);
process.exit(echecs.length ? 1 : 0);
