/**
 * « Ça, c'est pour quel projet ? »
 *
 * Une phrase dictée n'a pas de destinataire : le chef d'orchestre est attaché à
 * UN projet, et rien ne disait où déposer « ajoute un bouton de partage ». Ce
 * fichier tranche, sans base, sans réseau et SANS moteur payant : il compare la
 * phrase aux noms des projets ouverts et rend soit le projet, soit la question
 * à poser.
 *
 * La règle ne DEVINE jamais. Trois issues, et trois seulement :
 *
 *  - un seul projet nommé, ou un seul projet ouvert : on dépose ;
 *  - un nom APPROCHANT nettement devant les autres : on dépose (la dictée
 *    écorche les noms propres, « aïko dev » vaut « HaikoDev ») ;
 *  - tout le reste — aucun nom, deux noms possibles, ou un projet clair mais
 *    une action réduite à un mot : on POSE LA QUESTION.
 *
 * Le doute se paie d'une question, jamais d'un pari.
 */

/** Le strict minimum dont la décision a besoin. */
export interface ProjetJoignable {
  id: string;
  name: string;
  archived?: boolean;
}

/** Pourquoi la règle a tranché comme elle l'a fait — dit à l'écran, jamais tu. */
export type MotifRoutage =
  | 'nom-cite'
  | 'nom-approchant'
  | 'projet-unique'
  | 'plusieurs-projets'
  | 'aucun-nom'
  | 'action-floue'
  | 'phrase-vide'
  | 'aucun-projet';

export interface Routage {
  /** Où déposer la demande. Absent : on ne devine pas, on demande. */
  projectId?: string;
  /** La question à poser quand un doute demeure. */
  question?: string;
  /** Les réponses à proposer, dans l'ordre. Vide pour une réponse libre. */
  candidats: ProjetJoignable[];
  /**
   * Le projet DÉJÀ connu alors qu'une question est posée : c'est le cas quand
   * seule l'action manque. La réponse ne doit alors plus redemander où déposer.
   */
  projetRetenu?: string;
  motif: MotifRoutage;
}

/** Un projet est reconnu au-dessus de cette ressemblance (0 → 1). */
export const SEUIL_APPROCHANT = 0.74;
/** …et seulement s'il devance le suivant d'au moins cet écart. */
export const ECART_APPROCHANT = 0.08;
/** Combien de mots utiles doit porter la demande, une fois le projet ôté. */
export const MOTS_MIN_ACTION = 2;
/** Combien de projets au plus sont proposés en réponse à la question. */
export const CANDIDATS_MAX = 8;
/** Au-delà, la phrase citée dans la question est raccourcie. */
export const EXTRAIT_MAX = 90;
/** Une question de routage n'attend une réponse dictée que dix minutes. */
export const DELAI_REPONSE_DICTEE_MS = 10 * 60 * 1000;

/**
 * Les mots qui ne distinguent aucun projet : ils ne servent ni à reconnaître un
 * nom, ni à prouver qu'une action a été demandée.
 */
const MOTS_VIDES = new Set([
  'le', 'la', 'les', 'l', 'un', 'une', 'des', 'du', 'de', 'd', 'au', 'aux', 'et', 'ou',
  'a', 'en', 'dans', 'sur', 'par', 'chez', 'avec', 'sans', 'que', 'qui', 'pour',
  'ce', 'cet', 'cette', 'ces', 'mon', 'ma', 'mes', 'son', 'sa', 'ses', 'notre', 'nos',
  'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 's', 'y',
  'te', 'me', 'se', 'plait', 'stp',
  'projet', 'projets', 'site', 'appli', 'application', 'app', 'dossier',
]);

/** Minuscules, sans accents, sans ponctuation : la forme sur laquelle on compare. */
export function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function mots(texte: string): string[] {
  const net = normaliser(texte);
  return net ? net.split(' ') : [];
}

/** Distance de Levenshtein : combien de retouches séparent deux mots. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let ligne = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const suivante = [i];
    for (let j = 1; j <= b.length; j++) {
      suivante[j] = Math.min(
        ligne[j] + 1,
        suivante[j - 1] + 1,
        ligne[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    ligne = suivante;
  }
  return ligne[b.length];
}

/** Ressemblance entre deux mots, de 0 (rien à voir) à 1 (identiques). */
export function ressemblance(a: string, b: string): number {
  const plus = Math.max(a.length, b.length);
  if (!plus) return 0;
  return 1 - distance(a, b) / plus;
}

/** Les fenêtres de 1 à `max` mots consécutifs, collées (« haiko dev » → « haikodev »). */
function fenetres(motsPhrase: string[], max: number): string[] {
  const sortie: string[] = [];
  for (let taille = 1; taille <= max; taille++) {
    for (let debut = 0; debut + taille <= motsPhrase.length; debut++) {
      sortie.push(motsPhrase.slice(debut, debut + taille).join(''));
    }
  }
  return sortie;
}

