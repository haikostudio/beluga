/**
 * CE QUE DOIT CONTENIR LA DESCRIPTION D'UNE CARTE PROPOSÉE.
 *
 * Le défaut constaté : selon le moteur qui tient la conversation, la même
 * demande produisait tantôt une description complète, tantôt trois lignes qui
 * ne faisaient que reformuler la phrase de l'utilisateur. L'agent d'exécution
 * partait alors avec une consigne pauvre, et le travail rendu s'en ressentait.
 *
 * La réponse : l'exigence est posée ICI, dans une règle pure de HaikoDev, et
 * non dans le texte d'un briefing que chaque modèle interprète à sa façon. Une
 * description qui n'atteint pas la barre n'est pas affichée : l'outil la
 * REFUSE, avec le gabarit à suivre, et le chef la refait.
 *
 * Quatre parties, toujours les mêmes :
 *   - le CONSTAT de départ (ce que le projet fait aujourd'hui) ;
 *   - ce qui est ATTENDU (ce que le projet doit faire après) ;
 *   - les LIMITES à ne pas franchir ;
 *   - comment VÉRIFIER que c'est fait.
 *
 * Plus une preuve que le chef a REGARDÉ le projet avant de proposer : au moins
 * un repère concret (un fichier, une commande, un libellé vu à l'écran, une
 * règle existante citée). Sans ce repère, la description n'est qu'une
 * reformulation de la demande.
 *
 * Aucune base, aucun disque, aucun moteur : les tests rejouent tout.
 */

/** Le plancher : en dessous, la carte n'est pas exécutable seule. */
export const MIN_SIGNES_DESCRIPTION = 320;

/** Le plafond : au-dessus, ce n'est plus une carte, c'est un dossier. */
export const MAX_SIGNES_DESCRIPTION = 2400;

/** Les quatre parties attendues, dans l'ordre où elles se lisent. */
export const PARTIES_DESCRIPTION = ['constat', 'attendu', 'limites', 'verification'] as const;

export type PartieDescription = (typeof PARTIES_DESCRIPTION)[number];

/** Ce qui peut manquer à une description. */
export type ManqueDescription =
  | 'vide'
  | 'trop-courte'
  | 'trop-longue'
  | 'sans-repere'
  | PartieDescription;

export interface PartiesCarte {
  constat?: string;
  attendu?: string;
  limites?: string;
  verification?: string;
}

export interface VerdictDescription {
  /** Vrai quand la description peut être affichée telle quelle. */
  ok: boolean;
  /** Ce qui manque, dans l'ordre de lecture. Vide quand `ok`. */
  manques: ManqueDescription[];
  /** Le nombre de signes utiles, une fois les blancs resserrés. */
  signes: number;
  /** À rendre au moteur quand la proposition est refusée. Vide quand `ok`. */
  message: string;
}

/** Les intertitres écrits par HaikoDev, identiques d'un moteur à l'autre. */
export const INTERTITRES: Record<PartieDescription, string> = {
  constat: 'Constat',
  attendu: 'Attendu',
  limites: 'Limites',
  verification: 'Vérification',
};

/*
 * Les mots qui font reconnaître une partie. On reste tolérant sur la forme
 * (« ## Constat », « **Constat :** », « Ce qui est attendu ») parce que c'est
 * le CONTENU qu'on exige, pas une ponctuation ; mais on exige que la partie
 * soit ANNONCÉE, sans quoi elle n'existe pas pour celui qui lira la carte.
 */
