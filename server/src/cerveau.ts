import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  CERVEAU_SOURCE,
  CERVEAU_URL,
  DOSSIERS_IGNORES,
  EmpreinteRetenue,
  FichierRecolte,
  IdentiteProjet,
  PROFONDEUR_MAX,
  RaisonEnvoi,
  decisionEnvoi,
  estPageDuCerveau,
  ordonnerPages,
  doitEnvoyerMaintenant,
  faitPartir,
  fichiersACerveau,
  identifiantEnvoi,
  projetsACerveau,
  texteEnvoi,
} from '@haikodev/shared';
import { getMeta, setMeta } from './db.js';
import { log } from './logger.js';
import * as store from './store.js';

const execFileAsync = promisify(execFile);

/**
 * L'envoi quotidien au cerveau (voir [[cerveau]] côté partagé pour la règle).
 *
 * Une fois par jour, chaque projet vivant expédie sa mémoire et les
 * instructions de ses moteurs. Le cerveau MET À JOUR au lieu d'empiler (un
 * identifiant stable par projet et par fichier), et seuls les fichiers qui ont
 * bougé repartent — sauf une fois par semaine, où tout repart pour réparer une
 * désynchronisation silencieuse.
 *
 * Rien ici ne doit bloquer le démon : délai court, échec journalisé, on passe.
 */

/** Les empreintes déjà envoyées, retenues d'un redémarrage à l'autre. */
const CLE_EMPREINTES = 'cerveau.empreintes';
/** L'instant du dernier passage, réussi ou non. */
const CLE_DERNIER_PASSAGE = 'cerveau.dernier-passage';

/** Le cerveau ne doit jamais faire attendre le démon. */
const DELAI_MS = 10_000;

export function empreintesRetenues(): Record<string, EmpreinteRetenue> {
  try {
    const raw = getMeta(CLE_EMPREINTES);
    return raw ? (JSON.parse(raw) as Record<string, EmpreinteRetenue>) : {};
  } catch {
    return {};
  }
}

function retenirEmpreintes(empreintes: Record<string, EmpreinteRetenue>): void {
  try {
    setMeta(CLE_EMPREINTES, JSON.stringify(empreintes));
  } catch (err) {
    // Sans trace retenue, tout repartirait demain : ce n'est pas grave, mais ça se dit.
    log.warn('cerveau : empreintes non retenues', err);
  }
}

function dernierPassage(): number | undefined {
  const raw = getMeta(CLE_DERNIER_PASSAGE);
  const valeur = raw ? Number(raw) : NaN;
  return Number.isFinite(valeur) ? valeur : undefined;
}

/** La clé du cerveau vient de l'environnement, JAMAIS du dépôt. */
export function cleCerveau(): string | undefined {
  const cle = process.env.CERVEAU_API_KEY?.trim();
  return cle || undefined;
}

export function empreinte(contenu: string): string {
  return crypto.createHash('sha256').update(contenu).digest('hex');
}

/* ------------------------------------------------------------------ */
/* Récolter les fichiers d'un projet                                   */
/* ------------------------------------------------------------------ */

/**
 * Les fichiers exclus par `.gitignore`. Un projet peut très bien mettre son
 * `CLAUDE.md` de côté, ou poser un `ACCES-PRIVES.md` : ce qui n'est pas dans le
 * dépôt ne part pas. Sans dépôt git, rien n'est exclu.
 *
 * La question est posée par PAQUETS : une ligne de commande n'accepte pas mille
 * arguments, et un projet bavard en aurait vite autant.
 */
async function fichiersIgnores(chemin: string, noms: string[]): Promise<Set<string>> {
  const ignores = new Set<string>();
  for (let debut = 0; debut < noms.length; debut += 200) {
    const paquet = noms.slice(debut, debut + 200);
    try {
      const { stdout } = await execFileAsync('git', ['check-ignore', '--', ...paquet], {
        cwd: chemin,
        timeout: 15000,
        maxBuffer: 4 * 1024 * 1024,
      });
      for (const ligne of stdout.split('\n')) {
        const nom = ligne.trim();
        if (nom) ignores.add(nom);
      }
    } catch {
      // Sortie 1 = aucun fichier ignoré ; pas de dépôt = rien à exclure non plus.
    }
  }
  return ignores;
}

/**
 * Toutes les pages Markdown du dossier, sous-dossiers compris : certains
 * projets portent l'essentiel de ce qu'ils savent dans une documentation écrite
 * à côté de la mémoire. On ne descend pas dans les dossiers de machine (code
 * installé, constructions, données), et pas au-delà de quelques niveaux.
 */
