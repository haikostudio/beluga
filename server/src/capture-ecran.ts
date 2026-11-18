/**
 * LE MOTEUR DE CAPTURES D'ÉCRAN (carte « Captures d'écran et plaquette client », 05/11/2026).
 *
 * Exécute une RECETTE déjà VALIDÉE d'un clic (`shared/src/capture-ecran.ts`) : chaque adresse × appareil × thème donne
 * une image `.webp`, prise dans le Chrome du système (`playwright`, `channel: 'chrome'`, rien à télécharger), puis jointe
 * à la conversation (bande « Ce que l'agent a vu ») et rangée dans les Fichiers du projet, sous « Captures ».
 *
 * LA PRISE SUIT LA COMPÉTENCE « capture pleine page sans éléments collés en double » : animations coupées, chargement
 * différé réveillé par un déroulé, défileur interne d'une application trouvé, hauteurs « 100vh » figées, chaque élément
 * collant posé UNE fois à sa place (le fixed du bas au pied de la page, pas au milieu). Au-delà de 15 000 px, l'image
 * est coupée à cette hauteur (Chrome répète les images au-delà de ~16 000 px).
 *
 * LE SITE EST PRIS PROPRE (carte « Captures de sites sans pop-ups », 08/11/2026) : le bandeau de cookies est ACCEPTÉ puis
 * retiré, les fenêtres surgissantes, leur voile, les bulles de discussion et boutons flottants sont retirés, le défilement
 * bloqué est rendu — avant le déroulé, puis une seconde fois juste avant de déplier les collants (`capture-nettoyage.ts`).
 * L'en-tête et un bandeau d'annonce collé en haut restent. `garderLesSurcouches` dans la recette coupe ce nettoyage.
 *
 * ET LA COMPÉTENCE « captures réelles d'une app pour sa vitrine » : 1440×900 en densité 2, thème forcé par
 * `prefers-color-scheme`, connexion puis cookie de langue, badges de développement retirés, webp vers 80.
 *
 * LES SECRETS NE SORTENT PAS D'ICI : l'identifiant et le mot de passe sont lus dans le coffre au moment de se connecter,
 * tapés dans la page, et ne paraissent ni dans la recette, ni dans le texte rendu à l'agent, ni dans un fichier.
 *
 * UNE PRISE QUI NE REND PAS LA MAIN EST UNE PANNE : chaque page a son délai, la recette entière aussi, et le navigateur
 * se referme dans tous les cas.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  FENETRES_DE_CAPTURE,
  nomDeCapture,
  nomDeFichierSur,
  type AppareilDeCapture,
  type Attachment,
  type RecetteDeCapture,
  type ThemeDeCapture,
} from '@beluga/shared';
import { joindreUnFichier } from './joindre-fichier.js';
import { listerAcces } from './coffre-fort.js';
import { prendreLeNavigateur, rendreLeNavigateur } from './navigateur-du-serveur.js';
import { noterUneCapture } from './plaquettes.js';
import { log } from './logger.js';
import { nettoyerAvantLaPrise, retirerLesSurcouches } from './capture-nettoyage.js';

const executer = promisify(execFile);

/** Les badges et bandeaux de développement les plus courants, retirés d'office. */
const MASQUES_D_OFFICE = [
  'nextjs-portal',
  '[data-nextjs-toast]',
  '#vite-error-overlay',
  'vite-error-overlay',
  '#__next-build-watcher',
  '[data-astro-dev-toolbar]',
  'astro-dev-toolbar',
  '#webpack-dev-server-client-overlay',
  '[data-capture-masquer]',
];

const DELAI_PAGE_MS = 60_000;
const DELAI_RECETTE_MS = 15 * 60_000;
const HAUTEUR_MAX = 15_000;

export interface ResultatDeCapture {
  pieces: Attachment[];
  video?: Attachment;
  erreurs: string[];
}

/** L'accès du coffre désigné par la recette : par identifiant, sinon par nom (sans tenir compte de la casse). */
export function accesDuCoffre(designation: string): { identifiant: string; motDePasse: string; nom: string } | null {
  const tous = listerAcces();
  const d = designation.trim().toLowerCase();
  const fiche = tous.find((a) => a.id === designation) ?? tous.find((a) => a.nom.trim().toLowerCase() === d) ?? tous.find((a) => a.nom.toLowerCase().includes(d));
  if (!fiche) return null;
  const c = fiche.champs ?? {};
  const identifiant = c.identifiant || c.email || c.utilisateur || c.login || '';
  const motDePasse = c.motDePasse || c.password || '';
  if (!identifiant || !motDePasse) return null;
  return { identifiant, motDePasse, nom: fiche.nom };
}

