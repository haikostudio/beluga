/**
 * LES COMPÉTENCES QUI PARTENT AVEC LE CODE DE PRODUCTION — le tri, sans disque.
 *
 * Décision de l'utilisateur (14/10/2026) : les compétences d'INTERFACE — design,
 * composants, structure des sites, tableaux de bord, formulaires… — partent
 * avec le dépôt public, pour que toute installation en profite. Le tri se fait
 * PAR THÈME, avec un CONTRÔLE AUTOMATIQUE, jamais fiche par fiche à la main.
 *
 * UNE FICHE PART SI, ET SEULEMENT SI :
 *  - elle est commune (aucun champ `projets:`), active, écrite ici (pas importée
 *    d'une bibliothèque tierce, dont la licence n'est pas la nôtre), et ne
 *    décrit pas le fonctionnement interne de Beluga (nom en `beluga-`) ;
 *  - AU MOINS UN de ses thèmes est dans `THEMES_PUBLIES` et AUCUN dans
 *    `THEMES_PRIVES` (une fiche « interface + sécurité » reste privée) ;
 *  - aucun de ses fichiers ne porte un nom de projet ou de client, une adresse
 *    de ces projets, une adresse IP réelle, un courriel réel, un chemin
 *    personnel (`/root/`, `/home/`) ou quoi que ce soit qui ressemble à une clé.
 *
 * DANS LE DOUTE, ON RETIENT : chaque refus dit sa raison, et le script de
 * synchronisation (`scripts/synchroniser-miroir-public.mjs`) les affiche toutes.
 * Les lignes `provenance-*` (carte, projet, dates) ne partent jamais : elles
 * nomment le projet d'origine.
 */

export const THEMES_PUBLIES = [
  'interface',
  'design',
  'design-system',
  'composants',
  'structure',
  'navigation',
  'tableaux',
  'formulaires',
  'icones',
  'typographie',
  'chargement',
  'animation',
  'mouvement',
  'finition',
  'css',
] as const;

/** Un seul de ces thèmes garde la fiche privée, quels que soient les autres. */
export const THEMES_PRIVES = [
  'securite',
  'coffre',
  'authentification',
  'paiement',
  'stripe',
  'abonnements',
  'publication',
  'deploiement',
  'serveur',
  'beluga',
  'cartes',
  'agents',
  'quotas',
  'comptes',
  'outils',
  'donnees',
  'migration',
  'statistiques',
  'confidentialité',
] as const;

/** Le dossier du dépôt public qui porte les compétences publiées. */
export const DOSSIER_DES_COMPETENCES_PUBLIEES = 'competences';

export interface FicheACommuniquer {
  /** Le nom du dossier de la fiche. */
  nom: string;
  /** Le texte du `SKILL.md`. */
  texte: string;
  /** Les fichiers annexes TEXTE du dossier, chemin relatif → contenu. */
  annexes?: Record<string, string>;
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

const listeDesThemes = (valeur: string | undefined) =>
  (valeur ?? '')
    .split(',')
    .map((theme) => theme.trim().toLowerCase())
    .filter(Boolean);

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
  { nom: 'une clé d’API', expression: /\b(?:sk-[A-Za-z0-9_-]{16,}|sk_live_[A-Za-z0-9]{8,}|rk_live_[A-Za-z0-9]{8,}|re_[A-Za-z0-9]{16,})/g },
  { nom: 'un jeton GitHub', expression: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { nom: 'une clé AWS', expression: /\bAKIA[0-9A-Z]{16}\b/g },
  { nom: 'un jeton Slack', expression: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { nom: 'une clé privée', expression: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  {
    nom: 'un mot de passe écrit',
    expression: /\b(?:password|passwd|mot de passe|mdp|secret|token|api[_-]?key)\s*[:=]\s*["'`]?[^\s"'`<>{}()[\],;]{6,}/gi,
    // Une variable, un trou ou un exemple évident n'est pas un mot de passe.
    admis: (trouve) => /[:=]\s*["'`]?(\$|\{|<|process\.env|xxx|\.\.\.|…|exemple|example|changeme|motdepasse|secret$)/i.test(trouve),
  },
  { nom: 'une longue suite hexadécimale', expression: /\b[a-f0-9]{40,}\b/gi },
];

/**
 * LE VERDICT D'UNE FICHE. `nomsPrives` : les noms de projets et de clients, et
 * leurs adresses (domaines, dépôts), lus du côté privé par l'appelant — ils ne
 * sont jamais écrits dans ce fichier, qui part lui-même au public.
 */
export function jugerCompetence(fiche: FicheACommuniquer, nomsPrives: readonly string[]): VerdictDeCompetence {
  const champs = champsDeLaFiche(fiche.texte);
  const nom = champs.name || fiche.nom;
  if (!champs.name) return { publiee: false, raison: 'fiche sans en-tête lisible' };
  if (fiche.nom.startsWith('beluga-') || nom.startsWith('beluga-')) {
    return { publiee: false, raison: 'fonctionnement interne de Beluga (nom en « beluga- »)' };
  }
  if (champs['provenance-bibliotheque']) {
    return { publiee: false, raison: `importée d’une bibliothèque tierce (${champs['provenance-bibliotheque']}) : licence d’autrui` };
  }
  if (champs.projets) return { publiee: false, raison: 'fiche propre à un projet' };
  if (champs.etend) return { publiee: false, raison: 'nuance d’une fiche commune pour un projet' };
  if (champs.etat && champs.etat !== 'active') return { publiee: false, raison: `état « ${champs.etat} »` };

  const themes = listeDesThemes(champs.themes);
  const privee = themes.find((theme) => (THEMES_PRIVES as readonly string[]).includes(theme));
  if (privee) return { publiee: false, raison: `thème privé « ${privee} »` };
  const publie = themes.find((theme) => (THEMES_PUBLIES as readonly string[]).includes(theme));
  if (!publie) return { publiee: false, raison: themes.length ? `aucun thème publié (${themes.join(', ')})` : 'aucun thème' };

  const fichiers: [string, string][] = [['SKILL.md', texteAPublier(fiche.texte)], ...Object.entries(fiche.annexes ?? {})];
  const noms = [...new Set(nomsPrives.map((n) => n.trim()).filter((n) => n.length >= 3))];
  for (const [chemin, contenu] of fichiers) {
    for (const prive of noms) {
      const echappe = prive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      const trouve = new RegExp(`(?<![\\w-])${echappe}(?![\\w-])`, 'i').exec(contenu);
      if (trouve) return { publiee: false, raison: `${chemin} nomme un projet ou un client (« ${masquer(trouve[0])} »)` };
    }
    for (const motif of MOTIFS) {
      for (const trouve of contenu.matchAll(motif.expression)) {
        const valeur = trouve[0].trim();
        if (motif.admis?.(valeur)) continue;
        return { publiee: false, raison: `${chemin} porte ${motif.nom} (« ${masquer(valeur)} »)` };
      }
    }
  }
  return { publiee: true, raison: `thème « ${publie} », contrôle passé` };
}
