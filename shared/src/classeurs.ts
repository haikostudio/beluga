/**
 * LES RÈGLES DE LA MÉMOIRE PARTAGÉE — pures, sans base ni disque.
 *
 * La mémoire elle-même (classeurs, fiches, base de connaissances) vit dans
 * `server/src/connaissances.ts`. Ce fichier ne porte plus que ce qui reste
 * commun aux deux cotés et testable seul : la fabrication des requêtes de la
 * recherche locale (plein texte BM25 et trigrammes), le découpage de l'ancien
 * arbre en fiches à la reprise, et les réglages du moteur de vecteurs.
 */

import { decouperRegles, titreDeRegle } from './regles.js';

/* ------------------------------------------------------------------ */
/* Le gabarit                                                           */
/* ------------------------------------------------------------------ */

/** Ce qu'une fiche EST : c'est la première chose qu'on sait d'elle. */
export const NATURES_FICHE = ['information', 'regle', 'controle', 'competence'] as const;
export type NatureFiche = (typeof NATURES_FICHE)[number];

/**
 * L'ÉTAT D'UNE FICHE. « à valider » est l'état d'une fiche IMPORTÉE : elle est
 * cherchable, mais l'écran la montre à part tant que personne ne l'a relue.
 * Rien ne se supprime : une fiche qui ne sert plus s'ARCHIVE, et la recherche
 * l'écarte par défaut.
 */
export const ETATS_FICHE = ['a_valider', 'active', 'depreciee', 'archivee'] as const;
export type EtatFicheClasseur = (typeof ETATS_FICHE)[number];

export interface ProvenanceFiche {
  /** Le fichier d'origine, relatif à sa racine (`docs/regles/cartes.md`), ou « outil », « écran ». */
  source: string;
  /** La section d'origine dans ce fichier, quand il en a. */
  section?: string;
  /** La racine d'origine : le chemin du projet, ou « centrale », ou « competences ». */
  racine?: string;
  /** La carte qui a écrit la fiche, quand un agent l'a écrite en travaillant. */
  carteId?: string;
}

export interface Fiche {
  id: number;
  /** L'identifiant court, copiable et cité dans une carte : « M-1a2 ». */
  code: string;
  classeurId: string;
  theme: string;
  nature: NatureFiche;
  titre: string;
  resume: string;
  corps: string;
  motsCles: string[];
  alias: string[];
  pourquoi: string;
  fichiers: string[];
  controle: string;
  etat: EtatFicheClasseur;
  provenance: ProvenanceFiche;
  /** La clé de provenance : ce qui rend un import rejouable sans doublon. */
  cleProvenance: string | null;
  creeLe: number;
  modifieLe: number;
  servie: number;
  lue: number;
  utile: number;
  inutile: number;
  perimee: number;
}

/** Ce qu'on donne pour écrire une fiche : tout ce qui n'est pas calculé par la base. */
export type BrouillonFiche = Partial<
  Pick<
    Fiche,
    | 'classeurId'
    | 'theme'
    | 'nature'
    | 'titre'
    | 'resume'
    | 'corps'
    | 'motsCles'
    | 'alias'
    | 'pourquoi'
    | 'fichiers'
    | 'controle'
    | 'etat'
    | 'provenance'
    | 'cleProvenance'
  >
>;

export const TITRE_FICHE_MAX = 140;

/** Liste propre : chaînes nettoyées, vides retirées, doublons retirés. */
export function listePropre(valeur: unknown, max = 20): string[] {
  const brutes = Array.isArray(valeur)
    ? valeur
    : typeof valeur === 'string'
      ? valeur.split(/[,\n]/)
      : [];
  const vues = new Set<string>();
  const sortie: string[] = [];
  for (const brute of brutes) {
    const texte = String(brute ?? '').replace(/\s+/g, ' ').trim();
    const cle = texte.toLowerCase();
    if (!texte || vues.has(cle)) continue;
    vues.add(cle);
    sortie.push(texte);
    if (sortie.length >= max) break;
  }
  return sortie;
}

/* ------------------------------------------------------------------ */
/* Le texte                                                             */
/* ------------------------------------------------------------------ */

