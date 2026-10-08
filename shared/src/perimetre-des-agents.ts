/**
 * LE PÉRIMÈTRE D'UN AGENT : SON PROJET, ET LUI SEUL.
 *
 * Le cadrage d'une carte InVia (« Alléger le journal d'erreurs d'InVia »,
 * 08.10.2026) a demandé « Tous les sites / Seulement InVia » : un agent posé
 * dans UN projet proposait d'agir sur tous les autres, et sur une mécanique
 * commune (le nettoyage du journal, code du projet de l'application) qui ne lui
 * appartient pas. Décision de l'utilisateur :
 *
 *  - l'agent d'un projet ordinaire — cadrage, tâche, analyse, publication — ne
 *    regarde, ne mentionne et ne modifie que CE projet ;
 *  - seuls le projet de l'APPLICATION (marque `isSelf`, le projet nommé
 *    « Beluga ») et l'assistant général voient l'ensemble ; un travail qui
 *    touche d'autres projets s'y propose en UNE CARTE PAR PROJET, jamais en
 *    modifiant leur dépôt depuis ici.
 *
 * PIÈGE DE NOM : le projet nommé « Beluga Build » est le SITE VITRINE de
 * l'application, un projet ordinaire. La règle se tranche donc sur `isSelf`,
 * jamais sur un nom — et ces textes ne disent jamais « Beluga Build » pour
 * désigner l'application.
 *
 * La consigne ne dépend que du projet, stable pour une session : la consigne
 * système ne change pas d'un tour à l'autre.
 */

/** Pour l'agent d'un projet ordinaire : ce projet, et rien d'autre. */
export const CONSIGNE_PERIMETRE_PROJET =
  "TON PÉRIMÈTRE EST CE PROJET, ET LUI SEUL : son dépôt, son site, ses cartes. Tu ne regardes, n'analyses et ne modifies aucun autre projet, et tu n'en parles pas. " +
  "Tu ne proposes JAMAIS d'étendre un travail à d'autres projets ou sites (« tous les sites », « les autres projets ») — ni en question, ni en carte. " +
  "Les mécaniques communes que l'application Beluga applique à tous les projets (surveillance des sites, nettoyage des journaux, sauvegardes, publication) ne sont pas à toi : tu n'y touches pas ; si l'une gêne CE projet, dis-le en une phrase, sans rien proposer pour les autres.";

/** Pour l'agent du projet de l'application : il voit tout, mais propose une carte par projet. */
export const CONSIGNE_PERIMETRE_APPLICATION =
  "TU ES DANS LE PROJET DE L'APPLICATION BELUGA ELLE-MÊME : avec l'assistant général, c'est le seul qui voit tous les projets. " +
  "Un travail qui doit modifier D'AUTRES projets ne se fait JAMAIS d'ici : tu ne touches pas à leur dépôt. Tu proposes UNE carte PAR projet concerné, avec « board_create_card » et son champ « projet », chacune limitée à ce projet. " +
  "Le projet nommé « Beluga Build » est le site vitrine de l'application : un projet comme les autres.";

/** La phrase de l'assistant général : le même partage, vu de sa fenêtre. */
export const CONSIGNE_PERIMETRE_ASSISTANT =
  "UNE CARTE PAR PROJET : un travail qui touche plusieurs projets se propose en UNE carte dans CHAQUE projet concerné (board_create_card, avec « projet »), jamais en une seule carte qui les mêlerait. " +
  "Le projet nommé « Beluga Build » est le site vitrine de l'application ; l'application elle-même est le projet « Beluga ».";

/** La consigne de périmètre d'un agent, d'après la marque `isSelf` de son projet. */
export function consigneDePerimetre(isSelf: boolean): string {
  return isSelf ? CONSIGNE_PERIMETRE_APPLICATION : CONSIGNE_PERIMETRE_PROJET;
}

/**
 * QUI PEUT PROPOSER UNE CARTE DANS UN AUTRE PROJET (champ « projet » de
 * `board_create_card`) : l'agent d'une conversation du projet de l'application,
 * et lui seul. L'agent d'un site surveillé vit lui aussi dans ce projet, mais
 * sa carte suit le projet du site (DEC-340) : il n'a pas ce droit.
 */
export type VerdictProjetVise =
  | { ok: true }
  | { ok: false; raison: string };

export function propositionAilleursPermise(entree: {
  projetDeLAgentIsSelf: boolean;
  agentDUnSite: boolean;
}): VerdictProjetVise {
  if (entree.agentDUnSite) {
    return {
      ok: false,
      raison:
        "Refusé : l'agent d'un site surveillé ne choisit pas le projet de sa carte — elle naît dans le projet du site. Repropose-la sans « projet ».",
    };
  }
  if (!entree.projetDeLAgentIsSelf) {
    return {
      ok: false,
      raison:
        "Refusé : une carte ne se propose que dans TON projet. Seul le projet de l'application Beluga propose des cartes dans d'autres projets. Repropose-la sans « projet », limitée à ce projet.",
    };
  }
  return { ok: true };
}
