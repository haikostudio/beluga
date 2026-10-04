/**
 * LES COMPÉTENCES PARTAGÉES : un POOL de modes d'emploi pour TOUS les agents —
 * Beluga Build compris. Une fiche est COMMUNE (elle vaut partout) ou PROPRE à
 * un ou plusieurs projets (leur interface, leur fonctionnement, leur structure,
 * leurs technologies), et chaque agent ne reçoit que les communes et celles de
 * son projet (`ficheServieAuProjet`).
 *
 * Une compétence (« skill ») est un DOSSIER portant un `SKILL.md` : un en-tête
 * qui dit son nom et à quoi elle sert, puis le mode d'emploi. Elles vivaient
 * dans le dossier personnel de l'utilisateur, donc nulle part pour les agents
 * lancés par Beluga Build — chaque compte de moteur a SON coffre, et un coffre neuf
 * n'a rien. Deux chemins, complémentaires, les rendent atteignables :
 *
 *   1. LE COFFRE. Claude Code lit les compétences de son dossier de
 *      configuration (`<coffre>/skills/<nom>`) : le démon y pose un lien vers
 *      chaque compétence COMMUNE, sans jamais écraser ce qui s'y trouve. Le
 *      coffre est celui d'un compte, partagé par tous les projets : une fiche
 *      propre à un projet n'y entre pas, le briefing de son projet la sert.
 *   2. LE BRIEFING. Codex n'a aucun mécanisme de compétences, et le chef
 *      d'orchestre n'a pas le droit d'ouvrir celles de son moteur. Le briefing
 *      les ANNONCE donc à tout agent — par un SOMMAIRE, jamais par une
 *      énumération qui grossirait avec le pool.
 *
 * TROIS CHOSES SONT NÉES AVEC LE POOL, et elles sont ici :
 *
 *   • UN REFUS SE DIT. Ce qui n'a pas la bonne forme était écarté EN SILENCE :
 *     ni journal, ni écran, ni raison. Chaque entrée écartée porte désormais sa
 *     cause (`RefusDeCompetence`), et chaque fiche gardée porte ses ANOMALIES.
 *   • UNE FICHE A UN ÉTAT ET UNE PROVENANCE. Active, dépréciée, archivée — rien
 *     ne se supprime : une fiche dépréciée apprend encore quelque chose, une
 *     fiche effacée n'apprend rien.
 *   • UNE FICHE EST UN ARBRE. Le `SKILL.md` est la TÊTE (courte, celle que les
 *     moteurs déclenchent) ; ses détails vivent dans des fichiers voisins, qui
 *     ne pèsent que si on les ouvre.
 *
 * Rien ici ne touche à la base ni au disque : les règles se lisent et se
 * rejouent seules.
 */

import { classerRegles } from './extrait-regles.js';

/** Le nom du dossier de compétences dans le coffre d'un compte. */
export const NOM_DOSSIER_COMPETENCES = 'skills';

/** Le fichier qui fait d'un dossier une compétence : sa TÊTE. */
export const FICHIER_COMPETENCE = 'SKILL.md';

/** Le fichier d'entrée n° 1 : le sommaire par thème, écrit par le démon. */
export const FICHIER_SOMMAIRE = 'SOMMAIRE.md';

/** Le fichier d'entrée n° 2 : l'index par symptôme, écrit par le démon. */
export const FICHIER_INDEX_SYMPTOMES = 'SYMPTOMES.md';

/** Les deux fichiers d'entrée, au sommet de l'arbre. */
export const FICHIERS_D_ENTREE = [FICHIER_SOMMAIRE, FICHIER_INDEX_SYMPTOMES];

/**
 * L'ÉTAT d'une fiche. RIEN NE SE SUPPRIME (limite posée par la carte) :
 *
 *   • `active` — servie, liée aux coffres, indexée ;
 *   • `depreciee` — gardée et indexée, mais SIGNALÉE : elle a été contredite ou
 *     n'aide plus personne. Elle apprend encore ce qu'il ne faut pas refaire ;
 *   • `archivee` — retirée du service (ni coffre, ni index), gardée sur le
 *     disque avec son histoire et ses statistiques.
 */
export const ETATS_DE_FICHE = ['active', 'depreciee', 'archivee'] as const;
export type EtatDeFiche = (typeof ETATS_DE_FICHE)[number];

/** L'état par défaut d'une fiche déposée à la main, sans en-tête `etat`. */
export const ETAT_PAR_DEFAUT: EtatDeFiche = 'active';