export function sansAccents(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Retire le balisage Markdown le plus courant, pour un résumé lisible. */
export function texteNu(texte: string): string {
  return texte
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^#+\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Le résumé d'une ligne : la première phrase, coupée proprement sous le plafond. */
export function resumeDuTexte(texte: string, max = 200): string {
  const nu = texteNu(texte);
  if (!nu) return '';
  const phrase = /^(.{20,}?[.!?])(\s|$)/.exec(nu)?.[1] ?? nu;
  if (phrase.length <= max) return phrase;
  const coupe = phrase.slice(0, max - 1);
  const espace = coupe.lastIndexOf(' ');
  return `${(espace > max / 2 ? coupe.slice(0, espace) : coupe).trim()}…`;
}

/** Les repères techniques d'un texte, qui font de bons mots-clés : fichiers, fonctions, commandes. */
export function motsClesDuTexte(texte: string, max = 8): string[] {
  const trouves: string[] = [];
  for (const m of texte.matchAll(/`([^`\n]{3,60})`/g)) {
    const mot = m[1].trim();
    if (/\s{2,}/.test(mot)) continue;
    trouves.push(mot);
  }
  return listePropre(trouves, max);
}

/** Les fichiers cités par un texte (`web/src/…`, `scripts/…`). */
export function fichiersDuTexte(texte: string, max = 12): string[] {
  const trouves = [...texte.matchAll(/\b((?:server|web|shared|scripts|docs|data)\/[\w./-]+\.\w+)/g)].map((m) => m[1]);
  return listePropre(trouves, max);
}

/* ------------------------------------------------------------------ */
/* La recherche locale                                                  */
/* ------------------------------------------------------------------ */

/**
 * LES MOTS QUI NE CHERCHENT RIEN. Sans eux, « la carte de la mémoire » trouve
 * toutes les fiches qui contiennent « la » et « de ».
 */
const MOTS_VIDES = new Set(
  (
    'le la les un une des du de d l et ou a au aux en dans sur sous par pour avec sans ce cet cette ces ' +
    'qui que quoi dont ou est sont etre avoir fait faire il elle on nous vous ils elles se sa son ses leur ' +
    'leurs pas plus ne ni tout tous toute toutes mais donc car comme si the of and to in is it for on ' +
    'jamais toujours aussi deja encore tres bien quand puis alors meme autre chaque'
  ).split(/\s+/),
);

/** Les mots d'une demande, sans accents, sans mots vides, sans doublons. */
export function motsDeRecherche(texte: string, max = 24): string[] {
  const mots = sansAccents(String(texte ?? ''))
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((m) => m.length >= 2 && !MOTS_VIDES.has(m));
  return [...new Set(mots)].slice(0, max);
}

const SUFFIXES = ['issements', 'issement', 'ements', 'ement', 'ations', 'ation', 'euses', 'euse', 'eurs', 'eur', 'ees', 'ee', 'es', 'er', 'ez', 'e', 's', 'x'];

/**
 * UNE RACINE GROSSIÈRE, SANS DICTIONNAIRE : « déployer », « déploiement » et
 * « déployé » partagent « deploy » / « deploi ». La recherche plein texte n'a
 * pas de racinisation française ; un préfixe raccourci en tient lieu, et BM25
 * départage.
 */
export function racineDeMot(mot: string): string {
  let racine = mot;
  for (const suffixe of SUFFIXES) {
    if (racine.length - suffixe.length >= 4 && racine.endsWith(suffixe)) {
      racine = racine.slice(0, -suffixe.length);
      break;
    }
  }
  // « deploi » et « deploy » : le y et le i se valent en fin de racine.
  return racine.replace(/[iy]$/, '');
}

/** Un terme FTS5 sûr : guillemets doublés, jamais un opérateur glissé par la demande. */
function termeFts(mot: string, prefixe: boolean): string {
  return `"${mot.replace(/"/g, '""')}"${prefixe ? '*' : ''}`;
}

/**
 * LA REQUÊTE PLEIN TEXTE (BM25). Chaque mot devient sa racine en préfixe, ses
 * synonymes du classeur s'y ajoutent, et le tout se relie par OU : BM25 fait
 * monter les fiches qui en portent le plus, et les plus rares. Une demande vide
 * rend une requête vide — jamais « tout ».
 */
export function requetePleinTexte(texte: string, synonymes: ReadonlyMap<string, readonly string[]> = new Map()): string {
  const termes = new Set<string>();
  for (const mot of motsDeRecherche(texte)) {
    const variantes = [mot, ...(synonymes.get(mot) ?? [])];
    for (const variante of variantes) {
      for (const sous of motsDeRecherche(variante)) {
        const racine = racineDeMot(sous);
        termes.add(termeFts(racine.length >= 3 ? racine : sous, racine.length >= 3));
      }
    }
  }
  return [...termes].join(' OR ');
}

/**
 * LA REQUÊTE EN TRIGRAMMES, pour les fautes de frappe et les mots partiels :
 * chaque mot de quatre lettres et plus se découpe en morceaux de trois, reliés
 * par OU. « deploiment » garde assez de morceaux communs avec « déploiement »
 * pour remonter, là où le plein texte ne trouve rien.
 */
export function requeteTrigrammes(texte: string, max = 60): string {
  const morceaux = new Set<string>();
  for (const mot of motsDeRecherche(texte)) {
    if (mot.length < 4) continue;
    for (let i = 0; i + 3 <= mot.length; i++) morceaux.add(termeFts(mot.slice(i, i + 3), false));
  }
  return [...morceaux].slice(0, max).join(' OR ');
}

