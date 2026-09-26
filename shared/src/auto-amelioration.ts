/**
 * LE RENDEZ-VOUS D'AUTO-AMÉLIORATION : chaque nuit vers 3 h.
 *
 * Beluga Build doit progresser de jour en jour sans qu'on le lui demande. Une fois
 * par nuit, un agent d'ANALYSE relit le mécanisme du projet et cherche ce qui
 * peut être amélioré — du temps perdu, du code que plus personne n'appelle, deux
 * fois la même chose, des pages que rien ne lit, une mémoire qui gonfle, deux
 * contrôles qui vérifient la même règle.
 *
 * Il ne CHANGE rien. Il PROPOSE, et c'est tout : ses trouvailles deviennent des
 * cartes en attente de validation, que l'utilisateur accepte ou écarte au
 * réveil. Le rôle « analysis » porte déjà cet interdit dans sa consigne (« tu
 * n'écris ni ne modifies aucun fichier »), et l'outil `propose_task` n'écrit
 * rien sur le tableau avant le clic.
 *
 * Les règles vivent ici, sans base ni disque : l'heure, la fenêtre de
 * rattrapage, les trois refus de lancement, le plafond de trouvailles et le
 * texte de la consigne. Elles se testent seules.
 */

/**
 * L'heure du rendez-vous : 3 h du matin. Heure creuse, personne n'attend le
 * serveur, et la réserve du jour n'est pas entamée. Fixe, comme l'heure creuse
 * des heures creuses : un réglage de plus sans écran pour le régler ne
 * servirait personne.
 */
export const HEURE_RENDEZ_VOUS = 3;

/**
 * La FENÊTRE de DÉPART, en heures pleines : 3 h, 4 h, 5 h.
 *
 * « Vers 3 h » et non « à 3 h pile » : la boucle du démon ne tombe pas à la
 * seconde. C'est la fenêtre où le rendez-vous COMMENCE à essayer — une fois
 * engagé dans une nuit (parce qu'un travail occupait la place), il n'y est
 * plus tenu : voir `ATTENTE_PLACE_MAX_MS` plus bas, qui dit jusqu'où il patiente.
 */
export const FENETRE_HEURES = 3;

/**
 * TANT QU'UNE PLACE MANQUE, LE RENDEZ-VOUS ATTEND — IL NE SAUTE PLUS LA NUIT.
 *
 * Avant cette règle, un travail encore en cours à 3 h faisait reporter le
 * rendez-vous de dix minutes en dix minutes, et si ça durait toute la fenêtre
 * (3 h-5 h), la nuit entière était sautée sans analyse ni carte — alors même
 * que le démon sait faire tourner plusieurs agents à la fois. Désormais, une
 * fois entré dans la fenêtre 3 h-5 h, le rendez-vous continue de guetter une
 * place libre bien après 5 h, jusqu'à ce qu'il en trouve une — dix-huit heures
 * au plus, pour laisser la place au rendez-vous du lendemain plutôt que de
 * chevaucher deux nuits.
 */
export const ATTENTE_PLACE_MAX_MS = 18 * 60 * 60 * 1000;

/** Un passage par nuit, jamais deux. */
export const PERIODE_MS = 24 * 60 * 60 * 1000;

/**
 * L'étiquette posée sur chaque carte issue du rendez-vous de la nuit. Elle
 * seule permet de les repérer d'un coup d'œil sur le tableau, au milieu des
 * cartes nées d'une demande de l'utilisateur.
 */
export const LABEL_AUTO_AMELIORATION = 'auto amélioration';

/**
 * L'ÉTIQUETTE DE LA CARTE DU RENDEZ-VOUS LUI-MÊME — distincte de celle des
 * propositions. La carte du rendez-vous suit le TOUR (sa conversation, sa
 * panne éventuelle) ; elle ne se cadre pas au réveil et n'a pas à porter la
 * phrase d'intro ludique réservée aux propositions.
 */
