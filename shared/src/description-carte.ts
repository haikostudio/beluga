/**
 * CE QUE DOIT CONTENIR LA DESCRIPTION D'UNE CARTE PROPOSÉE.
 *
 * Le défaut constaté : selon le moteur qui tient la conversation, la même
 * demande produisait tantôt une description complète, tantôt trois lignes qui
 * ne faisaient que reformuler la phrase de l'utilisateur. L'agent d'exécution
 * partait alors avec une consigne pauvre, et le travail rendu s'en ressentait.
 *
 * La réponse : l'exigence est posée ICI, dans une règle pure de Beluga Build, et
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
 * DEUX EXIGENCES, depuis que le chef d'orchestre ne fait plus que trier. Une
 * carte qu'il propose n'est plus le fruit d'une étude : il n'ouvre plus le
 * projet, l'analyse est faite APRÈS validation, par la carte elle-même. Lui
 * réclamer quatre parties et un repère concret revenait à lui faire inventer un
 * constat qu'il n'avait pas vérifié — le contraire de ce qu'on veut. Sa carte
 * est donc jugée « courte » : un titre et la demande REFORMULÉE, assez pour que
 * l'utilisateur reconnaisse ce qu'il a demandé avant de cliquer. L'exigence
 * « complète » (quatre parties, repère concret) reste la référence pour une
 * description écrite après une vraie étude.
 *
 * Aucune base, aucun disque, aucun moteur : les tests rejouent tout.
 */

import { MAX_SIGNES_TITRE } from './titre-carte.js';

/** Le plancher : en dessous, la carte n'est pas exécutable seule. */
export const MIN_SIGNES_DESCRIPTION = 320;

/**
 * Le plancher d'une carte de TRI : une phrase reformulée, pas un mot. En
 * dessous, l'utilisateur ne reconnaît pas sa demande dans la carte qu'on lui
 * présente.
 */
export const MIN_SIGNES_CARTE_COURTE = 80;

/**
 * Ce qu'on exige de la description : « complete » après une étude,
 * « courte » pour une carte de tri proposée par le chef d'orchestre.
 */
export type ExigenceDescription = 'complete' | 'courte';

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
  | 'renvoi-au-fil'
  | PartieDescription;

