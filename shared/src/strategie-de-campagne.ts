/**
 * LA STRATÉGIE D'UNE CAMPAGNE, BÂTIE AVEC SON AGENT (carte « Suppression de campagne et menu nettoyé », 10/11/2026).
 *
 * Décision de l'utilisateur : une campagne se conçoit en CONVERSATION avec un agent spécialiste, qui pose ses
 * questions une à une jusqu'à une STRATÉGIE COMPLÈTE — les huit points de la fiche (`fiche-de-campagne.ts`), puis
 * l'idée et l'objectif business, le parcours du client, plusieurs angles à tester, la concurrence, les preuves à
 * montrer, un budget de publicité RECOMMANDÉ (rien ne se paie) et des indicateurs semaine par semaine.
 *
 * Chaque rubrique est un TEXTE (Markdown court) écrit par l'agent avec l'outil « communication », action
 * « campagne », champ « strategie » : une rubrique donnée remplace l'ancienne, les autres restent. Le volet de la
 * page de la campagne les lit EN LECTURE SEULE ; l'outil refuse de préparer des publications tant qu'une rubrique
 * manque pour une campagne menée par son agent (`refusStrategieIncomplete`).
 */

/** Les rubriques de la stratégie, dans l'ordre des questions de l'agent. */
export const RUBRIQUES_DE_STRATEGIE = ['idee', 'parcours', 'angles', 'concurrence', 'preuves', 'budget', 'indicateurs'] as const;
export type RubriqueDeStrategie = (typeof RUBRIQUES_DE_STRATEGIE)[number];

/** Le libellé de chaque rubrique, tel que le volet et l'agent le disent. */
export const LIBELLES_DE_STRATEGIE: Record<RubriqueDeStrategie, string> = {
  idee: 'Idée et objectif business',
  parcours: 'Parcours du client',
  angles: 'Angles à tester',
  concurrence: 'Concurrence',
  preuves: 'Preuves à montrer',
  budget: 'Budget de publicité recommandé',
  indicateurs: 'Indicateurs semaine par semaine',
};

/** Ce que chaque rubrique doit contenir : dit à l'agent dans sa consigne et dans le schéma de son outil. */
export const CONTENU_DES_RUBRIQUES: Record<RubriqueDeStrategie, string> = {
  idee: 'l’idée de la campagne et ce qu’elle doit rapporter à l’entreprise',
  parcours: 'découverte, considération, passage à l’acte : ce que la cible voit et fait à chaque étape',
  angles: 'deux ou trois angles à tester l’un contre l’autre, chacun avec son hypothèse et l’indicateur qui dira lequel gagne',
  concurrence: 'les concurrents qui parlent à la même cible et ce qui distingue la marque',
  preuves: 'chiffres, témoignages, démonstrations à montrer',
  budget: 'le budget de publicité conseillé et sa répartition — une RECOMMANDATION, rien ne se paie ici ; « aucun » est une réponse valable',
  indicateurs: 'ce qu’on regarde chaque semaine et le chiffre visé',
};

export type StrategieDeCampagne = Partial<Record<RubriqueDeStrategie, string>>;

/** Une rubrique est-elle une des sept ? */
export function estRubriqueDeStrategie(x: unknown): x is RubriqueDeStrategie {
  return typeof x === 'string' && (RUBRIQUES_DE_STRATEGIE as readonly string[]).includes(x);
}

