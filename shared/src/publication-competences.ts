/**
 * LES COMPÉTENCES QUI PARTENT AVEC LE CODE DE PRODUCTION — le tri, sans disque.
 *
 * Décision de l'utilisateur (23/11/2026, carte « Élargir le dépôt public ») :
 * TOUTES les compétences génériques partent — fonctionnement de Beluga,
 * cahier des charges, marketing, sécurité compris. La liste blanche de thèmes
 * du 14/10/2026 est abandonnée. UNE FICHE PART, SAUF SI :
 *  - elle vient de Philippe Pitton / Digital Tales (licence commerciale de son
 *    auteur) : bibliothèque `digital-tales-*`, `brain.manifest.json`, ou une
 *    LICENSE qui le nomme — JAMAIS publiée ;
 *  - elle est NÉE D'UN PROJET autre que l'application elle-même : champ
 *    `projets:` ou `provenance-projet:` qui ne vaut pas `PROJET_DE_L_APPLICATION`,
 *    ou fiche qui nuance une commune pour un projet (`etend:`) ;
 *  - elle vient d'une bibliothèque tierce dont la licence n'est pas dans
 *    `LICENCES_REDISTRIBUABLES` (licence lue une fois, rangée dans un tableau
 *    versionné côté privé, jamais devinée à l'envoi) ;
 *  - elle n'est pas active ;
 *  - un de ses fichiers porte un nom de projet ou de client, une adresse IP
 *    réelle, un courriel réel, un chemin personnel ou une clé.
 *
 * DANS LE DOUTE, ON RETIENT : chaque refus dit sa raison. Les lignes
 * `provenance-*` ne partent jamais.
 */

/** Le projet qui EST l'application : ses fiches sont le mode d'emploi de Beluga, elles partent. */
export const PROJET_DE_L_APPLICATION = 'Beluga';

/** Les licences qui permettent de republier, avec attribution. */
export const LICENCES_REDISTRIBUABLES = [
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'CC0-1.0',
  'CC-BY-4.0',
  'Unlicense',
  '0BSD',
  'AGPL-3.0',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
] as const;

/** La famille de l'auteur dont les fiches ne partent jamais (Philippe Pitton, Digital Tales). */
const AUTEUR_RESERVE = /philippe\s+pitton|digital[\s-]+tales/i;

export interface LicenceDeBibliotheque {
  /** Identifiant SPDX lu sur le dépôt d'origine, ou `AUCUNE`. */
  licence: string;
  /** Adresse du dépôt d'origine. */
  source?: string;
}

export interface OptionsDuTri {
  /** Bibliothèque (nom du pool) → sa licence. Absente = retenue. */
  licences?: Readonly<Record<string, LicenceDeBibliotheque>>;
}

/** Le dossier du dépôt public qui porte les compétences publiées. */
export const DOSSIER_DES_COMPETENCES_PUBLIEES = 'competences';

export interface FicheACommuniquer {
  /** Le nom du dossier de la fiche. */
  nom: string;
  /** Le texte du `SKILL.md`. */
  texte: string;
  /** Les fichiers annexes TEXTE du dossier, chemin relatif → contenu. */
  annexes?: Record<string, string>;
  /** Les noms de TOUS les fichiers du dossier, cachés et binaires compris. */
  fichiers?: readonly string[];
}

export interface VerdictDeCompetence {
  publiee: boolean;
  /** Pourquoi elle part, ou pourquoi elle reste — toujours dite. */
  raison: string;
}

