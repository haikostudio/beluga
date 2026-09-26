/**
 * LES BIBLIOTHÈQUES DE COMPÉTENCES — les règles pures de l'IMPORT, sans base
 * ni disque (le travail réel : `server/src/bibliotheques-competences.ts`).
 *
 * Une bibliothèque est une COLLECTION de compétences publiée ailleurs : celle
 * d'Anthropic pour Claude (`anthropics/skills`), celle d'OpenAI pour Codex
 * (`openai/skills`), ou une collection de la communauté. Les deux premières
 * partagent le MÊME format que notre pool — un dossier par compétence, un
 * `SKILL.md` à en-tête `name` / `description` — : elles se copient telles
 * quelles. Les règles écrites pour d'autres outils (`.mdc` de Cursor,
 * `AGENTS.md`, `*.instructions.md`) se CONVERTISSENT au mieux, et ce qui ne
 * peut pas l'être est écarté AVEC SA RAISON.
 *
 * DÉCISION DE L'UTILISATEUR (2026-09-24) : une fiche importée est SERVIE PAR LA
 * MÉMOIRE SEULEMENT (`annonceeEnTeteDeSession`). Le REGISTRE du pool
 * (`.bibliotheques.json`) dit quelles fiches viennent de quelle bibliothèque :
 * il sert à la mise à jour (ce qui a disparu de la source se déprécie) ET à
 * reconnaître une fiche ADOPTÉE qu'on ne réécrit pas (un lien vers le coffre
 * personnel de l'utilisateur).
 */

import { enTeteDeCompetence } from './competences.js';
import { MOTIF_NOM_DE_FICHE } from './fiche-competence.js';

/** Le registre des bibliothèques, à la racine du pool (caché : `lirePool` ne le prend pas pour une fiche). */
export const FICHIER_REGISTRE_BIBLIOTHEQUES = '.bibliotheques.json';

/** Ce que le registre retient d'une bibliothèque. */
export interface EntreeDeBibliotheque {
  /** L'adresse d'où elle a été importée (dépôt git, ou chemin local). */
  source: string;
  /** L'enregistrement (commit) importé, quand la source est un dépôt git. */
  commit?: string;
  /** Le sous-dossier de la source, quand l'import n'a pris qu'une partie du dépôt. */
  sousDossier?: string;
  /** La dernière importation, en millisecondes. */
  importeeLe: number;
  /** Les fiches du pool qui viennent d'elle (noms de dossier). */
  competences: string[];
  /**
   * Fiches ADOPTÉES, pas copiées : des liens vers un dossier tenu ailleurs (le
   * coffre personnel). Le démon ne les réécrit pas ; il sait seulement qu'elles
   * viennent de cette bibliothèque.
   */
  adoptees?: boolean;
}

export type RegistreDesBibliotheques = Record<string, EntreeDeBibliotheque>;

/** Le registre lu depuis son texte — jamais d'exception : un registre illisible vaut un registre vide. */
export function registreDepuisTexte(texte: string | undefined): RegistreDesBibliotheques {
  if (!texte) return {};
  try {
    const brut = JSON.parse(texte) as unknown;
    if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return {};
    const registre: RegistreDesBibliotheques = {};
    for (const [id, valeur] of Object.entries(brut as Record<string, Partial<EntreeDeBibliotheque>>)) {
      if (!valeur || typeof valeur !== 'object' || !idDeBibliothequeValide(id)) continue;
      registre[id] = {
        source: String(valeur.source ?? ''),
        commit: valeur.commit ? String(valeur.commit) : undefined,
        sousDossier: valeur.sousDossier ? String(valeur.sousDossier) : undefined,
        importeeLe: Number(valeur.importeeLe) || 0,
        competences: Array.isArray(valeur.competences) ? valeur.competences.map(String).filter(Boolean) : [],
        adoptees: valeur.adoptees === true ? true : undefined,
      };
    }
    return registre;
  } catch {
    return {};
  }
}

export function texteDuRegistre(registre: RegistreDesBibliotheques): string {
  const trie = Object.fromEntries(
    Object.entries(registre)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([id, e]) => [id, { ...e, competences: [...new Set(e.competences)].sort() }]),
  );
  return `${JSON.stringify(trie, null, 2)}\n`;
}

/** La bibliothèque d'une fiche d'après le registre, ou `undefined` pour une fiche maison. */
export function bibliothequeDuRegistre(registre: RegistreDesBibliotheques, nom: string): string | undefined {
  for (const [id, entree] of Object.entries(registre)) if (entree.competences.includes(nom)) return id;
  return undefined;
}