export function etatDeFiche(brut?: string): EtatDeFiche {
  const valeur = (brut ?? '').trim().toLowerCase().replace(/é/g, 'e');
  return (ETATS_DE_FICHE as readonly string[]).includes(valeur) ? (valeur as EtatDeFiche) : ETAT_PAR_DEFAUT;
}

/** Une fiche `archivee` sort du service : ni coffre, ni index, ni briefing. */
export function ficheEnService(etat: EtatDeFiche): boolean {
  return etat !== 'archivee';
}

/** D'où vient une fiche : le projet et la carte qui l'ont prouvée. */
export interface ProvenanceDeFiche {
  /** Le projet où la leçon a été apprise. */
  projet?: string;
  /** La carte d'origine (son identifiant), celle qui a fait la preuve. */
  carte?: string;
  /** Le titre de cette carte, pour un lecteur humain. */
  titre?: string;
  /** L'enregistrement (commit) qui porte le travail prouvé. */
  commit?: string;
  /** Quand la fiche est née, en millisecondes. */
  creeeLe?: number;
  /** La dernière vérification RÉUSSIE de sa procédure. */
  verifieeLe?: number;
  /** Les cartes qui l'ont ensuite renforcée ou corrigée. */
  renforceePar?: string[];
  /**
   * LA BIBLIOTHÈQUE D'ORIGINE d'une fiche IMPORTÉE (collection publiée pour
   * Claude, pour les moteurs d'OpenAI, ou par la communauté) — son identifiant
   * court (`anthropics-skills`). Absente sur une fiche écrite par nos agents.
   */
  bibliotheque?: string;
  /** D'où la bibliothèque a été importée : adresse du dépôt, ou chemin local. */
  source?: string;
  /** Quand la fiche a été importée (ou rafraîchie) depuis sa bibliothèque. */
  importeeLe?: number;
}

/** Une compétence partagée, telle que le démon la lit sur le disque. */
export interface Competence {
  /** Nom court, celui du dossier ou celui déclaré dans l'en-tête. */
  nom: string;
  /** À quoi elle sert et quand s'en servir, en une phrase. */
  description: string;
  /** Le dossier de la compétence. */
  dossier: string;
  /** Le mode d'emploi à ouvrir : sa TÊTE. */
  fichier: string;
  /** Son état : active, dépréciée, archivée. */
  etat: EtatDeFiche;
  /** Les thèmes déclarés, qui servent à ranger le sommaire. */
  themes: string[];
  /** Les symptômes déclarés : les mots par lesquels on la cherche. */
  symptomes: string[];
  /**
   * Les projets auxquels elle s'applique. VIDE = commune : elle sert partout.
   * Sinon elle n'est servie qu'à ces projets (`ficheServieAuProjet`).
   */
  projets: string[];
  /** D'où elle vient, et ce qui l'a renforcée. */
  provenance: ProvenanceDeFiche;
  /**
   * L'ARBRE : les fichiers de DÉTAIL qui vivent à côté de la tête, chemins
   * relatifs au dossier de la compétence (`references/api.md`,
   * `scripts/creer.sh`). Ils sont indexés, mais ne pèsent que si on les ouvre.
   */
  annexes: string[];
  /**
   * Ce qui cloche dans la fiche SANS l'écarter du pool : une tête sans section
   * « Vérification », une description qui ne dit pas quand s'en servir. Elle est
   * servie quand même — quinze fiches écrites avant cette règle valent mieux que
   * zéro — mais l'écran le DIT, et l'écriture, elle, refuse (`jugerLaFiche`).
   */
  anomalies: string[];
  /**
   * La BIBLIOTHÈQUE d'où vient la fiche, si elle est importée (en-tête
   * `provenance-bibliotheque`, ou registre `.bibliotheques.json` du pool pour
   * une fiche adoptée qu'on ne réécrit pas). Une fiche de bibliothèque est
   * SERVIE PAR LA MÉMOIRE SEULEMENT : ni briefing, ni coffre des comptes.
   */
  bibliotheque?: string;
}

/**
 * UNE FICHE DE BIBLIOTHÈQUE N'EST PAS ANNONCÉE. Décision de l'utilisateur
 * (2026-09-24) : une bibliothèque importée peut porter des dizaines de fiches ;
 * les annoncer en tête de session, ou les poser dans le coffre des comptes
 * Claude (dont l'outil de compétences charge toutes les descriptions), ferait
 * payer leur liste à CHAQUE tour de CHAQUE agent. Elles se trouvent par la
 * recherche de la mémoire, et s'ouvrent en entier au besoin.
 */
export function annonceeEnTeteDeSession(fiche: Pick<Competence, 'bibliotheque'>): boolean {
  return !fiche.bibliotheque;
}

