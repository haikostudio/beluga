/**
 * LE GABARIT D'UN RAPPORT DE TRAVAIL — la réponse finale d'un agent, rangée.
 *
 * Le cadrage se lit en TIMELINE VERTICALE : un rond, une icône, un trait qui
 * descend, et sous chaque étape ce qu'elle a produit. Une fois la tâche
 * lancée, cette forme disparaissait : le compte rendu final retombait dans le
 * rendu Markdown ordinaire, six titres empilés dans un long texte dense. La
 * structure changeait au milieu du travail, alors que c'est la MÊME carte.
 *
 * Ce module ne juge rien et n'invente rien : il RANGE le texte rendu par le
 * moteur en sections du gabarit (`REPORT_SECTIONS`, `templates.ts`), pour que
 * l'écran puisse les poser dans le même flux vertical. Il accepte les
 * écritures qu'un moteur emploie — « ## 1. Analyse », « ## Analyse »,
 * « **Analyse** » — et garde tel quel ce qui précède la première section.
 *
 * Règle pure : ni base, ni disque, ni réseau — donc rejouable seule
 * (`server/src/test/rapport-gabarit.test.ts`).
 */

import { aplatiCompact as aplati } from './mots.js';

/** Une section du rapport, telle que l'affichage la dessine. */
export interface SectionRangee {
  /** Repère stable, sans accent : « analyse », « ce-qui-est-fait »… */
  cle: CleDeSection;
  /** Le nom canonique de la section, quelle que soit la tournure employée. */
  nom: string;
  /** Son rang dans le fil affiché, à partir de 1. */
  numero: number;
  /** Ce qu'il y a sous son titre, Markdown compris, sans le titre lui-même. */
  corps: string;
}

/** Un rapport rangé selon le gabarit. */
export interface RapportRange {
  /** Ce qui précède la première section — une ligne d'en-tête, le plus souvent. */
  entete: string;
  /** Les sections trouvées, dans l'ordre du gabarit. */
  sections: SectionRangee[];
  /** Le gabarit est-il tenu, c'est-à-dire assez de sections pour faire un fil ? */
  conforme: boolean;
}

/** Les clés des sections du gabarit, dans l'ordre. */
export const CLES_DU_RAPPORT = [
  'analyse',
  'ce-qui-est-fait',
  'consequences',
  'impact',
  'evolutions',
  'couts',
] as const;

export type CleDeSection = (typeof CLES_DU_RAPPORT)[number];

/**
 * Les sections du gabarit et les intitulés qui les ouvrent. Un moteur écrit
 * « Coûts » ou « Coût », « Évolutions possibles » ou « Évolutions » : on
 * reconnaît le DÉBUT du titre aplati, jamais une égalité stricte.
 */
const SECTIONS: { cle: CleDeSection; nom: string; intitules: string[] }[] = [
  { cle: 'analyse', nom: 'Analyse', intitules: ['analyse'] },
  { cle: 'ce-qui-est-fait', nom: 'Ce qui est fait', intitules: ['ce qui est fait', 'ce qui a ete fait'] },
  { cle: 'consequences', nom: 'Conséquences', intitules: ['consequences'] },
  { cle: 'impact', nom: 'Impact', intitules: ['impact'] },
  { cle: 'evolutions', nom: 'Évolutions possibles', intitules: ['evolutions possibles', 'evolutions'] },
  { cle: 'couts', nom: 'Coûts', intitules: ['couts', 'cout'] },
];

/**
 * DEUX SECTIONS SUFFISENT À FAIRE UN FIL. Le gabarit complet en compte six,
 * mais une réponse d'ampleur moyenne n'en porte que trois, et il n'y a aucune
 * raison de lui refuser la même mise en page.
 */
const MINIMUM_DE_SECTIONS = 2;

/** L'habillage d'une ligne de titre, retiré : dièses, numéro, gras, deux-points. */
function titreNu(ligne: string): string {
  return ligne
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\d+[.)]\s*/, '')
    .replace(/^\*\*(.*?)\*\*\s*:?\s*$/, '$1')
    .replace(/^\*\*/, '')
    .replace(/\*\*$/, '')
    .replace(/\s*:\s*$/, '')
    .trim();
}

/**
 * LA SECTION QU'UNE LIGNE OUVRE, s'il y en a une. La ligne doit être un TITRE
 * — dièses ou ligne toute en gras — et ne rien dire d'autre : « Analyse du
 * fichier trouvée » n'ouvre rien, c'est une phrase.
 */
export function sectionOuvertePar(ligne: string): { cle: CleDeSection; nom: string } | null {
  const nue = (ligne ?? '').trim();
  if (!nue) return null;
  const estTitreMarkdown = /^#{1,6}\s+\S/.test(nue);
  const estLigneGrasse = /^\*\*[^*]+\*\*\s*:?\s*$/.test(nue);
  if (!estTitreMarkdown && !estLigneGrasse) return null;

  const candidat = aplati(titreNu(nue));
  if (!candidat || candidat.length > 60) return null;
  const trouvee = SECTIONS.find((section) =>
    section.intitules.some((attendu) => candidat === attendu || candidat.startsWith(`${attendu} `)),
  );
  return trouvee ? { cle: trouvee.cle, nom: trouvee.nom } : null;
}

/**
 * LE RAPPORT, RANGÉ. Une seule lecture du texte : chaque ligne appartient à la
 * section ouverte la plus récente, ou à l'en-tête tant qu'aucune ne l'est.
 */
export function rangerLeRapport(texte: string): RapportRange {
  const lignes = (texte ?? '').split('\n');
  const entete: string[] = [];
  const corps = new Map<CleDeSection, string[]>();
  let courante: CleDeSection | null = null;

  for (const ligne of lignes) {
    const ouverte = sectionOuvertePar(ligne);
    if (ouverte) {
      // Une section citée deux fois reprend la même : la seconde moitié du
      // texte n'écrase jamais la première.
      if (!corps.has(ouverte.cle)) corps.set(ouverte.cle, []);
      courante = ouverte.cle;
      continue;
    }
    if (courante) corps.get(courante)!.push(ligne);
    else entete.push(ligne);
  }

  const sections: SectionRangee[] = [];
  for (const section of SECTIONS) {
    const contenu = corps.get(section.cle);
    if (contenu === undefined) continue;
    sections.push({
      cle: section.cle,
      nom: section.nom,
      numero: sections.length + 1,
      corps: contenu.join('\n').trim(),
    });
  }

  return {
    entete: entete.join('\n').trim(),
    sections,
    conforme: sections.length >= MINIMUM_DE_SECTIONS,
  };
}