export const LABEL_RENDEZ_VOUS_DE_NUIT = 'rendez-vous de nuit';

/** Ce que la carte du rendez-vous dit d'elle-même. */
export function descriptionDuRendezVous(nomDuProjet: string): string {
  return (
    `Un agent d’analyse relit « ${nomDuProjet} » et propose au plus trois améliorations. Il ne modifie rien : ` +
    `ses propositions deviennent des cartes à part, dans « Planifié », étiquetées « ${LABEL_AUTO_AMELIORATION} ».` +
    '\n\nCette carte suit le tour lui-même : sa conversation montre ce que l’agent a lu et constaté, et une panne s’y dit en clair.'
  );
}

/** La phrase posée sur la carte du rendez-vous une fois le tour tenu : les propositions, nommées. */
export function rapportDuRendezVous(titres: readonly string[]): string {
  if (!titres.length) return 'Rendez-vous tenu : aucune proposition posée cette nuit.';
  return `Rendez-vous tenu : ${titres.length} proposition(s) posée(s) dans « Planifié » — ${titres
    .map((titre) => `« ${titre} »`)
    .join(', ')}.`;
}

/**
 * QUELQUES POINTS AU PLUS. Un tableau noyé sous vingt propositions ne se lit
 * pas : on n'en garderait aucune. Trois trouvailles réelles valent mieux que
 * vingt remarques, et la consigne le dit à l'agent en toutes lettres.
 */
export const PROPOSITIONS_MAX = 3;

/**
 * Ce que l'agent va chercher. La liste est ici, et non noyée dans la consigne :
 * c'est elle qui définit le rendez-vous, et un test peut la vérifier.
 */
export const AXES_D_EXAMEN = [
  'des gains de performance : un traitement refait à chaque tour ce qu\'il pourrait retenir, une boucle qui repasse sur tout, une requête lancée en double',
  'du code jamais appelé : une fonction exportée que plus personne n\'importe, une option de réglage qu\'aucun écran ne pose, une branche de code devenue inatteignable',
  'des doublons : deux fonctions qui font la même chose sous deux noms, une règle recopiée à deux endroits qui finiront par diverger',
  'des fichiers et des pages de documentation que plus rien ne lit ni ne cite',
  'la mémoire du projet qui gonfle : un fait redit trois fois, une ligne devenue fausse, un sujet qui a doublé de taille sans rien apprendre de neuf',
  'des contrôles qui font double emploi : deux tests qui verrouillent la même règle, un script de vérification que `npm test` couvre déjà entièrement',
] as const;

/**
 * Pourquoi le rendez-vous ne part pas cette fois-ci. Chaque raison se dit en
 * clair au journal : un rendez-vous muet dont on ne sait pas s'il a eu lieu ne
 * vaut rien.
 */
export type RaisonDeSauter =
  /** Il est 14 h : ce n'est ni l'heure ni la fenêtre. */
  | 'pas-l-heure'
  /** Le rendez-vous de cette nuit a déjà eu lieu. */
  | 'deja-passe'
  /** Un agent travaille : on ne lui prend ni sa place ni sa réserve. */
  | 'travail-en-cours'
  /** Le projet Beluga Build n'est pas inscrit, ou il a été mis de côté. */
  | 'projet-absent';

/** Le verdict du rendez-vous : partir, ou dire pourquoi non. */
export type DecisionDuRendezVous = { lancer: true } | { lancer: false; raison: RaisonDeSauter };

/** Cette heure tombe-t-elle dans la fenêtre du rendez-vous ? */
export function heureDuRendezVous(heure: number): boolean {
  for (let pas = 0; pas < FENETRE_HEURES; pas += 1) {
    if ((HEURE_RENDEZ_VOUS + pas) % 24 === heure) return true;
  }
  return false;
}