/** La stratégie lue depuis la base (JSON), nettoyée : seulement les sept rubriques, des textes non vides. */
export function lireStrategie(brut: unknown): StrategieDeCampagne {
  let v: unknown = brut;
  if (typeof brut === 'string') {
    try {
      v = JSON.parse(brut || '{}');
    } catch {
      return {};
    }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const lue: StrategieDeCampagne = {};
  for (const r of RUBRIQUES_DE_STRATEGIE) {
    const texte = (v as Record<string, unknown>)[r];
    if (typeof texte === 'string' && texte.trim()) lue[r] = texte.trim().slice(0, 4000);
  }
  return lue;
}

/**
 * FUSIONNER UNE ÉCRITURE DE L'AGENT : chaque rubrique donnée remplace l'ancienne ; une rubrique donnée vide (ou `null`)
 * est effacée ; une clé inconnue est ignorée. Un objet absent ne change rien.
 */
export function fusionnerStrategie(avant: StrategieDeCampagne, entree: unknown): StrategieDeCampagne {
  if (!entree || typeof entree !== 'object' || Array.isArray(entree)) return { ...avant };
  const apres: StrategieDeCampagne = { ...avant };
  for (const [cle, valeur] of Object.entries(entree as Record<string, unknown>)) {
    if (!estRubriqueDeStrategie(cle)) continue;
    const texte = typeof valeur === 'string' ? valeur.trim().slice(0, 4000) : '';
    if (texte) apres[cle] = texte;
    else delete apres[cle];
  }
  return apres;
}

/** Les rubriques encore à trancher, dans l'ordre des questions. */
export function rubriquesManquantes(s: StrategieDeCampagne): RubriqueDeStrategie[] {
  return RUBRIQUES_DE_STRATEGIE.filter((r) => !s[r]?.trim());
}

/** La phrase de refus de l'outil tant que la stratégie n'est pas complète. */
export function refusStrategieIncomplete(titre: string, manquantes: readonly RubriqueDeStrategie[]): string {
  return `La stratégie de la campagne « ${titre} » n'est pas complète : il manque ${manquantes.map((r) => LIBELLES_DE_STRATEGIE[r].toLowerCase()).join(', ')}. Pose ces questions à la personne avec ask_user, une à la fois, ton conseil en premier « (recommandé) », et enregistre chaque réponse avec l'action « campagne », champ « strategie », avant de préparer la moindre publication.`;
}

/** La durée de la corbeille des campagnes : celle des médias (décision de l'utilisateur, 10/11/2026). */
export const DUREE_DE_LA_CORBEILLE_DES_CAMPAGNES_MS = 30 * 24 * 3600_000;

/** Ce qu'une suppression a emporté : de quoi tout rendre à la restauration. */
export interface SuppressionDeCampagne {
  medias: string[];
  contenus: { id: string; etape: string }[];
}

export function lireSuppression(brut: unknown): SuppressionDeCampagne {
  try {
    const v = typeof brut === 'string' ? JSON.parse(brut) : brut;
    const medias = Array.isArray(v?.medias) ? v.medias.filter((x: unknown): x is string => typeof x === 'string') : [];
    const contenus = Array.isArray(v?.contenus)
      ? v.contenus.filter((x: any) => x && typeof x.id === 'string' && typeof x.etape === 'string').map((x: any) => ({ id: x.id, etape: x.etape }))
      : [];
    return { medias, contenus };
  } catch {
    return { medias: [], contenus: [] };
  }
}

/**
 * UNE PUBLICATION ANNULÉE PAR LA SUPPRESSION SE RÉTABLIT-ELLE ? Seulement si elle est encore à venir (ou sans date) et
 * toujours abandonnée : une date passée reste annulée, une publication touchée depuis ne se réécrit pas.
 */
export function publicationARetablir(p: { etape: string; datePrevue?: string | null }, aujourdhui: string): boolean {
  if (p.etape !== 'abandonne') return false;
  return !p.datePrevue || p.datePrevue >= aujourdhui;
}

/** Les étapes d'une publication qu'une suppression de campagne annule : ni partie, ni déjà abandonnée. */
export function publicationAAnnuler(etape: string): boolean {
  return etape !== 'publie' && etape !== 'abandonne';
}

/**
 * LE TITRE PROVISOIRE d'une campagne née d'un premier message : sa première phrase, raccourcie. L'agent la renomme
 * dès que l'idée est claire (action « campagne », champ « titre »).
 */
export function titreProvisoireDeCampagne(texte: string): string {
  const net = texte.replace(/\[fichier:[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  const phrase = net.split(/(?<=[.!?])\s/)[0] ?? net;
  if (!phrase) return 'Nouvelle campagne';
  return phrase.length > 60 ? `${phrase.slice(0, 57).replace(/\s+\S*$/, '')}…` : phrase.replace(/[.!?]+$/, '');
}
