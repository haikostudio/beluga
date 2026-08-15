/**
 * LA PROCÉDURE DE MISE EN LIGNE SE DÉFINIT, ELLE NE SE DEVINE PLUS.
 *
 * Un projet neuf arrivait avec un déploiement TOUT FAIT : fusionner, construire,
 * rafraîchir l'instance de dev constatée sur ce serveur. C'était vrai pour
 * HaikoDev et faux pour presque tout le reste — un projet local n'a rien à
 * rafraîchir, un site client ne se sert pas d'ici. La mise en production, elle,
 * était déjà vide au départ, mais son refus renvoyait vers un bloc des réglages
 * que personne ne trouvait.
 *
 * Les DEUX étapes ont désormais la même forme : une PROCÉDURE, rangée sur le
 * projet, vide tant qu'on ne l'a pas définie. Tant qu'elle est vide, la tête de
 * la colonne ne propose pas de partir — elle propose d'INITIER. Une fois en
 * place, le bouton d'action revient et une icône de réglages, en haut à droite
 * de la colonne, rouvre le même tiroir pour la modifier.
 *
 * Deux procédures, une par étape, JAMAIS l'une pour l'autre :
 *  - `dev`        → `Project.deploiement` (nouveau) ;
 *  - `production` → `Project.miseEnProduction` (celle qui existait déjà).
 *
 * Le marqueur `constate` est le PONT avec l'existant : tous les projets déjà
 * inscrits le portent (migration 22), ce qui veut dire « garde le déroulé
 * constaté d'avant ». Un projet neuf ne le porte pas, et n'a donc aucune
 * procédure tant qu'un agent ne l'a pas écrite.
 *
 * Règles PURES : ni base, ni disque, ni date.
 */

import type { CiblePublication } from './etapes-publication.js';

/** Ce qu'on garde d'une procédure écrite : au-delà, c'est de la documentation. */
export const PROCEDURE_MAX = 8000;

/** Ce qu'un projet range pour son DÉPLOIEMENT sur l'instance de dev. */
export type ProcedureDeploiement = {
  /** Ce que l'utilisateur a répondu, dans ses mots — la base de la procédure. */
  base?: string;
  /** La procédure écrite par l'agent, suivie à chaque déploiement. */
  prompt?: string;
  /**
   * Le déroulé CONSTATÉ d'avant cette règle : HaikoDev, sinon le service
   * système, sinon le dossier servi. Porté par tous les projets déjà inscrits,
   * jamais par un projet neuf.
   */
  constate?: boolean;
};

/** Ce qu'un projet porte, vu d'ici : une procédure par étape, et rien d'autre. */
export type ProjetAvecProcedures = {
  deploiement?: ProcedureDeploiement;
  miseEnProduction?: { base?: string; prompt?: string; type?: string };
};

function texte(valeur: unknown): string {
  return typeof valeur === 'string' ? valeur.trim() : '';
}

/**
 * La procédure de CETTE étape est-elle définie ?
 *
 * Pour le déploiement : une procédure écrite, ou le marqueur « constaté » des
 * projets d'avant. Pour la mise en production : un prompt écrit, ou un TYPE de
 * cible explicitement choisi (aucune, SSH, FTP) — ces trois-là se règlent sans
 * prompt, et un accès incomplet se dit ailleurs, ce n'est pas le même sujet.
 */
export function procedureEnPlace(
  projet: ProjetAvecProcedures | undefined,
  cible: CiblePublication,
): boolean {
  if (!projet) return false;
  if (cible === 'dev') {
    return projet.deploiement?.constate === true || !!texte(projet.deploiement?.prompt);
  }
  const type = texte(projet.miseEnProduction?.type);
  if (type && type !== 'consigne') return true;
  return !!texte(projet.miseEnProduction?.prompt);
}

/** La procédure écrite de cette étape, ou la chaîne vide. Point de lecture unique. */
export function procedureDeLEtape(
  projet: ProjetAvecProcedures | undefined,
  cible: CiblePublication,
): string {
  if (cible === 'dev') {
    if (projet?.deploiement?.constate === true) return '';
    return texte(projet?.deploiement?.prompt);
  }
  return texte(projet?.miseEnProduction?.prompt);
}