async function attendreLeNavigateur(qui: string): Promise<boolean> {
  for (let i = 0; i < 90; i++) {
    if (prendreLeNavigateur(qui)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/**
 * Le webp ne dépasse pas 16 383 px de côté : une page haute prise en densité 2 (15 000 px CSS → 30 000 px) faisait
 * échouer la conversion, donc TOUTE capture d'une page de plus de ~8 200 px. Au-delà, l'image est réduite pour tenir,
 * proportions gardées : la page reste entière, un peu moins fine.
 */
const WEBP_MAX = 16_383;

async function versWebp(png: string, webp: string): Promise<void> {
  const reduire = `scale=w='trunc(iw*min(1,${WEBP_MAX}/ih)/2)*2':h='min(ih,${WEBP_MAX})'`;
  await executer('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-vf', reduire, '-c:v', 'libwebp', '-quality', '80', webp], { timeout: 120_000 });
}

/* Tout ce qui suit tourne DANS la page (évalué par Chrome) : écrit en JavaScript sans dépendance. */

const SCRIPT_PREPARER = `(() => {
  const doc = document.scrollingElement || document.documentElement;
  let defileur = doc;
  if (doc.scrollHeight <= innerHeight + 4) {
    let meilleur = null;
    for (const e of document.querySelectorAll('body *')) {
      const s = getComputedStyle(e);
      if (!/(auto|scroll|overlay)/.test(s.overflowY)) continue;
      if (e.scrollHeight <= e.clientHeight + 40 || e.clientHeight < innerHeight * 0.4) continue;
      if (!meilleur || e.clientWidth * e.clientHeight > meilleur.clientWidth * meilleur.clientHeight) meilleur = e;
    }
    if (meilleur) defileur = meilleur;
  }
  defileur.setAttribute('data-capture-defileur', defileur === doc ? 'page' : 'interne');
  window.__defileur = defileur;
})()`;

const SCRIPT_DEROULER = `(async () => {
  const d = window.__defileur;
  const pas = Math.max(200, Math.floor((d === document.scrollingElement || d === document.documentElement ? innerHeight : d.clientHeight) / 2));
  document.querySelectorAll('img[loading="lazy"]').forEach((i) => i.setAttribute('loading', 'eager'));
  let y = 0;
  for (let tour = 0; tour < 400; tour++) {
    y += pas;
    d.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 120));
    if (y >= d.scrollHeight - d.clientHeight) {
      await new Promise((r) => setTimeout(r, 400));
      if (y >= d.scrollHeight - d.clientHeight) break;
    }
  }
  d.scrollTo(0, 0);
  await Promise.race([
    Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; }))),
    new Promise((r) => setTimeout(r, 8000)),
  ]);
})()`;

const SCRIPT_DEPLIER = `(() => {
  const liste = [];
  let n = 0;
  for (const e of document.querySelectorAll('body *')) {
    const s = getComputedStyle(e);
    if (s.position !== 'fixed' && s.position !== 'sticky') continue;
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || s.display === 'none' || s.visibility === 'hidden') continue;
    const id = 'c' + n++;
    e.setAttribute('data-capture-collant', id);
    const enBas = s.position === 'fixed' && s.bottom !== 'auto' && (s.top === 'auto' || r.top > innerHeight / 2);
    liste.push({ id, position: s.position, enBas });
  }
  const h = innerHeight;
  for (const e of document.querySelectorAll('body *')) {
    const s = getComputedStyle(e);
    if (s.position === 'fixed') continue;
    const r = e.getBoundingClientRect();
    if (Math.abs(r.height - h) <= 2 || /vh|dvh|svh|lvh/.test(e.getAttribute('style') || '')) {
      e.style.setProperty('height', r.height + 'px', 'important');
      e.style.setProperty('min-height', '0', 'important');
    }
  }
  const d = window.__defileur;
  if (d.getAttribute('data-capture-defileur') === 'interne') {
    for (let e = d; e && e !== document.documentElement; e = e.parentElement) {
      e.style.setProperty('height', 'auto', 'important');
      e.style.setProperty('max-height', 'none', 'important');
      e.style.setProperty('overflow', 'visible', 'important');
    }
    document.documentElement.style.setProperty('height', 'auto', 'important');
    document.documentElement.style.setProperty('overflow', 'visible', 'important');
  }
  for (const c of liste) {
    const e = document.querySelector('[data-capture-collant="' + c.id + '"]');
    if (!e) continue;
    if (c.position === 'sticky') e.style.setProperty('position', 'relative', 'important');
    else if (!c.enBas) {
      const r = e.getBoundingClientRect();
      e.style.setProperty('position', 'absolute', 'important');
      e.style.setProperty('top', (r.top + scrollY) + 'px', 'important');
    }
  }
  const H = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  for (const c of liste) {
    if (c.position !== 'fixed' || !c.enBas) continue;
    const e = document.querySelector('[data-capture-collant="' + c.id + '"]');
    if (!e) continue;
    const r = e.getBoundingClientRect();
    e.style.setProperty('position', 'absolute', 'important');
    e.style.setProperty('bottom', 'auto', 'important');
    e.style.setProperty('top', (H - (innerHeight - r.top)) + 'px', 'important');
  }
  return Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
})()`;

const CSS_FIGE =
  '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important;overflow-anchor:none!important}';

type Contexte = import('playwright').BrowserContext;
type Page = import('playwright').Page;

async function ouvrir(page: Page, url: string, attente: number): Promise<void> {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
  } catch {
    await page.goto(url, { waitUntil: 'load', timeout: 45_000 });
  }
  if (attente) await page.waitForTimeout(attente);
}

async function retirer(page: Page, selecteurs: readonly string[]): Promise<void> {
  await page.addStyleTag({ content: CSS_FIGE }).catch(() => {});
  await page
    .evaluate(
      `(() => { for (const s of ${JSON.stringify([...selecteurs])}) { try { document.querySelectorAll(s).forEach((e) => e.remove()); } catch (e) { /* sélecteur invalide */ } } })()`,
    )
    .catch(() => {});
}

/** Se connecter avec l'accès du coffre, une fois par contexte. Rend une raison d'échec, ou `null`. */
async function seConnecter(contexte: Contexte, recette: RecetteDeCapture): Promise<string | null> {
  const c = recette.connexion;
  if (!c) return null;
  const acces = accesDuCoffre(c.acces);
  if (!acces) return `l'accès « ${c.acces} » est introuvable dans le coffre-fort, ou il lui manque l'identifiant ou le mot de passe`;
  const page = await contexte.newPage();
  try {
    await ouvrir(page, c.url ?? recette.cibles[0]!.url, 500);
    const champId = c.champIdentifiant ?? 'input[type="email"], input[name*="mail" i], input[name*="user" i], input[name*="login" i], input[type="text"]';
    const champMdp = c.champMotDePasse ?? 'input[type="password"]';
    await page.locator(champId).first().fill(acces.identifiant, { timeout: 15_000 });
    await page.locator(champMdp).first().fill(acces.motDePasse, { timeout: 15_000 });
    if (c.bouton) await page.locator(c.bouton).first().click({ timeout: 15_000 });
    else await page.locator(champMdp).first().press('Enter');
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(800);
    const encore = await page.locator('input[type="password"]').count().catch(() => 0);
    if (encore && page.url() === (c.url ?? recette.cibles[0]!.url)) return `la connexion avec « ${acces.nom} » n'a pas abouti (la page de connexion est restée affichée)`;
    if (recette.langue) {
      const u = new URL(page.url());
      await contexte.addCookies([{ name: 'lang', value: recette.langue, domain: u.hostname, path: '/' }, { name: 'locale', value: recette.langue, domain: u.hostname, path: '/' }]).catch(() => {});
    }
    return null;
  } catch (err) {
    return `la connexion avec « ${acces.nom} » a échoué (${(err as Error).message.split('\n')[0]})`;
  } finally {
    await page.close().catch(() => {});
  }
}

async function prendreUneImage(contexte: Contexte, url: string, recette: RecetteDeCapture, sortiePng: string): Promise<void> {
  const page = await contexte.newPage();
  try {
    await ouvrir(page, url, recette.attente);
    const masques = [...MASQUES_D_OFFICE, ...recette.masquer];
    await retirer(page, masques);
    if (!recette.garderLesSurcouches) await nettoyerAvantLaPrise(page, () => retirer(page, masques));
    if (!recette.pleinePage) {
      await page.screenshot({ path: sortiePng, animations: 'disabled' });
      return;
    }
    await page.evaluate(SCRIPT_PREPARER);
    await page.evaluate(SCRIPT_DEROULER);
    await page.waitForTimeout(300);
    /* Seconde passe : une fenêtre surgie pendant le déroulé serait sinon figée au milieu de l'image par le dépliage. */
    if (!recette.garderLesSurcouches) await retirerLesSurcouches(page);
    const hauteur = Number(await page.evaluate(SCRIPT_DEPLIER)) || 0;
    await page.waitForTimeout(200);
    const largeur = page.viewportSize()?.width ?? 1440;
    if (hauteur > HAUTEUR_MAX) {
      await page.screenshot({ path: sortiePng, fullPage: true, animations: 'disabled', clip: { x: 0, y: 0, width: largeur, height: HAUTEUR_MAX } });
    } else {
      await page.screenshot({ path: sortiePng, fullPage: true, animations: 'disabled' });
    }
  } finally {
    await page.close().catch(() => {});
  }
}

function avecDelai<T>(promesse: Promise<T>, ms: number, quoi: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const minuteur = setTimeout(() => reject(new Error(`${quoi} : aucune réponse après ${Math.round(ms / 1000)} s`)), ms);
    promesse.then(
      (v) => {
        clearTimeout(minuteur);
        resolve(v);
      },
      (e) => {
        clearTimeout(minuteur);
        reject(e);
      },
    );
  });
}