/* ------------------------------------------------------------------ */
/* LA SOURCE                                                            */
/* ------------------------------------------------------------------ */

/**
 * LES BIBLIOTHÈQUES CONNUES, appelables par un mot. « anthropic » ou « claude »
 * vaut la collection d'Anthropic, « openai », « codex » ou « gpt » celle
 * d'OpenAI : un agent n'a pas à retrouver l'adresse exacte.
 */
export const BIBLIOTHEQUES_CONNUES: Record<string, string> = {
  anthropic: 'anthropics/skills',
  anthropics: 'anthropics/skills',
  claude: 'anthropics/skills',
  openai: 'openai/skills',
  codex: 'openai/skills',
  gpt: 'openai/skills',
  'taste-skill': 'Leonxlnx/taste-skill',
};

export interface SourceDeBibliotheque {
  genre: 'git' | 'local';
  /** Ce que `git clone` reçoit, ou le chemin local. */
  adresse: string;
  /** L'identifiant proposé pour la bibliothèque (`anthropics-skills`). */
  id: string;
}

const MOTIF_ID_BIBLIOTHEQUE = /^[a-z0-9][a-z0-9-]{1,39}$/;

export function idDeBibliothequeValide(id: string): boolean {
  return MOTIF_ID_BIBLIOTHEQUE.test(id);
}