/** Les mots d'un nom de projet qui le distinguent vraiment des autres. */
function motsDistinctifs(nom: string): string[] {
  const tous = mots(nom);
  const forts = tous.filter((mot) => mot.length >= 4 && !MOTS_VIDES.has(mot));
  return forts.length ? forts : tous.filter((mot) => mot.length >= 3);
}

/** Le nom d'un projet est-il CITÉ tel quel dans la phrase ? */
function nomCite(phrase: string[], projet: ProjetJoignable): boolean {
  const nom = mots(projet.name);
  if (!nom.length) return false;
  const colle = nom.join('');
  return fenetres(phrase, Math.min(nom.length + 1, 4)).includes(colle);
}

/** À quel point le nom d'un projet transparaît dans la phrase (0 → 1). */
function ressemblanceAuProjet(phrase: string[], projet: ProjetJoignable): number {
  const nom = mots(projet.name);
  if (!nom.length || !phrase.length) return 0;
  const colle = nom.join('');
  let meilleure = 0;

  // Le nom entier, contre chaque suite de mots de la phrase.
  for (const fenetre of fenetres(phrase, Math.min(nom.length + 1, 4))) {
    if (fenetre.length < 3) continue;
    meilleure = Math.max(meilleure, ressemblance(colle, fenetre));
  }

  // Un mot distinctif du nom, contre chaque mot de la phrase : « Dupont » suffit
  // à désigner « Site du client Dupont ».
  for (const distinctif of motsDistinctifs(projet.name)) {
    for (const mot of phrase) {
      if (mot.length < 3) continue;
      meilleure = Math.max(meilleure, ressemblance(distinctif, mot));
    }
  }
  return meilleure;
}

/** Ce qui reste de la phrase une fois le nom du projet retiré. */
function resteApresLeNom(phrase: string[], projet: ProjetJoignable): string[] {
  const nom = new Set(mots(projet.name));
  return phrase.filter((mot) => !nom.has(mot) && !MOTS_VIDES.has(mot) && mot.length >= 2);
}

/**
 * Le DESTINATAIRE d'une phrase, sans regarder ce qu'elle demande.
 * Sert aussi à lire la réponse à une question de routage — où l'utilisateur ne
 * dit souvent qu'un nom de projet, sans aucune action.
 */
export function projetNomme(
  texte: string,
  projets: ProjetJoignable[],
): { projectId?: string; candidats: ProjetJoignable[]; motif: MotifRoutage } {
  const ouverts = projets.filter((projet) => !projet.archived);
  if (!ouverts.length) return { candidats: [], motif: 'aucun-projet' };

  const phrase = mots(texte);
  if (!phrase.length) {
    return { candidats: ouverts.slice(0, CANDIDATS_MAX), motif: 'phrase-vide' };
  }

  const cites = ouverts.filter((projet) => nomCite(phrase, projet));
  if (cites.length === 1) return { projectId: cites[0].id, candidats: cites, motif: 'nom-cite' };
  if (cites.length > 1) {
    return { candidats: cites.slice(0, CANDIDATS_MAX), motif: 'plusieurs-projets' };
  }

  const classes = ouverts
    .map((projet) => ({ projet, score: ressemblanceAuProjet(phrase, projet) }))
    .sort((a, b) => b.score - a.score);
  const tete = classes[0];
  const second = classes[1];

  if (tete && tete.score >= SEUIL_APPROCHANT) {
    const devance = !second || tete.score - second.score >= ECART_APPROCHANT;
    if (devance) {
      return { projectId: tete.projet.id, candidats: [tete.projet], motif: 'nom-approchant' };
    }
    const proches = classes
      .filter((ligne) => ligne.score >= SEUIL_APPROCHANT)
      .map((ligne) => ligne.projet);
    return { candidats: proches.slice(0, CANDIDATS_MAX), motif: 'plusieurs-projets' };
  }

  // Aucun nom reconnu. Un seul projet ouvert : il n'y a rien à deviner.
  if (ouverts.length === 1) {
    return { projectId: ouverts[0].id, candidats: ouverts, motif: 'projet-unique' };
  }
  return { candidats: ouverts.slice(0, CANDIDATS_MAX), motif: 'aucun-nom' };
}

