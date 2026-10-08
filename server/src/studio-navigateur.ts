/**
 * LE NAVIGATEUR DES SOURCES DE STYLES — un VRAI Chrome, sur le serveur, pour
 * passer soi-même une vérification anti-robot (Cloudflare et ses semblables).
 *
 * Un site comme prompt-motion.com répond au démon par une page « Just a
 * moment… » : aucune lecture automatique ne passe. Le laissez-passer qu'il
 * délivre après la vérification est lié au NAVIGATEUR (ses témoins, son
 * empreinte) et à son adresse, et il expire. Donc :
 *
 *  1. LE VOLET « Passer la vérification » ouvre ici un Chrome du système
 *     (`channel: 'chrome'`), sur un PROFIL DURABLE propre à la source
 *     (`data/studio/navigateurs/<source>`), avec un écran virtuel (Xvfb) quand
 *     il existe : un Chrome sans écran se fait souvent repérer. Ses images
 *     partent à l'écran par le canal temps réel (`studio.navigateur`, capture
 *     CDP `Page.startScreencast`), les clics, la molette et la frappe reviennent
 *     (`gesteVerification`) ;
 *  2. une fois la vérification passée, la source se lit PAR CE NAVIGATEUR
 *     (`lecteurDuNavigateur`) et le restera (`par_navigateur`), y compris la
 *     nuit (`avecNavigateur`) : même profil, même machine ;
 *  3. UN SEUL navigateur à la fois (machine de 7 Go), fermé à la sortie du
 *     volet ou après dix minutes sans geste.
 *
 * Le démon ne devient jamais un relais : seules des adresses de source
 * acceptées (`jugerAdresseSource`) sont ouvertes, et les gestes ne sont que
 * des clics, une molette et du texte borné.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { BrowserContext, CDPSession, Page } from 'playwright';
import { jugerAdresseSource, pageAntiRobot, raisonDePageRefusee } from '@beluga/shared';
import { CONFIG } from './config.js';
import { bus } from './bus.js';
import { log } from './logger.js';

const LARGEUR = 1280;
const HAUTEUR = 800;
const INACTIVITE_MS = 10 * 60_000;
/** Une image toutes les 250 ms au plus : le volet suit la page sans saturer le canal. */
const PAS_IMAGES_MS = 250;
const TOUCHES = new Set(['Enter', 'Tab', 'Backspace', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Delete']);

export type GesteNavigateur =
  | { genre: 'clic'; x: number; y: number }
  | { genre: 'molette'; x: number; y: number; dx: number; dy: number }
  | { genre: 'texte'; texte: string }
  | { genre: 'touche'; cle: string };

export function dossierDuProfil(sourceId: string): string {
  return path.join(CONFIG.dataDir, 'studio', 'navigateurs', sourceId.replace(/[^A-Za-z0-9-]/g, '_'));
}

/* ------------------------------------------------------------------ */
/* L'écran virtuel et le navigateur                                    */
/* ------------------------------------------------------------------ */

let ecran: { proc: ChildProcess; display: string } | null = null;

/** Un écran virtuel (Xvfb) pour un Chrome « avec écran » ; null s'il n'y en a pas (Chrome tourne alors sans écran). */
async function ecranVirtuel(): Promise<string | null> {
  if (process.env.DISPLAY) return process.env.DISPLAY;
  if (ecran && ecran.proc.exitCode === null) return ecran.display;
  for (let n = 91; n < 99; n++) {
    if (fs.existsSync(`/tmp/.X${n}-lock`)) continue;
    const proc = spawn('Xvfb', [`:${n}`, '-screen', '0', `${LARGEUR}x${HAUTEUR}x24`, '-nolisten', 'tcp'], { stdio: 'ignore' });
    const ok = await new Promise<boolean>((resoudre) => {
      proc.once('error', () => resoudre(false));
      setTimeout(() => resoudre(proc.exitCode === null), 500);
    });
    if (ok) {
      ecran = { proc, display: `:${n}` };
      return ecran.display;
    }
    if (proc.exitCode === null) proc.kill();
  }
  return null;
}

function eteindreEcran(): void {
  if (ecran && ecran.proc.exitCode === null) ecran.proc.kill();
  ecran = null;
}

async function ouvrirContexte(sourceId: string): Promise<BrowserContext> {
  const { chromium } = await import('playwright');
  const display = await ecranVirtuel();
  fs.mkdirSync(dossierDuProfil(sourceId), { recursive: true });
  return chromium.launchPersistentContext(dossierDuProfil(sourceId), {
    channel: 'chrome',
    headless: !display,
    viewport: { width: LARGEUR, height: HAUTEUR },
    locale: 'fr-FR',
    env: display ? { ...process.env, DISPLAY: display } : { ...process.env },
    // Le bandeau « contrôlé par un logiciel » et `navigator.webdriver` trahissent l'automate.
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check', `--window-size=${LARGEUR},${HAUTEUR}`],
  });
}

/* ------------------------------------------------------------------ */
/* La lecture d'une page par le navigateur                             */
/* ------------------------------------------------------------------ */

export type Lecteur = (url: string) => Promise<{ ok: true; texte: string } | { ok: false; raison: string }>;

/**
 * LIRE UNE ADRESSE AVEC LES TÉMOINS DU NAVIGATEUR : sur le site déjà ouvert, un `fetch` de la page elle-même (la
 * pile réseau de Chrome, ses témoins) ; ailleurs, une vraie navigation, une à la fois.
 */
export function lecteurDuNavigateur(page: Page): Lecteur {
  let file: Promise<unknown> = Promise.resolve();
  return async (url) => {
    if (!jugerAdresseSource(url).ok) return { ok: false, raison: `adresse refusée : ${url}` };
    let statut = 0;
    let texte = '';
    try {
      const ici = /^https?:/.test(page.url()) ? new URL(page.url()).origin : '';
      if (ici && new URL(url).origin === ici) {
        const r = await page.evaluate(async (u) => {
          const x = await fetch(u, { credentials: 'include' });
          return { statut: x.status, texte: (await x.text()).slice(0, 8_000_000) };
        }, url);
        ({ statut, texte } = r);
      } else {
        const tour = file.then(async () => {
          const reponse = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
          return { statut: reponse?.status() ?? 0, texte: ((await reponse?.text().catch(() => '')) ?? '').slice(0, 8_000_000) };
        });
        file = tour.catch(() => undefined);
        ({ statut, texte } = await tour);
      }
    } catch (err: any) {
      return { ok: false, raison: `le navigateur n’a pas pu lire la page (${err?.message ?? err})` };
    }
    const refus = raisonDePageRefusee(statut, texte);
    return refus ? { ok: false, raison: refus } : { ok: true, texte };
  };
}

/* ------------------------------------------------------------------ */
/* La session du volet                                                 */
/* ------------------------------------------------------------------ */

interface Session {
  sourceId: string;
  contexte: BrowserContext;
  page: Page;
  cdp: CDPSession;
  minuteur: NodeJS.Timeout;
  derniereImage: number;
  imageEnAttente: { data: string; largeur: number; hauteur: number } | null;
  envoi: NodeJS.Timeout | null;
}

let session: Session | null = null;
/** Une lecture de nuit (ou d'après vérification) tient le navigateur : rien d'autre ne l'ouvre pendant ce temps. */
let lectureEnCours: string | null = null;

function dire(sourceId: string, champs: { etat?: 'ouvert' | 'ferme' | 'lecture' | 'verifie' | 'echec'; texte?: string; image?: string; largeur?: number; hauteur?: number; adresse?: string }) {
  bus.emit({ type: 'studio.navigateur', sourceId, ...champs });
}

function armer(s: Session): void {
  clearTimeout(s.minuteur);
  s.minuteur = setTimeout(() => void fermerVerification(s.sourceId, 'Fermé après dix minutes sans geste.'), INACTIVITE_MS);
  s.minuteur.unref();
}

function envoyerImage(s: Session): void {
  s.envoi = null;
  const img = s.imageEnAttente;
  if (!img || session !== s) return;
  s.imageEnAttente = null;
  s.derniereImage = Date.now();
  dire(s.sourceId, { image: img.data, largeur: img.largeur, hauteur: img.hauteur, adresse: s.page.url() });
}

/** Le volet s'ouvre : le navigateur part sur l'adresse de la source et ses images arrivent à l'écran. */
export async function ouvrirVerification(sourceId: string, adresse: string): Promise<void> {
  const avis = jugerAdresseSource(adresse);
  if (!avis.ok) throw new Error(`Adresse refusée : ${avis.raison}`);
  if (session?.sourceId === sourceId) {
    armer(session);
    dire(sourceId, { etat: 'ouvert', adresse: session.page.url() });
    return;
  }
  if (lectureEnCours) throw new Error('Le navigateur lit déjà une source : réessayez dans une minute.');
  if (session) await fermerVerification(session.sourceId, 'Fermé : un autre volet de vérification s’est ouvert.');
  const contexte = await ouvrirContexte(sourceId);
  const page = contexte.pages()[0] ?? (await contexte.newPage());
  const cdp = await contexte.newCDPSession(page);
  const s: Session = { sourceId, contexte, page, cdp, minuteur: setTimeout(() => undefined, 0), derniereImage: 0, imageEnAttente: null, envoi: null };
  session = s;
  armer(s);
  cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number; metadata: { deviceWidth: number; deviceHeight: number } }) => {
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
    s.imageEnAttente = { data: f.data, largeur: f.metadata.deviceWidth, hauteur: f.metadata.deviceHeight };
    // La dernière image n'est jamais perdue : elle part au prochain pas, pas plus vite.
    if (!s.envoi) s.envoi = setTimeout(() => envoyerImage(s), Math.max(0, PAS_IMAGES_MS - (Date.now() - s.derniereImage)));
  });
  contexte.on('close', () => {
    if (session === s) {
      clearTimeout(s.minuteur);
      session = null;
      eteindreEcran();
      dire(sourceId, { etat: 'ferme' });
    }
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: LARGEUR, maxHeight: HAUTEUR, everyNthFrame: 1 });
  dire(sourceId, { etat: 'ouvert', adresse: avis.valeur });
  page.goto(avis.valeur, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch((err) => log.warn(`navigateur des sources : ${avis.valeur} — ${err?.message ?? err}`));
}