/** Les champs `clé: valeur` du front-matter (première valeur seulement). */
export function champsDeLaFiche(texte: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(texte);
  const champs: Record<string, string> = {};
  if (!m) return champs;
  for (const ligne of m[1].split(/\r?\n/)) {
    const c = /^([a-zA-Z][\w-]*):\s*(.*)$/.exec(ligne);
    if (c && !(c[1] in champs)) champs[c[1]] = c[2].trim().replace(/^["']|["']$/g, '');
  }
  return champs;
}

/** Le texte publié : le front-matter sans ses lignes de provenance. */
export function texteAPublier(texte: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(texte);
  if (!m) return texte;
  const tete = m[1]
    .split(/\r?\n/)
    .filter((ligne) => !/^provenance-[\w-]*:/.test(ligne))
    .join('\n');
  return `---\n${tete}\n---${texte.slice(m[0].length)}`;
}

/** Le motif entier, masqué au milieu : un refus ne recopie pas ce qu'il retient. */
function masquer(trouve: string): string {
  if (trouve.length <= 6) return `${trouve.slice(0, 1)}…`;
  return `${trouve.slice(0, 3)}…${trouve.slice(-2)}`;
}

const DOMAINES_D_EXEMPLE = /(^|\.)(exemple|example)\.(com|org|net|fr)$|(^|\.)localhost$|\.(example|test|invalid|local)$/i;

interface Motif {
  nom: string;
  expression: RegExp;
  /** Une occurrence à laisser passer (adresse de documentation, exemple). */
  admis?: (trouve: string) => boolean;
  /** Un FORMAT de clé reconnaissable entre mille (et non une trace qui pourrait être anodine). */
  cle?: true;
}

const MOTIFS: Motif[] = [
  {
    nom: 'une adresse IP',
    expression: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    admis: (ip) =>
      /^(127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|255\.)/.test(ip) ||
      ip.split('.').some((n) => Number(n) > 255),
  },
  {
    nom: 'une adresse de courriel',
    expression: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g,
    admis: (adresse) => DOMAINES_D_EXEMPLE.test(adresse.split('@')[1] ?? '') || /^(git|noreply|no-reply)@/i.test(adresse),
  },
  { nom: 'un chemin personnel', expression: /(?:^|[\s"'`(=:])\/(?:root|home\/[\w.-]+)\//gm },
  { nom: 'une clé d’API', expression: /\b(?:sk-[A-Za-z0-9_-]{16,}|sk_live_[A-Za-z0-9]{8,}|rk_live_[A-Za-z0-9]{8,}|re_[A-Za-z0-9]{16,})/g, cle: true },
  { nom: 'un jeton GitHub', expression: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, cle: true },
  { nom: 'une clé AWS', expression: /\bAKIA[0-9A-Z]{16}\b/g, cle: true },
  { nom: 'un jeton Slack', expression: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, cle: true },
  { nom: 'une clé privée', expression: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, cle: true },
  {
    nom: 'un mot de passe écrit',
    expression: /\b(?:password|passwd|mot de passe|mdp|secret|token|api[_-]?key)\s*[:=]\s*["'`]?[^\s"'`<>{}()[\],;]{6,}/gi,
    // Une variable, un trou ou un exemple évident n'est pas un mot de passe.
    admis: (trouve) => /[:=]\s*["'`]?(\$|\{|<|process\.env|xxx|\.\.\.|…|exemple|example|changeme|motdepasse|secret$)/i.test(trouve),
  },
  { nom: 'une longue suite hexadécimale', expression: /\b[a-f0-9]{40,}\b/gi },
];

/**
 * LE FILTRE DE CONTENU, PARTAGÉ : le tri du dépôt public ET celui du lot des
 * serveurs clients (`lot-competences-clients.ts`) passent par lui, pour que les
 * deux ne divergent jamais. Rend la raison du PREMIER refus (nom de projet ou
 * de client, puis un des MOTIFS), ou `null` si tous les fichiers sont propres.
 * Ne jamais l'assouplir pour l'un sans l'autre.
 */
export function premierePieceSensible(
  fichiers: readonly (readonly [string, string])[],
  nomsPrives: readonly string[],
  options: {
    /**
     * Un nom collé à un signe de CODE (`:root`, `/brain/`, `.root`, `$root`)
     * n'est pas un nom de projet : il est ignoré. Réservé au lot des serveurs
     * clients — le dépôt public garde la lecture stricte.
     */
    bordsDeCode?: boolean;
    /**
     * `cles` : seuls les FORMATS de clé (sk-, ghp_, AKIA, xox, clé privée)
     * comptent parmi les MOTIFS. Pour le contenu d'un TIERS (bibliothèque
     * protégée), où une adresse, une empreinte ou un « mot de passe : 12
     * caractères » ne sont pas des traces de l'auteur. Les noms privés,
     * eux, comptent toujours.
     */
    motifs?: 'tous' | 'cles';
  } = {},
): string | null {
  const noms = [...new Set(nomsPrives.map((n) => n.trim()).filter((n) => n.length >= 3))];
  const avant = options.bordsDeCode ? '(?<![\\w\\-:/.$@#])' : '(?<![\\w-])';
  const apres = options.bordsDeCode ? '(?![\\w\\-/(])' : '(?![\\w-])';
  const expressions = noms.map((prive) => {
    const echappe = prive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`${avant}${echappe}${apres}`, 'i');
  });
  for (const [chemin, contenu] of fichiers) {
    for (const expression of expressions) {
      const trouve = expression.exec(contenu);
      if (trouve) return `${chemin} nomme un projet ou un client (« ${masquer(trouve[0])} »)`;
    }
    for (const motif of MOTIFS) {
      if (options.motifs === 'cles' && !motif.cle) continue;
      for (const trouve of contenu.matchAll(motif.expression)) {
        const valeur = trouve[0].trim();
        if (motif.admis?.(valeur)) continue;
        return `${chemin} porte ${motif.nom} (« ${masquer(valeur)} »)`;
      }
    }
  }
  return null;
}

/**
 * LE VERDICT D'UNE FICHE. `nomsPrives` : les noms de projets et de clients, et
 * leurs adresses (domaines, dépôts), lus du côté privé par l'appelant — ils ne
 * sont jamais écrits dans ce fichier, qui part lui-même au public.
 */
export function jugerCompetence(
  fiche: FicheACommuniquer,
  nomsPrives: readonly string[],
  options: OptionsDuTri = {},
): VerdictDeCompetence {
  const champs = champsDeLaFiche(fiche.texte);
  if (!champs.name) return { publiee: false, raison: 'fiche sans en-tête lisible' };
  const bibliotheque = champs['provenance-bibliotheque'];
  const licenceLocale = Object.entries(fiche.annexes ?? {}).find(([chemin]) => /^licen[cs]e/i.test(chemin.split('/').pop() ?? ''));
  if (
    (bibliotheque && /^digital-tales/i.test(bibliotheque)) ||
    (fiche.fichiers ?? []).some((f) => f === 'brain.manifest.json' || f === '.forge-brain-upgrade.json') ||
    (licenceLocale && AUTEUR_RESERVE.test(licenceLocale[1])) ||
    AUTEUR_RESERVE.test(champs.licence ?? '')
  ) {
    return { publiee: false, raison: 'licence commerciale de son auteur (Philippe Pitton, Digital Tales)' };
  }
  if (champs.projets) {
    const projets = champs.projets.split(',').map((p) => p.trim()).filter(Boolean);
    if (projets.some((p) => p !== PROJET_DE_L_APPLICATION)) return { publiee: false, raison: 'fiche propre à un projet' };
  }
  const origine = champs['provenance-projet'];
  if (origine && origine !== PROJET_DE_L_APPLICATION) return { publiee: false, raison: 'née d’un projet client ou personnel' };
  if (champs.etend) return { publiee: false, raison: 'nuance d’une fiche commune pour un projet' };
  if (champs.etat && champs.etat !== 'active') return { publiee: false, raison: `état « ${champs.etat} »` };

  let raison = 'fiche générique, contrôle passé';
  if (bibliotheque) {
    const licence = options.licences?.[bibliotheque]?.licence;
    if (!licence) return { publiee: false, raison: `bibliothèque tierce (${bibliotheque}) : licence non relevée` };
    if (!(LICENCES_REDISTRIBUABLES as readonly string[]).includes(licence)) {
      return { publiee: false, raison: `bibliothèque tierce (${bibliotheque}) : licence ${licence}, lien seulement` };
    }
    raison = `bibliothèque tierce (${bibliotheque}) sous ${licence}, contrôle passé`;
  }

  const fichiers: [string, string][] = [['SKILL.md', texteAPublier(fiche.texte)], ...Object.entries(fiche.annexes ?? {})];
  const sensible = premierePieceSensible(fichiers, nomsPrives);
  if (sensible) return { publiee: false, raison: sensible };
  return { publiee: true, raison };
}
