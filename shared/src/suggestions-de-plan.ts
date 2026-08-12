/**
 * LES SUGGESTIONS D'OPTIMISATION D'UN PLAN — de quoi rebondir sans écrire.
 *
 * Le mode plan est un BRAINSTORMING : on regarde une version, on demande autre
 * chose, on regarde la suivante. Entre les deux, il fallait rédiger sa relance
 * à la main — et devant un plan qui « a l'air bien », on ne trouve pas quoi
 * demander. D'où ces quelques relances TOUTES PRÊTES, posées sous le plan
 * courant : un clic les DÉPOSE DANS LE CHAMP DE SAISIE, où elles se complètent
 * et se corrigent avant d'être envoyées.
 *
 * Deux règles tiennent tout le module :
 *
 * 1. UNE SUGGESTION NE PART JAMAIS TOUTE SEULE. Elle écrit dans le champ, elle
 *    ne lance aucun tour — comme le bouton « Refuser ». Le geste qui dépense,
 *    c'est l'envoi, et il appartient à l'utilisateur.
 * 2. ON NE PROPOSE PAS CE QUE LE PLAN FAIT DÉJÀ. Chaque suggestion porte les
 *    mots qui prouvent que la question est traitée (`deja`) : un plan qui
 *    chiffre déjà ses étapes ne se voit pas proposer « chiffre l'effort ».
 *
 * Rien ici ne touche à la base ni au disque : la règle se rejoue seule, et le
 * texte des suggestions se relit d'un coup d'œil.
 */

/** Une relance toute prête, montrée sous le plan courant. */
export interface SuggestionDePlan {
  /** Repère stable, pour l'affichage et les vérifications. */
  id: string;
  /** Les deux ou trois mots portés par la pastille. */
  libelle: string;
  /** Le texte déposé dans le champ de saisie au clic. */
  texte: string;
  /**
   * Les mots qui montrent que le plan répond DÉJÀ à cette suggestion : elle
   * disparaît alors de la liste. Absent = toujours proposée.
   */
  deja?: RegExp;
}

/**
 * Le catalogue, dans l'ordre où les suggestions se présentent. L'ordre compte :
 * les deux premières valent pour n'importe quel plan, les suivantes ne servent
 * qu'à un plan qui a laissé un angle de côté.
 */
export const SUGGESTIONS_DE_PLAN: SuggestionDePlan[] = [
  {
    id: 'simplifier',
    libelle: 'Plus simple',
    texte:
      "Reprends ce plan en plus SIMPLE : garde le même résultat, retire tout ce qui n'est pas indispensable, et dis en une ligne ce que tu abandonnes.",
  },
  {
    id: 'autre-approche',
    libelle: 'Une autre approche',
    texte:
      'Propose une approche DIFFÉRENTE pour arriver au même résultat, et compare-la en deux lignes à celle que tu viens de décrire.',
  },
  {
    id: 'par-etapes',
    libelle: 'Livrer par étapes',
    texte:
      "Découpe ce plan en étapes livrables l'une après l'autre, la première apportant déjà quelque chose d'utilisable seule.",
    deja: /\b(premi[eè]re\s+[ée]tape|par\s+[ée]tapes|lot\s+1|premier\s+lot)\b/i,
  },
  {
    id: 'effort',
    libelle: "Chiffrer l'effort",
    texte:
      "Ajoute à chaque étape le temps qu'elle demande, puis dis laquelle rapporte le plus pour le moins d'effort.",
    deja: /\b(\d+\s*(min|minutes?|h|heures?|jours?)|chf|co[uû]t\s+estim)/i,
  },
  {
    id: 'risques',
    libelle: 'Ce qui peut casser',
    texte:
      "Dis ce qui peut mal tourner dans ce plan, ce qu'on ne pourra plus défaire, et comment revenir en arrière.",
    deja: /\b(risques?|ce qui peut mal tourner|revenir en arri[eè]re|r[ée]versible)\b/i,
  },
  {
    id: 'telephone',
    libelle: 'Sur téléphone',
    texte: "Dis comment ce plan se comporte sur un téléphone, et ce qu'il faut prévoir pour un écran étroit.",
    deja: /\b(t[ée]l[ée]phone|mobile|[ée]cran\s+[ée]troit|petit\s+[ée]cran)\b/i,
  },
  {
    id: 'verification',
    libelle: 'Comment le vérifier',
    texte: 'Ajoute au plan la façon de VÉRIFIER que le résultat marche, geste par geste.',
    deja: /\b(v[ée]rifi|contr[oô]le[rs]?\b|test[se]?\b)/i,
  },
];

/**
 * Combien on en montre au plus. Au-delà, la liste devient un second plan à
 * lire : quatre relances suffisent à relancer une réflexion, et les deux
 * premières du catalogue valent toujours.
 */
export const SUGGESTIONS_MONTREES = 4;

/**
 * LES SUGGESTIONS À MONTRER SOUS CE PLAN — celles auxquelles il ne répond pas
 * encore, dans l'ordre du catalogue, plafonnées.
 *
 * Un texte vide (le plan est encore en train de s'écrire) ne rend rien : on ne
 * propose pas de rebondir sur ce qui n'est pas là.
 */
export function suggestionsPourLePlan(plan: string): SuggestionDePlan[] {
  const texte = (plan ?? '').trim();
  if (!texte) return [];
  return SUGGESTIONS_DE_PLAN.filter((s) => !s.deja?.test(texte)).slice(0, SUGGESTIONS_MONTREES);
}

/**
 * LE REFUS, PRÉPARÉ SANS ÊTRE ENVOYÉ.
 *
 * « Refuser » ne relance plus rien tout seul (§ mode plan) : il pose cette
 * phrase dans le champ de saisie. Elle dit l'essentiel, et laisse la place à ce
 * que l'utilisateur veut ajouter — c'est bien là son intérêt, un refus muet ne
 * fait que faire deviner le chef.
 */
export const REFUS_A_COMPLETER =
  'Je refuse ce plan : réfléchis à une autre approche.';

/**
 * CE QUI SE DÉPOSE DANS LE CHAMP quand il contient déjà quelque chose.
 *
 * Un clic n'écrase JAMAIS ce qui est écrit — on ne perd pas une phrase en
 * cours pour une pastille. Les relances s'empilent donc l'une sous l'autre,
 * et une même suggestion cliquée deux fois ne se recopie pas.
 */
export function texteApresInsertion(actuel: string, ajout: string): string {
  const avant = (actuel ?? '').trim();
  const suite = (ajout ?? '').trim();
  if (!suite) return actuel ?? '';
  if (!avant) return suite;
  if (avant.split('\n').some((ligne) => ligne.trim() === suite)) return actuel ?? '';
  return `${avant}\n${suite}`;
}