/** La phrase citée dans la question, raccourcie pour l'œil et pour l'oreille. */
export function extrait(texte: string, max = EXTRAIT_MAX): string {
  const propre = texte.trim().replace(/\s+/g, ' ');
  return propre.length <= max ? propre : `${propre.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Où déposer une phrase dictée — et, à défaut, quelle question poser.
 *
 * @param texte    La phrase telle qu'elle a été transcrite.
 * @param projets  Les projets du tableau ; les archivés sont écartés d'office.
 */
export function routerLaDemande(texte: string, projets: ProjetJoignable[]): Routage {
  const choix = projetNomme(texte, projets);

  if (choix.motif === 'aucun-projet') {
    return { candidats: [], motif: 'aucun-projet' };
  }

  if (!choix.projectId) {
    const question =
      choix.motif === 'phrase-vide'
        ? "Je n'ai rien compris de ce qui a été dit. Pour quel projet est cette demande ?"
        : `Pour quel projet est cette demande : « ${extrait(texte)} » ?`;
    return { question, candidats: choix.candidats, motif: choix.motif };
  }

  // Le projet est clair, mais l'ordre tient en un mot : on ne suppose pas
  // l'action non plus. « HaikoDev » seul n'est pas une demande.
  const projet = choix.candidats.find((p) => p.id === choix.projectId);
  const reste = projet ? resteApresLeNom(mots(texte), projet) : [];
  if (reste.length < MOTS_MIN_ACTION) {
    return {
      question: `Que dois-je demander au chef d'orchestre de « ${projet?.name ?? 'ce projet'} » ?`,
      candidats: [],
      // Le projet est retenu : c'est l'action qui manque, pas la destination.
      projetRetenu: choix.projectId,
      motif: 'action-floue',
    };
  }

  return { projectId: choix.projectId, candidats: choix.candidats, motif: choix.motif };
}

/**
 * OÙ la question se pose. Une décision n'existe que dans une conversation, et
 * une conversation appartient à un projet : sans lieu, le triangle orange
 * n'apparaîtrait nulle part et personne ne saurait qu'on attend une réponse.
 *
 * Le premier candidat plausible d'abord (c'est là que l'utilisateur regardera),
 * sinon le projet qu'il a sous les yeux, sinon le premier du tableau.
 */
export function lieuDeLaQuestion(
  routage: Routage,
  projets: ProjetJoignable[],
  projetActif?: string | null,
): string | null {
  const ouverts = projets.filter((projet) => !projet.archived);
  if (!ouverts.length) return null;
  // Le projet déjà retenu passe devant : la question s'y prend forcément.
  if (routage.projetRetenu && ouverts.some((projet) => projet.id === routage.projetRetenu)) {
    return routage.projetRetenu;
  }
  const candidat = routage.candidats.find((projet) => ouverts.some((p) => p.id === projet.id));
  if (candidat) return candidat.id;
  if (projetActif && ouverts.some((projet) => projet.id === projetActif)) return projetActif;
  return ouverts[0].id;
}

/* ------------------------------------------------------------------ */
/* La réponse                                                          */
/* ------------------------------------------------------------------ */

/** Une dictée mise en attente d'une réponse. */
export interface DicteeEnAttente {
  /** La phrase dictée, telle qu'elle a été comprise. */
  texte: string;
  /** Le projet déjà retenu, quand seule l'action manquait. */
  projectId?: string;
  /** Les projets proposés en réponse. */
  candidats: ProjetJoignable[];
  /** Quand la question a été posée. */
  poseeA: number;
}

export interface SuiteDuRoutage {
  /** Où déposer, une fois la réponse lue. */
  projectId?: string;
  /** Ce qu'il faut y déposer. */
  texte?: string;
  /** Pourquoi rien n'est déposé — dit à l'utilisateur, jamais tu. */
  raison?: string;
}

/**
 * Ce que devient une dictée quand la réponse arrive.
 *
 * Deux cas, et ils ne se ressemblent pas : quand le PROJET manquait, la réponse
 * nomme le projet et c'est la phrase d'origine qu'on dépose ; quand l'ACTION
 * manquait, le projet est déjà connu et c'est la réponse elle-même qui est la
 * demande.
 */
export function suiteDuRoutage(
  attente: DicteeEnAttente,
  reponse: string,
  projets: ProjetJoignable[],
): SuiteDuRoutage {
  const dit = reponse.trim();
  if (!dit) return { raison: "La réponse est vide : rien n'a été transmis." };

  if (attente.projectId) {
    const ouvert = projets.some((projet) => projet.id === attente.projectId && !projet.archived);
    if (!ouvert) return { raison: "Ce projet n'est plus au tableau : rien n'a été transmis." };
    return { projectId: attente.projectId, texte: dit };
  }

  // La réponse cochée est un nom de projet : on le reconnaît d'abord parmi les
  // candidats proposés, ensuite parmi tous les projets ouverts.
  const parmiCandidats = attente.candidats.length ? projetNomme(dit, attente.candidats) : null;
  const choix = parmiCandidats?.projectId ? parmiCandidats : projetNomme(dit, projets);
  if (!choix.projectId) {
    return { raison: `Je n'ai pas reconnu de projet dans « ${extrait(dit)} » : rien n'a été transmis.` };
  }
  return { projectId: choix.projectId, texte: attente.texte };
}

/** Une question de routage attend-elle ENCORE une réponse dictée ? */
export function reponseEncoreAttendue(poseeA: number, maintenant: number): boolean {
  return maintenant - poseeA >= 0 && maintenant - poseeA <= DELAI_REPONSE_DICTEE_MS;
}
