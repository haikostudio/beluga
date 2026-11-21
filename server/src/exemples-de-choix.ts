/**
 * LES EXEMPLES D'UN CHOIX (demande du 29/10/2026, captures #2a0a et #b2e5).
 *
 * Avant un choix qui se VOIT ou s'ENTEND — couleurs en situation, encadré,
 * icône, mise en page, typographie, illustration, logo, ambiance, voix —, tout
 * agent propose d'en fabriquer un exemple par piste (clause EXEMPLES de
 * `REGLE_DES_EXEMPLES`, `shared/src/pistes-de-question.ts`). Cet outil les
 * fabrique, une pièce jointe par piste, prête pour « image » ou « media » d'une
 * option d'`ask_user`.
 *
 * ORDRE DÉCIDÉ PAR L'UTILISATEUR : le moyen LOCAL adapté d'abord, sans frais ;
 * un service externe seulement en dernier recours, plafonné à 1 $ PAR CARTE.
 *
 *  - « page »  : une page HTML écrite par l'agent (élément d'interface,
 *                encadré, couleurs en situation, mise en page, typographie),
 *                photographiée par le Chrome du système — sans frais, en
 *                quelques secondes ;
 *  - « image » : une illustration fabriquée par Codex du serveur (outil
 *                image_gen de l'abonnement ChatGPT), une à la fois et bornée
 *                dans le temps ; en cas d'échec, l'aperçu payant de kie.ai
 *                (`fabriquerUnApercu`, mode exemple) sous l'enveloppe à part
 *                `ENVELOPPE_DES_EXEMPLES`, refusé au-delà ;
 *  - « voix »  : la voix d'essai Piper du serveur, sans frais.
 *
 * Un refus d'un service (quota, 429) se dit en une RAISON COURTE (« Codex :
 * quota épuisé jusqu'au 9 nov. ») — le détail au journal du démon ; aucune
 * bascule silencieuse vers un autre service payant (MEM-3737). Codex essaie
 * chacun de ses comptes en service avant de rendre la main (05/11/2026). Chaque fabrication pose
 * le bloc d'attente des médias au bas du fil (MEM-5372).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import {
  ENVELOPPE_DES_EXEMPLES,
  MAX_PISTES_D_EXEMPLE,
  NATURES_D_EXEMPLE,
  avecLeStyleDuProduit,
  avecLesIconesReelles,
  enteteDeMaquette,
  refusDeFourneeMelangee,
  releveLu,
  SCRIPT_DU_RELEVE,
  type ReleveDemande,
  type TraceDIcone,
  jetonsDuTheme,
  lettreDuRang,
  nomDeLExemple,
  tailleDeLaMaquette,
  type PieceDUnLotDExemples,
  type ThemeDeMaquette,
} from '@beluga/shared';
import crypto from 'node:crypto';
import { CONFIG, ROOT } from './config.js';
import { getDb } from './db.js';

type NatureDExemple = (typeof NATURES_D_EXEMPLE)[number];
import * as store from './store.js';
import { joindreUnFichier } from './joindre-fichier.js';
import { annoncerUnMedia, terminerUnMedia } from './medias-en-fabrication.js';
import { log } from './logger.js';

export interface ContexteDExemple {
  agentId: string;
  projectId: string;
  cardId?: string;
}

export interface PisteDExemple {
  titre: string;
  html?: string;
  /** Nature « page » : la taille réelle de la zone montrée (bornée, 960×640 par défaut). */
  largeur?: number;
  hauteur?: number;
  consigne?: string;
  texte?: string;
  voix?: string;
  /** La zone de l'écran que montre la piste : toutes les pistes d'un appel montrent la même (une fournée = un choix). */
  zone?: string;
  /** Nature « page » : le relevé de l'écran réel, à retoucher (`releveLu`). */
  depuis?: ReleveDemande | { refus: string };
}

export interface ResultatDExemples {
  ok: boolean;
  text: string;
}

/**
 * LE DERNIER LOT D'EXEMPLES DE CHAQUE AGENT, en mémoire (décision du
 * 04/11/2026, `shared/src/exemples-oublies.ts`) : « ask_user » refuse la
 * question qui en reprend une partie et oublie le reste. Un nouveau lot
 * remplace le précédent ; la question qui le reprend en entier le consomme. Un
 * redémarrage du démon l'oublie — sans dommage : la règle reste dite à l'agent.
 */
export interface LotDExemples {
  champ: 'image' | 'media';
  pieces: PieceDUnLotDExemples[];
}
const lotsEnAttente = new Map<string, LotDExemples>();