function pagesDuDossier(racine: string): string[] {
  const trouvees: string[] = [];
  const parcourir = (dossier: string, relatif: string, profondeur: number) => {
    if (profondeur > PROFONDEUR_MAX) return;
    let entrees: fs.Dirent[];
    try {
      entrees = fs.readdirSync(dossier, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entree of entrees) {
      const sousChemin = relatif ? `${relatif}/${entree.name}` : entree.name;
      if (entree.isDirectory()) {
        if (entree.name.startsWith('.')) continue;
        if (DOSSIERS_IGNORES.includes(entree.name as (typeof DOSSIERS_IGNORES)[number])) continue;
        parcourir(path.join(dossier, entree.name), sousChemin, profondeur + 1);
      } else if (entree.isFile() && estPageDuCerveau(sousChemin)) {
        trouvees.push(sousChemin);
      }
    }
  };
  parcourir(racine, '', 0);
  return trouvees;
}

/**
 * Ce qu'un projet donne à lire. Un fichier illisible vaut `null` et ne fait
 * échouer personne.
 */
export async function recolterProjet(identite: IdentiteProjet): Promise<FichierRecolte[]> {
  const pages = ordonnerPages(pagesDuDossier(identite.chemin));
  const ignores = await fichiersIgnores(identite.chemin, pages);
  return pages
    .filter((nom) => !ignores.has(nom))
    .map((nom) => {
      try {
        return { nom, contenu: fs.readFileSync(path.join(identite.chemin, nom), 'utf8') };
      } catch {
        return { nom, contenu: null };
      }
    });
}

/* ------------------------------------------------------------------ */
/* L'envoi lui-même                                                    */
/* ------------------------------------------------------------------ */

/** Poser un texte dans le cerveau. Injectable : les tests n'appellent pas le réseau. */
export type Posteur = (envoi: {
  identifiant: string;
  projet: string;
  fichier: string;
  texte: string;
}) => Promise<{ ok: boolean; error?: string }>;

/**
 * Le vrai posteur : `POST /v1/memories`, avec un `discussion_id` stable — c'est
 * lui qui fait que le cerveau REMPLACE la version précédente au lieu d'en
 * accumuler une de plus chaque jour.
 */
export function posteurReel(cle: string): Posteur {
  return async (envoi) => {
    try {
      const res = await fetch(`${CERVEAU_URL}/v1/memories`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${cle}`,
          'content-type': 'application/json',
          'X-Cerveau-Client': CERVEAU_SOURCE,
          'X-Cerveau-Project': envoi.projet,
        },
        body: JSON.stringify({
          texte: envoi.texte,
          source: CERVEAU_SOURCE,
          projet: envoi.projet,
          discussion_id: envoi.identifiant,
        }),
        signal: AbortSignal.timeout(DELAI_MS),
      });
      if (!res.ok) return { ok: false, error: `refus (${res.status})` };
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'envoi impossible' };
    }
  };
}

export interface ResultatEnvoi {
  projets: number;
  fichiers: number;
  erreurs: { projet: string; message: string }[];
  /** Les empreintes après le passage : seuls les envois RÉUSSIS y sont notés. */
  empreintes: Record<string, EmpreinteRetenue>;
  /** Le détail par projet, tel qu'il part au journal. */
  lignes: { projet: string; ok: boolean; fichiers: number; error?: string }[];
}

/**
 * Le passage sur une liste de projets. Sans base ni réglages : on lui donne les
 * projets, les empreintes connues et de quoi poster — c'est ce qui rend le
 * mécanisme entier vérifiable par un test.
 */
export async function envoyerProjets(
  identites: IdentiteProjet[],
  options: { poster: Posteur; empreintes?: Record<string, EmpreinteRetenue>; maintenant?: number },
): Promise<ResultatEnvoi> {
  const maintenant = options.maintenant ?? Date.now();
  const empreintes = { ...(options.empreintes ?? {}) };
  const resultat: ResultatEnvoi = { projets: 0, fichiers: 0, erreurs: [], empreintes, lignes: [] };

  for (const identite of projetsACerveau(identites)) {
    let partis = 0;
    let echec: string | undefined;
    try {
      const recoltes = await recolterProjet(identite);
      for (const fichier of fichiersACerveau(recoltes)) {
        const identifiant = identifiantEnvoi(identite.id, fichier.nom);
        const sha = empreinte(fichier.contenu);
        const raison: RaisonEnvoi = decisionEnvoi(sha, empreintes[identifiant], maintenant);
        if (!faitPartir(raison)) continue;

        const texte = texteEnvoi(identite, fichier.nom, fichier.contenu, new Date(maintenant));
        const envoi = await options.poster({ identifiant, projet: identite.nom, fichier: fichier.nom, texte });
        if (envoi.ok) {
          empreintes[identifiant] = { sha, at: maintenant };
          partis += 1;
        } else {
          // Un fichier refusé n'empêche pas les suivants de partir : l'empreinte
          // n'est simplement pas retenue, il repassera demain.
          echec = envoi.error ?? 'envoi refusé';
        }
      }
    } catch (err: any) {
      echec = err?.message ?? 'récolte impossible';
    }
    resultat.fichiers += partis;
    if (partis) resultat.projets += 1;
    if (echec) resultat.erreurs.push({ projet: identite.nom, message: echec });
    resultat.lignes.push({ projet: identite.nom, ok: !echec, fichiers: partis, error: echec });
  }
  return resultat;
}

/* ------------------------------------------------------------------ */
/* Le passage du démon                                                 */
/* ------------------------------------------------------------------ */

/** Un seul passage à la fois : deux ne doivent pas se chevaucher. */
let enCours = false;

/** Les projets de la base, tels que le cerveau a besoin de les voir. */
export function identitesDesProjets(): IdentiteProjet[] {
  return store.listProjects(true).map((projet) => ({
    id: projet.id,
    nom: projet.name,
    chemin: projet.path,
    depot: projet.gitRemote,
    archive: projet.archived,
  }));
}

/**
 * Le passage réel : lit la clé, récolte, envoie, journalise. Sans clé, il se
 * tait proprement — l'état le dit dans les réglages, et la boucle continue de
 * tourner sans rien casser.
 */
export async function envoyerAuCerveau(
  options: { force?: boolean; auDemarrage?: boolean } = {},
): Promise<{ envoye: boolean; projets: number; fichiers: number; erreurs: number; raison?: string }> {
  if (enCours) return { envoye: false, projets: 0, fichiers: 0, erreurs: 0, raison: 'passage déjà en cours' };
  const maintenant = Date.now();

  if (
    !options.force &&
    !doitEnvoyerMaintenant(dernierPassage(), maintenant, new Date(maintenant).getHours(), options.auDemarrage)
  ) {
    return { envoye: false, projets: 0, fichiers: 0, erreurs: 0, raison: "ce n'est pas l'heure" };
  }

  const cle = cleCerveau();
  if (!cle) {
    // Sans clé, on ne réessaie pas toutes les heures : une ligne par jour suffit
    // à dire pourquoi rien ne part.
    setMeta(CLE_DERNIER_PASSAGE, String(maintenant));
    store.recordCerveau({ at: maintenant, ok: false, error: 'aucune clé (CERVEAU_API_KEY)' });
    log.info('cerveau : aucune clé posée, envoi ignoré');
    return { envoye: false, projets: 0, fichiers: 0, erreurs: 0, raison: 'aucune clé' };
  }

  enCours = true;
  try {
    const resultat = await envoyerProjets(identitesDesProjets(), {
      poster: posteurReel(cle),
      empreintes: empreintesRetenues(),
      maintenant,
    });
    retenirEmpreintes(resultat.empreintes);
    setMeta(CLE_DERNIER_PASSAGE, String(maintenant));
    for (const ligne of resultat.lignes) {
      store.recordCerveau({
        at: maintenant,
        project: ligne.projet,
        ok: ligne.ok,
        files: ligne.fichiers,
        error: ligne.error,
      });
    }
    log.info(
      `cerveau : ${resultat.fichiers} fichier(s) envoyé(s) pour ${resultat.projets} projet(s)` +
        (resultat.erreurs.length ? `, ${resultat.erreurs.length} en échec` : ''),
    );
    return {
      envoye: true,
      projets: resultat.projets,
      fichiers: resultat.fichiers,
      erreurs: resultat.erreurs.length,
    };
  } catch (err: any) {
    log.error('cerveau : envoi impossible', err);
    store.recordCerveau({ at: maintenant, ok: false, error: err?.message ?? 'envoi impossible' });
    return { envoye: false, projets: 0, fichiers: 0, erreurs: 1, raison: err?.message };
  } finally {
    enCours = false;
  }
}

/* ------------------------------------------------------------------ */
/* Ce qu'on lit dans les réglages                                      */
/* ------------------------------------------------------------------ */

export interface EtatCerveau {
  clePosee: boolean;
  adresse: string;
  dernierSucces?: number;
  projetsEnvoyes: number;
  fichiersEnvoyes: number;
  derniereTentative?: number;
  erreurs: { at: number; projet?: string; message: string }[];
}

export function etatCerveau(): EtatCerveau {
  const entrees = store.cerveauHistory(120);
  const succes = entrees.filter((e) => e.ok);
  const dernierSucces = succes[0]?.at;
  const duDernier = dernierSucces ? succes.filter((e) => e.at === dernierSucces) : [];
  return {
    clePosee: !!cleCerveau(),
    adresse: CERVEAU_URL,
    dernierSucces,
    projetsEnvoyes: duDernier.filter((e) => (e.files ?? 0) > 0).length,
    fichiersEnvoyes: duDernier.reduce((total, e) => total + (e.files ?? 0), 0),
    derniereTentative: entrees[0]?.at,
    erreurs: entrees
      .filter((e) => !e.ok)
      .slice(0, 5)
      .map((e) => ({ at: e.at, projet: e.project, message: e.error ?? 'raison inconnue' })),
  };
}
