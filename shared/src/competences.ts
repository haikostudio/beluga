/**
 * LES COMPÉTENCES PARTAGÉES : un POOL de modes d'emploi, valable pour TOUS les
 * projets et TOUS les agents — HaikoDev compris.
 *
 * Une compétence (« skill ») est un DOSSIER portant un `SKILL.md` : un en-tête
 * qui dit son nom et à quoi elle sert, puis le mode d'emploi. Elles vivaient
 * dans le dossier personnel de l'utilisateur, donc nulle part pour les agents
 * lancés par HaikoDev — chaque compte de moteur a SON coffre, et un coffre neuf
 * n'a rien. Deux chemins, complémentaires, les rendent atteignables :
 *
 *   1. LE COFFRE. Claude Code lit les compétences de son dossier de
 *      configuration (`<coffre>/skills/<nom>`) : le démon y pose un lien vers
 *      chaque compétence partagée, sans jamais écraser ce qui s'y trouve.
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

/** Le nom du dossier de compétences dans le coffre d'un compte. */
export const NOM_DOSSIER_COMPETENCES = 'skills';

/** Le fichier qui fait d'un dossier une compétence : sa TÊTE. */
export const FICHIER_COMPETENCE = 'SKILL.md';

/**
 * Le préfixe des sources indexées du pool. Il ne dépend PAS de l'endroit où le
 * dossier vit sur le disque (`HAIKODEV_COMPETENCES` peut le déplacer) : c'est
 * un chemin d'AFFICHAGE, le même pour tous les projets, et c'est lui qui permet
 * de reconnaître un passage de compétence au moment de servir.
 */
export const PREFIXE_SOURCE_COMPETENCE = 'competences/';

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
   * Les projets auxquels elle s'applique. VIDE = tous : une leçon de plateforme
   * sert partout, c'est tout l'objet du pool.
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
 * Les clés de HaikoDev viennent EN PLUS et sont toutes facultatives : une fiche
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
export function texteDesCompetences(liste: Competence[], dossier = ''): string {
  const servies = liste.filter((fiche) => ficheEnService(fiche.etat));
  if (!servies.length) return '';
  const groupes = grouperParTheme(servies);
  const lignes = groupes.map((groupe) => {
    const noms = groupe.fiches.map((fiche) => fiche.nom).join(', ');
    return `- ${groupe.theme} (${groupe.fiches.length}) : ${noms}`;
  });
  const entree = dossier
    ? `\nLe sommaire complet et l'index par symptôme sont dans ${dossier}/${FICHIER_SOMMAIRE} et ${dossier}/${FICHIER_INDEX_SYMPTOMES}.`
    : '';
  return (
    `COMPÉTENCES PARTAGÉES (${servies.length}) — des modes d'emploi déjà écrits, valables pour TOUS les projets, ` +
    `rangés par thème :\n${lignes.join('\n')}\n${entree}\n` +
    `Dès qu'une demande entre dans le champ d'une compétence, OUVRE son mode d'emploi (le SKILL.md de son dossier) ` +
    `et suis-le : il dit quelle commande lancer et avec quels identifiants. Ne réponds jamais que tu ne sais pas faire ` +
    `ce qu'une compétence sait faire — et si tu ne fais pas le travail toi-même, nomme-la dans la carte que tu proposes.`
  );
}

/* ------------------------------------------------------------------ */
/* SERVIR SANS PRIVILÈGE                                               */
/* ------------------------------------------------------------------ */

/**
 * LA PART DU BUDGET QUE LES COMPÉTENCES ONT LE DROIT DE PRENDRE.
 *
 * Une compétence est une leçon d'AILLEURS : elle peut être la meilleure réponse,
 * elle ne doit jamais passer devant la documentation du projet PAR PRINCIPE
 * (limite posée par la carte). Même mécanique que la borne déjà en place pour le
 * code (`PART_MAX_DU_CODE`) : une part RÉSERVÉE — le pool a droit à sa place —
 * mais PLAFONNÉE — il ne prend pas celle des règles du projet.
 */
export const PART_MAX_DES_COMPETENCES = 0.25;

/** Un passage vient-il du pool ? Reconnu à sa SOURCE, jamais à sa priorité. */
export function estPassageDeCompetence(source: string): boolean {
  return source.startsWith(PREFIXE_SOURCE_COMPETENCE);
}

/** Le nom de la fiche dont vient un passage (`competences/compta/SKILL.md` → `compta`). */
export function nomDepuisLaSource(source: string): string | undefined {
  if (!estPassageDeCompetence(source)) return undefined;
  return source.slice(PREFIXE_SOURCE_COMPETENCE.length).split('/')[0] || undefined;
}

/**
 * L'APPLICABILITÉ d'une fiche à un projet. Une fiche qui ne nomme aucun projet
 * vaut partout (c'est le cas général : une leçon de plateforme) ; une fiche qui
 * en nomme et qui ne nomme pas celui-ci reste servie, mais de plus loin — elle
 * peut encore aider, elle n'a simplement pas été prouvée ici.
 */
export const APPLICABILITE_HORS_PORTEE = 0.4;

export function applicabiliteSurProjet(projets: string[], projet: string): number {
  if (!projets.length) return 1;
  const cible = normaliserMot(projet);
  return projets.some((nom) => normaliserMot(nom) === cible) ? 1 : APPLICABILITE_HORS_PORTEE;
}

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
