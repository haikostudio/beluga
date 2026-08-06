/**
 * CONFIER LA MISE EN PRODUCTION À UN AGENT QUI SUIT LE PROMPT RÉGLÉ.
 *
 * La publication enchaînait sept étapes figées, les mêmes pour tous les
 * projets : fusion, enregistrement, envoi, vérification, construction, mise en
 * ligne, redémarrage. Un agent de rôle « deploy » n'entrait en jeu qu'en
 * SECOURS — conflit de fusion, construction cassée, contrôle tombé. Décrire un
 * déploiement propre à un projet (« pousse sur le dépôt du client, puis lance
 * la commande X sur la machine Y ») était impossible : `planDeMiseEnLigne` ne
 * connaît que quatre moyens et refuse tout ce qui n'y entre pas.
 *
 * Le projet porte donc UN PROMPT DE MISE EN PRODUCTION, réglé dans ses
 * paramètres (`shared/src/mise-en-production.ts`). Quand il est écrit, la mise
 * en ligne proprement dite est confiée à un agent : il reçoit le prompt tel
 * quel, le lot de cartes embarquées et l'environnement visé avec son adresse et
 * sa branche, et il mène le travail.
 *
 * Ce qui NE bouge pas : la plomberie git (fusion, enregistrement, envoi) reste
 * celle de HaikoDev — c'est elle qui garantit le lot, l'attente d'accord d'un
 * projet « se déploie sur envoi » et la fermeture des branches. Et sans prompt
 * écrit, rien de tout cela ne s'applique : le déroulé d'avant tient mot pour
 * mot. Le prompt ne vaut QUE pour la mise en production ; la mise sur
 * l'environnement de dev ne le lit pas.
 *
 * Règles PURES : ni base, ni disque, ni date, ni horloge — donc rejouables.
 */

/* ------------------------------------------------------------------ */
/* Les étapes, et ce que chacune dit                                    */
/* ------------------------------------------------------------------ */

/**
 * Les quatre étapes que l'agent prend en charge. Les sept étapes de la
 * publication ne sont ni renommées ni supprimées : celles-ci changent
 * simplement de main. Les trois premières — fusion, enregistrement, envoi —
 * restent à HaikoDev.
 */
export const ETAPES_CONFIEES = ['verify', 'build', 'publish', 'restart'] as const;
export type EtapeConfiee = (typeof ETAPES_CONFIEES)[number];

/**
 * Ce qu'une étape confiée AFFICHE quand ce n'est pas elle qui porte le travail.
 *
 * Jamais une étape muette : « ignoré » sans motif se lit comme une panne. Ces
 * trois-là disent que le prompt de mise en production les couvre, et l'étape
 * « Mise en ligne » porte le compte rendu de l'agent. L'environnement est NOMMÉ
 * — avec plusieurs environnements, « c'est l'agent qui la mène » ne dit pas où.
 */
export function mentionEtapeConfiee(etape: EtapeConfiee, environnement: string): string {
  const ou = `le prompt de mise en production du projet (environnement « ${environnement} »)`;
  switch (etape) {
    case 'verify':
      return `Vérification comprise dans ${ou} : c'est l'agent de mise en production qui la mène.`;
    case 'build':
      return `Construction comprise dans ${ou} : c'est l'agent de mise en production qui la mène.`;
    case 'restart':
      return `Relance comprise dans ${ou} : rien à relancer ici.`;
    default:
      return `Mise en ligne menée par l'agent de mise en production, d'après ${ou}.`;
  }
}

/* ------------------------------------------------------------------ */
/* Ce que l'agent reçoit                                                */
/* ------------------------------------------------------------------ */

/** Une carte du lot, telle que l'agent doit la lire. */
export type CarteDuLot = { titre: string; branche?: string };

/** Tout ce que l'agent de publication a besoin de savoir. */
export type ContexteDePublication = {
  /** Le nom du projet publié. */
  projet: string;
  /** Le dossier de travail, celui où la fusion vient d'atterrir. */
  dossier: string;
  /** L'environnement visé : son nom, son rôle, son adresse, sa branche. */
  environnement: { nom: string; role?: string; url?: string; branche?: string };
  /** Le prompt de mise en production du projet, repris TEL QUEL. */
  prompt: string;
  /** Les cartes embarquées par ce lot. */
  cartes: CarteDuLot[];
  /** L'enregistrement sur lequel le lot se pose, quand il est connu. */
  enregistrement?: string;
  /** Vrai quand cette étape CLÔT les cartes (dernière mise en ligne). */
  clot?: boolean;
};

/** Combien de cartes du lot sont nommées à l'agent avant d'être comptées. */
export const CARTES_NOMMEES_MAX = 12;

/**
 * La consigne envoyée à l'agent de mise en production.
 *
 * Elle vit ICI, dans une règle pure, pour deux raisons : un contrôle la lit
 * sans lancer un tour payant, et elle ne nomme AUCUN outil propre à un moteur —
 * elle vaut donc pareil sous Claude et sous Codex.
 *
 * Le prompt réglé par l'utilisateur est recopié TEL QUEL, entouré de repères :
 * le reformuler, c'est publier autre chose que ce qui est écrit.
 */