/** Ce que l'utilisateur avait répondu, quand on rouvre le tiroir pour modifier. */
export function baseDeLaProcedure(
  projet: ProjetAvecProcedures | undefined,
  cible: CiblePublication,
): string {
  return cible === 'dev' ? texte(projet?.deploiement?.base) : texte(projet?.miseEnProduction?.base);
}

/* ------------------------------------------------------------------ */
/* Les mots de l'écran                                                  */
/* ------------------------------------------------------------------ */

/** Le nom de l'étape, tel qu'on l'écrit partout. */
export function titreDeLaProcedure(cible: CiblePublication): string {
  return cible === 'dev' ? 'Déploiement' : 'Mise en production';
}

/** Le bouton qui remplace l'action tant que rien n'est défini. */
export function libelleInitier(cible: CiblePublication): string {
  return cible === 'dev' ? 'Initier le déploiement' : 'Initier la mise en production';
}

/** L'icône de réglages, une fois la procédure en place : ce qu'elle dit au survol. */
export function libelleReglages(cible: CiblePublication): string {
  return cible === 'dev'
    ? 'Modifier la procédure de déploiement'
    : 'Modifier la procédure de mise en production';
}

/**
 * Le refus d'une mise en ligne dont la procédure n'est pas définie.
 *
 * Il vit ici pour que le serveur (qui refuse `deploy.start`) et l'interface (qui
 * n'affiche même pas le bouton d'action) disent la MÊME chose, et il renvoie à
 * l'endroit exact où l'on initie : la tête de la colonne, pas un onglet perdu.
 */
export function refusSansProcedure(cible: CiblePublication): string {
  return `Aucune procédure de ${titreDeLaProcedure(cible).toLowerCase()} n’est définie pour ce projet : rien ne part. Cliquez sur « ${libelleInitier(cible)} » en tête de la colonne.`;
}

/* ------------------------------------------------------------------ */
/* Le dialogue avec l'agent                                             */
/* ------------------------------------------------------------------ */

/**
 * Les repères qui entourent la procédure finale dans la réponse de l'agent.
 *
 * Un agent qui pose une QUESTION répond en texte simple ; un agent qui a de quoi
 * ÉCRIRE la procédure l'enferme entre ces deux repères. C'est ce qui permet de
 * savoir, sans deviner, si le tiroir doit attendre une réponse de plus ou
 * enregistrer.
 */
export const DEBUT_PROCEDURE = '<<<PROCEDURE';
export const FIN_PROCEDURE = 'PROCEDURE>>>';

/** Ce que l'agent a rendu : une question de plus, ou la procédure écrite. */
export type ReponseDeProcedure = { question: string; procedure?: undefined } | { procedure: string; question?: undefined };

/**
 * Lit la réponse de l'agent.
 *
 * Le bloc encadré gagne toujours : un agent qui écrit la procédure peut la faire
 * précéder d'une phrase, elle n'est alors qu'un accompagnement. Sans bloc, tout
 * le texte est une question — y compris quand l'agent propose des options.
 */
export function lireReponseDeProcedure(brut: string): ReponseDeProcedure {
  const propre = (brut ?? '').trim();
  const debut = propre.indexOf(DEBUT_PROCEDURE);
  const fin = propre.lastIndexOf(FIN_PROCEDURE);
  if (debut !== -1 && fin > debut) {
    const procedure = propre.slice(debut + DEBUT_PROCEDURE.length, fin).trim();
    if (procedure) return { procedure: procedure.slice(0, PROCEDURE_MAX) };
  }
  return { question: propre };
}

/** Ce que le projet apporte au dialogue : de quoi ne pas questionner à l'aveugle. */
export type ContexteDeProcedure = {
  /** Le nom du projet. */
  projet: string;
  /** Son dossier de travail sur ce serveur. */
  dossier: string;
  /** L'adresse de l'instance de dev, quand le projet en règle une. */
  devUrl?: string;
  /** La procédure déjà en place, quand on rouvre le tiroir pour la modifier. */
  actuelle?: string;
};