export function lotDExemplesEnAttente(agentId: string): LotDExemples | undefined {
  return lotsEnAttente.get(agentId);
}
export function retenirLeLot(agentId: string, lot: LotDExemples): void {
  if (lot.pieces.length) lotsEnAttente.set(agentId, lot);
  else lotsEnAttente.delete(agentId);
}
export function oublierLeLot(agentId: string): void {
  lotsEnAttente.delete(agentId);
}

/** Ce qu'un appel à Codex peut prendre au plus, par image. */
const DUREE_MAX_CODEX_MS = 4 * 60_000;
/** La taille de la photographie d'une page, par défaut. */
const LARGEUR_PAGE = 960;
const HAUTEUR_PAGE = 640;

/** UN SEUL CODEX À LA FOIS : deux appels prendraient chacun l'image de l'autre. */
let fileCodex: Promise<unknown> = Promise.resolve();
function unCodexALaFois<T>(travail: () => Promise<T>): Promise<T> {
  const suite = fileCodex.then(travail, travail);
  fileCodex = suite.catch(() => undefined);
  return suite;
}

function dossierDeTravail(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-exemples-'));
}

/** Les pistes reçues, nettoyées et bornées. */
export function pistesLues(brut: unknown): PisteDExemple[] {
  if (!Array.isArray(brut)) return [];
  return brut
    .slice(0, MAX_PISTES_D_EXEMPLE)
    .map((p: any) => ({
      titre: String(p?.titre ?? p?.label ?? '').trim().slice(0, 120),
      html: typeof p?.html === 'string' ? p.html : undefined,
      ...(p?.largeur !== undefined || p?.hauteur !== undefined ? tailleDeLaMaquette(p?.largeur, p?.hauteur) : {}),
      consigne: typeof p?.consigne === 'string' ? p.consigne.trim().slice(0, 2000) : undefined,
      texte: typeof p?.texte === 'string' ? p.texte.trim().slice(0, 600) : undefined,
      voix: typeof p?.voix === 'string' ? p.voix.trim() : undefined,
      zone: typeof p?.zone === 'string' ? p.zone.trim().slice(0, 120) : undefined,
      ...(p?.depuis && typeof p.depuis === 'object' ? { depuis: releveLu(p.depuis) } : {}),
    }))
    .filter((p) => p.titre);
}