/**
 * Le rendez-vous a-t-il lieu maintenant ?
 *
 * L'ordre des refus est voulu. Le projet d'abord — sans lui il n'y a rien à
 * examiner. La périodicité ensuite : elle est vraie toute la journée et coûte
 * une lecture. L'heure après — sauf si l'attente est déjà engagée pour cette
 * nuit, auquel cas elle ne bloque plus. Le manque de place EN DERNIER, parce
 * que c'est le seul refus qui se rejoue dix minutes plus tard : les autres
 * sont acquis pour la nuit.
 *
 * Aucun rattrapage au démarrage : un serveur redémarré
 * à midi ne doit surtout pas lancer une analyse complète en pleine journée — la
 * réserve de la journée est précisément ce qu'on protège.
 */
export function decisionDuRendezVous(input: {
  /** Le projet à examiner est-il là, et vivant ? */
  projetPresent: boolean;
  /** L'instant du dernier passage, réussi ou non. */
  dernierPassage?: number;
  maintenant: number;
  heureCourante: number;
  /** Une place est-elle libre pour lancer l'agent d'analyse tout de suite ? */
  placeLibre: boolean;
  /**
   * Depuis quand le rendez-vous ATTEND une place pour cette nuit — absent
   * tant qu'il n'a pas encore commencé à attendre. Posé la première fois que
   * le manque de place le fait patienter, il permet aux essais SUIVANTS de
   * continuer même une fois sorti de la fenêtre 3 h-5 h : sans lui, le
   * rendez-vous se ferait à nouveau refuser pour « pas-l-heure » à 6 h, et la
   * nuit serait sautée malgré l'attente déjà commencée.
   */
  enAttenteDepuis?: number;
}): DecisionDuRendezVous {
  if (!input.projetPresent) return { lancer: false, raison: 'projet-absent' };
  if (input.dernierPassage !== undefined && input.maintenant - input.dernierPassage < PERIODE_MS) {
    return { lancer: false, raison: 'deja-passe' };
  }
  const dejaEnAttente =
    input.enAttenteDepuis !== undefined && input.maintenant - input.enAttenteDepuis < ATTENTE_PLACE_MAX_MS;
  if (!dejaEnAttente && !heureDuRendezVous(input.heureCourante)) {
    return { lancer: false, raison: 'pas-l-heure' };
  }
  if (!input.placeLibre) return { lancer: false, raison: 'travail-en-cours' };
  return { lancer: true };
}

/** La raison, écrite pour le journal du démon. */
export function raisonDite(raison: RaisonDeSauter): string {
  switch (raison) {
    case 'pas-l-heure':
      return `ce n'est pas l'heure (rendez-vous vers ${HEURE_RENDEZ_VOUS} h)`;
    case 'deja-passe':
      return 'le rendez-vous de cette nuit a déjà eu lieu';
    case 'travail-en-cours':
      return 'aucune place libre, le rendez-vous attend';
    case 'projet-absent':
      return 'aucun projet à examiner';
  }
}

/** Le titre de la conversation de la nuit, daté pour s'y retrouver. */
export function titreDuRendezVous(date: Date): string {
  const jour = date.toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `Auto-amélioration — nuit du ${jour}`;
}

/**
 * La consigne envoyée à l'agent de la nuit.
 *
 * Trois choses y sont dites et redites, parce que ce sont les trois façons dont
 * ce rendez-vous peut mal tourner : ne RIEN modifier (l'agent a les outils pour
 * le faire), ne proposer que ce qui a un GAIN RÉEL, et n'en proposer que
 * quelques-unes. Une nuit sans rien à dire est une bonne nuit : la consigne
 * autorise explicitement à ne rien proposer.
 */