/** Ce que chaque étape recouvre, dit à l'agent pour qu'il ne mélange pas les deux. */
function perimetre(cible: CiblePublication): string[] {
  if (cible === 'dev') {
    return [
      'Le DÉPLOIEMENT met le code sur l’instance de TRAVAIL de ce serveur — celle que l’équipe regarde, pas celle du client.',
      'Les cartes passent alors de « À déployer » à « En production », sans être closes.',
    ];
  }
  return [
    'La MISE EN PRODUCTION met le code chez le CLIENT, à son adresse publique.',
    'Les cartes du lot sont ensuite closes puis archivées : c’est la dernière étape.',
  ];
}

/**
 * LE PREMIER TOUR : l'agent lit le projet et DEMANDE quelle procédure on veut.
 *
 * Il ne propose pas dans le vide : il a lu le dossier, il sait s'il y a un
 * service, un script de construction, un dossier servi. Sa question tient en
 * quelques lignes et se répond en une phrase — c'est un tiroir, pas un
 * formulaire.
 */
export function promptOuvertureProcedure(cible: CiblePublication, ctx: ContexteDeProcedure): string {
  const lignes: (string | null)[] = [
    `Tu prépares la procédure de ${titreDeLaProcedure(cible).toUpperCase()} du projet « ${ctx.projet} ». Pour l’instant, tu ne fais que POSER LA QUESTION.`,
    '',
    ...perimetre(cible),
    '',
    `Dossier du projet : ${ctx.dossier}`,
    ctx.devUrl ? `Adresse de l’instance de dev réglée : ${ctx.devUrl}` : 'Aucune adresse d’instance de dev n’est réglée.',
    ctx.actuelle
      ? ['Une procédure est DÉJÀ en place — tu vas la MODIFIER, pas repartir de zéro :', '--- procédure actuelle ---', ctx.actuelle, '--- fin ---'].join('\n')
      : 'Aucune procédure n’existe encore pour cette étape.',
    '',
    'Va LIRE le projet avant de parler : fichiers de configuration, scripts de construction, service système, documentation, adresse servie. Ne modifie rien, ne lance aucune publication.',
    '',
    'Puis écris, en français simple et pour un lecteur non technique :',
    '- une phrase qui dit ce que tu as constaté du projet ;',
    `- LA question : comment cette étape doit-elle se passer pour ce projet ?`,
    '- deux ou trois pistes courtes, en liste, tirées de ce que tu as vraiment vu (jamais inventées).',
    '',
    'Reste sous 1200 signes. Ne rends AUCUN bloc de procédure à ce tour-ci : on attend la réponse de l’utilisateur.',
    '',
    'Ta question s’affiche DANS LE TIROIR ouvert en bas de l’écran, et c’est là qu’on te répond — que tu l’écrives en texte ou que tu passes par l’outil « ask_user ». Si tu passes par l’outil, la réponse te revient dans le MÊME tour : écris alors la procédure aussitôt, enfermée entre ces deux repères et rien d’autre autour —',
    `${DEBUT_PROCEDURE} …la procédure… ${FIN_PROCEDURE}`,
  ];
  return lignes.filter((ligne): ligne is string => ligne !== null).join('\n');
}

/**
 * LE TOUR SUIVANT : l'utilisateur a répondu, l'agent écrit la procédure.
 *
 * Il peut encore poser une question s'il manque vraiment quelque chose — mais
 * dès qu'il a de quoi écrire, il rend la procédure entre les deux repères, et
 * c'est ce bloc-là qui est enregistré.
 */
export function promptReponseProcedure(cible: CiblePublication, reponse: string): string {
  return [
    'L’utilisateur a répondu :',
    '<<<REPONSE',
    (reponse ?? '').trim(),
    'REPONSE',
    '',
    `Si sa réponse suffit, écris maintenant la PROCÉDURE de ${titreDeLaProcedure(cible).toLowerCase()} : les gestes DANS L’ORDRE, un par ligne, en français simple ; ce qu’il faut contrôler et à quoi on voit que c’est réellement en ligne ; ce qu’il ne faut surtout pas faire.`,
    'Reste FIDÈLE à sa réponse : tu la mets en forme et tu la précises avec ce que tu as lu du projet, tu n’inventes aucune étape qu’elle ne dit pas.',
    'Le code sera DÉJÀ fusionné, enregistré et envoyé sur le dépôt quand cette procédure servira : n’y mets aucune manœuvre git de fusion ou d’envoi, HaikoDev s’en charge.',
    '',
    `Rends-la enfermée entre ces deux repères, seule et sans bloc de code autour :`,
    DEBUT_PROCEDURE,
    '…la procédure…',
    FIN_PROCEDURE,
    '',
    `S’il te manque VRAIMENT une information sans laquelle la procédure serait fausse, pose une seule question courte à la place, sans aucun repère. Reste sous ${PROCEDURE_MAX} signes. Tu ne DÉPLOIES rien et ne modifies aucun fichier : tu ne fais que RÉDIGER.`,
  ].join('\n');
}