/** Un clic, la molette ou du texte, renvoyés tels quels au navigateur (coordonnées de sa page, en pixels CSS). */
export async function gesteVerification(sourceId: string, geste: GesteNavigateur): Promise<void> {
  const s = session;
  if (!s || s.sourceId !== sourceId) throw new Error('Le navigateur de cette source est fermé : rouvrez le volet.');
  armer(s);
  const borne = (v: number, max: number) => Math.max(0, Math.min(max, Number(v) || 0));
  if (geste.genre === 'clic') await s.page.mouse.click(borne(geste.x, LARGEUR), borne(geste.y, HAUTEUR));
  else if (geste.genre === 'molette') {
    await s.page.mouse.move(borne(geste.x, LARGEUR), borne(geste.y, HAUTEUR));
    await s.page.mouse.wheel(Math.max(-2000, Math.min(2000, Number(geste.dx) || 0)), Math.max(-2000, Math.min(2000, Number(geste.dy) || 0)));
  } else if (geste.genre === 'texte') await s.page.keyboard.type(String(geste.texte ?? '').slice(0, 500));
  else if (geste.genre === 'touche' && TOUCHES.has(geste.cle)) await s.page.keyboard.press(geste.cle === 'Space' ? ' ' : geste.cle);
}

/** La page affichée est-elle encore une vérification ? */
export async function verificationEncoreAffichee(sourceId: string): Promise<boolean> {
  const s = session;
  if (!s || s.sourceId !== sourceId) throw new Error('Le navigateur de cette source est fermé : rouvrez le volet.');
  const html = await s.page.content().catch(() => '');
  return pageAntiRobot(html);
}