/** EXÉCUTE la recette. Ne s'appelle QUE pour une recette dont l'encadré a reçu « Capturer » (vérifié par l'appelant). */
export async function executerLaRecette(opts: {
  recette: RecetteDeCapture;
  projectId: string;
  agentId?: string;
  cardId?: string;
}): Promise<ResultatDeCapture> {
  const qui = `captures:${opts.agentId ?? opts.projectId}`;
  if (!(await attendreLeNavigateur(qui))) return { pieces: [], erreurs: ['le navigateur du serveur est occupé depuis plus d’une minute et demie — réessaie dans un instant'] };
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-captures-'));
  const resultat: ResultatDeCapture = { pieces: [], erreurs: [] };
  const { chromium } = await import('playwright');
  const navigateur = await chromium.launch({ channel: 'chrome', headless: true });
  const joindre = async (fichier: string, nom: string, genre: 'capture' | 'video'): Promise<Attachment | null> => {
    const j = await joindreUnFichier({ projectId: opts.projectId, agentId: opts.agentId, cardId: opts.cardId, fichier, nom, deLAgent: true });
    if (!j.ok) {
      resultat.erreurs.push(`${nom} : ${j.refus}`);
      return null;
    }
    noterUneCapture({ attachmentId: j.attachment.id, projectId: opts.projectId, genre });
    return j.attachment;
  };
  const tout = async () => {
    const recette = opts.recette;
    for (const appareil of recette.appareils) {
      for (const theme of recette.themes) {
        const contexte = await nouveauContexte(navigateur, appareil, theme, recette);
        try {
          const refus = await seConnecter(contexte, recette);
          if (refus) {
            resultat.erreurs.push(refus);
            if (recette.connexion) continue;
          }
          for (const cible of recette.cibles) {
            const nom = nomDeCapture(cible, appareil, theme);
            const png = path.join(travail, nom.replace(/\.webp$/, '.png'));
            const webp = path.join(travail, nom);
            try {
              await avecDelai(prendreUneImage(contexte, cible.url, recette, png), DELAI_PAGE_MS, nom);
              await versWebp(png, webp);
              const piece = await joindre(webp, nom, 'capture');
              if (piece) resultat.pieces.push(piece);
            } catch (err) {
              resultat.erreurs.push(`${nom} : ${(err as Error).message.split('\n')[0]}`);
            }
          }
        } finally {
          await contexte.close().catch(() => {});
        }
      }
    }
    if (recette.video) resultat.video = (await filmerLeParcours(navigateur, recette, travail, resultat, joindre)) ?? undefined;
  };
  try {
    await avecDelai(tout(), DELAI_RECETTE_MS, 'la recette de captures');
  } catch (err) {
    resultat.erreurs.push((err as Error).message.split('\n')[0]!);
  } finally {
    await navigateur.close().catch(() => {});
    rendreLeNavigateur(qui);
    fs.rmSync(travail, { recursive: true, force: true });
  }
  log.info(`captures : ${resultat.pieces.length} image(s)${resultat.video ? ' + 1 vidéo' : ''}, ${resultat.erreurs.length} erreur(s)`);
  return resultat;
}