/** Deux noms de projet se comparent sans tenir compte de la casse ni des espaces autour. */
function memeProjet(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * UNE FICHE EST COMMUNE OU PROPRE À DES PROJETS — ET UN AGENT NE REÇOIT QUE LES
 * SIENNES. Décision de l'utilisateur (2026-10-02) : chaque projet apprend de son
 * propre travail (interface, fonctionnement, structure, technologies), et ses
 * fiches s'écrivent dès la fin d'une carte. Servir à ProjetA la fiche d'un
 * composant de ProjetB ferait payer — et suivre — une leçon qui n'y vaut rien.
 *
 * Une fiche COMMUNE (`projets` vide) sert partout. Une fiche PROPRE ne sert qu'aux
 * projets qu'elle nomme. Sans projet connu, seules les communes passent.
 */
export function ficheServieAuProjet(fiche: Pick<Competence, 'projets'>, nomDuProjet?: string): boolean {
  if (!fiche.projets.length) return true;
  if (!nomDuProjet?.trim()) return false;
  return fiche.projets.some((projet) => memeProjet(projet, nomDuProjet));
}

/** La fiche est-elle COMMUNE à tous les projets ? */
export function ficheCommune(fiche: Pick<Competence, 'projets'>): boolean {
  return !fiche.projets.length;
}

/** Pourquoi une entrée du dossier n'a PAS été retenue comme compétence. */
export type CauseDeRefus =
  | 'pas-un-dossier'
  | 'sans-mode-d-emploi'
  | 'illisible'
  | 'lien-mort';

export interface RefusDeCompetence {
  /** Le nom de l'entrée écartée, tel qu'il apparaît dans le dossier. */
  nom: string;
  cause: CauseDeRefus;
  /** Le détail machine, quand il y en a un (message système). */
  detail?: string;
}

/** La raison d'un refus, en français, pour le journal comme pour l'écran. */
export function raisonDuRefus(refus: RefusDeCompetence): string {
  const causes: Record<CauseDeRefus, string> = {
    'pas-un-dossier': `« ${refus.nom} » n'est pas un dossier : une compétence est un DOSSIER portant un ${FICHIER_COMPETENCE}`,
    'sans-mode-d-emploi': `« ${refus.nom} » n'a pas de ${FICHIER_COMPETENCE} : sans mode d'emploi, il n'y a rien à servir`,
    illisible: `« ${refus.nom} » est illisible`,
    'lien-mort': `« ${refus.nom} » est un lien qui ne mène nulle part`,
  };
  const base = causes[refus.cause];
  return refus.detail ? `${base} (${refus.detail})` : base;
}

/* ------------------------------------------------------------------ */
/* L'EN-TÊTE D'UNE FICHE                                               */
/* ------------------------------------------------------------------ */

/**
 * L'en-tête d'un `SKILL.md` : un bloc encadré de `---`, une clé par ligne. On
 * ne dépend d'aucun analyseur YAML — un fichier sans en-tête ne doit pas faire
 * tomber le démon, et les deux clés STANDARD (`name`, `description`) sont les
 * seules que les moteurs lisent.
 *
 * Les clés de Beluga Build viennent EN PLUS et sont toutes facultatives : une fiche
 * écrite avant cette règle reste valide, elle prend simplement les valeurs par
 * défaut.
 */
export interface EnTeteDeCompetence {
  nom?: string;
  description?: string;
  etat?: string;
  themes?: string;
  symptomes?: string;
  projets?: string;
  /** Provenance, à plat : `provenance-projet`, `provenance-carte`… */
  provenance?: Record<string, string>;
  /** Toutes les clés lues, pour ne rien perdre à la réécriture. */
  brut: Record<string, string>;
}

export function enTeteDeCompetence(texte: string): EnTeteDeCompetence {
  const lignes = texte.split(/\r?\n/);
  const entete: EnTeteDeCompetence = { brut: {} };
  if (lignes[0]?.trim() !== '---') return entete;
  for (let i = 1; i < lignes.length; i += 1) {
    const ligne = lignes[i];
    if (ligne.trim() === '---') break;
    // Une ligne INDENTÉE appartient à la clé précédente (bloc YAML), jamais à
    // une clé neuve : sans ce saut, le « : » d'une phrase de continuation
    // fabriquerait une clé fantôme.
    if (/^\s/.test(ligne)) continue;
    const coupe = ligne.indexOf(':');
    if (coupe <= 0) continue;
    const cle = ligne.slice(0, coupe).trim().toLowerCase();
    let valeur = ligne
      .slice(coupe + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    /*
     * LES DESCRIPTIONS SUR PLUSIEURS LIGNES. YAML écrit `description: >-` puis
     * le texte INDENTÉ en dessous — une compétence du coffre le fait, et son
     * sommaire affichait « >- » à la place de sa phrase. On ramasse donc les
     * lignes indentées qui suivent : repliées (`>`) elles se recollent par un
     * espace, littérales (`|`) elles gardent leurs retours à la ligne.
     */
    const bloc = /^[|>][+-]?$/.test(valeur) ? valeur[0] : undefined;
    if (bloc) {
      const suite: string[] = [];
      let j = i + 1;
      for (; j < lignes.length; j += 1) {
        const prochaine = lignes[j];
        if (prochaine.trim() === '---') break;
        if (prochaine.trim() && !/^\s/.test(prochaine)) break;
        suite.push(prochaine.trim());
      }
      i = j - 1;
      valeur = suite.join(bloc === '>' ? ' ' : '\n').trim();
    } else {
      /*
       * LE SCALAIRE SIMPLE SUR PLUSIEURS LIGNES. `description:` seul, puis le
       * texte indenté dessous (ou une première ligne continuée en retrait) :
       * YAML le recolle par des espaces. Des bibliothèques publiques l'écrivent
       * ainsi (vercel-labs/agent-skills), et l'import les écartait « sans
       * description ». Un retrait qui ouvre une table (`  author: x`) ou une
       * liste (`  - x`) n'est pas une continuation : il reste ignoré.
       */
      const suite: string[] = [];
      let j = i + 1;
      for (; j < lignes.length; j += 1) {
        const prochaine = lignes[j];
        if (prochaine.trim() === '---' || !/^\s/.test(prochaine)) break;
        if (!suite.length && /^\s+(-\s|[\w-]+\s*:(\s|$))/.test(prochaine)) break;
        suite.push(prochaine.trim());
      }
      if (suite.length) {
        i = j - 1;
        valeur = [valeur, ...suite].filter(Boolean).join(' ').trim().replace(/^["']|["']$/g, '');
      }
    }
    if (!valeur) continue;
    entete.brut[cle] = valeur;
    if (cle === 'name') entete.nom = valeur;
    else if (cle === 'description') entete.description = valeur;
    else if (cle === 'etat' || cle === 'état') entete.etat = valeur;
    else if (cle === 'themes' || cle === 'thèmes') entete.themes = valeur;
    else if (cle === 'symptomes' || cle === 'symptômes') entete.symptomes = valeur;
    else if (cle === 'projets') entete.projets = valeur;
    else if (cle.startsWith('provenance-')) {
      entete.provenance = { ...(entete.provenance ?? {}), [cle.slice('provenance-'.length)]: valeur };
    }
  }
  return entete;
}

/** Une liste écrite en une ligne : « voix, publication ». Vide si rien. */
export function listeDEnTete(valeur?: string): string[] {
  if (!valeur) return [];
  return valeur
    .split(/[,;]/)
    .map((mot) => mot.trim())
    .filter(Boolean);
}

/** La provenance reconstruite depuis l'en-tête, sans rien inventer. */
export function provenanceDepuisEnTete(entete: EnTeteDeCompetence): ProvenanceDeFiche {
  const source = entete.provenance ?? {};
  const nombre = (brut?: string) => {
    const valeur = Number(brut);
    return Number.isFinite(valeur) && valeur > 0 ? valeur : undefined;
  };
  return {
    projet: source.projet,
    carte: source.carte,
    titre: source.titre,
    commit: source.commit,
    creeeLe: nombre(source.creeele ?? source['creee-le']),
    verifieeLe: nombre(source.verifieele ?? source['verifiee-le']),
    renforceePar: listeDEnTete(source.renforceepar ?? source['renforcee-par']),
    bibliotheque: source.bibliotheque,
    source: source.source,
    importeeLe: nombre(source.importeele ?? source['importee-le']),
  };
}

/* ------------------------------------------------------------------ */
/* LA QUALITÉ D'UNE FICHE                                              */
/* ------------------------------------------------------------------ */

/**
 * LES SECTIONS D'UNE FICHE, dans l'ordre où elles se lisent. Seule
 * « Vérification » est EXIGÉE : c'est elle qui distingue une procédure d'une
 * opinion — sans elle, personne ne peut savoir si la fiche marche encore.
 */
export const SECTIONS_DE_FICHE = [
  'Symptôme',
  'Cause',
  'Procédure',
  'Vérification',
  'Pièges',
  'Ce qui ne marche pas',
] as const;

/** La section sans laquelle une fiche n'est pas une procédure. */
export const SECTION_EXIGEE = 'Vérification';

/**
 * UNE DESCRIPTION DOIT DIRE QUAND S'EN SERVIR, pas seulement de quoi elle
 * parle : c'est ce mot-là que le moteur reconnaît pour déclencher la fiche. Une
 * description qui n'en porte aucun ne se déclenche jamais — elle dort.
 */
export const DECLENCHEURS = [
  'utiliser',
  'utilise',
  'dès que',
  'des que',
  'quand',
  'lorsque',
  'à utiliser',
  'use when',
  'when the user',
  'whenever',
  'trigger',
];

/** Longueur minimale d'une description : en dessous, elle ne dit rien d'utile. */
export const DESCRIPTION_MIN = 40;

/** Ce qu'on reproche à une fiche, avec la raison en clair. */
export interface JugementDeFiche {
  ok: boolean;
  raisons: string[];
}

/**
 * LE CONTRÔLE DE QUALITÉ D'UNE FICHE. Il s'applique à L'ÉCRITURE — la nuit, le
 * forçage, un dépôt à la main relu par l'écran —, JAMAIS à la lecture : les
 * quinze fiches écrites avant cette règle continuent d'être servies, avec leurs
 * anomalies affichées. Refuser à la lecture, c'était vider le pool le jour même
 * où on le remplit.
 */
export function jugerLaFiche(texte: string): JugementDeFiche {
  const raisons: string[] = [];
  const entete = enTeteDeCompetence(texte);
  if (!entete.nom) raisons.push("l'en-tête ne porte pas de « name »");
  const description = entete.description?.trim() ?? '';
  if (!description) raisons.push("l'en-tête ne porte pas de « description »");
  else {
    if (description.length < DESCRIPTION_MIN) {
      raisons.push(`la description est trop courte pour dire quand s'en servir (${description.length} signes)`);
    }
    if (!symptomeAnnonce(description, listeDEnTete(entete.symptomes))) {
      raisons.push('la description ne dit pas QUAND s\'en servir (aucun mot de déclenchement, aucun symptôme déclaré)');
    }
  }
  if (!sectionPresente(texte, SECTION_EXIGEE)) {
    raisons.push(`la fiche n'a pas de section « ${SECTION_EXIGEE} » : rien ne permet de savoir si elle marche encore`);
  }
  return { ok: raisons.length === 0, raisons };
}

/** Une fiche déjà en place : les mêmes reproches, mais elle reste servie. */
export function anomaliesDeLaFiche(texte: string): string[] {
  return jugerLaFiche(texte).raisons;
}

/** Un titre de section Markdown, quel que soit son niveau, accents compris. */
export function sectionPresente(texte: string, titre: string): boolean {
  const attendu = normaliserMot(titre);
  return texte
    .split(/\r?\n/)
    .some((ligne) => /^#{1,6}\s+/.test(ligne) && normaliserMot(ligne.replace(/^#{1,6}\s+/, '')).startsWith(attendu));
}

function normaliserMot(mot: string): string {
  return mot
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** La description annonce-t-elle un déclenchement, ou la fiche déclare-t-elle un symptôme ? */
export function symptomeAnnonce(description: string, symptomes: string[]): boolean {
  if (symptomes.length) return true;
  const texte = normaliserMot(description);
  return DECLENCHEURS.some((mot) => texte.includes(normaliserMot(mot)));
}

/* ------------------------------------------------------------------ */
/* LA LIAISON AUX COFFRES                                              */
/* ------------------------------------------------------------------ */

/**
 * Ce que le démon doit faire d'une compétence pour un coffre donné. `existant`
 * est le chemin RÉEL de ce qui occupe déjà la place (rien si la place est
 * libre) : comparer les chemins réels évite de reposer un lien sur lui-même, et
 * de piétiner une compétence que l'utilisateur a mise là à la main.
 */
export type GesteDeLiaison = 'lier' | 'deja-liee' | 'occupe';

export function gesteDeLiaison(source: string, existant?: string): GesteDeLiaison {
  if (!existant) return 'lier';
  return existant === source ? 'deja-liee' : 'occupe';
}

/* ------------------------------------------------------------------ */
/* CE QUI PART AU BRIEFING                                             */
/* ------------------------------------------------------------------ */

/** Le thème sous lequel ranger une fiche qui n'en déclare aucun. */
export const THEME_PAR_DEFAUT = 'divers';

/** Les fiches groupées par thème, thèmes triés, fiches triées dans chacun. */
export function grouperParTheme(liste: Competence[]): { theme: string; fiches: Competence[] }[] {
  const groupes = new Map<string, Competence[]>();
  for (const fiche of liste) {
    const themes = fiche.themes.length ? fiche.themes : [THEME_PAR_DEFAUT];
    for (const theme of themes) {
      const cle = theme.trim().toLowerCase() || THEME_PAR_DEFAUT;
      groupes.set(cle, [...(groupes.get(cle) ?? []), fiche]);
    }
  }
  return [...groupes]
    .map(([theme, fiches]) => ({
      theme,
      fiches: [...fiches].sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
    }))
    .sort((a, b) => a.theme.localeCompare(b.theme, 'fr'));
}

/**
 * LE BLOC ANNONCÉ DANS LE BRIEFING — UN SOMMAIRE, PLUS UNE ÉNUMÉRATION.
 *
 * L'ancien bloc écrivait une ligne par fiche, description entière comprise, à
 * CHAQUE tour de CHAQUE agent : avec une compétence c'était deux lignes, avec
 * quinze c'est une page, et le pool est fait pour grossir. Le briefing porte
 * donc les THÈMES et le nombre de fiches de chacun, plus le chemin des deux
 * fichiers d'entrée — le détail se lit à la demande, et la recherche remonte de
 * toute façon la bonne fiche quand la demande la concerne.
 *
 * Vide s'il n'y a aucune compétence : on n'envoie pas un titre pour ne rien dire.
 */
/**
 * EN DESSOUS DE TANT DE FICHES, ON NE TRIE PAS. Un pool de trois compétences
 * tient en deux lignes : le trier ferait courir le risque d'en cacher une utile
 * pour économiser cent signes. Le tri ne se déclenche que quand la liste pèse
 * vraiment — et c'est le sens du pool que de grossir.
 */
export const COMPETENCES_MINIMUM_POUR_FILTRER = 6;

/**
 * CE QUI FAIT QU'UNE FICHE PARLE D'UN TRAVAIL. Son nom, sa description, ses
 * symptômes et ses thèmes — jamais le corps du `SKILL.md`, qui n'est pas lu ici
 * et n'a pas à l'être : une fiche se déclenche sur sa TÊTE, c'est tout l'objet
 * de l'en-tête qu'elle porte.
 */
export function texteClassableDUneFiche(fiche: Competence): string {
  return [fiche.nom, fiche.description, ...fiche.symptomes, ...fiche.themes].join(' ');
}

/**
 * LES FICHES QUI TOUCHENT LE TRAVAIL DE LA CARTE, ET CELLES QUI N'EN PARLENT PAS.
 *
 * Même classement lexical que les règles (`classerRegles`) : les mots utiles de
 * la demande, cherchés dans la tête de chaque fiche. Aucune demande, ou aucune
 * fiche touchée, rend `retenues` vide — l'appelant sert alors la liste entière,
 * car rogner reviendrait à cacher le pool au lieu de l'annoncer.
 */
export function classerCompetences(
  liste: Competence[],
  travail: string,
): { retenues: Competence[]; ecartees: Competence[] } {
  const classees = classerRegles(liste.map(texteClassableDUneFiche), travail);
  const touchees = new Set(classees.map((regle) => regle.texte));
  const retenues = liste.filter((fiche) => touchees.has(texteClassableDUneFiche(fiche)));
  return { retenues, ecartees: liste.filter((fiche) => !retenues.includes(fiche)) };
}

/** Le sommaire par thème d'une liste de fiches — une ligne par thème. */
function lignesParTheme(liste: Competence[]): string {
  return grouperParTheme(liste)
    .map((groupe) => `- ${groupe.theme} (${groupe.fiches.length}) : ${groupe.fiches.map((f) => f.nom).join(', ')}`)
    .join('\n');
}

export function texteDesCompetences(
  liste: Competence[],
  dossier = '',
  travail = '',
  /**
   * LES FICHES JUGÉES UTILES PAR LE JUGE LOCAL (usage « pertinence-competences »),
   * par NOM. Quand elles sont données, elles remplacent le classement par les
   * mots — qui retenait presque tout, faute de distinguer « carte » de « carte
   * graphique ». Absent : le classement par les mots, comme avant.
   */
  pertinentes?: ReadonlySet<string>,
  /**
   * LE PROJET DE L'AGENT. Donné, il ne reçoit que les fiches communes et celles
   * de CE projet (`ficheServieAuProjet`), et apprend quand ce projet n'en a encore
   * aucune à lui — c'est à ce signe que le cadrage reconnaît un projet NEUF.
   * Absent (tests, scripts), le pool entier est annoncé, comme avant.
   */
  projet?: string,
): string {
  const enService = liste
    .filter((fiche) => ficheEnService(fiche.etat))
    .filter((fiche) => projet === undefined || ficheServieAuProjet(fiche, projet));
  // Les fiches de BIBLIOTHÈQUE ne sont pas annoncées : une ligne les COMPTE et
  // dit où les chercher, sans jamais les énumérer (`annonceeEnTeteDeSession`).
  const servies = enService.filter(annonceeEnTeteDeSession);
  const deBibliotheques = enService.length - servies.length;
  const ligneBibliotheques = deBibliotheques
    ? `\n${deBibliotheques} autre${deBibliotheques > 1 ? 's' : ''} compétence${deBibliotheques > 1 ? 's' : ''} ` +
      `vien${deBibliotheques > 1 ? 'nent' : 't'} de bibliothèques importées : elles ne sont pas listées ici, ` +
      `cherche-les avec l'outil « memoire » (geste « chercher »).`
    : '';
  /*
   * UN PROJET QUI N'A ENCORE RIEN APPRIS PAR ÉCRIT LE DIT. C'est le signe d'un
   * projet NEUF : son cadrage propose alors les compétences COMMUNES qui
   * conviennent à son genre (`CONSIGNE_CADRAGE`, `shared/src/cadrage.ts`).
   */
  const lignePropres =
    projet?.trim() && !servies.some((fiche) => !ficheCommune(fiche))
      ? `\n« ${projet.trim()} » n'a encore aucune compétence propre.`
      : '';
  if (!servies.length) return `${ligneBibliotheques}${lignePropres}`.trim();
  const portee = projet?.trim()
    ? `communes à tous les projets ou propres à « ${projet.trim()} »`
    : 'valables pour TOUS les projets';

  const entree = dossier
    ? `\nLe sommaire complet et l'index par symptôme sont dans ${dossier}/${FICHIER_SOMMAIRE} et ${dossier}/${FICHIER_INDEX_SYMPTOMES}.`
    : '';
  const consigne =
    `Dès qu'une demande entre dans le champ d'une compétence, OUVRE son mode d'emploi (le SKILL.md de son dossier) ` +
    `et suis-le : il dit quelle commande lancer et avec quels identifiants. Ne réponds jamais que tu ne sais pas faire ` +
    `ce qu'une compétence sait faire — et si tu ne fais pas le travail toi-même, nomme-la dans la carte que tu proposes.`;

  /*
   * LE POOL EST SERVI AU POIDS DE LA DEMANDE, COMME LES RÈGLES.
   *
   * Le sommaire par thème partait ENTIER dans le briefing de chaque agent : une
   * carte qui touche un bouton recevait la liste des quinze fiches — dessin,
   * comptabilité, navigateur — dont aucune ne parle de son travail. On NOMME
   * donc celles qui touchent la carte, et on COMPTE les autres en disant où les
   * lire. Sans carte (une conversation, le chef d'orchestre), rien ne change :
   * la liste entière part, comme avant.
   */
  const entier =
    `COMPÉTENCES PARTAGÉES (${servies.length}) — des modes d'emploi déjà écrits, ${portee}, ` +
    `rangés par thème :\n${lignesParTheme(servies)}\n${entree}${ligneBibliotheques}${lignePropres}\n${consigne}`;

  if (travail.trim() && servies.length >= COMPETENCES_MINIMUM_POUR_FILTRER) {
    const { retenues, ecartees } = pertinentes
      ? {
          retenues: servies.filter((fiche) => pertinentes.has(fiche.nom)),
          ecartees: servies.filter((fiche) => !pertinentes.has(fiche.nom)),
        }
      : classerCompetences(servies, travail);
    /* Le juge peut dire « aucune » : c'est une réponse, pas un silence. */
    if (pertinentes && !retenues.length && ecartees.length) {
      const aucune =
        `COMPÉTENCES PARTAGÉES (${servies.length} en tout) — des modes d'emploi déjà écrits, ${portee}. ` +
        `Aucune ne touche le travail de ta carte ; le sommaire les donne toutes si le travail change.\n${entree}${ligneBibliotheques}${lignePropres}\n${consigne}`;
      if (aucune.length < entier.length) return aucune;
    }
    if (retenues.length && ecartees.length) {
      const reste =
        `(${ecartees.length} autre${ecartees.length > 1 ? 's' : ''} compétence${ecartees.length > 1 ? 's' : ''} ` +
        `du pool ne parle${ecartees.length > 1 ? 'nt' : ''} pas du travail de ta carte et ne ${
          ecartees.length > 1 ? 'sont' : 'est'
        } pas listée${ecartees.length > 1 ? 's' : ''} ici — le sommaire les donne toutes.)`;
      const trie =
        `COMPÉTENCES PARTAGÉES (${servies.length} en tout) — des modes d'emploi déjà écrits, ${portee}. ` +
        `Celles qui touchent le travail de ta carte :\n${lignesParTheme(retenues)}\n${reste}\n${entree}${ligneBibliotheques}${lignePropres}\n${consigne}`;
      /*
       * UN TRI QUI COÛTE PLUS CHER QUE CE QU'IL CACHE N'EST PAS UN TRI. La
       * phrase qui COMPTE les fiches écartées pèse elle aussi ; sur un pool de
       * noms courts, elle peut peser plus que les noms retirés. On compare donc
       * les deux textes RÉELLEMENT construits et on garde le plus léger — et à
       * poids égal, la liste entière, qui en apprend plus.
       */
      if (trie.length < entier.length) return trie;
    }
  }

  return entier;
}

/* ------------------------------------------------------------------ */
/* SERVIR SANS PRIVILÈGE                                               */
/* ------------------------------------------------------------------ */

/**
 * CE QUE LE CLASSEMENT AJOUTE (OU RETIRE) À UN PASSAGE DE COMPÉTENCE.
 *
 * Le score de base ne connaît que le sens, les mots et le rang de la source. Une
 * compétence a deux qualités de plus, et elles sont MESURÉES : sa CONFIANCE
 * (montée à l'usage utile, descendue aux contradictions —
 * `shared/src/confiance-competence.ts`) et son APPLICABILITÉ au projet visé.
 *
 * L'ajustement est volontairement petit — de l'ordre du bonus de priorité — :
 * il DÉPARTAGE deux passages proches, il ne renverse pas un classement. Une
 * fiche dépréciée, elle, recule franchement : elle reste lisible, elle ne se
 * sert plus d'elle-même.
 */
export const POIDS_CONFIANCE = 0.06;
export const MALUS_DEPRECIEE = 0.15;

export function ajustementDeCompetence(options: {
  confiance: number;
  applicabilite: number;
  etat: EtatDeFiche;
}): number {
  // La confiance est centrée sur 0,5 : au-dessus elle aide, en dessous elle coûte.
  const confiance = POIDS_CONFIANCE * (options.confiance - 0.5) * 2;
  const applicabilite = POIDS_CONFIANCE * (options.applicabilite - 1);
  const depreciee = options.etat === 'depreciee' ? -MALUS_DEPRECIEE : 0;
  return confiance + applicabilite + depreciee;
}

/* ------------------------------------------------------------------ */
/* LES DATES D'UNE FICHE, LUES DANS L'HISTOIRE GIT DU POOL              */
/* ------------------------------------------------------------------ */

/** La première et la dernière fois qu'un enregistrement a touché une fiche (ms). */
export interface DatesDeFiche {
  premier: number;
  dernier: number;
}

/**
 * LE JOURNAL GIT DU POOL, LU EN UNE FOIS. Le démon lance UN SEUL
 * `git log --format=@@%ct --name-only` (jamais un appel par fiche : l'écran
 * des compétences s'ouvrirait en secondes) ; cette règle en tire, pour chaque
 * dossier de premier niveau, la date du premier et du dernier enregistrement
 * qui l'ont touché. Les fichiers posés à la racine (sommaire, index) ne
 * comptent pour aucune fiche.
 *
 * « Mise à jour » veut dire : le MODE D'EMPLOI a changé. Les compteurs d'usage
 * (servie, aidée…) vivent en base et ne passent jamais par ici.
 */
export function datesDesFichesDepuisGit(journal: string): Map<string, DatesDeFiche> {
  const dates = new Map<string, DatesDeFiche>();
  let instant: number | null = null;
  for (const brute of journal.split('\n')) {
    const ligne = brute.trim();
    if (!ligne) continue;
    if (ligne.startsWith('@@')) {
      const secondes = Number(ligne.slice(2));
      instant = Number.isFinite(secondes) && secondes > 0 ? secondes * 1000 : null;
      continue;
    }
    if (instant === null) continue;
    const coupure = ligne.indexOf('/');
    if (coupure <= 0) continue;
    const nom = ligne.slice(0, coupure);
    const connu = dates.get(nom);
    if (!connu) dates.set(nom, { premier: instant, dernier: instant });
    else {
      if (instant < connu.premier) connu.premier = instant;
      if (instant > connu.dernier) connu.dernier = instant;
    }
  }
  return dates;
}
