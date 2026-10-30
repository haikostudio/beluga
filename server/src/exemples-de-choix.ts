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
 * Un refus d'un service (quota, 429) se dit tel quel : aucune bascule
 * silencieuse vers un autre service payant (MEM-3737). Chaque fabrication pose
 * le bloc d'attente des médias au bas du fil (MEM-5372).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { ENVELOPPE_DES_EXEMPLES, MAX_PISTES_D_EXEMPLE, NATURES_D_EXEMPLE, lettreDuRang, nomDeLExemple } from '@beluga/shared';

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
  consigne?: string;
  texte?: string;
  voix?: string;
}

export interface ResultatDExemples {
  ok: boolean;
  text: string;
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
      consigne: typeof p?.consigne === 'string' ? p.consigne.trim().slice(0, 2000) : undefined,
      texte: typeof p?.texte === 'string' ? p.texte.trim().slice(0, 600) : undefined,
      voix: typeof p?.voix === 'string' ? p.voix.trim() : undefined,
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

/** Une page HTML photographiée par le Chrome du système. */
async function photographierLesPages(pistes: PisteDExemple[], dossier: string): Promise<(string | { refus: string })[]> {
  const { chromium } = await import('playwright');
  const navigateur = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const sorties: (string | { refus: string })[] = [];
    for (const [i, piste] of pistes.entries()) {
      if (!piste.html?.trim()) {
        sorties.push({ refus: 'il manque « html » : la page entière qui montre cette piste' });
        continue;
      }
      const page = await navigateur.newPage({ viewport: { width: LARGEUR_PAGE, height: HAUTEUR_PAGE }, deviceScaleFactor: 2 });
      try {
        // Aucune requête au-dehors : une page d'exemple se suffit à elle-même.
        await page.route('**/*', (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort()));
        await page.setContent(piste.html, { waitUntil: 'load', timeout: 15_000 });
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

/** Une illustration par Codex du serveur : rend le fichier, ou la raison du refus (dite telle quelle). */
async function illustrerParCodex(consigne: string, dossier: string): Promise<string | { refus: string }> {
  const formule = formuleDeCodex();
  if (formule !== 'plus' && formule !== 'pro' && formule !== 'team' && formule !== 'business' && formule !== 'enterprise') {
    return { refus: `Codex du serveur n'a pas la génération d'images (formule « ${formule ?? 'inconnue'} »)` };
  }
  const { codexAdapter } = await import('./engines/codex.js');
  return unCodexALaFois(
    () =>
      new Promise<string | { refus: string }>((resolve) => {
        const depuis = Date.now() - 1000;
        const enfant = execFile(
          codexAdapter.binary,
          ['exec', '--skip-git-repo-check', '-s', 'read-only', '-C', dossier, '-'],
          { timeout: DUREE_MAX_CODEX_MS, maxBuffer: 8 * 1024 * 1024 },
          (err, stdout, stderr) => {
            const image = derniereImageDeCodex(depuis);
            if (image) return resolve(image);
            const sortie = `${stdout ?? ''}\n${stderr ?? ''}`;
            const quota = /usage_limit_reached|rate.?limit|429/i.test(sortie);
            resolve({
              refus: quota
                ? 'Codex a atteint la limite de son abonnement'
                : err?.killed
                  ? 'Codex n’a pas rendu son image à temps'
                  : `Codex n’a rendu aucune image (${(err?.message ?? sortie).trim().slice(0, 160)})`,
            });
          },
        );
        enfant.stdin?.end(
          `Produce exactly ONE image with your built-in image generation tool. Do not write code, do not run shell commands. No text in the image unless asked.\n\n${consigne}`,
        );
      }),
  );
}

/** Le dernier recours payant : l'aperçu de kie.ai, sous l'enveloppe des exemples de la carte. */
async function illustrerParLeServiceExterne(ctx: ContexteDExemple, piste: PisteDExemple): Promise<{ piece: string } | { refus: string }> {
  if (!ctx.cardId) return { refus: 'sans carte, pas de dépense possible : seuls les moyens sans frais du serveur servent' };
  const { fabriquerUnApercu } = await import('./realisation.js');
  const r = await fabriquerUnApercu(
    { agentId: ctx.agentId, projectId: ctx.projectId, cardId: ctx.cardId } as never,
    { consigne: piste.consigne, legende: piste.titre, format: '1:1' },
    undefined,
    { exemple: true },
  );
  const piece = r.ok ? /pièce « ([^»]+) »/.exec(r.text)?.[1]?.trim() : undefined;
  return piece ? { piece } : { refus: r.text };
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
  /** Une piste réussie : sa ligne dit lettre, pièce et référence courte. */
  const reussie = (i: number, piece: string, alias: string | undefined, origine: string) => {
    reussies += 1;
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
      const rendus = await photographierLesPages(pistes, dossier);
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
        if ('piece' in externe) reussie(i, externe.piece, store.getAttachment(externe.piece)?.alias, `service externe : ${raisonLocale}`);
        else ratee(i, `${raisonLocale} ; service externe : ${externe.refus}`);
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
  return {
    ok: reussies > 0,
    text: [
      `${reussies}/${pistes.length} exemple(s) fabriqué(s) :`,
      ...lignes,
      reussies
        ? `Repose maintenant ta question par ask_user, chaque option avec son identifiant dans « ${champ} ». Chaque exemple garde sa LETTRE et sa référence : cite-les dans le texte de ta question (« A (#xxxx) — titre »). Une piste sans exemple reste décrite en mots.`
        : `Aucun exemple : pose ta question avec des choix décrits en mots, et dis à l’utilisateur pourquoi (raison ci-dessus).`,
      ctx.cardId ? `Enveloppe des exemples payants de cette carte : ${ENVELOPPE_DES_EXEMPLES} $.` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}