export interface PartiesCarte {
  /**
   * Une ou deux phrases simples et ludiques, SANS jargon ni nom de fichier,
   * qui disent en langage courant ce que la carte va changer et pourquoi —
   * avant le détail technique. Affichée telle quelle, sans intertitre, en
   * tête de la description composée.
   */
  intro?: string;
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

/** Les intertitres écrits par Beluga Build, identiques d'un moteur à l'autre. */
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

/*
 * LE RENVOI AU FIL : une carte qui ne dit pas son sujet.
 *
 * Le chef d'orchestre a la conversation sous les yeux ; l'agent qui exécutera
 * la carte, LUI, ne l'a pas — il ne reçoit que le titre et la description. Une
 * carte qui dit « corriger ce qui a été discuté » ou « voir la conversation »
 * part donc vers quelqu'un pour qui ces mots ne désignent rien. Ces tournures
 * sont refusées telles quelles : le sujet se nomme en toutes lettres.
 *
 * La liste est VOLONTAIREMENT étroite — seulement des renvois qui n'ont aucun
 * sens hors du fil. Un « comme prévu » ou un « voir plus bas » ordinaire passe.
 */
const RENVOIS_AU_FIL: RegExp[] = [
  // « ce qui a été discuté », « celui dont on a parlé », « ce qu'on vient de dire »
  /\b(?:ce|celui|celle|ceux|celles) (?:qui|dont|qu'?on|que l'?on)\s+(?:a été |vient d'?être |on a |vient de |a )?(?:discut|évoqu|parl[ée]|dit\b|dire\b|d[ée]crit ci-dessus)/i,
  // « le point / le sujet / la demande évoqué(e) plus haut / ci-dessus / dans la conversation »
  /\b(?:le point|le sujet|la demande|le probl[èe]me|le besoin)\s+(?:[^.\n]{0,20}\s)?(?:évoqué|discuté|mentionné|abordé|décrit|cité)e?s?\s+(?:plus haut|ci-dessus|au-dessus|dans la conversation|dans le fil)/i,
  // « comme discuté / convenu ci-dessus / dans la conversation »
  /\bcomme (?:discut|évoqu|convenu|vu|indiqué)[a-zé]*\s+(?:plus haut|ci-dessus|dans (?:la|notre) (?:conversation|échange|discussion))/i,
  // « voir la conversation », « cf. notre échange », « se reporter au fil »
  /\b(?:voir|cf\.?|se reporter (?:à|au)|reprendre)\s+(?:la |notre |le |l'?)?(?:conversation|échange|discussion|fil)\b(?!\s+(?:de|d'|du|des)\b)/i,
  // « la conversation ci-dessus », « notre échange précédent »
  /\b(?:la|notre|cette)\s+(?:conversation|échange|discussion)\s+(?:ci-dessus|précédente?|au-dessus|plus haut)/i,
  // « d'après la conversation », « selon notre échange »
  /\b(?:d'?après|selon)\s+(?:la|notre)\s+(?:conversation|échange|discussion)/i,
];

/**
 * Vrai quand la description se contente de RENVOYER au fil au lieu de nommer
 * son sujet. C'est un refus à part entière : ni la longueur ni les quatre
 * parties ne le rattrapent.
 */
export function renvoieAuFil(texte: string): boolean {
  return RENVOIS_AU_FIL.some((r) => r.test(texte));
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
  'renvoi-au-fil':
    "la carte RENVOIE à la conversation au lieu de nommer son sujet : l'agent qui l'exécutera n'a pas ton fil sous les yeux. Remplace « ce qui a été discuté », « le point ci-dessus », « voir la conversation » par le sujet lui-même, écrit en toutes lettres",
};

/** Les mêmes manques, dits autrement quand on n'attend qu'une carte de tri. */
const LIBELLE_MANQUE_COURT: Partial<Record<ManqueDescription, string>> = {
  vide: 'la description est vide ou réduite au titre',
  'trop-courte': `la demande n'est pas reformulée (moins de ${MIN_SIGNES_CARTE_COURTE} signes)`,
};

/**
 * Le jugement, seul point d'entrée du démon. Il ne réécrit rien : il dit si la
 * description peut être affichée, et sinon ce qu'il faut y ajouter.
 *
 * L'exigence « courte » est celle d'une carte de TRI : on vérifie seulement que
 * la demande est REFORMULÉE — ni quatre parties, ni repère concret, puisque le
 * chef n'a pas ouvert le projet et n'a donc rien vu à citer.
 */
export function jugerDescription(
  description: string | undefined | null,
  exigence: ExigenceDescription = 'complete',
): VerdictDescription {
  const texte = String(description ?? '').trim();
  const signes = signesUtiles(texte);
  const manques: ManqueDescription[] = [];
  const plancher = exigence === 'courte' ? MIN_SIGNES_CARTE_COURTE : MIN_SIGNES_DESCRIPTION;

  if (!texte) {
    manques.push('vide');
  } else {
    if (signes < plancher) manques.push('trop-courte');
    if (signes > MAX_SIGNES_DESCRIPTION) manques.push('trop-longue');
    // Vaut pour les DEUX exigences : une carte courte qui renvoie au fil est
    // aussi illisible pour l'agent d'exécution qu'une carte complète.
    if (renvoieAuFil(texte)) manques.push('renvoi-au-fil');
    if (exigence === 'complete') {
      const trouvees = partiesTrouvees(texte);
      for (const partie of PARTIES_DESCRIPTION) if (!trouvees.has(partie)) manques.push(partie);
      if (!contientRepereConcret(texte)) manques.push('sans-repere');
    }
  }

  if (!manques.length) return { ok: true, manques: [], signes, message: '' };

  const message =
    exigence === 'courte'
      ? 'Proposition REFUSÉE — elle ne part pas dans la conversation tant que la demande n’y est pas reformulée.\n' +
        `Ce qui manque : ${manques.map((m) => LIBELLE_MANQUE_COURT[m] ?? LIBELLE_MANQUE[m]).join(' ; ')}.\n\n` +
        `Reprends l'outil avec deux ou trois phrases (entre ${MIN_SIGNES_CARTE_COURTE} et ${MAX_SIGNES_DESCRIPTION} signes) : ` +
        "ce que l'utilisateur demande, dans tes mots, assez précisément pour qu'il reconnaisse sa demande avant de cliquer. " +
        "NOMME LE SUJET : si la demande renvoyait à ce qui venait d'être dit, va le chercher dans la conversation et écris-le en toutes lettres — l'agent qui exécutera la carte n'a pas ton fil. " +
        "N'invente aucun constat sur le projet : tu ne l'as pas ouvert, et l'agent de la carte s'en chargera."
      : 'Proposition REFUSÉE — elle ne part pas dans la conversation tant que sa description ne tient pas debout.\n' +
        `Ce qui manque : ${manques.map((m) => LIBELLE_MANQUE[m]).join(' ; ')}.\n\n` +
        `Reprends l'outil avec une description bâtie ainsi (entre ${MIN_SIGNES_DESCRIPTION} et ${MAX_SIGNES_DESCRIPTION} signes, quatre parties annoncées) :\n` +
        GABARIT_DESCRIPTION +
        "\n\nVa REGARDER le projet avant de réécrire : une description qui ne fait que redire la demande de l'utilisateur sera refusée de nouveau.";

  return { ok: false, manques, signes, message };
}

/**
 * Assemble une description à partir des quatre parties, quand le moteur les
 * fournit séparément. La mise en forme appartient alors à Beluga Build, pas au
 * modèle : même carte, même allure, quel que soit le moteur.
 */
export function composerDescription(parties: PartiesCarte): string {
  const intro = String(parties.intro ?? '').trim();
  const corps = PARTIES_DESCRIPTION.map((partie) => {
    const contenu = String(parties[partie] ?? '').trim();
    return contenu ? `**${INTERTITRES[partie]}** : ${contenu}` : '';
  })
    .filter(Boolean)
    .join('\n\n');
  return [intro, corps].filter(Boolean).join('\n\n');
}

/**
 * La consigne posée dans le briefing du chef. Elle est UNIQUE : les deux
 * moteurs reçoivent mot pour mot le même texte.
 */
export const CONSIGNE_DESCRIPTION_CARTE =
  "CE QUE DOIT CONTENIR LA DESCRIPTION D'UNE CARTE QUE TU PROPOSES (imposé par Beluga Build, l'outil refuse le reste) :\n" +
  "quatre parties ANNONCÉES, chacune sur sa ligne — Constat (ce que le projet fait aujourd'hui), Attendu (ce qu'il doit faire), " +
  'Limites (ce qu’on ne touche pas), Vérification (comment savoir que c’est fait).\n' +
  `Longueur : entre ${MIN_SIGNES_DESCRIPTION} et ${MAX_SIGNES_DESCRIPTION} signes — assez pour être exécutée sans toi, jamais un pavé.\n` +
  "REGARDE LE PROJET AVANT DE PROPOSER : la description doit citer au moins un repère concret que tu as vu (un fichier, une commande, un libellé affiché, une règle existante). " +
  "Reformuler la demande de l'utilisateur ne suffit pas ; une proposition vide ou réduite au titre est refusée et t'est rendue à réécrire.";

/**
 * La consigne donnée au CHEF D'ORCHESTRE, qui ne fait plus que trier. Elle dit
 * l'inverse de la précédente sur un point, et c'est voulu : il ne va PAS
 * regarder le projet. Une carte courte, honnête, sans constat inventé.
 */
export const CONSIGNE_CARTE_COURTE =
  "CE QUE DOIT CONTENIR LA CARTE QUE TU PROPOSES (imposé par Beluga Build, l'outil refuse le reste) :\n" +
  `un TITRE COURT et EXPLICITE (quelques mots, ${MAX_SIGNES_TITRE} signes au plus — jamais une description du travail attendu), ` +
  "et une DESCRIPTION de deux ou trois phrases qui REFORMULE la demande — ce que l'utilisateur veut, " +
  "et ce qui compte pour lui (l'écran, le comportement, la contrainte qu'il a dite).\n" +
  `Longueur : entre ${MIN_SIGNES_CARTE_COURTE} et ${MAX_SIGNES_DESCRIPTION} signes.\n` +
  "TU N'OUVRES PAS LE PROJET POUR ÉCRIRE CETTE CARTE et tu n'inventes AUCUN constat sur le code : l'étude, le chiffrage et " +
  "les contrôles à rejouer sont le travail de l'agent qui exécutera la carte, une fois qu'elle sera validée. " +
  "Une description vide ou réduite au titre est refusée et t'est rendue à réécrire.\n" +
  "LA CARTE SE LIT SANS TA CONVERSATION : l'agent qui l'exécutera reçoit le titre et la description, RIEN D'AUTRE — ni le fil, ni ce qui vient d'être dit. " +
  "Quand la demande renvoie à ce qui précède (« ça », « cette idée », « fais-en une carte », « comme on vient d'en parler »), REMONTE LE FIL, retrouve le sujet et NOMME-LE en toutes lettres dans le titre comme dans la description. " +
  "« Corriger ce qui a été discuté », « le point ci-dessus », « voir la conversation » sont refusés par l'outil : ces mots ne désignent rien pour qui n'était pas là.";