/**
 * MODIFIER UNE PROCÉDURE DÉJÀ ÉCRITE, sans repartir de la question d'ouverture.
 *
 * On rouvre le tiroir avec une procédure en place, on écrit ce qu'on veut y
 * changer, et c'est un agent NEUF qui reçoit la demande : le dialogue de la
 * fois précédente a disparu depuis longtemps (il ne vit qu'en mémoire), donc
 * `promptReponseProcedure` — qui suppose la session encore ouverte — lui
 * parlerait d'un projet qu'il n'a jamais lu. Ce prompt-ci porte donc le
 * contexte ET la demande, et attend la procédure corrigée dans le même tour.
 */
export function promptModificationProcedure(
  cible: CiblePublication,
  ctx: ContexteDeProcedure,
  demande: string,
): string {
  const existante = (ctx.actuelle ?? '').trim();
  const lignes: string[] = [
    existante
      ? `Tu modifies la procédure de ${titreDeLaProcedure(cible).toUpperCase()} du projet « ${ctx.projet} ».`
      : `Tu écris la procédure de ${titreDeLaProcedure(cible).toUpperCase()} du projet « ${ctx.projet} ».`,
    '',
    ...perimetre(cible),
    '',
    `Dossier du projet : ${ctx.dossier}`,
    ctx.devUrl ? `Adresse de l’instance de dev réglée : ${ctx.devUrl}` : 'Aucune adresse d’instance de dev n’est réglée.',
    '',
    existante
      ? ['Procédure ACTUELLE, celle qui est suivie aujourd’hui :', '--- procédure actuelle ---', existante, '--- fin ---'].join('\n')
      : 'Aucune procédure n’existe encore pour cette étape.',
    '',
    'Ce que l’utilisateur demande :',
    '<<<DEMANDE',
    (demande ?? '').trim(),
    'DEMANDE',
    '',
    'Va vérifier dans le projet ce que cette demande touche (fichiers de configuration, scripts, service système, adresse servie), puis ÉCRIS la procédure ENTIÈRE en tenant compte de ce qu’elle dit : les gestes dans l’ordre, un par ligne, en français simple ; ce qu’il faut contrôler ; ce qu’il ne faut surtout pas faire.',
    existante
      ? 'Garde tout ce que la demande ne remet pas en cause : tu modifies une procédure qui marche, tu n’en inventes pas une autre.'
      : 'Reste FIDÈLE à la demande : tu la mets en forme et tu la précises avec ce que tu as lu du projet, tu n’inventes aucune étape qu’elle ne dit pas.',
    'Le code sera DÉJÀ fusionné, enregistré et envoyé sur le dépôt quand cette procédure servira : n’y mets aucune manœuvre git de fusion ou d’envoi, HaikoDev s’en charge.',
    'Ne modifie aucun fichier et ne déploie rien : tu ne fais que RÉDIGER.',
    '',
    'Rends-la enfermée entre ces deux repères, seule et sans bloc de code autour :',
    DEBUT_PROCEDURE,
    '…la procédure…',
    FIN_PROCEDURE,
    '',
    `S’il te manque VRAIMENT une information sans laquelle la procédure serait fausse, pose une seule question courte avec l’outil « ask_user » et attends la réponse. Reste sous ${PROCEDURE_MAX} signes.`,
  ];
  return lignes.join('\n');
}

/* ------------------------------------------------------------------ */
/* LE TOUR NE SE LIVRE PLUS PAR LA RÉPONSE D'UNE REQUÊTE                */
/* ------------------------------------------------------------------ */