/**
 * LIRE AVEC LE NAVIGATEUR DU VOLET, puis le fermer. La vérification vient d'être passée : la lecture de la source
 * se fait par CE navigateur, le seul à qui le site a délivré son laissez-passer.
 */
export async function lireAvecLeVolet<T>(sourceId: string, travail: (lecteur: Lecteur) => Promise<T>): Promise<T> {
  const s = session;
  if (!s || s.sourceId !== sourceId) throw new Error('Le navigateur de cette source est fermé : rouvrez le volet.');
  clearTimeout(s.minuteur);
  lectureEnCours = sourceId;
  dire(sourceId, { etat: 'lecture' });
  try {
    await s.cdp.send('Page.stopScreencast').catch(() => undefined);
    return await travail(lecteurDuNavigateur(s.page));
  } finally {
    lectureEnCours = null;
    await fermerVerification(sourceId);
  }
}

/** Le volet se ferme (ou dix minutes sans geste) : le navigateur et son écran s'éteignent, le profil reste. */
export async function fermerVerification(sourceId: string, texte?: string): Promise<void> {
  const s = session;
  if (!s || s.sourceId !== sourceId) return;
  session = null;
  clearTimeout(s.minuteur);
  if (s.envoi) clearTimeout(s.envoi);
  await s.contexte.close().catch(() => undefined);
  if (!lectureEnCours) eteindreEcran();
  dire(sourceId, { etat: 'ferme', ...(texte ? { texte } : {}) });
}

/**
 * LA LECTURE DE NUIT D'UNE SOURCE « PAR NAVIGATEUR » : le même profil, ouvert sans volet le temps de la lecture.
 * Rend null quand le navigateur est déjà pris (le volet d'une autre source est ouvert) : la nuit réessaiera.
 */
export async function avecNavigateur<T>(sourceId: string, adresse: string, travail: (lecteur: Lecteur) => Promise<T>): Promise<T | null> {
  if (session || lectureEnCours) return null;
  lectureEnCours = sourceId;
  let contexte: BrowserContext | null = null;
  try {
    contexte = await ouvrirContexte(sourceId);
    const page = contexte.pages()[0] ?? (await contexte.newPage());
    // D'abord la page d'accueil de la source : le site pose (ou redemande) son laissez-passer là.
    await page.goto(adresse, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => undefined);
    await page.waitForTimeout(4000);
    return await travail(lecteurDuNavigateur(page));
  } finally {
    await contexte?.close().catch(() => undefined);
    lectureEnCours = null;
    eteindreEcran();
  }
}