export function consigneDAutoAmelioration(nomDuProjet: string): string {
  return `RENDEZ-VOUS D'AUTO-AMÉLIORATION — ${nomDuProjet}.

C'est la nuit, personne ne t'attend. Ton travail : examiner le MÉCANISME du projet et chercher ce qui peut être amélioré. Tu cherches :
${AXES_D_EXAMEN.map((axe) => `- ${axe}`).join('\n')}

TU NE MODIFIES RIEN. Aucun fichier écrit, aucun fichier effacé, aucun enregistrement, aucune commande qui change quoi que ce soit. Tu lis, tu cherches, tu constates — et tu t'arrêtes là. C'est l'utilisateur qui décidera au réveil, et un agent de tâche qui exécutera.

CHAQUE TROUVAILLE DEVIENT UNE PROPOSITION DE CARTE, avec l'outil « propose_task ». Ce rendez-vous se conclut SEUL : dès ton tour terminé, Beluga Build pose lui-même chaque proposition dans « Demande », étiquetée « ${LABEL_AUTO_AMELIORATION} », sans attendre de clic. Le LANCEMENT de ces cartes, lui, reste un geste de l'utilisateur — seule leur création n'attend plus personne. Rien d'autre ne sort de ce tour.

REMPLIS TOUJOURS LE CHAMP « contexte » DE « propose_task » : c'est la SYNTHÈSE du besoin, déposée en premier message de la conversation de l'agent qui exécutera la carte. Ici, personne n'a discuté avec toi : tu y écris donc ce que TU as constaté en cherchant — ce que tu as lu, où, ce qui t'a mis sur la piste, ce que tu as écarté et pourquoi. L'outil refuse une carte sans ce champ.

REMPLIS TOUJOURS LE CHAMP « intro » DE « propose_task ». C'est un lecteur non technique qui lira cette carte au réveil, pas un développeur : avant le Constat truffé de noms de fichiers, écris une ou deux phrases simples et ludiques, sans jargon ni chemin de fichier, qui disent en langage courant ce que la carte va changer et pourquoi ça vaut le coup. Le Constat, l'Attendu, les Limites et la Vérification restent aussi précis et techniques qu'avant — c'est ce texte d'intro qui les rend abordables, pas leur remplacement.

TROIS AU PLUS, ET SEULEMENT CE QUI A UN GAIN RÉEL. ${PROPOSITIONS_MAX} propositions est un plafond, pas un objectif : deux bonnes valent mieux que ${PROPOSITIONS_MAX} moyennes, et une nuit sans rien à proposer est une nuit normale — tu le dis alors en une ligne, sans forcer. Un gain réel se mesure : du temps gagné, des lignes retirées, un fichier de moins à tenir à jour. « Ce serait plus propre » n'en est pas un.

CE QUE TU NE PROPOSES JAMAIS : une réécriture large, un changement d'architecture, une refonte visuelle, ni rien qui touche à la façon dont les identifiants du projet sont rangés. Tu proposes des gestes courts, cernés, qu'un agent peut mener en un tour.

AVANT DE CONCLURE, VÉRIFIE : une chose que tu crois inutilisée doit être CHERCHÉE dans tout le projet avant d'être dite inutilisée. Un doublon supposé se lit aux deux endroits. Une trouvaille non vérifiée fait perdre plus de temps qu'elle n'en fait gagner — dans le doute, ne la propose pas.

Ta réponse finale tient en quelques lignes : ce que tu as examiné, ce que tu as retenu, ce que tu as écarté et pourquoi.`;
}

/* ------------------------------------------------------------------ */
/* CE QUE LA NUIT DEMANDE AU CADRAGE DE CHAQUE CARTE POSÉE             */
/* ------------------------------------------------------------------ */