/**
 * Un tour de ce tiroir dure une à deux MINUTES : l'agent lit tout le projet
 * avant de parler. Faire attendre la réponse d'une commande pendant tout ce
 * temps rendait le dialogue impossible à suivre et surtout impossible à
 * RATTRAPER — tiroir refermé, page rechargée, serveur redémarré, réseau qui
 * cligne : la question, déjà payée, était perdue sans un mot, et chaque
 * réouverture repayait un tour.
 *
 * Le dialogue vit donc SUR LE SERVEUR, et l'écran ne fait que le suivre. Les
 * règles qui suivent sont pures : elles disent quoi afficher et quand relancer,
 * sans base ni disque.
 */

/** Une bulle du dialogue : ce que l'agent a dit, ce qu'on lui a répondu. */
export type EchangeDeProcedure = { qui: 'agent' | 'moi'; texte: string };

/**
 * LA QUESTION QUE L'AGENT POSE AVEC SON OUTIL, portée jusqu'au tiroir.
 *
 * Un agent ne finit pas un tour sur une question écrite en texte : la méthode
 * du projet lui impose l'outil `ask_user`, qui ARRÊTE son tour jusqu'à la
 * réponse. Cette question-là s'affichait donc dans la cloche du bandeau (avec
 * toutes les autres décisions attendues) mais NULLE PART dans le tiroir ouvert
 * juste dessous — celui-ci restait sur « L'agent travaille… », sans rien à
 * répondre, alors que c'est exactement l'endroit où on l'attend.
 *
 * L'état du dialogue la porte donc, avec de quoi y répondre sur place :
 * le message qui la tient et son identifiant, comme partout ailleurs.
 */
export type QuestionDeProcedure = {
  messageId: string;
  questionId: string;
  texte: string;
  /** Les choix proposés, quand l'agent en propose : un clic répond. */
  options: { id: string; label: string; description?: string }[];
};

/** Le dialogue d'une étape, tel que le serveur le garde et l'écran l'affiche. */
export type EtatDeProcedure = {
  projectId: string;
  cible: CiblePublication;
  /** L'agent qui mène le dialogue : la question et la réponse dans une session. */
  agentId?: string;
  /** Un tour tourne-t-il en ce moment ? C'est LUI qui allume le témoin. */
  enCours: boolean;
  echanges: EchangeDeProcedure[];
  /** La procédure écrite ET enregistrée, quand le dialogue aboutit. */
  procedure?: string;
  /** Ce qui a empêché le tour d'aboutir, dit en clair. */
  raison?: string;
  /**
   * L'instant où le DERNIER tour est parti : de quoi afficher sa durée pendant
   * qu'il tourne, et de quoi juger ensuite si sa question est encore fraîche.
   * Il n'est donc PAS effacé à la fin du tour — sinon toute question posée
   * tiroir fermé paraissait vieille et se repayait à la réouverture.
   */
  depuis?: number;
  /** La question posée par l'outil de l'agent, tant que personne n'y a répondu. */
  question?: QuestionDeProcedure;
};

/** Au-delà, le projet a pu changer : on repose la question plutôt que la relire. */
export const DIALOGUE_FRAIS_MS = 15 * 60 * 1000;

/**
 * Ce qu'un tiroir qui s'OUVRE doit faire du dialogue déjà là.
 *
 *  - `attendre`  : un tour tourne encore, on s'y raccroche — on n'en paie pas un second ;
 *  - `reprendre` : le tour est fini et sa question (ou son échec) n'a pas été lue ;
 *  - `proposer`  : une procédure est DÉJÀ écrite — on la montre, on ne demande rien ;
 *  - `relancer`  : rien à reprendre et rien d'écrit, un tour part.
 *
 * UNE PROCÉDURE EN PLACE NE SE REDEMANDE JAMAIS TOUTE SEULE. L'icône de
 * réglages relançait un agent complet à CHAQUE clic : il relisait tout le
 * projet (une à deux minutes, un tour payé) pour reposer depuis le début une
 * question déjà tranchée, alors que la procédure était là, sous les yeux. Le
 * tiroir affiche donc ce qui existe et attend un geste : ou bien on écrit ce
 * qu'on veut changer, ou bien on clique pour reposer la question.
 *
 * Un échec ne se relance pas non plus tout seul : une panne de quota rejouée à
 * chaque ouverture coûterait sans rien rendre. C'est le bouton qui décide.
 */