/**
 * LE SEUIL DES PISTES AU LANCEMENT. Sous ce score, on n'envoie RIEN plutôt
 * qu'une liste inutile : l'ancienne recherche servait un tour sur trois pour
 * rien. Le score brut de BM25 grandit avec la LONGUEUR de la demande (une
 * description de carte porte des dizaines de mots) : le seuil se juge donc sur
 * le score de la meilleure fiche PAR MOT de la demande (`scoreParMot`).
 *
 * Mesuré le 13/09/2026 sur 60 cartes réelles (`scripts/mesure-memoire-classeurs.mjs`) :
 * les scores des pistes utiles et inutiles SE CHEVAUCHENT — aucun seuil ne
 * retire les envois inutiles sans retirer aussi des pistes utiles. 1,5 garde 16
 * des 19 cartes touchées et se tait sur 10 cartes sur 60.
 */
export const SEUIL_DES_PISTES = 1.5;

/** Le score de la meilleure fiche rapporté au nombre de mots de la demande. */
export function scoreParMot(score: number, demande: string): number {
  return score / Math.max(1, motsDeRecherche(demande).length);
}
export const PISTES_MAX = 5;

/* ------------------------------------------------------------------ */
/* Le découpage de l'ancien arbre                                       */
/* ------------------------------------------------------------------ */

/** Le brouillon d'une fiche reprise de l'ancien arbre, sans classeur encore. */
export type FicheReprise = BrouillonFiche & { titre: string; corps: string; nature: NatureFiche; theme: string; cleProvenance: string };

function empreinte(texte: string): string {
  // FNV-1a 32 bits : assez pour distinguer deux lignes, sans module de hachage.
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * LES RÈGLES D'UN FICHIER `docs/regles/<sujet>.md` : une puce en gras = une
 * règle = une fiche. Le « pourquoi » n'est pas extrait de force : il reste dans
 * le corps, où la règle l'a écrit.
 */
export function fichesDeRegles(texte: string, theme: string, source: string, racine: string): FicheReprise[] {
  return decouperRegles(texte).map((regle, rang) => {
    const titre = titreDeRegle(regle) || `Règle ${rang + 1}`;
    const corps = regle.replace(/^-\s+\*\*[\s\S]+?\*\*\s*/, '').replace(/^\s{2}/gm, '').trim() || titre;
    return {
      nature: 'regle' as const,
      theme,
      titre: tronquer(titre, TITRE_FICHE_MAX),
      resume: resumeDuTexte(corps, 220) || tronquer(titre, 200),
      corps,
      motsCles: motsClesDuTexte(regle),
      fichiers: fichiersDuTexte(regle),
      etat: 'a_valider' as const,
      provenance: { source, section: titre, racine },
      cleProvenance: `${racine}|${source}|regle|${empreinte(titre)}`,
    };
  });
}

function tronquer(texte: string, max: number): string {
  const net = texte.replace(/\s+/g, ' ').trim();
  return net.length <= max ? net : `${net.slice(0, max - 1).trim()}…`;
}

/* ------------------------------------------------------------------ */
/* Vecteurs                                                             */
/* ------------------------------------------------------------------ */

/**
 * LE MODÈLE DE VECTEURS, LOCAL ET LÉGER : multilingual-e5-small (384 nombres par
 * texte, ~130 Mo sur disque), choisi pour tenir peu de mémoire sur le serveur.
 * Mesuré sur 60 cartes réelles : une fiche utile dans les cinq premières sur
 * 37 % des cartes en mêlant plein texte et vecteurs, contre 30 % sans.
 */
export const MODELE_VECTEURS = 'Xenova/multilingual-e5-small';
export const DIMENSIONS_VECTEURS = 384;
/** Le modèle quitte la mémoire vive après ce temps sans demande. */
export const REPOS_DU_VECTORISEUR_MS = 10 * 60 * 1000;

/** Le texte vectorisé d'une demande (e5 distingue la question du passage). */
export function demandeAVectoriser(texte: string): string {
  return `query: ${texte.trim()}`.slice(0, 1500);
}

/** Cosinus de deux vecteurs déjà normalisés : leur simple produit scalaire. */
export function cosinus(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/** Le passage de nuit de la mémoire : même fenêtre que le rangement des instructions, une fois par nuit. */
export const FENETRE_MEMOIRE_DE_NUIT = { debut: 2, fin: 5 } as const;

export function doitPasserLaNuit(maintenant: Date, dernierPassageA: number | undefined): boolean {
  const heure = maintenant.getHours();
  if (heure < FENETRE_MEMOIRE_DE_NUIT.debut || heure >= FENETRE_MEMOIRE_DE_NUIT.fin) return false;
  return !dernierPassageA || maintenant.getTime() - dernierPassageA >= 20 * 60 * 60 * 1000;
}