/** La formule ChatGPT branchée sur Codex, lue dans son fichier de connexion (MEM-5449). */
export function formuleDeCodex(dossierCodex = path.join(os.homedir(), '.codex')): string | null {
  try {
    const auth = JSON.parse(fs.readFileSync(path.join(dossierCodex, 'auth.json'), 'utf8'));
    const jeton = String(auth?.tokens?.id_token ?? '');
    const charge = jeton.split('.')[1];
    if (!charge) return null;
    const claims = JSON.parse(Buffer.from(charge.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return claims?.['https://api.openai.com/auth']?.chatgpt_plan_type ?? null;
  } catch {
    return null;
  }
}

/**
 * LE STYLE DU PRODUIT POSÉ D'OFFICE EN TÊTE DE CHAQUE PAGE (17/11/2026, `shared/src/maquette-realiste.ts`) : la vraie
 * police de l'interface et les jetons du thème, lus dans les fichiers de l'interface du dépôt. Introuvables (dépôt sans
 * l'interface), la page part telle quelle : rien n'échoue pour ça.
 */
const stylesDuProduit = new Map<ThemeDeMaquette, string>();
export function styleDuProduit(theme: ThemeDeMaquette, racine = ROOT): string {
  const connu = stylesDuProduit.get(theme);
  if (connu !== undefined) return connu;
  let entete = '';
  try {
    const css = fs.readFileSync(path.join(racine, 'web', 'src', 'styles.css'), 'utf8');
    const polices = ['inter-latin-wght-normal.woff2', 'inter-latin-ext-wght-normal.woff2']
      .map((nom) => path.join(racine, 'web', 'src', 'polices', nom))
      .filter((fichier) => fs.existsSync(fichier))
      .map((fichier) => `data:font/woff2;base64,${fs.readFileSync(fichier).toString('base64')}`);
    entete = enteteDeMaquette({ jetons: jetonsDuTheme(css, theme), polices });
  } catch (err: any) {
    log.warn('exemples', `style du produit illisible : ${String(err?.message ?? err).slice(0, 160)}`);
  }
  stylesDuProduit.set(theme, entete);
  return entete;
}

/** Le tracé réel d'une icône Lucide (`node_modules/lucide-react`), lu une fois. */
const tracesLus = new Map<string, TraceDIcone | null>();
function traceDeLucide(nom: string): TraceDIcone | null {
  if (tracesLus.has(nom)) return tracesLus.get(nom)!;
  let trace: TraceDIcone | null = null;
  try {
    const texte = fs.readFileSync(path.join(ROOT, 'node_modules', 'lucide-react', 'dist', 'esm', 'icons', `${nom}.js`), 'utf8');
    const brut = /createLucideIcon\("[^"]+",\s*(\[[\s\S]*?\])\);/.exec(texte)?.[1];
    /* Un tableau de littéraux (balises et attributs) : relu en JSON après avoir mis les clés entre guillemets. */
    if (brut) trace = JSON.parse(brut.replace(/([{,]\s*)([a-zA-Z][\w-]*)\s*:/g, '$1"$2":')) as TraceDIcone;
  } catch {
    trace = null;
  }
  tracesLus.set(nom, trace);
  return trace;
}

/**
 * LE RELEVÉ DE L'ÉCRAN RÉEL (méthode prouvée au cadrage de la carte « Extension, rapport SEO-GEO et menus »,
 * 21/11/2026) : une session d'une heure posée HACHÉE puis retirée, la vraie application ouverte sur son adresse,
 * l'écran FIGÉ (la racine React clonée : sinon React redessine et efface les retouches), les ronds flottants et la bande
 * du haut masqués, les retouches posées aux VRAIES classes (la feuille compilée est déjà chargée), puis la photo de la
 * zone seule ou de l'écran entier.
 */
async function releverLEcran(navigateur: import('playwright').Browser, r: ReleveDemande, fichier: string): Promise<string | { refus: string }> {
  const jeton = crypto.randomBytes(24).toString('hex');
  const hache = crypto.createHash('sha256').update(jeton).digest('hex');
  const db = getDb();
  let admin: string | null = null;
  try {
    admin = (db.prepare("SELECT id FROM users WHERE role = 'admin' AND actif = 1 ORDER BY cree_le LIMIT 1").get() as { id?: string } | undefined)?.id ?? null;
  } catch {
    admin = null;
  }
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?, ?, ?, ?, ?)').run(hache, Date.now(), Date.now() + 3600_000, 'maquette-relevee', admin);
  const contexte = await navigateur.newContext({ viewport: { width: r.largeur, height: r.hauteur }, deviceScaleFactor: 2, colorScheme: r.theme === 'clair' ? 'light' : 'dark', serviceWorkers: 'block' });
  try {
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, domain: 'localhost', path: '/' }]);
    const page = await contexte.newPage();
    await page.goto(`http://localhost:${CONFIG.port}/#${r.adresse}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const pret = await page.waitForSelector(r.attendre, { state: 'visible', timeout: 25_000 }).then(() => true, () => false);
    if (!pret) return { refus: `l’écran « #${r.adresse} » n’a pas montré « ${r.attendre} » : vérifie l’adresse et le sélecteur (zone introuvable)` };
    await page.waitForTimeout(900);
    const retouches = r.remplacer.map((x) => ({ selecteur: x.selecteur, html: avecLesIconesReelles(x.html, traceDeLucide) }));
    const manquants = (await page.evaluate(`(${SCRIPT_DU_RELEVE})(${JSON.stringify({ theme: r.theme, retouches })})`)) as string[];
    if (manquants.length) return { refus: `retouche impossible : ${manquants.map((m) => `« ${m} »`).join(', ')} n’existe pas sur l’écran réel` };
    await page.evaluate('document.fonts ? document.fonts.ready.then(() => true) : true').catch(() => undefined);
    await page.waitForTimeout(300);
    if (r.selecteur) {
      const zone = page.locator(r.selecteur).first();
      if (!(await zone.count())) return { refus: `la zone « ${r.selecteur} » a disparu après les retouches` };
      await zone.screenshot({ path: fichier });
    } else {
      await page.screenshot({ path: fichier, fullPage: false });
    }
    return fichier;
  } catch (err: any) {
    return { refus: `le relevé de l’écran a échoué (${String(err?.message ?? err).slice(0, 160)})` };
  } finally {
    await contexte.close().catch(() => {});
    db.prepare('DELETE FROM sessions WHERE token = ?').run(hache);
  }
}