export function repriseDuDialogue(
  etat: EtatDeProcedure | null | undefined,
  maintenant: number,
  procedureEcrite = false,
): 'attendre' | 'reprendre' | 'proposer' | 'relancer' {
  if (etat?.enCours) return 'attendre';
  if (etat?.raison) return 'reprendre';
  // Une procédure écrite clôt le dialogue : rouvrir, c'est vouloir la modifier.
  if (etat?.procedure) return 'proposer';
  const fraiche =
    !!etat &&
    (!!etat.question || etat.echanges.some((echange) => echange.qui === 'agent')) &&
    maintenant - (etat.depuis ?? 0) <= DIALOGUE_FRAIS_MS;
  if (fraiche) return 'reprendre';
  return procedureEcrite ? 'proposer' : 'relancer';
}

/** Le témoin de travail : jamais un mot seul, toujours ce qui se passe et depuis quand. */
export function phraseDeTravail(
  input: { depuis?: number; etape?: string },
  maintenant: number,
): string {
  const secondes = input.depuis ? Math.max(0, Math.round((maintenant - input.depuis) / 1000)) : 0;
  const duree =
    secondes >= 60
      ? `${Math.floor(secondes / 60)} min ${String(secondes % 60).padStart(2, '0')} s`
      : `${secondes} s`;
  const etape = (input.etape ?? '').trim().slice(0, 80);
  return etape ? `L’agent travaille… ${etape} · ${duree}` : `L’agent travaille… ${duree}`;
}

/** Le tour attendu n'existe plus : le dire, au lieu de tourner sans fin. */
export const RAISON_TOUR_PERDU =
  'Le tour de l’agent ne tourne plus (serveur redémarré, ou agent arrêté). Rien n’a été écrit : relancez la question.';

/** Ce qu'un tour d'agent a rendu : une question, la procédure, ou un échec dit en clair. */
export type IssueDuTour = { question: string } | { procedure: string } | { raison: string };

/**
 * L'ISSUE D'UN TOUR, décidée en un seul endroit.
 *
 * Un tour qui ne rend rien, un agent qui s'arrête, une panne du moteur : chacun
 * a sa phrase. Rien ne « reste en cours » faute d'avoir su quoi dire.
 */
export function issueDuTour(input: { contenu?: string; statut?: string; erreur?: string }): IssueDuTour {
  const erreur = (input.erreur ?? '').trim();
  if (erreur) return { raison: `Le tour de l’agent s’est arrêté : ${erreur}` };
  if (input.statut && input.statut !== 'done') {
    return { raison: `Le tour de l’agent s’est terminé en « ${input.statut} », sans réponse.` };
  }
  const contenu = (input.contenu ?? '').trim();
  if (!contenu) return { raison: 'L’agent n’a rien rendu : aucune question, aucune procédure.' };
  const lue = lireReponseDeProcedure(contenu);
  return lue.procedure ? { procedure: lue.procedure } : { question: lue.question ?? contenu };
}

/**
 * Ce que le tiroir dit quand une procédure existe DÉJÀ : rien n'a été demandé à
 * un agent, et rien ne le sera sans un geste. Cette phrase remplace le témoin
 * de travail qui s'allumait tout seul à chaque clic sur l'icône de réglages.
 */
export function mentionProcedureEnPlace(cible: CiblePublication): string {
  return (
    `Une procédure de ${titreDeLaProcedure(cible).toLowerCase()} est déjà en place : aucun agent n’a été ` +
    'lancé. Écrivez ci-dessous ce que vous voulez y changer, ou reposez la question depuis le début.'
  );
}

/** Le bouton qui, lui, paie un tour : on ne repose la question que si on le veut. */
export const LIBELLE_REPOSER_LA_QUESTION = 'Reposer la question depuis le début';

/** L'état de la procédure, dit en une ligne dans le tiroir. */
export function mentionProcedure(cible: CiblePublication, procedure: string): string {
  const propre = (procedure ?? '').trim();
  if (!propre) return `Aucune procédure de ${titreDeLaProcedure(cible).toLowerCase()} : rien ne peut partir.`;
  const lignes = propre.split('\n').filter((ligne) => ligne.trim()).length;
  return `Procédure en place : ${propre.length} signes, ${lignes} ligne${lignes > 1 ? 's' : ''}.`;
}