const MARQUEURS: Record<PartieDescription, RegExp> = {
  constat: /(constat|aujourd'?hui|état actuel|ce qui se passe|situation actuelle)/i,
  attendu: /(attendu|ce qui est attendu|résultat attendu|objectif|ce que ça doit faire|à obtenir)/i,
  limites: /(limites?|à ne pas|ne pas toucher|hors sujet|périmètre|garde-fous?|interdits?)/i,
  verification: /(vérification|vérifier|contrôle|comment le voir|preuve|test)/i,
};

/** Une ligne qui annonce une partie : un intertitre, une puce ou un gras. */
function lignesDAnnonce(texte: string): string[] {
  return texte
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^(#{1,6}\s|[-*•]\s|\*\*|\d+[.)]\s)/.test(l) || /^[^.!?]{0,60}:/.test(l));
}

/** Les parties réellement annoncées dans un texte libre. */
export function partiesTrouvees(texte: string): Set<PartieDescription> {
  const annonces = lignesDAnnonce(texte);
  const trouvees = new Set<PartieDescription>();
  for (const partie of PARTIES_DESCRIPTION) {
    // Le marqueur doit apparaître dans une ligne d'ANNONCE : un « vérifier »
    // perdu au milieu d'un paragraphe ne fait pas une partie « Vérification ».
    if (annonces.some((ligne) => MARQUEURS[partie].test(ligne))) trouvees.add(partie);
  }
  return trouvees;
}

/*
 * Le repère concret : la preuve que le chef est allé voir. Un chemin de
 * fichier, une commande, un extrait de code ou un libellé cité entre
 * guillemets français — tout ce qu'on ne peut pas écrire sans avoir ouvert le
 * projet.
 */
const REPERES: RegExp[] = [
  /[\w./-]+\.(ts|tsx|js|jsx|mjs|cjs|md|json|css|scss|html|sql|sh|yml|yaml|py)\b/,
  /`[^`\n]{3,}`/,
  /«[^»\n]{3,}»/,
  /\b(npm|node|git|npx|curl|bash)\s+[a-z-]{2,}/i,
  /\b(colonne|fichier|dossier|fonction|table|route|bouton|onglet|composant)\s+«/i,
];

/** Vrai dès qu'un repère tiré du projet est cité. */
export function contientRepereConcret(texte: string): boolean {
  return REPERES.some((r) => r.test(texte));
}

/** Le nombre de signes utiles : les blancs en série ne comptent que pour un. */
export function signesUtiles(texte: string): number {
  return texte.replace(/\s+/g, ' ').trim().length;
}

/** Le gabarit rendu au moteur quand sa proposition est refusée. */
export const GABARIT_DESCRIPTION = [
  `Constat : ce que le projet fait aujourd'hui, vu de tes yeux — cite au moins un repère concret (un fichier, une commande, un libellé affiché, une règle existante).`,
  `Attendu : ce que le projet doit faire une fois la carte terminée.`,
  `Limites : ce qu'il ne faut pas toucher, ni élargir.`,
  `Vérification : comment savoir que c'est fait (contrôle à rejouer, écran à regarder).`,
].join('\n');

const LIBELLE_MANQUE: Record<ManqueDescription, string> = {
  vide: 'la description est vide ou réduite au titre',
  'trop-courte': `la description est trop courte pour être exécutée seule (moins de ${MIN_SIGNES_DESCRIPTION} signes)`,
  'trop-longue': `la description est un pavé (plus de ${MAX_SIGNES_DESCRIPTION} signes) : resserre-la`,
  'sans-repere':
    "aucun repère concret tiré du projet : cite un fichier, une commande, un libellé affiché ou une règle existante, au lieu de reformuler la demande",
  constat: 'le CONSTAT de départ manque',
  attendu: "ce qui est ATTENDU n'est pas dit",
  limites: 'les LIMITES à ne pas franchir manquent',
  verification: "la manière de VÉRIFIER que c'est fait manque",
};

/**
 * Le jugement, seul point d'entrée du démon. Il ne réécrit rien : il dit si la
 * description peut être affichée, et sinon ce qu'il faut y ajouter.
 */
export function jugerDescription(description: string | undefined | null): VerdictDescription {
  const texte = String(description ?? '').trim();
  const signes = signesUtiles(texte);
  const manques: ManqueDescription[] = [];

  if (!texte) {
    manques.push('vide');
  } else {
    if (signes < MIN_SIGNES_DESCRIPTION) manques.push('trop-courte');
    if (signes > MAX_SIGNES_DESCRIPTION) manques.push('trop-longue');
    const trouvees = partiesTrouvees(texte);
    for (const partie of PARTIES_DESCRIPTION) if (!trouvees.has(partie)) manques.push(partie);
    if (!contientRepereConcret(texte)) manques.push('sans-repere');
  }

  if (!manques.length) return { ok: true, manques: [], signes, message: '' };

  const message =
    'Proposition REFUSÉE — elle ne part pas dans la conversation tant que sa description ne tient pas debout.\n' +
    `Ce qui manque : ${manques.map((m) => LIBELLE_MANQUE[m]).join(' ; ')}.\n\n` +
    `Reprends l'outil avec une description bâtie ainsi (entre ${MIN_SIGNES_DESCRIPTION} et ${MAX_SIGNES_DESCRIPTION} signes, quatre parties annoncées) :\n` +
    GABARIT_DESCRIPTION +
    "\n\nVa REGARDER le projet avant de réécrire : une description qui ne fait que redire la demande de l'utilisateur sera refusée de nouveau.";

  return { ok: false, manques, signes, message };
}

/**
 * Assemble une description à partir des quatre parties, quand le moteur les
 * fournit séparément. La mise en forme appartient alors à HaikoDev, pas au
 * modèle : même carte, même allure, quel que soit le moteur.
 */
export function composerDescription(parties: PartiesCarte): string {
  return PARTIES_DESCRIPTION.map((partie) => {
    const contenu = String(parties[partie] ?? '').trim();
    return contenu ? `**${INTERTITRES[partie]}** : ${contenu}` : '';
  })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * La consigne posée dans le briefing du chef. Elle est UNIQUE : les deux
 * moteurs reçoivent mot pour mot le même texte.
 */
export const CONSIGNE_DESCRIPTION_CARTE =
  "CE QUE DOIT CONTENIR LA DESCRIPTION D'UNE CARTE QUE TU PROPOSES (imposé par HaikoDev, l'outil refuse le reste) :\n" +
  "quatre parties ANNONCÉES, chacune sur sa ligne — Constat (ce que le projet fait aujourd'hui), Attendu (ce qu'il doit faire), " +
  'Limites (ce qu’on ne touche pas), Vérification (comment savoir que c’est fait).\n' +
  `Longueur : entre ${MIN_SIGNES_DESCRIPTION} et ${MAX_SIGNES_DESCRIPTION} signes — assez pour être exécutée sans toi, jamais un pavé.\n` +
  "REGARDE LE PROJET AVANT DE PROPOSER : la description doit citer au moins un repère concret que tu as vu (un fichier, une commande, un libellé affiché, une règle existante). " +
  "Reformuler la demande de l'utilisateur ne suffit pas ; une proposition vide ou réduite au titre est refusée et t'est rendue à réécrire.";