export function promptDeLAgentDeProduction(ctx: ContexteDePublication): string {
  const env = ctx.environnement;
  const nommees = ctx.cartes.slice(0, CARTES_NOMMEES_MAX);
  const reste = ctx.cartes.length - nommees.length;
  const lot = nommees.length
    ? [
        ...nommees.map((carte) => `- ${carte.titre}${carte.branche ? ` (branche ${carte.branche})` : ''}`),
        ...(reste > 0 ? [`- … et ${reste} autre(s)`] : []),
      ].join('\n')
    : '- (aucune carte : ce lot ne porte que du travail enregistré sans carte)';

  const lignes: (string | null)[] = [
    `La publication de « ${ctx.projet} » est EN COURS, et c'est TOI qui la mènes.`,
    '',
    `Environnement visé : « ${env.nom} »${env.role ? ` (${env.role})` : ''}`,
    `Dossier de travail : ${ctx.dossier}`,
    `Branche installée : ${env.branche?.trim() || 'la branche principale du dépôt'}`,
    env.url ? `Adresse à contrôler une fois en ligne : ${env.url}` : 'Aucune adresse à contrôler n’est réglée pour cet environnement.',
    ctx.enregistrement ? `Enregistrement mis en ligne : ${ctx.enregistrement}` : null,
    ctx.clot
      ? 'Cette mise en ligne est la DERNIÈRE étape : les cartes du lot seront closes ensuite.'
      : 'Cette mise en ligne est une étape intermédiaire : les cartes du lot resteront ouvertes ensuite.',
    '',
    `Le lot embarqué (${ctx.cartes.length} carte(s)) :`,
    lot,
    '',
    'Le code est DÉJÀ fusionné sur la branche installée, enregistré et envoyé sur le dépôt : il ne reste qu’à le mettre en ligne.',
    '',
    'PROMPT DE MISE EN PRODUCTION DE CE PROJET — suis-le tel quel :',
    '--- début du prompt ---',
    ctx.prompt,
    '--- fin du prompt ---',
    '',
    'Fais exactement ceci, et rien d’autre :',
    '1. Suis le prompt ci-dessus, de bout en bout. N’invente aucune étape qu’il ne demande pas.',
    '2. Si une construction ou un contrôle tombe, répare la CAUSE puis rejoue. Ne supprime, ne désactive et ne mets en commentaire AUCUN test.',
    '3. Tu es dans le dossier du projet, sur la branche installée : n’en change pas et ne crée pas de branche. Le dossier est PARTAGÉ — nomme tes fichiers un par un, jamais `git add -A`.',
    '4. Ne touche pas au tableau : n’archive, ne déplace et ne clôture aucune carte. HaikoDev s’en charge quand tu auras fini.',
    '5. Termine par un compte rendu COURT : ce qui est réellement parti en ligne, où, et à quoi tu le vois. Si quelque chose n’a pas pu partir, dis-le en toutes lettres avec sa cause — une publication annoncée sans rien en ligne est une faute.',
  ];
  // `null` = ligne ABSENTE (pas d'adresse réglée, pas d'enregistrement connu).
  // Une chaîne vide, elle, est une respiration voulue et reste en place.
  return lignes.filter((ligne): ligne is string => ligne !== null).join('\n');
}

/* ------------------------------------------------------------------ */
/* Ce que l'agent rapporte                                              */
/* ------------------------------------------------------------------ */

/** Combien de signes du compte rendu de l'agent tiennent dans l'étape. */
export const RECIT_MAX = 3000;

/**
 * Le compte rendu de l'agent, tel que l'étape « Mise en ligne » l'affiche.
 *
 * Un agent muet ne passe pas pour un agent content : l'étape le dit, et c'est
 * l'adresse publique — quand elle est réglée — qui tranchera juste après.
 */
export function recitDeLAgent(texte: string | undefined, environnement: string): string {
  const propre = texte?.trim();
  if (!propre) {
    return `L’agent de mise en production a travaillé sur « ${environnement} » mais n’a rendu aucun compte rendu.`;
  }
  return propre.length > RECIT_MAX ? `${propre.slice(0, RECIT_MAX)}\n…` : propre;
}

/**
 * Le refus, quand l'agent n'a pas mené le prompt de mise en production à son
 * terme.
 *
 * Un échec reste un échec, et il NOMME l'environnement : avec plusieurs
 * environnements, « la publication a échoué » ne dit pas lequel aller regarder.
 */
export function phraseDEchecConfie(environnement: string, raison?: string): string {
  const motif = raison?.trim();
  return `L’agent de mise en production n’a pas mené à son terme le prompt du projet sur « ${environnement} »${
    motif ? ` : ${motif}` : ''
  }. Rien n’est mis en ligne, les cartes restent à déployer.`;
}