/** Un texte quelconque, rendu en identifiant court : minuscules, sans accents, traits d'union. */
export function enIdentifiant(texte: string, max = 40): string {
  return String(texte ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/**
 * LA SOURCE D'UNE BIBLIOTHÈQUE, telle qu'un agent la donne : un mot connu
 * (« anthropic »), « propriétaire/dépôt » (GitHub), une adresse de dépôt git, ou
 * un chemin local absolu. `null` si rien de tout cela.
 */
export function sourceDeBibliotheque(brut: string): SourceDeBibliotheque | null {
  let texte = String(brut ?? '').trim();
  if (!texte) return null;
  const connue = BIBLIOTHEQUES_CONNUES[texte.toLowerCase()];
  if (connue) texte = connue;

  if (texte.startsWith('/')) {
    const morceaux = texte.replace(/\/+$/, '').split('/').filter(Boolean);
    const id = enIdentifiant(morceaux.slice(-1)[0] ?? '');
    return id.length >= 2 ? { genre: 'local', adresse: texte.replace(/\/+$/, ''), id } : null;
  }

  const court = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(texte);
  if (court) {
    return { genre: 'git', adresse: `https://github.com/${court[1]}/${court[2]}.git`, id: enIdentifiant(`${court[1]}-${court[2]}`) };
  }

  const url = /^(?:https?:\/\/|git@)([^/:]+)[/:](.+?)(?:\.git)?\/?$/.exec(texte);
  if (url) {
    const chemin = url[2].split('/').filter(Boolean);
    // Une adresse de navigation GitHub (« …/tree/main/skills ») ne se clone pas :
    // on garde le dépôt, le reste est un sous-dossier que l'agent peut donner à part.
    const coupe = chemin.indexOf('tree');
    const depot = coupe > 0 ? chemin.slice(0, coupe) : chemin;
    if (depot.length < 1) return null;
    const adresse = texte.startsWith('git@') ? texte : `https://${url[1]}/${depot.join('/')}.git`;
    return { genre: 'git', adresse, id: enIdentifiant(depot.slice(-2).join('-')) };
  }
  return null;
}

/** Le sous-dossier porté par une adresse de navigation (`…/tree/main/skills` → `skills`). */
export function sousDossierDeLAdresse(brut: string): string | undefined {
  const m = /\/tree\/[^/]+\/(.+?)\/?$/.exec(String(brut ?? '').trim());
  return m ? m[1] : undefined;
}

/** Un sous-dossier accepté : relatif, sans remontée. */
export function sousDossierValide(chemin: string): boolean {
  const propre = chemin.trim();
  return Boolean(propre) && !propre.startsWith('/') && !propre.split('/').includes('..') && !propre.includes('\\');
}

/* ------------------------------------------------------------------ */
/* LES FICHES                                                           */
/* ------------------------------------------------------------------ */

/** Le nom de dossier d'une fiche importée : son `name` déclaré, sinon le nom de son dossier. */
export function nomDeFicheImportee(nomDeclare: string | undefined, nomDuDossier: string): string {
  const candidat = enIdentifiant(nomDeclare || '', 49) || enIdentifiant(nomDuDossier, 49);
  return MOTIF_NOM_DE_FICHE.test(candidat) ? candidat : '';
}

/**
 * UN NOM DÉJÀ PRIS NE S'ÉCRASE PAS. Une fiche MAISON, ou la fiche d'une AUTRE
 * bibliothèque, garde son nom ; la fiche importée reçoit celui de sa
 * bibliothèque en suffixe. Une fiche de LA MÊME bibliothèque, elle, est la
 * même fiche : elle se met à jour sous son nom.
 */
export function nomDeFicheSansCollision(
  nom: string,
  bibliotheque: string,
  occupants: ReadonlyMap<string, string | null>,
): string {
  const occupant = occupants.get(nom);
  if (occupant === undefined || occupant === bibliotheque) return nom;
  const suffixe = `-${bibliotheque}`;
  const base = nom.slice(0, Math.max(2, 49 - suffixe.length)).replace(/-+$/g, '');
  const propose = `${base}${suffixe}`.slice(0, 49).replace(/-+$/g, '');
  return propose;
}

/**
 * LE CONTRÔLE D'UNE FICHE IMPORTÉE — minimal, et c'est voulu. Le contrôle de
 * qualité de nos fiches (`jugerLaFiche`) exige une section « Vérification » que
 * les collections publiées n'ont pas : il les écarterait toutes. On garde
 * seulement ce sans quoi une fiche ne se déclenche jamais.
 */
export function raisonsDeRefusDeLImport(texte: string): string[] {
  const entete = enTeteDeCompetence(texte);
  const raisons: string[] = [];
  if (!String(texte ?? '').trimStart().startsWith('---')) raisons.push("pas d'en-tête (« --- name / description --- »)");
  if (!entete.nom?.trim()) raisons.push("l'en-tête ne porte pas de « name »");
  const description = entete.description?.trim() ?? '';
  if (!description) raisons.push("l'en-tête ne porte pas de « description » : la fiche ne se déclencherait jamais");
  else if (/^[|>][+-]?$/.test(description)) raisons.push('la description est un bloc YAML vide (« >- »)');
  return raisons;
}

/**
 * POSER DES CLÉS DANS L'EN-TÊTE, sans toucher au reste : une clé présente est
 * remplacée, une clé absente s'ajoute à la fin. Le texte d'une fiche importée
 * reste celui de ses auteurs ; seul l'en-tête apprend d'où elle vient.
 */
export function enTeteAvecCles(texte: string, cles: Record<string, string | undefined>): string {
  const lignes = String(texte ?? '').split(/\r?\n/);
  if (lignes[0]?.trim() !== '---') return texte;
  const fin = lignes.findIndex((ligne, i) => i > 0 && ligne.trim() === '---');
  if (fin < 0) return texte;
  const entete = lignes.slice(1, fin);
  for (const [cle, valeur] of Object.entries(cles)) {
    if (valeur === undefined) continue;
    const propre = String(valeur).replace(/\s*\n\s*/g, ' ').trim();
    const rang = entete.findIndex((ligne) => new RegExp(`^${cle.replace(/[-]/g, '\\-')}\\s*:`, 'i').test(ligne));
    if (rang >= 0) entete[rang] = `${cle}: ${propre}`;
    else entete.push(`${cle}: ${propre}`);
  }
  return ['---', ...entete, ...lignes.slice(fin)].join('\n');
}

/** Les formats d'autres outils qu'on sait convertir, et comment on les reconnaît. */
export type FormatAConvertir = 'cursor' | 'agents' | 'instructions';

export function formatAConvertir(nomDeFichier: string): FormatAConvertir | null {
  const nom = nomDeFichier.toLowerCase();
  if (nom.endsWith('.mdc')) return 'cursor';
  if (nom === 'agents.md') return 'agents';
  if (nom.endsWith('.instructions.md')) return 'instructions';
  return null;
}

/** Une règle convertie en `SKILL.md`, ou la raison de son refus. */
export type Conversion = { ok: true; nom: string; texte: string } | { ok: false; raison: string };

/**
 * CONVERTIR UNE RÈGLE D'UN AUTRE OUTIL EN FICHE. Le `name` vient de l'en-tête,
 * sinon du fichier (ou de son dossier pour un `AGENTS.md`) ; la `description`
 * vient de l'en-tête, sinon du premier paragraphe du texte. Sans description
 * d'au moins quarante signes, la fiche ne dirait pas quand s'en servir : refus.
 */
export function convertirEnFiche(
  format: FormatAConvertir,
  texte: string,
  nomDuFichier: string,
  nomDuDossier: string,
): Conversion {
  const entete = enTeteDeCompetence(texte);
  const corps = (() => {
    const lignes = texte.split(/\r?\n/);
    if (lignes[0]?.trim() !== '---') return texte.trim();
    const fin = lignes.findIndex((l, i) => i > 0 && l.trim() === '---');
    return (fin < 0 ? lignes : lignes.slice(fin + 1)).join('\n').trim();
  })();
  if (!corps) return { ok: false, raison: `${nomDuFichier} : fichier vide` };

  const base =
    format === 'agents'
      ? nomDuDossier
      : nomDuFichier.replace(/\.instructions\.md$/i, '').replace(/\.mdc$/i, '');
  const nom = nomDeFicheImportee(entete.nom, base);
  if (!nom) return { ok: false, raison: `${nomDuFichier} : aucun nom de fiche utilisable` };

  let description = entete.description?.trim() ?? '';
  if (!description || /^[|>][+-]?$/.test(description)) {
    const paragraphe = corps
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .find((p) => p && !p.startsWith('#') && !p.startsWith('```') && !p.startsWith('-') && !p.startsWith('|'));
    description = (paragraphe ?? '').replace(/\s+/g, ' ').slice(0, 600);
  }
  if (description.length < 40) {
    return { ok: false, raison: `${nomDuFichier} : pas de description assez claire pour dire quand s'en servir` };
  }

  const origine = { cursor: 'règle Cursor', agents: 'AGENTS.md', instructions: 'instructions' }[format];
  const globs = entete.brut.globs ? `\n\nFichiers visés par la règle d'origine : \`${entete.brut.globs}\`.` : '';
  const texteDeLaFiche =
    `---\nname: ${nom}\ndescription: ${description.replace(/\s*\n\s*/g, ' ')}\nprovenance-format: ${origine}\n---\n\n` +
    `# ${nom}\n\n_Convertie depuis ${origine} (\`${nomDuFichier}\`)._${globs}\n\n${corps}\n`;
  return { ok: true, nom, texte: texteDeLaFiche };
}

/* ------------------------------------------------------------------ */
/* LE BILAN                                                             */
/* ------------------------------------------------------------------ */

export interface BilanDImportDeBibliotheque {
  ok: boolean;
  bibliotheque: string;
  source: string;
  commit?: string;
  creees: string[];
  misesAJour: string[];
  inchangees: string[];
  /** Disparues de la source : retirées du service (archivées), jamais effacées. */
  retirees: string[];
  /** Renommées pour ne pas écraser une fiche maison ou d'une autre bibliothèque : `nom d'origine → nom posé`. */
  renommees: string[];
  refusees: { nom: string; raison: string }[];
  /** La panne qui a arrêté l'import entier (clone impossible, source introuvable). */
  erreur?: string;
}

/** Le bilan en clair, pour l'agent qui a demandé l'import. */
export function texteDuBilanDImport(b: BilanDImportDeBibliotheque): string {
  if (!b.ok) return `Import de la bibliothèque « ${b.bibliotheque || '?'} » impossible : ${b.erreur ?? 'raison inconnue'}.`;
  const lignes = [
    `Bibliothèque « ${b.bibliotheque} » importée depuis ${b.source}${b.commit ? ` (commit ${b.commit.slice(0, 10)})` : ''}.`,
    `- ${b.creees.length} fiche(s) créée(s)${b.creees.length ? ` : ${b.creees.join(', ')}` : ''}`,
    `- ${b.misesAJour.length} mise(s) à jour${b.misesAJour.length ? ` : ${b.misesAJour.join(', ')}` : ''}`,
    `- ${b.inchangees.length} inchangée(s)`,
    `- ${b.retirees.length} retirée(s) du service, car disparue(s) de la source${b.retirees.length ? ` : ${b.retirees.join(', ')}` : ''}`,
  ];
  if (b.renommees.length) lignes.push(`- renommées pour ne rien écraser : ${b.renommees.join(', ')}`);
  if (b.refusees.length) lignes.push(`- ${b.refusees.length} écartée(s) :\n${b.refusees.map((r) => `  - ${r.nom} : ${r.raison}`).join('\n')}`);
  lignes.push(
    'Ces fiches sont servies PAR LA MÉMOIRE SEULEMENT : elles ne sont ni annoncées en tête de session, ni posées dans le coffre des comptes. ' +
      'On les trouve avec l’outil « memoire », geste « chercher ».',
  );
  return lignes.join('\n');
}