/** Une page HTML photographiée par le Chrome du système, à la taille réelle demandée par sa piste. */
async function photographierLesPages(pistes: PisteDExemple[], dossier: string, theme: ThemeDeMaquette = 'sombre'): Promise<(string | { refus: string })[]> {
  const entete = styleDuProduit(theme);
  const { chromium } = await import('playwright');
  const navigateur = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const sorties: (string | { refus: string })[] = [];
    for (const [i, piste] of pistes.entries()) {
      if (piste.depuis) {
        sorties.push('refus' in piste.depuis ? { refus: piste.depuis.refus } : await releverLEcran(navigateur, piste.depuis, path.join(dossier, `exemple-${i + 1}.png`)));
        continue;
      }
      if (!piste.html?.trim()) {
        sorties.push({ refus: 'il manque « html » (la page entière) ou « depuis » (le relevé de l’écran réel, à retoucher)' });
        continue;
      }
      const page = await navigateur.newPage({ viewport: { width: piste.largeur ?? LARGEUR_PAGE, height: piste.hauteur ?? HAUTEUR_PAGE }, deviceScaleFactor: 2 });
      try {
        // Aucune requête au-dehors : une page d'exemple se suffit à elle-même.
        await page.route('**/*', (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort()));
        await page.setContent(entete ? avecLeStyleDuProduit(piste.html, entete) : piste.html, { waitUntil: 'load', timeout: 15_000 });
        await page.evaluate('document.fonts ? document.fonts.ready.then(() => true) : true').catch(() => undefined);
        const fichier = path.join(dossier, `exemple-${i + 1}.png`);
        await page.screenshot({ path: fichier, fullPage: false });
        sorties.push(fichier);
      } catch (err: any) {
        sorties.push({ refus: `la page ne s'est pas rendue (${String(err?.message ?? err).slice(0, 160)})` });
      } finally {
        await page.close().catch(() => {});
      }
    }
    return sorties;
  } finally {
    await navigateur.close().catch(() => {});
  }
}