/**
 * LA DEMANDE ENVOYÉE À L'AGENT DE CADRAGE D'UNE CARTE POSÉE PAR LA NUIT.
 *
 * Une carte d'auto-amélioration naissait MUETTE : son constat s'affichait en
 * premier message, mais aucun agent ne portait sa conversation — la barre
 * d'écriture restait éteinte (`composer.tsx` désactive l'envoi sans agent), et
 * la carte n'avait donc ni titre affiné, ni mémoire ouverte, ni compréhension.
 * On pouvait la commenter, pas en discuter.
 *
 * Elle reçoit désormais le MÊME agent de cadrage que la carte née du « + » de
 * « Planifié », et cette demande-ci en est le premier tour : le constat de la
 * nuit lui est remis comme une demande d'utilisateur, et le déroulé habituel
 * du cadrage s'y joue — jusqu'à la compréhension, PAS plus loin : comme toute
 * carte de jour, elle reste dans « Demande » tant que personne n'a demandé de
 * plan.
 *
 * DEUX DIFFÉRENCES AVEC UN CADRAGE ORDINAIRE : personne n'est devant l'écran à
 * 3 h du matin. Une question posée avec `ask_user` ARRÊTERAIT l'agent jusqu'à
 * la réponse — il tiendrait une place toute la nuit pour rien. La demande
 * interdit donc la question et impose de trancher en disant ses hypothèses ;
 * et elle interdit tout aussi explicitement le plan, qui ne se produit JAMAIS
 * de lui-même, ni de jour ni de nuit. L'utilisateur affine au réveil, en
 * écrivant dans le fil, puis demande lui-même le plan s'il le souhaite.
 *
 * Règle PURE : aucun accès à la base ni au moteur, elle se teste seule.
 */
export function demandeDeCadrageDeLaNuit(
  carte: {
    title: string;
    description?: string;
    /** La synthèse du besoin écrite par l'agent de la nuit (« contexte »). */
    briefing?: string;
  },
  nomDuProjet: string,
): string {
  const description = String(carte.description ?? '').trim();
  const constat = String(carte.briefing ?? '').trim();
  return `CETTE DEMANDE VIENT DU RENDEZ-VOUS D'AUTO-AMÉLIORATION DE LA NUIT, pas d'une personne au clavier. Un agent d'analyse a examiné ${nomDuProjet} pendant la nuit et a posé cette carte : c'est SA trouvaille que tu cadres maintenant, exactement comme si l'utilisateur venait de te l'écrire.

TITRE POSÉ PAR LA NUIT : ${carte.title}
${description ? `\nCE QUI EST DEMANDÉ :\n${description}\n` : ''}${
    constat ? `\nCE QUE L'AGENT DE LA NUIT A CONSTATÉ :\n${constat}\n` : ''
}
DÉROULE TON PROCESSUS HABITUEL DE CADRAGE, sans en sauter un temps : la carte porte déjà un titre, garde-le s'il dit juste le besoin et affine-le sinon. Ouvre la mémoire des sujets touchés, montre ce que tu y trouves, écris la carte en entier (description et niveau), puis RENDS CE QUE TU AS COMPRIS avec l'outil « rendre_comprehension » — ET ARRÊTE-TOI LÀ.

N'APPELLE JAMAIS « rendre_plan » CETTE NUIT, même si tout te semble déjà clair : le plan ne se produit jamais de lui-même, ni de jour ni de nuit, ici pas plus qu'ailleurs — seul un geste explicite de l'utilisateur, au réveil, le déclenche. Ton tour s'arrête avec la compréhension rendue.

NE POSE AUCUNE QUESTION AVEC « ask_user » : personne ne dort à côté de l'écran, et une question laisserait cette carte figée jusqu'au matin. Ce qui manque se tranche : tu annonces ton choix, tu dis « je suppose » là où tu supposes, et tu rends ce que tu as compris. L'utilisateur affinera au réveil en t'écrivant dans cette conversation, puis validera et lancera la tâche d'un seul geste — et c'est LUI qui allume l'interrupteur « Plan » s'il en veut un.

VÉRIFIE CE QUE LA NUIT AFFIRME avant de le reprendre : l'agent de la nuit n'a pas discuté avec l'utilisateur, et ce qu'il croit inutilisé ou dupliqué reste à confirmer. Ce dont tu n'es pas sûr se dit comme une supposition, dans les hypothèses de ta compréhension.`;
}