async function nouveauContexte(
  navigateur: import('playwright').Browser,
  appareil: AppareilDeCapture,
  theme: ThemeDeCapture,
  recette: RecetteDeCapture,
  video?: { dir: string },
): Promise<Contexte> {
  const f = FENETRES_DE_CAPTURE[appareil];
  return navigateur.newContext({
    viewport: { width: f.largeur, height: f.hauteur },
    deviceScaleFactor: video ? 1 : f.densite,
    isMobile: f.mobile,
    hasTouch: f.mobile,
    colorScheme: theme === 'sombre' ? 'dark' : 'light',
    reducedMotion: video ? 'no-preference' : 'reduce',
    ...(recette.langue ? { locale: recette.langue, extraHTTPHeaders: { 'accept-language': recette.langue } } : {}),
    ...(video ? { recordVideo: { dir: video.dir, size: { width: f.largeur, height: f.hauteur } } } : {}),
  });
}

/** LA VIDÉO DE PARCOURS : chaque page ouverte puis déroulée lentement, enregistrée par Chrome puis passée en mp4. */
async function filmerLeParcours(
  navigateur: import('playwright').Browser,
  recette: RecetteDeCapture,
  travail: string,
  resultat: ResultatDeCapture,
  joindre: (fichier: string, nom: string, genre: 'capture' | 'video') => Promise<Attachment | null>,
): Promise<Attachment | null> {
  const v = recette.video!;
  const dir = path.join(travail, 'video');
  fs.mkdirSync(dir, { recursive: true });
  const contexte = await nouveauContexte(navigateur, v.appareil, recette.themes[0]!, recette, { dir });
  let brut: string | null = null;
  try {
    const refus = await seConnecter(contexte, recette);
    if (refus && recette.connexion) {
      resultat.erreurs.push(`vidéo : ${refus}`);
      return null;
    }
    const page = await contexte.newPage();
    for (const cible of recette.cibles) {
      await avecDelai(ouvrir(page, cible.url, 600), DELAI_PAGE_MS, `vidéo (${cible.nom})`);
      const masques = [...MASQUES_D_OFFICE, ...recette.masquer];
      await retirer(page, masques);
      if (!recette.garderLesSurcouches) await nettoyerAvantLaPrise(page, () => retirer(page, masques));
      const pas = Math.max(8, Math.round((v.secondesParPage * 1000) / 40));
      await page.evaluate(`(async () => {
        const d = document.scrollingElement || document.documentElement;
        const total = Math.max(0, d.scrollHeight - innerHeight);
        for (let i = 1; i <= ${pas}; i++) {
          d.scrollTo(0, (total * i) / ${pas});
          await new Promise((r) => setTimeout(r, 40));
        }
      })()`);
      await page.waitForTimeout(500);
    }
    brut = (await page.video()?.path()) ?? null;
    await page.close();
  } catch (err) {
    resultat.erreurs.push(`vidéo : ${(err as Error).message.split('\n')[0]}`);
  } finally {
    await contexte.close().catch(() => {});
  }
  if (!brut || !fs.existsSync(brut)) return null;
  const nom = `parcours-${nomDeFichierSur(recette.cibles[0]!.nom)}-${v.appareil}.mp4`;
  const mp4 = path.join(travail, nom);
  try {
    await executer('ffmpeg', ['-y', '-loglevel', 'error', '-i', brut, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '23', '-movflags', '+faststart', '-an', mp4], { timeout: 300_000 });
  } catch (err) {
    resultat.erreurs.push(`vidéo : la conversion en mp4 a échoué (${(err as Error).message.split('\n')[0]})`);
    return null;
  }
  return joindre(mp4, nom, 'video');
}

