/**
 * LE MÉNAGE DE NUIT DU POOL DE COMPÉTENCES.
 *
 * Jusqu'au 2026-10-02, la nuit était la SEULE porte d'entrée du pool : elle ne
 * capitalisait qu'une carte prouvée (contrôles rejoués, passage en production,
 * sept jours sans contradiction), trois fiches au plus, et jamais une leçon
 * propre à un projet — d'où un pool qui n'apprenait presque rien de l'interface
 * ni de la structure des projets. Décision de l'utilisateur : une compétence
 * naît DÈS LA FIN DU TRAVAIL, propre au projet et commune quand elle vaut
 * ailleurs, et sert tout de suite (consigne du rôle de tâche,
 * `server/src/runtime.ts`).
 *
 * La nuit change donc de rôle : elle ne crée plus, elle RANGE ce que la
 * journée a écrit vite — doublons fusionnés, fiches maigres complétées, leçon
 * répétée d'un projet à l'autre remontée en fiche commune, fiche née d'un
 * travail défait depuis revue. La contradiction entre cartes
 * (`shared/src/contradiction-cartes.ts`) sert désormais à ce dernier point.
 *
 * Rien ici ne touche la base ni le disque : le démon relève les fiches
 * (`server/src/menage-competences.ts`), ces règles décident et rédigent.
 */

/** Le titre de l'agent de la nuit, visible dans la pile d'agents. */
export const TITRE_MENAGE = 'Ménage des compétences';

/**
 * COMBIEN DE FICHES LA CONSIGNE NOMME AU PLUS. Ce n'est pas un plafond
 * d'écriture — le ménage range autant qu'il le faut —, c'est la taille de la
 * liste remise à l'agent : au-delà, il lit le pool lui-même.
 */
export const FICHES_NOMMEES_MAX = 60;

/** Une fiche écrite ou retouchée depuis le dernier passage. */
export interface FicheTouchee {
  nom: string;
  /** Les projets qu'elle nomme ; vide = commune. */
  projets: string[];
}

/** Une fiche née d'une carte qu'une carte postérieure contredit. */
export interface FicheARevoir {
  nom: string;
  /** Le titre de la carte d'origine. */
  carte: string;
  /** Le titre de la carte qui la contredit. */
  contreditePar: string;
}

/** Y a-t-il de quoi ranger cette nuit ? Rien d'écrit et rien de contredit : pas d'agent. */
export function menageNecessaire(entree: { touchees: readonly FicheTouchee[]; aRevoir: readonly FicheARevoir[] }): boolean {
  return entree.touchees.length > 0 || entree.aRevoir.length > 0;
}

function ligneDeFiche(fiche: FicheTouchee): string {
  return `- ${fiche.nom} (${fiche.projets.length ? `propre à ${fiche.projets.join(', ')}` : 'commune'})`;
}

/**
 * LA CONSIGNE DU MÉNAGE. Un agent d'ANALYSE : il ne modifie aucun code, ses
 * seules sorties sont l'outil « competences » (écrire, changer l'état) — donc le
 * contrôle de qualité de la porte d'écriture. Il ne CRÉE pas de leçon : il range
 * celles que les tâches ont écrites.
 */
export function consigneDuMenage(entree: { touchees: readonly FicheTouchee[]; aRevoir: readonly FicheARevoir[] }): string {
  const nommees = entree.touchees.slice(0, FICHES_NOMMEES_MAX);
  const reste = entree.touchees.length - nommees.length;
  const touchees = nommees.length
    ? `FICHES ÉCRITES OU RETOUCHÉES DEPUIS LE DERNIER PASSAGE (${entree.touchees.length}) :\n${nommees.map(ligneDeFiche).join('\n')}` +
      (reste > 0 ? `\n(et ${reste} autre(s) : « competences », action « lister » avec « tous », les donne toutes)` : '')
    : '';
  const aRevoir = entree.aRevoir.length
    ? `FICHES NÉES D'UN TRAVAIL QU'UNE CARTE POSTÉRIEURE CONTREDIT (${entree.aRevoir.length}) :\n` +
      entree.aRevoir.map((f) => `- ${f.nom} — née de « ${f.carte} », contredite par « ${f.contreditePar} »`).join('\n')
    : '';
  return [
    `TU FAIS LE MÉNAGE DU POOL DE COMPÉTENCES. Les agents de tâche écrivent leurs fiches dès la fin de leur travail — ` +
      `propres à leur projet, communes quand la leçon vaut ailleurs. Ils écrivent vite : toi, tu ranges. Tu ne crées ` +
      `aucune leçon nouvelle.`,
    [touchees, aRevoir].filter(Boolean).join('\n\n'),
    `CINQ GESTES, dans cet ordre, en lisant les fiches concernées et leurs voisines (« competences », action « lister » ` +
      `avec « tous » ; chaque fiche est le SKILL.md de son dossier) :\n` +
      `1. DOUBLONS — deux fiches qui règlent le même problème dans la même portée : garde la plus juste, réécris-la ENTIÈRE ` +
      `avec ce que l'autre apportait, puis passe l'autre en « archivee » (action « etat »).\n` +
      `2. FICHES MAIGRES — une fiche qui ne dit pas QUAND s'en servir, sans vraie procédure ou sans vérification : ` +
      `complète-la depuis les cartes qu'elle cite.\n` +
      `3. CE QUI SE RÉPÈTE D'UN PROJET À L'AUTRE — la même leçon dans les fiches propres de deux projets ou plus : écris ` +
      `UNE fiche commune (« projets » = « tous »), sans rien de propre à un projet, puis allège chaque fiche propre pour ` +
      `qu'elle n'y garde que ce qui est vraiment à elle et RENVOIE à la commune par son nom.\n` +
      `4. FICHES CONTREDITES — relis la carte qui la contredit : corrige la fiche, ou passe-la en « depreciee » si ce ` +
      `qu'elle enseigne a été défait.\n` +
      `5. PORTÉE — une fiche commune qui ne parle que d'un projet redevient propre à ce projet ; une fiche propre dont la ` +
      `leçon vaut partout (la machine, un service, une bibliothèque) devient commune (« projets » = « tous ») ; une fiche ` +
      `propre écrite sans le nom exact de son projet est corrigée.`,
    `RÉÉCRIRE UNE FICHE, c'est la relire puis la redonner ENTIÈRE sous son nom : l'écriture remplace son texte. Une fiche ` +
      `refusée te dit pourquoi : corrige-la. Rien à ranger : dis-le en une ligne. TU N'ÉCRIS AUCUN CODE et tu ne touches à ` +
      `aucun projet : ta seule sortie est l'outil « competences ». Termine par une ligne par geste fait.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