/** Le PNG le plus récent écrit par Codex depuis `depuis`. */
function derniereImageDeCodex(depuis: number, dossierCodex = path.join(os.homedir(), '.codex')): string | null {
  const racine = path.join(dossierCodex, 'generated_images');
  let meilleure: { fichier: string; date: number } | null = null;
  const parcourir = (dossier: string, profondeur: number) => {
    let entrees: fs.Dirent[] = [];
    try {
      entrees = fs.readdirSync(dossier, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entrees) {
      const chemin = path.join(dossier, e.name);
      if (e.isDirectory() && profondeur < 2) parcourir(chemin, profondeur + 1);
      else if (e.isFile() && e.name.endsWith('.png')) {
        const date = fs.statSync(chemin).mtimeMs;
        if (date >= depuis && (!meilleure || date > meilleure.date)) meilleure = { fichier: chemin, date };
      }
    }
  };
  parcourir(racine, 0);
  return (meilleure as { fichier: string } | null)?.fichier ?? null;
}

/** Un compte Codex, tel que l'illustration le choisit. */
export interface CompteCodex {
  id: string;
  engine: string;
  priority: number;
  configDir: string;
  disabled?: boolean;
}

/** Son dernier relevé de quota (`cachedQuotas`) : une fenêtre pleine dont la remise à zéro n'est pas passée le met à sec. */
export interface QuotaDeCompte {
  id: string;
  session?: { usedPct?: number; resetsAt?: number };
  weekly?: { usedPct?: number; resetsAt?: number };
}

/**
 * LES COMPTES CODEX À ESSAYER POUR UNE IMAGE (carte « Médias : aperçu en modale, fiche en tiroir », 05/11/2026 : le
 * compte principal à sec, les exemples tombaient en panne alors qu'un second compte existait). Les comptes Codex en
 * service, du premier rang au dernier ; un compte dont le relevé dit une fenêtre pleine — ou qui vient de répondre « limite
 * atteinte » (`aSecConnus`) — est mis de côté avec sa date de reprise, sans être appelé. Règle pure.
 */
export function comptesCodexPourLesImages(
  comptes: readonly CompteCodex[],
  quotas: readonly QuotaDeCompte[],
  aSecConnus: ReadonlyMap<string, number | null> = new Map(),
  maintenant = Date.now(),
): { utilisables: CompteCodex[]; aSec: { id: string; reprise: number | null }[] } {
  const codex = comptes.filter((c) => c.engine === 'codex' && !c.disabled).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const utilisables: CompteCodex[] = [];
  const aSec: { id: string; reprise: number | null }[] = [];
  for (const compte of codex) {
    if (aSecConnus.has(compte.id)) {
      const reprise = aSecConnus.get(compte.id) ?? null;
      if (reprise === null || reprise > maintenant) {
        aSec.push({ id: compte.id, reprise });
        continue;
      }
    }
    const q = quotas.find((x) => x.id === compte.id);
    const pleines = [q?.session, q?.weekly].filter((w): w is { usedPct?: number; resetsAt?: number } => !!w && (w.usedPct ?? 0) >= 100 && (!w.resetsAt || w.resetsAt > maintenant));
    if (pleines.length) aSec.push({ id: compte.id, reprise: Math.max(...pleines.map((w) => w.resetsAt ?? 0)) || null });
    else utilisables.push(compte);
  }
  return { utilisables, aSec };
}

/**
 * CODEX A-T-IL DIT « LIMITE ATTEINTE » ? Il le dit parfois en sortant SANS erreur (mesuré le 05/11/2026 : « You've hit
 * your usage limit … try again at Nov 9th, 2026 6:01 PM », code 0) ; on lit donc le texte, et la date de reprise quand
 * elle y est. `null` : ce n'est pas une limite.
 */
export function limiteDeCodex(sortie: string, maintenant = new Date()): { reprise: number | null } | null {
  if (!/usage_limit_reached|usage limit|rate.?limit|\b429\b|quota exceeded/i.test(sortie)) return null;
  const m = /try again (?:at|after|on)\s+([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?,?\s*(?:at\s+)?(\d{1,2}:\d{2}\s*[AP]M)?/i.exec(sortie);
  if (!m) return { reprise: null };
  const quand = Date.parse(`${m[1]} ${m[2]}, ${m[3] ?? maintenant.getFullYear()}${m[4] ? ` ${m[4].replace(/\s+/g, ' ')}` : ''}`);
  return { reprise: Number.isFinite(quand) ? quand : null };
}

/** Une date de reprise en mots courts (« 9 nov. »). */
const jourCourt = (quand: number): string => new Date(quand).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

/** LA RAISON COURTE d'un Codex à sec, lue dans la tuile ratée : jamais la ligne de commande. */
export function raisonCodexASec(aSec: readonly { reprise: number | null }[]): string {
  const dates = aSec.map((x) => x.reprise).filter((x): x is number => !!x).sort((a, b) => a - b);
  const pluriel = aSec.length > 1;
  return dates[0] ? `Codex : ${pluriel ? 'quotas épuisés, reprise le' : 'quota épuisé jusqu’au'} ${jourCourt(dates[0])}` : `Codex : ${pluriel ? 'quotas épuisés' : 'quota épuisé'}`;
}

/**
 * LA RAISON COURTE d'un refus du service externe (le texte complet part au journal du démon). Les messages bruts de
 * kie.ai ou de la porte de dépense n'ont rien à faire dans une tuile de choix.
 */
export function raisonCourteDuServiceExterne(texte: string): string {
  if (/sans carte/i.test(texte)) return 'service externe : réservé aux cartes';
  if (/pas branché|non branché/i.test(texte)) return 'service externe non branché';
  if (/cr[ée]dit|balance|insufficient/i.test(texte)) return 'service externe : crédit épuisé';
  if (/text length|maximum limit|trop longue/i.test(texte)) return 'service externe : consigne trop longue';
  if (/enveloppe|refusé/i.test(texte)) return 'service externe : enveloppe des exemples dépensée';
  if (/tarde/i.test(texte)) return 'service externe : image pas encore prête';
  return 'service externe : échec';
}

/** Les comptes Codex vus « à sec » par un appel récent, avec leur date de reprise : on ne les rappelle pas avant. */
const codexASec = new Map<string, number | null>();
/** Faute de date dite, un compte à sec est laissé de côté une heure. */
const OUBLI_SANS_DATE_MS = 60 * 60_000;

/** Un appel à Codex sur UN compte : le fichier rendu, ou ce qui l'en a empêché. */
function appelerCodex(compte: CompteCodex, consigne: string, dossier: string, delai: number): Promise<string | { quota: { reprise: number | null } | null; raison: string }> {
  return new Promise((resolve) => {
    const depuis = Date.now() - 1000;
    void import('./accounts.js').then(({ applyAccountEnv }) =>
      import('./engines/codex.js').then(({ codexAdapter }) => {
        /* Le compte choisi par son dossier : `CODEX_HOME`, comme un tour de ce compte (`applyAccountEnv`). */
        const env = { ...process.env, ...applyAccountEnv(compte as never) };
        const enfant = execFile(
          codexAdapter.binary,
          ['exec', '--skip-git-repo-check', '-s', 'read-only', '-C', dossier, '-'],
          { timeout: delai, maxBuffer: 8 * 1024 * 1024, env },
          (err, stdout, stderr) => {
            const image = derniereImageDeCodex(depuis, compte.configDir);
            if (image) return resolve(image);
            const sortie = `${stdout ?? ''}\n${stderr ?? ''}`;
            log.warn(`exemples de choix : Codex (${compte.id}) sans image`, `${err?.message ?? ''}\n${sortie}`.trim().slice(-2000));
            const quota = limiteDeCodex(sortie);
            resolve({
              quota,
              raison: quota ? raisonCodexASec([quota]) : err?.killed ? 'Codex : pas d’image à temps' : 'Codex : aucune image rendue',
            });
          },
        );
        enfant.stdin?.end(
          `Produce exactly ONE image with your built-in image generation tool. Do not write code, do not run shell commands. No text in the image unless asked.\n\n${consigne}`,
        );
      }),
    ).catch((err: any) => resolve({ quota: null, raison: `Codex : lancement impossible (${String(err?.message ?? err).slice(0, 60)})` }));
  });
}

/**
 * UNE ILLUSTRATION PAR CODEX DU SERVEUR : chaque compte Codex en service, du premier rang au dernier, jusqu'à une image
 * (les comptes à sec sont sautés sans appel). Le tout tient dans `DUREE_MAX_CODEX_MS`, comptes essayés compris. Rend le
 * fichier, ou une RAISON COURTE ; le détail va au journal du démon.
 */
async function illustrerParCodex(consigne: string, dossier: string): Promise<string | { refus: string }> {
  const { listAllAccountRecords, cachedQuotas } = await import('./accounts.js');
  return unCodexALaFois(async () => {
    const { utilisables, aSec } = comptesCodexPourLesImages(listAllAccountRecords(), cachedQuotas(), codexASec);
    if (!utilisables.length) return { refus: aSec.length ? raisonCodexASec(aSec) : 'Codex : aucun compte en service' };
    const fin = Date.now() + DUREE_MAX_CODEX_MS;
    let refus = 'Codex : aucune image rendue';
    const aSecIci = [...aSec];
    for (const compte of utilisables) {
      const formule = formuleDeCodex(compte.configDir);
      if (formule !== 'plus' && formule !== 'pro' && formule !== 'team' && formule !== 'business' && formule !== 'enterprise') {
        refus = 'Codex : pas d’images avec cette formule';
        continue;
      }
      const delai = fin - Date.now();
      if (delai < 15_000) break;
      const r = await appelerCodex(compte, consigne, dossier, delai);
      if (typeof r === 'string') return r;
      if (r.quota) {
        codexASec.set(compte.id, r.quota.reprise ?? Date.now() + OUBLI_SANS_DATE_MS);
        aSecIci.push({ id: compte.id, reprise: r.quota.reprise });
        refus = raisonCodexASec(aSecIci);
      } else refus = r.raison;
    }
    return { refus };
  });
}

/** Une image PNG violette de 64 × 64, pour les contrôles qui ne doivent appeler aucun Codex. */
const PNG_FACTICE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeUlEQVR4nO3PwQkAIBDAsBvUjdzXt0P4CEKhA6Sz1/m64YIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALHrums9G0hBjZPwAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * UNE IMAGE GRATUITE, ET RIEN D'AUTRE (esquisse d'une campagne, 10/11/2026) : Codex du serveur, dans la même file que
 * les exemples (un seul Codex à la fois), jamais le service externe payant — l'agent de campagne n'a pas de carte, et
 * sans carte rien ne se dépense (DEC-447). Rend le fichier, écrit dans `dossier`, ou une RAISON COURTE.
 * `BELUGA_IMAGE_GRATUITE_FACTICE=1` (contrôles sur démon jetable) écrit une image unie sans rien appeler.
 */
export async function fabriquerUneImageGratuite(consigne: string, dossier: string): Promise<string | { refus: string }> {
  if (process.env.BELUGA_IMAGE_GRATUITE_FACTICE === '1') {
    const fichier = path.join(dossier, `factice-${Date.now()}.png`);
    /* Une empreinte différente à chaque fois : chaque esquisse factice reste une pièce à elle. */
    fs.writeFileSync(fichier, Buffer.concat([PNG_FACTICE, Buffer.from(`${Date.now()}${Math.random()}`)]));
    return fichier;
  }
  return illustrerParCodex(consigne, dossier);
}

/** Le dernier recours payant : l'aperçu de kie.ai, sous l'enveloppe des exemples de la carte. */
async function illustrerParLeServiceExterne(ctx: ContexteDExemple, piste: PisteDExemple): Promise<{ piece: string } | { refus: string }> {
  if (!ctx.cardId) return { refus: raisonCourteDuServiceExterne('sans carte') };
  const { fabriquerUnApercu } = await import('./realisation.js');
  const r = await fabriquerUnApercu(
    { agentId: ctx.agentId, projectId: ctx.projectId, cardId: ctx.cardId } as never,
    { consigne: piste.consigne, legende: piste.titre, format: '1:1' },
    undefined,
    { exemple: true },
  );
  const piece = r.ok ? /pièce « ([^»]+) »/.exec(r.text)?.[1]?.trim() : undefined;
  if (piece) return { piece };
  log.warn('exemples de choix : service externe sans image', r.text.slice(0, 1000));
  return { refus: raisonCourteDuServiceExterne(r.text) };
}

/**
 * FABRIQUE UN EXEMPLE PAR PISTE et rend, pour chacune, l'identifiant de sa
 * pièce jointe — ou la raison qui l'en a privée. Les pistes réussies restent
 * jointes même si une autre échoue.
 */
export async function fabriquerLesExemples(ctx: ContexteDExemple, args: Record<string, unknown>): Promise<ResultatDExemples> {
  const nature = String(args.nature ?? '') as NatureDExemple;
  if (!(NATURES_D_EXEMPLE as readonly string[]).includes(nature)) {
    return { ok: false, text: `« nature » : ${NATURES_D_EXEMPLE.join(', ')} (page pour un élément d'interface, des couleurs en situation, une mise en page ou une typographie ; image pour une illustration ou un logo ; voix pour une voix).` };
  }
  const pistes = pistesLues(args.pistes);
  if (!pistes.length) return { ok: false, text: `Il faut « pistes » : 1 à ${MAX_PISTES_D_EXEMPLE} pistes, chacune avec son « titre » (et « html », « consigne » ou « texte » selon la nature).` };
  /* UNE FOURNÉE = UN SEUL CHOIX (21/11/2026) : des pistes de zones différentes feraient une question « tout mélangé ». */
  const melange = refusDeFourneeMelangee(pistes);
  if (melange) return { ok: false, text: melange };
  const card = ctx.cardId ? store.getCard(ctx.cardId) : null;
  if (card?.parcours?.realisationSouhaitee) {
    return { ok: false, text: 'Cette carte est en mode caméra : son questionnaire illustré a déjà ses exemples. N’ajoute pas de question d’exemples.' };
  }

  /* UN BLOC PAR EXEMPLE, FERMÉ AVEC SA PIÈCE (30/10/2026, captures #9d60 et
     #09b9) : un bloc collectif refermé sans pièce laissait un cadre gris vide
     dans le fil. Chaque piste a donc son bloc, qui scintille pendant la
     fabrication puis devient une ligne du fil à son heure (« A — titre »),
     comme tout média livré — et la même image rejoint « Ce que l'agent a vu ».
     La LETTRE est écrite dans le nom de la pièce (« exemple-A.png ») : la
     question la retrouve même si l'agent réordonne ses options. */
  const phraseDe = (i: number) => `${lettreDuRang(i)} — ${pistes[i].titre}`;
  const blocs = pistes.map((_, i) =>
    annoncerUnMedia({
      agentId: ctx.agentId,
      projectId: ctx.projectId,
      cardId: ctx.cardId,
      genre: nature === 'voix' ? 'son' : 'image',
      sujet: phraseDe(i),
      outil: nature === 'page' ? 'Page photographiée sur le serveur' : nature === 'voix' ? 'Voix d’essai du serveur' : 'Codex du serveur, sinon service externe',
      prix: 0,
    }),
  );
  const fermes = new Set<number>();
  const fermer = (i: number, fin: { piece?: string | null; echec?: string }) => {
    if (fermes.has(i)) return;
    fermes.add(i);
    terminerUnMedia(blocs[i].id, fin.piece ? { attachmentId: fin.piece, legende: phraseDe(i) } : { echec: fin.echec ?? 'exemple non fabriqué' });
  };
  const dossier = dossierDeTravail();
  const lignes: string[] = [];
  let reussies = 0;
  const lot: PieceDUnLotDExemples[] = [];
  /** Une piste réussie : sa ligne dit lettre, pièce et référence courte. */
  const reussie = (i: number, piece: string, alias: string | undefined, origine: string) => {
    reussies += 1;
    lot.push({ id: piece, lettre: lettreDuRang(i), titre: pistes[i].titre, alias: alias ?? null });
    fermer(i, { piece });
    lignes.push(`- ${lettreDuRang(i)} « ${pistes[i].titre} » : pièce « ${piece} »${alias ? ` · #${alias}` : ''} (${origine})`);
  };
  const ratee = (i: number, raison: string) => {
    fermer(i, { echec: raison });
    lignes.push(`- ${lettreDuRang(i)} « ${pistes[i].titre} » : échec — ${raison}`);
  };
  try {
    const joindre = async (fichier: string, nom: string) => {
      const j = await joindreUnFichier({ projectId: ctx.projectId, agentId: ctx.agentId, cardId: ctx.cardId, fichier, nom, deLAgent: true });
      return j.ok ? { id: j.attachment.id, alias: j.attachment.alias } : null;
    };
    if (nature === 'page') {
      const rendus = await photographierLesPages(pistes, dossier, args.theme === 'clair' ? 'clair' : 'sombre');
      for (const [i, rendu] of rendus.entries()) {
        const piece = typeof rendu === 'string' ? await joindre(rendu, nomDeLExemple(i, 'png')) : null;
        if (piece) reussie(i, piece.id, piece.alias, 'sans frais');
        else ratee(i, typeof rendu === 'string' ? 'pièce non jointe' : rendu.refus);
      }
    } else if (nature === 'image') {
      for (const [i, piste] of pistes.entries()) {
        if (!piste.consigne) {
          ratee(i, 'il manque « consigne », la description de l’image');
          continue;
        }
        const local = await illustrerParCodex(piste.consigne, dossier);
        if (typeof local === 'string') {
          const piece = await joindre(local, nomDeLExemple(i, 'png'));
          if (piece) {
            reussie(i, piece.id, piece.alias, 'Codex du serveur, sans frais');
            continue;
          }
        }
        const raisonLocale = typeof local === 'string' ? 'pièce non jointe' : local.refus;
        const externe = await illustrerParLeServiceExterne(ctx, piste);
        /* La pièce du service externe garde son nom (« apercu-exemple-3-v1.png ») :
           sa lettre voyage par le lot, que « ask_user » écrit sur l'option. */
        if ('piece' in externe) {
          reussie(i, externe.piece, store.getAttachment(externe.piece)?.alias, `service externe : ${raisonLocale}`);
        }
        else ratee(i, `${raisonLocale} · ${externe.refus}`);
      }
    } else {
      const { fabriquerVoixDEssai } = await import('./voix-de-realisation.js');
      for (const [i, piste] of pistes.entries()) {
        if (!piste.texte) {
          ratee(i, 'il manque « texte », la phrase à faire entendre');
          continue;
        }
        const sortie = path.join(dossier, nomDeLExemple(i, 'wav'));
        const r = piste.voix ? await fabriquerVoixDEssai(piste.texte, sortie, piste.voix) : await fabriquerVoixDEssai(piste.texte, sortie);
        const piece = r.ok ? await joindre(sortie, nomDeLExemple(i, 'wav')) : null;
        if (piece) reussie(i, piece.id, piece.alias, 'voix d’essai du serveur, sans frais');
        else ratee(i, r.ok ? 'pièce non jointe' : r.raison);
      }
    }
  } catch (err: any) {
    log.warn('exemples de choix : fabrication tombée', err?.message ?? err);
    lignes.push(`Fabrication interrompue : ${String(err?.message ?? err).slice(0, 200)}`);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
    /* Une piste restée sans issue (fabrication tombée) ne laisse pas de bloc ouvert. */
    pistes.forEach((_, i) => fermer(i, { echec: 'fabrication interrompue' }));
  }
  const champ = nature === 'voix' ? 'media' : 'image';
  retenirLeLot(ctx.agentId, { champ, pieces: lot });
  return {
    ok: reussies > 0,
    text: [
      `${reussies}/${pistes.length} exemple(s) fabriqué(s) :`,
      ...lignes,
      reussies
        ? `Repose maintenant ta question par ask_user, chaque option avec son identifiant dans « ${champ} ». Chaque exemple garde sa LETTRE et sa référence : cite-les dans le texte de ta question (« A (#xxxx) — titre »). CHAQUE exemple ci-dessus devient un choix, même raté : dis-le dans sa description, ne le retire jamais — ask_user refuse une question qui en oublie un. Une piste sans exemple reste décrite en mots.`
        : `Aucun exemple : pose ta question avec des choix décrits en mots, et dis à l’utilisateur pourquoi (raison ci-dessus).`,
      ctx.cardId ? `Enveloppe des exemples payants de cette carte : ${ENVELOPPE_DES_EXEMPLES} $.` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}