/* ------------------------------------------------------------------ */
/* Les maquettes gratuites : HTML/CSS photographié par Chrome           */
/* ------------------------------------------------------------------ */

/** Photographie un HTML à la taille exacte donnée, en PNG puis webp. Rend le chemin du webp (dans `dossier`). */
export async function photographierLeHtml(html: string, largeur: number, hauteur: number, dossier: string, nom: string): Promise<string> {
  const qui = `maquette:${nom}`;
  if (!(await attendreLeNavigateur(qui))) throw new Error('le navigateur du serveur est occupé — réessaie dans un instant');
  const { chromium } = await import('playwright');
  const navigateur = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await navigateur.newPage({ viewport: { width: largeur, height: hauteur }, deviceScaleFactor: 1 });
    await avecDelai(page.setContent(html, { waitUntil: 'load', timeout: 60_000 }), 70_000, 'la maquette');
    await page.evaluate('Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))))');
    const png = path.join(dossier, `${nom}.png`);
    const webp = path.join(dossier, `${nom}.webp`);
    await page.screenshot({ path: png, clip: { x: 0, y: 0, width: largeur, height: hauteur } });
    await versWebp(png, webp);
    return webp;
  } finally {
    await navigateur.close().catch(() => {});
    rendreLeNavigateur(qui);
  }
}
