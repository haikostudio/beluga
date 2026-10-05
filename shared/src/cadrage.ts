/**
 * LA CARTE-FIL : ON DISCUTE SA TÂCHE DANS LA CARTE, PLUS DANS LE CHEF D'ORCHESTRE.
 *
 * Avant, poser une tâche demandait deux endroits : le fil du chef d'orchestre
 * pour expliquer le besoin, puis une carte proposée, validée, lancée — et la
 * discussion restait derrière, dans un autre fil, invisible de la carte.
 *
 * Désormais le « + » de la colonne « Planifié » crée DIRECTEMENT la carte et
 * l'ouvre sur sa conversation. Un agent de CADRAGE y discute le besoin : il
 * questionne, lit la mémoire du projet, écrit le titre et le niveau de la
 * carte, et rend ce qu'il a COMPRIS par un outil (`rendre_comprehension`).
 * Quand l'utilisateur a fini d'expliquer, il clique « Générer le plan » : le
 * même agent rend un plan ENTIER par un outil (`rendre_plan`), versionné sur la
 * carte, que chaque message suivant affine en version n+1. Puis « Lancer la
 * tâche » confie le travail à un agent complet, avec toute la discussion et le
 * plan comme contexte de départ.
 *
 * LE PARCOURS N'EST PLUS DÉDUIT DU TEXTE : il vit sur la carte
 * (`shared/src/parcours-carte.ts`). Ce fichier garde ce qui appartient au
 * CADRAGE lui-même — sa consigne, ses verrous, ses textes, le contexte de
 * départ remis à l'exécution et le titre éclair.
 *
 * Règle PURE : ni base, ni disque, ni moteur. Elle se rejoue seule.
 */

/** Le titre d'une carte qui vient de naître et n'a encore rien dit. */
export const TITRE_CARTE_DE_CADRAGE = 'Nouvelle tâche';

/** Ce que la conversation d'une carte de cadrage encore vide annonce. */
export const MOT_CADRAGE = {
  titre: 'Dites ce que vous voulez faire',
  indice:
    'Expliquez votre besoin en quelques mots. On en discute ici, à moindre coût, puis « Lancer la tâche » confie le travail à un agent complet.',
};

/** Le libellé du bouton qui ferme le cadrage et lance le travail. */
export const BOUTON_LANCER_LA_TACHE = 'Lancer la tâche';

/**
 * Le libellé du geste qui l'accompagne : mettre la carte en file plutôt que de
 * la lancer tout de suite. Il vit DANS la barre d'action, juste au-dessus du
 * champ de saisie — les deux gestes de lancement d'une carte se prennent là où
 * la discussion se termine.
 */
export const BOUTON_DES_QUE_POSSIBLE = 'Dès que possible';

/**
 * Les raisons qui éteignent le geste de lancement, réunies pour être
 * TRADUITES : elles s'affichent à l'écran sans qu'aucun `t('…')` littéral ne
 * les nomme. Le parcours en ajoute d'autres (`RAISONS_DU_GESTE`).
 */
export const RAISONS_DU_BOUTON_LANCER = [
  'Attendez la fin de la réponse en cours.',
  'Dites d’abord ce que vous voulez faire.',
  'Attendez le plan proposé.',
] as const;

/**
 * LE FIL DES RECHERCHES DE MÉMOIRE NE S'AFFICHE PAS DANS LA CONVERSATION D'UNE
 * CARTE.
 *
 * Ces bulles — « Requête reçue », « Recherche effectuée », « Résumé compris »,
 * « Directives retrouvées » — disent ce que l'agent est allé LIRE avant de
 * travailler. Sur une carte, le parcours les porte déjà, repliées sous
 * « Travail de l'agent ». Une conversation SANS carte (un agent libre) les
 * garde : là, ce fil est son seul carnet de bord.
 */
export function filDesRecherchesAffiche(ctx: { surUneCarte: boolean }): boolean {
  return !ctx.surUneCarte;
}

/**
 * Ce que la carte de configuration annonce, en tête d'une tâche neuve. Elle
 * dit les deux choses qui comptent : ce choix est le vôtre, et il se fige à
 * L'ENVOI DE LA DEMANDE — pas au lancement. La conversation d'une carte
 * devient son PARCOURS dès le premier message, et la configuration y passe en
 * lecture seule (`ReglagesAgent`, `web/src/components/chat.tsx`) : promettre
 * une modification possible jusqu'au lancement serait faux.
 */
export const MOT_CONFIGURATION = {
  titre: 'Configurez l’agent de cette tâche',
  indice:
    'Choisissez le moteur, le modèle et le niveau de réflexion qui exécuteront cette tâche. Vous expliquerez votre besoin juste après ; ce choix reste modifiable jusqu’à la validation de la compréhension.',
};

/* ------------------------------------------------------------------ */
/* La discussion devenue contexte de départ                            */
/* ------------------------------------------------------------------ */

/** Ce qu'un message apporte au contexte de départ, et rien de plus. */
export interface MessageDeCadrage {
  role: string;
  content: string;
}

/**
 * Le contexte de départ ne doit pas coûter plus cher que le travail : au-delà
 * de ce plafond, on garde la FIN de la discussion (la plus récente, donc la
 * plus proche de ce qui a été décidé) et on dit ce qu'on a laissé.
 */
export const PLAFOND_DISCUSSION = 12000;

const QUI = (role: string): string => (role === 'user' ? 'VOUS' : 'CADRAGE');

/**
 * La discussion mise à plat, prête à être recollée dans la demande de
 * lancement. Rend une chaîne vide quand rien n'a été dit : l'appelant n'a
 * alors aucun bloc à poser.
 *
 * Seuls les tours de PAROLE comptent — un message d'outil ou de système n'est
 * pas ce que l'utilisateur a expliqué.
 */
export function discussionDeCadrage(messages: MessageDeCadrage[]): string {
  const utiles = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: (m.content ?? '').trim() }))
    .filter((m) => m.content.length > 0);
  if (!utiles.length) return '';

  const lignes = utiles.map((m) => `${QUI(m.role)} :\n${m.content}`);
  const texte = lignes.join('\n\n');
  if (texte.length <= PLAFOND_DISCUSSION) return texte;

  // On rogne par le DÉBUT : la fin porte les décisions.
  const gardees: string[] = [];
  let total = 0;
  for (let i = lignes.length - 1; i >= 0; i -= 1) {
    total += lignes[i].length + 2;
    if (total > PLAFOND_DISCUSSION && gardees.length) break;
    gardees.unshift(lignes[i]);
  }
  const coupes = lignes.length - gardees.length;
  const garde = gardees.join('\n\n');
  return coupes > 0 ? `(${coupes} échange(s) plus ancien(s) non recopié(s).)\n\n${garde}` : garde;
}

/**
 * LE BLOC ENTIER remis à l'agent d'exécution, en tête de sa demande. Il dit
 * d'où vient la discussion et ce qu'elle vaut : une intention exprimée par
 * l'utilisateur, pas une étude du projet.
 *
 * `sujetsDejaOuverts` (facultatif) : les passages et fiches de la mémoire que
 * l'agent de cadrage a LUS pendant cette discussion (`lecturesDeLaCarte`). Leur
 * contenu nourrit la conversation ci-dessous. Sans cette liste, l'agent
 * d'exécution n'a aucun moyen de savoir que c'est déjà fait et rouvre les mêmes
 * fiches pour rien.
 *
 * `plan` (facultatif) : le PLAN RETENU, tel que la carte le porte
 * (`card.parcours.plans`, dernière version). Il part en clair, à part de la
 * discussion : c'est le chemin que l'utilisateur a relu et lancé.
 *
 * `technique` (facultatif) : LA PART TECHNIQUE DE LA COMPRÉHENSION VALIDÉE.
 * Elle part MÊME EN L'ABSENCE DE TOUT PLAN — c'est justement ce qui rend le
 * plan facultatif : découpe du travail, faits du projet à respecter, risques.
 * Deux tiers des travaux exécutés n'ouvraient jamais la base de connaissances
 * du projet ; ce bloc la leur sert d'office.
 */
export function contexteDeDepart(
  messages: MessageDeCadrage[],
  sujetsDejaOuverts: string[] = [],
  plan?: { numero: number; texte: string; notesTechniques?: string },
  technique?: { taches: { titre: string; description: string }[]; faits: string[]; risques: string },
  /**
   * LES SUPPOSITIONS DE LA COMPRÉHENSION, et celles que l'utilisateur a
   * VALIDÉES d'un clic. Une validée vaut décision : elle part marquée
   * « confirmée par l'utilisateur », les autres restent des suppositions.
   */
  suppositions?: { hypotheses: readonly string[]; validees?: readonly string[] },
): string {
  const discussion = discussionDeCadrage(messages);
  if (!discussion && !plan && !technique) return '';
  const confirmees = new Set(suppositions?.validees ?? []);
  const blocSuppositions = suppositions?.hypotheses.length
    ? `\n\nCE QUE LE CADRAGE A SUPPOSÉ (une ligne « confirmée par l'utilisateur » vaut DÉCISION ; les autres restent à vérifier) :\n${suppositions.hypotheses
        .map((ligne) => `- ${ligne}${confirmees.has(ligne) ? ' — confirmée par l’utilisateur' : ''}`)
        .join('\n')}`
    : '';
  const sujets = [...new Set(sujetsDejaOuverts.filter((s) => s.trim().length > 0))];
  const rappelMemoire = sujets.length
    ? `\n\nFICHES DE MÉMOIRE DÉJÀ LUES PENDANT CE CADRAGE : ${sujets.join(', ')}. Ce qu'elles disent a nourri la conversation ci-dessus. Rouvre-les avec l'outil « memoire » seulement s'il te faut leur texte exact.`
    : '';
  /* Le plan affiché est écrit pour l'utilisateur, en mots simples : son détail
     technique voyage à part, et seulement ici. */
  const notes = plan?.notesTechniques?.trim()
    ? `\n\nNOTES TECHNIQUES DU PLAN (non montrées à l'utilisateur, à vérifier comme le reste) :\n${plan.notesTechniques.trim()}`
    : '';
  const blocPlan = plan
    ? `\n\nLE PLAN RETENU (version ${plan.numero}), relu et lancé par l'utilisateur — c'est le chemin à suivre ; ce qu'il affirme sur le code se vérifie avant d'être repris :\n\n${plan.texte}${notes}\n\nFIN DU PLAN RETENU.`
    : '';
  /*
   * LA PART TECHNIQUE DE LA COMPRÉHENSION VALIDÉE. Elle vaut l'accord de
   * l'utilisateur : c'est CE document qu'il a validé d'un clic avant de
   * dépenser un tour. Quand un plan l'accompagne, les deux partent ensemble —
   * le plan dit l'ORDRE, celle-ci dit le TERRAIN — et rien n'est redit.
   */
  const blocTechnique = technique
    ? [
        "\n\nLE DÉTAIL TECHNIQUE DE LA COMPRÉHENSION VALIDÉE — ce que l'agent de cadrage a relevé dans le projet, et sur quoi l'utilisateur a donné son accord. Ce qu'il affirme sur le code se vérifie avant d'être repris.",
        technique.taches.length
          ? `\n\nDÉCOUPE DU TRAVAIL :\n${technique.taches
              .map((tache, index) => `${index + 1}. ${tache.titre}${tache.description ? ` — ${tache.description}` : ''}`)
              .join('\n')}`
          : '',
        technique.faits.length
          ? `\n\nCE QUE LE PROJET SAIT DÉJÀ, À RESPECTER (tiré de sa base de connaissances) :\n${technique.faits
              .map((fait) => `- ${fait}`)
              .join('\n')}`
          : '',
        technique.risques.trim() ? `\n\nCE QUI RISQUE DE CASSER :\n${technique.risques.trim()}` : '',
        '\n\nFIN DU DÉTAIL TECHNIQUE.',
      ].join('')
    : '';
  return `CE QUI A ÉTÉ DIT AVANT LE LANCEMENT — la conversation de cadrage de cette carte, entre l'utilisateur (« VOUS ») et un agent léger (« CADRAGE ») qui n'a PAS ouvert le projet. C'est l'intention, pas une étude : ce qui y est affirmé sur le code se vérifie avant d'être repris.

${discussion || '(aucun échange recopié)'}

FIN DE LA CONVERSATION DE CADRAGE.${blocTechnique}${blocSuppositions}${blocPlan}${rappelMemoire}`;
}

/* ------------------------------------------------------------------ */
/* Le titre d'une carte qui n'en a pas encore                          */
/* ------------------------------------------------------------------ */

/** Le titre porte-t-il encore le mot par défaut ? */
export function titreEncoreVide(titre: string | undefined): boolean {
  const mot = (titre ?? '').trim();
  return !mot || mot.toLowerCase() === TITRE_CARTE_DE_CADRAGE.toLowerCase();
}

/**
 * La carte ouverte par le BOUTON ROBO du menu du bas n'existe vraiment que si
 * quelque chose y a été saisi — un message envoyé, ou un brouillon en train
 * de s'écrire. Sans l'un ni l'autre, elle repart en base à la fermeture du
 * tiroir : c'est cette décision, pure et testée seule, que `app.tsx` applique
 * à la fermeture (voir `carteRobotIdRef` dans `web/src/app.tsx`).
 */
export function carteRobotEstVide(etat: { nbMessages: number; brouillon?: string }): boolean {
  return etat.nbMessages <= 0 && !(etat.brouillon ?? '').trim();
}

/**
 * Les tags « [fichier: nom] » posés par le composeur : illisibles dans un
 * titre de carte, ils ne disent rien du besoin. On les retire avant d'en
 * tirer une phrase — le même motif que `TAG_FICHIER` de `ancres.ts`.
 */
const TAG_FICHIER_DU_TITRE = /\[fichier:\s*[^\]\n]+\]/g;

/** Le texte d'un message, débarrassé de ses tags de fichiers. */
function sansTagsDeFichier(texte: string): string {
  return texte.replace(TAG_FICHIER_DU_TITRE, ' ').replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * LE PLAFOND DU TITRE ÉCLAIR : plus court que celui d'un titre écrit à la main
 * (`MAX_SIGNES_TITRE`, 80). Ce titre-ci est POSÉ SANS MOTEUR, à la seconde où
 * la demande arrive : mieux vaut trois mots vifs qu'une phrase entière recopiée
 * dans une colonne étroite.
 */
export const MAX_SIGNES_TITRE_ECLAIR = 60;

/**
 * LES AMORCES QUI NE DISENT RIEN. « Bonjour, est-ce que tu peux… », « il
 * faudrait… », « j'aimerais que… » : ces mots ouvrent une phrase parlée, pas un
 * titre. Les retirer fait remonter le VERBE de la demande en tête — « Générer un
 * titre lisible » plutôt que « il faut générer un titre lisible ».
 *
 * L'ordre compte : on retire tant qu'une amorce est reconnue, donc les plus
 * longues avant les plus courtes.
 */
const AMORCES_CREUSES = [
  /^(bonjour|salut|coucou|hello|hey|yo)\s*[,!.:]*\s*/i,
  /^(s['’]?il te pla[îi]t|stp|svp)\s*[,]*\s*/i,
  /^(est-?ce que\s+)?(tu\s+)?(pourrais|peux|peut-on|pourrait-on)\s*(-tu|-on)?\s*/i,
  /^serait-il possible de\s+/i,
  /^(j['’]?ai besoin (que|de)|j['’]?aimerais (bien\s+)?(que|avoir)?|je (voudrais|veux|souhaite)(rais)?)\s+/i,
  /^(il (faut|faudrait)|on (doit|devrait)|tu (dois|devrais)|faut)\s+(que\s+)?/i,
  /^merci de\s+/i,
  /^(pour|dans) (ce|le) projet\s*[,:]?\s*/i,
  /^(la|le|les)\s+(demande|t[âa]che)\s*[:,]\s*/i,
];

/**
 * UN TITRE SIMPLE ET VIVANT, TIRÉ DE LA PHRASE DE L'UTILISATEUR — SANS MOTEUR.
 *
 * On garde SES mots (c'est ce qui rend le titre vivant : personne ne reconnaît
 * sa demande dans une reformulation administrative), et on ne fait que
 * l'alléger : tags de fichiers retirés, première phrase seulement, amorce de
 * politesse coupée, majuscule posée, ponctuation finale enlevée, plafond court.
 *
 * Rend une chaîne vide quand il n'y a rien à tirer — jamais une invention.
 */
export function titreEclairDeLaDemande(texte: string): string {
  const propre = sansTagsDeFichier(String(texte ?? '').trim());
  if (!propre) return '';
  /* La PREMIÈRE ligne qui porte quelque chose : une demande commence souvent
     par une ligne de tags, ou par un saut de ligne. */
  const ligne = propre.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  if (!ligne) return '';
  /* …et sa PREMIÈRE phrase : le reste est du détail, il a la description. */
  const premierePhrase = ligne.split(/(?<=[.!?…])\s+/)[0] ?? ligne;
  let mots = premierePhrase.trim();
  let coupe = true;
  while (coupe) {
    coupe = false;
    for (const amorce of AMORCES_CREUSES) {
      const apres = mots.replace(amorce, '');
      if (apres !== mots && apres.trim().length > 2) {
        mots = apres.trim();
        coupe = true;
      }
    }
  }
  mots = mots.replace(/\s+/g, ' ').replace(/[\s,;:.!?…]+$/u, '').trim();
  if (!mots) return '';
  if (mots.length > MAX_SIGNES_TITRE_ECLAIR) {
    const tranche = mots.slice(0, MAX_SIGNES_TITRE_ECLAIR);
    const espace = tranche.lastIndexOf(' ');
    mots = `${(espace > 25 ? tranche.slice(0, espace) : tranche).trim()}…`;
  }
  return mots.charAt(0).toLocaleUpperCase('fr-FR') + mots.slice(1);
}

/**
 * Un titre tiré de la discussion, quand l'agent de cadrage n'a pas pris la
 * peine d'en écrire un : la première phrase de la première demande, allégée par
 * `titreEclairDeLaDemande`. Mieux qu'une colonne de cartes toutes appelées
 * « Nouvelle tâche » — ou toutes affublées d'un « [fichier: IMG_1234.jpeg] » en
 * tête.
 */
export function titreDepuisLaDiscussion(messages: MessageDeCadrage[], secours = TITRE_CARTE_DE_CADRAGE): string {
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const titre = titreEclairDeLaDemande(message.content ?? '');
    if (titre) return titre;
  }
  return secours;
}

/**
 * LE TITRE POSÉ SANS MOTEUR EST PROVISOIRE, ET IL LE DIT.
 *
 * La carte reçoit son titre à la seconde où la demande arrive : la colonne ne
 * montre plus « Nouvelle tâche » pendant tout le premier tour. Mais ce titre-là
 * est une COPIE de la phrase de l'utilisateur, pas une lecture de la demande —
 * il ne vaut pas celui que l'agent de cadrage écrira.
 *
 * D'où ce drapeau, porté par la carte (`titreProvisoire`) :
 *
 *  - le VERROU du titre ne le prend pas pour un titre donné : l'agent doit
 *    toujours appeler `board_update_card` avant tout autre geste ;
 *  - le titre de l'agent REMPLACE le provisoire, au lieu d'être ignoré comme
 *    « titre déjà posé ».
 *
 * Un titre écrit à la main ou posé par l'agent n'est jamais provisoire, donc
 * jamais écrasé.
 */
export function titreDeCarteADonner(carte: { title?: string; titreProvisoire?: boolean }): boolean {
  return !titreEncoreVide(carte.title) && !carte.titreProvisoire;
}

/**
 * LE TITRE EST-IL ENCORE EN CONSTRUCTION ? — l'AFFICHAGE, pas le verrou.
 *
 * Vrai tant que le titre est vide (« Nouvelle tâche ») ou que c'est le titre
 * éclair recopié de la demande : l'écran montre alors un petit texte à la place
 * (« Titre en cours de création… »). Le titre reste stocké tel quel sur la
 * carte (toasts, étiquette de glisser, recherche) ; seul le rendu change.
 */
export function titreEnConstruction(carte: { title?: string; titreProvisoire?: boolean }): boolean {
  return titreEncoreVide(carte.title) || carte.titreProvisoire === true;
}

/* ------------------------------------------------------------------ */
/* LA MÉMOIRE S'OUVRE AVANT TOUT AUTRE GESTE                            */
/* ------------------------------------------------------------------ */

/**
 * LE CADRAGE COMMENCE PAR LIRE CE QUE LE PROJET SAIT.
 *
 * Il partait au travail — lecture de fichiers, recherche d'outils, écriture de
 * la carte — avant même d'avoir ouvert la mémoire du projet. Le déroulé est
 * donc VERROUILLÉ par le démon, pas seulement demandé au modèle : tant que la
 * mémoire n'a pas été ouverte, un outil de terrain est REFUSÉ À L'APPEL
 * (`hooksDuVerrouDAnalyse`) et sa carte n'est pas modifiable au-delà du titre.
 *
 * LE VERROU EST VIVANT, PAS FIGÉ AU LANCEMENT. Ces outils étaient retirés de la
 * liste blanche au départ du tour : le modèle les voyait toujours, les appelait,
 * et le moteur refusait en rouge ; et la liste ne bougeait plus de tout le tour,
 * même une fois la mémoire ouverte — 117 des 133 messages de cadrage porteurs de
 * refus étaient des PREMIERS messages. Le démon est désormais interrogé à chaque
 * appel : refus clair avant (`REFUS_AVANT_ANALYSE`), passage immédiat après.
 */
export const OUTILS_DE_TERRAIN_CADRAGE = [
  'Read',
  'Grep',
  'Glob',
  'Bash',
  'BashOutput',
  'KillShell',
  'WebFetch',
  'WebSearch',
] as const;

/**
 * PRÉPARER UN OUTIL N'EST PAS UN GESTE DE TERRAIN. `ToolSearch` charge le schéma
 * d'un outil différé — dont celui de la mémoire elle-même. Le verrouiller
 * murait tout modèle qui ne connaissait pas encore `mcp__beluga__memoire` :
 * carte de nuit fd54689b (claude-haiku-4-5), dix refus de suite puis
 * « comprehension-reclamee — sans réponse ». Ces outils passent TOUJOURS, avant
 * comme après l'ouverture de la mémoire.
 */
export const OUTILS_DE_PREPARATION_CADRAGE = ['ToolSearch'] as const;

/** Un outil est-il retenu par le verrou tant que la mémoire n'est pas ouverte ? */
export function outilVerrouilleAvantAnalyse(nom: string): boolean {
  if ((OUTILS_DE_PREPARATION_CADRAGE as readonly string[]).includes(nom)) return false;
  return (OUTILS_DE_TERRAIN_CADRAGE as readonly string[]).includes(nom);
}

/**
 * Les réglages Claude qui posent le verrou d'analyse devant chaque outil de
 * terrain. Le script du dépôt demande au démon si la mémoire est ouverte ; au
 * moindre doute (démon muet, réponse illisible), il LAISSE PASSER : un verrou
 * en panne ne doit jamais murer tout le cadrage.
 */
export function hooksDuVerrouDAnalyse(cheminDuVerrou: string): { PreToolUse: unknown[] } {
  return {
    PreToolUse: [
      {
        matcher: OUTILS_DE_TERRAIN_CADRAGE.join('|'),
        hooks: [{ type: 'command', command: `node ${cheminDuVerrou}` }],
      },
    ],
  };
}

/** L'analyse par sujet a-t-elle eu lieu ? Une ouverture de mémoire suffit. */
export function analyseDeCadrageFaite(etat: { ouverturesMemoire: number }): boolean {
  return etat.ouverturesMemoire > 0;
}

/**
 * LE TITRE EST LA SEULE CHOSE QU'ON PEUT ÉCRIRE AVANT D'AVOIR REGARDÉ.
 *
 * La carte ne se cadre qu'après la lecture — un niveau et une description
 * posés sur ce que le modèle IMAGINE du projet, c'est exactement ce que le
 * verrou empêche. Mais un titre de trois mots ne se déduit pas du projet : il
 * se déduit de la PHRASE de l'utilisateur, et le faire attendre laisse la
 * carte s'appeler « Nouvelle tâche » pendant tout le premier tour.
 *
 * LA SYNTHÈSE DE LA DEMANDE PASSE PAR LA MÊME PORTE, pour la même raison : elle
 * ne reformule que la PHRASE de l'utilisateur, jamais le projet. La faire
 * attendre la fin du tour laissait le fil sur « Votre demande est notée. »
 * pendant tout le travail de l'agent (`resumesDuFil`, `parcours-en-points.ts`).
 *
 * L'exception reste donc étroite : avant l'analyse, un appel qui ne porte que
 * le titre, que la synthèse, ou les deux ensemble passe ; dès qu'il porte autre
 * chose — description, niveau, étiquettes —, il est refusé comme avant.
 */
export const CHAMPS_DE_CARTE_AVANT_ANALYSE = ['title', 'resumeDemande'] as const;

export function ecritureDeCarteAutoriseeAuCadrage(etat: {
  analyseFaite: boolean;
  /** Les champs réellement fournis par l'appel (titre, description, niveau…). */
  champs: string[];
}): boolean {
  if (etat.analyseFaite) return true;
  const fournis = etat.champs.filter((champ) => champ !== 'cardId');
  if (!fournis.length) return false;
  return fournis.every((champ) => (CHAMPS_DE_CARTE_AVANT_ANALYSE as readonly string[]).includes(champ));
}

/**
 * Ce qui est répondu à un geste tenté trop tôt. Un refus muet ferait tourner le
 * modèle en rond : celui-ci dit quoi faire à la place, en une phrase.
 */
export const REFUS_AVANT_ANALYSE =
  'Trop tôt : ouvre d’abord la mémoire du projet avec l’outil « memoire » (geste « chercher », puis « lire »). S’il n’est pas encore chargé, charge-le avec ToolSearch (« select:mcp__beluga__memoire »), qui reste permis. La lecture de fichiers, les commandes et la carte viennent après.';

/* ------------------------------------------------------------------ */
/* La consigne de l'agent de cadrage                                   */
/* ------------------------------------------------------------------ */

/**
 * LES QUATRE GESTES DU CADRAGE, tenus par des OUTILS et non par la relecture
 * d'un texte. Le déroulé tenait huit temps, verrouillés par le démon, dont la
 * moitié ne produisait rien de lisible, et un bloc JSON en fin de réponse que
 * l'écran relisait pour dessiner une timeline. Il tient désormais en quatre
 * gestes, et chacun laisse une trace que le démon écrit lui-même sur la
 * carte : le titre, la mémoire, la question, la compréhension.
 *
 * LE QUATRIÈME N'EST PLUS DÛ À CHAQUE TOUR (30/09/2026) : le cadrage est une
 * DISCUSSION. L'agent répond d'abord, en texte, dans le fil ; il ne rend la
 * compréhension que quand le tour a fait avancer le travail — carte encore
 * sans compréhension, choix tranché, précision qui change ce qui sera fait —
 * ou sur « cadre ça » (`ISSUES_DE_TOUR_DE_CADRAGE`).
 */
export const GESTES_DU_CADRAGE = [
  'Titrer la carte et résumer la demande (board_update_card, les seuls champs « title » et « resumeDemande »)',
  'Ouvrir la mémoire des sujets touchés (memoire)',
  'Poser d’abord les choix de produit (ask_user, une question à la fois, chacune découlant de la réponse précédente, jusqu’à ce qu’il ne reste aucun point incertain : ce qui se vérifie se vérifie, le reste se pose)',
  'Rendre ce qui a été compris (rendre_comprehension, quand la discussion a fait avancer le travail à cadrer)',
] as const;

/**
 * LES DEUX FINS POSSIBLES D'UN TOUR DE CADRAGE, nommées pour être vérifiées.
 *
 * Le tour n'avait qu'une seule issue — la compréhension, « OBLIGATOIRE EN FIN
 * DE CHAQUE TOUR » — et l'agent partait donc cadrer un travail même quand on
 * lui posait une simple question. Une carte de cadrage est aussi un lieu de
 * DISCUSSION : on doit pouvoir y demander un avis, une explication ou une
 * étude, et repartir avec une réponse.
 *
 * L'arbitrage appartient au MODÈLE, pas à un bouton : c'est lui qui lit le
 * message. …ET DEPUIS LE 30/09/2026 LA RÉPONSE EST LA RÈGLE, PAS L'EXCEPTION.
 * L'arbitrage binaire (« travail → compréhension obligatoire, question →
 * réponse seule ») rendait l'échange pénible : chaque précision refaisait une
 * compréhension, la réponse aux questions passait après, et le démon relançait
 * l'agent qui avait « seulement » répondu. Chaque tour RÉPOND désormais en
 * texte ; la compréhension ne se rend que quand la discussion a fait avancer
 * le travail — et d'office sur une carte qui n'en a encore aucune, dès que le
 * travail est clair : sans elle, rien ne part. L'issue « cadrage » dit donc
 * « ce tour a (aussi) mis la compréhension à jour », « reponse » dit « ce tour
 * a discuté ». Un tour qui a parlé sans compréhension n'est plus relancé
 * (`comprehensionManquante`, `shared/src/tour-de-cadrage.ts`).
 */
export const ISSUES_DE_TOUR_DE_CADRAGE = ['cadrage', 'reponse'] as const;
export type IssueDeTourDeCadrage = (typeof ISSUES_DE_TOUR_DE_CADRAGE)[number];

/**
 * LA CONSIGNE DE RÔLE de l'agent de cadrage. Elle reste courte à dessein : cet
 * agent tourne à chaque message. Son travail est de LIRE ce que le projet sait
 * du besoin, d'en discuter, d'écrire la carte, et de rendre ce qu'il a
 * compris — par des outils, dans cet ordre.
 *
 * Elle s'ouvre sur la DISCUSSION : répondre d'abord, en suivant le fil, puis
 * mettre la compréhension à jour seulement quand le tour a fait avancer le
 * travail (`ISSUES_DE_TOUR_DE_CADRAGE`). Son texte est FIXE : il ne dépend ni
 * de la carte ni du tour (la consigne système ne change pas d'un tour à
 * l'autre) — c'est le contexte de la carte, redonné à chaque tour, qui dit à
 * l'agent si une compréhension existe déjà.
 */
/**
 * CE QU'ON ATTEND DU TEXTE D'UNE COMPRÉHENSION, dit en un seul endroit : la
 * consigne ci-dessous, la description de l'outil `rendre_comprehension` et son
 * refus (`lireComprehensionRendue`) la reprennent mot pour mot.
 *
 * UNE ATTENTE DE FOND, PLUS AUCUNE DE FORME. Le gabarit à trois parties
 * (ouverture, sommaire numéroté, « **n. Intitulé** » + « Comment : … » +
 * « Résultat : … ») produisait des compréhensions SQUELETTIQUES : chaque idée
 * devait tenir en une ligne de sommaire et deux lignes types, le raisonnement
 * n'avait nulle part où s'écrire, et le résultat se lisait comme un formulaire
 * rempli plutôt que comme une réponse. La consigne ne demande donc plus une
 * structure mais une SUBSTANCE — le besoin, le pourquoi, les constats, la
 * manière, le résultat attendu, les points délicats — et laisse le modèle
 * écrire en paragraphes, comme dans une conversation directe.
 *
 * …MAIS COURTE, ET TOURNÉE VERS CE QUI VA ÊTRE FAIT (22/09/2026). La version
 * « développée, qui résume TOUTE la conversation » donnait des pavés qui
 * s'ouvraient en redisant à l'utilisateur ce qu'il venait d'écrire. Il l'a
 * refusée : la compréhension explique désormais, simplement et concrètement,
 * ce que l'agent VA FAIRE et ce qu'on verra à la fin — jamais une reformulation
 * de la demande, jamais le récit de l'échange.
 *
 * `rangerLaComprehension` (`comprehension-gabarit.ts`) n'a pas bougé et ne doit
 * pas bouger : il RANGE en volets ce qui porte des intitulés en gras — les
 * compréhensions déjà écrites, et celles où le modèle choisit encore des
 * intertitres — et rend le texte tel quel sinon. La consigne s'est assouplie,
 * l'affichage était DÉJÀ tolérant : c'est lui qui absorbe les deux formes.
 *
 * LA MANIÈRE NOMME LES ÉCRANS ET LES ZONES — c'est un choix explicite de
 * l'utilisateur : dire « le menu du haut » ou « la colonne de gauche » n'est pas
 * du jargon, et sans cela la manière ne veut rien dire. Ce qui reste interdit :
 * les fichiers, les fonctions, les technologies, bref le détail d'implémentation.
 * Cette interdiction n'a PAS été assouplie avec le reste.
 *
 * ELLE TIENT SEULE, SANS RACONTER L'ÉCHANGE. La compréhension est une seule
 * valeur sur la carte, réécrite à chaque tour : une version qui ne dirait que le
 * dernier message effacerait ce qui avait été décidé avant. Le démon redonne la
 * dernière rendue au cadrage (`carteContexte`), et la nouvelle y INTÈGRE les
 * précisions reçues — dites comme ce qui sera fait, pas comme un récit.
 */
export const FORME_DE_LA_COMPREHENSION =
  'une explication SIMPLE ET CONCRÈTE de ce que tu VAS FAIRE, comme tu la dirais de vive voix : ce qui va changer, où on le verra (en nommant les écrans et les zones), ce qu’on constatera une fois le travail fini, et les points délicats que tu as tranchés. Tu NE REDIS PAS la demande — ni reformulation en ouverture, ni « vous voulez que… », ni récit de la conversation : l’utilisateur sait ce qu’il a demandé. Le texte tient seul : les précisions reçues depuis le premier message y figurent, dites comme ce qui sera fait. COURT : quelques paragraphes brefs, un peu plus pour un chantier, jamais un pavé ; AUCUN gabarit imposé, ni titre, ni tableau. Il s’adresse à quelqu’un qui ne programme pas : aucun détail d’implémentation, aucun chemin, aucun nom de fichier, de fonction ni de technologie, chaque notion dite par ce qu’elle fait et à quoi elle sert';

export const CONSIGNE_CADRAGE = `TU ES L'AGENT DE CADRAGE D'UNE CARTE. Tu ne codes pas, tu ne modifies aucun fichier : la carte n'a pas encore de branche, et le travail sera fait après par un agent complet.

C'EST UNE DISCUSSION, ET TU Y RÉPONDS D'ABORD. L'utilisateur te parle comme à un collègue expérimenté : chaque message reçoit une vraie réponse, en texte, dans le fil. S'il pose une question, tu y RÉPONDS EN PREMIER, avant tout le reste ; s'il en pose plusieurs, tu les prends toutes. Cette réponse est ARGUMENTÉE et OBJECTIVE, mais tenue comme un DIALOGUE : directe, en quelques phrases, sans redire la question, appuyée sur un vrai sondage du projet quand il le faut — ce que tu as vérifié se dit comme vérifié, et le reste comme une supposition. Tu vas droit à la conclusion : parmi les pistes, tu RECOMMANDES celle que tu retiendrais, en disant pourquoi en une ou deux phrases. La décision reste à l'utilisateur ; un avis qui ne conclut rien ne lui sert à rien. Tu SUIS LE FIL : ce qui a été dit aux messages d'avant compte, tu ne repars jamais de zéro.

LA COMPRÉHENSION SE MET À JOUR QUAND LA DISCUSSION A FAIT AVANCER LE TRAVAIL, PAS À CHAQUE MESSAGE — et c'est toi qui en juges. Tu la rends (geste 4) dans trois cas : la carte n'en porte ENCORE AUCUNE et le travail demandé est assez clair pour être cadré — elle ne peut pas partir sans elle, et dans ce cas, dans le doute, tu cadres ; ce tour CHANGE ce qui sera fait (un choix tranché, une précision qui modifie le travail, une piste retenue) ; ou l'utilisateur le demande (« cadre ça »). Sinon — une question, une explication, un avis, une précision qui ne change rien — tu réponds et tu t'arrêtes là : la compréhension déjà rendue reste valable telle quelle, aucun plan ne s'amorce et rien dans ta réponse n'y pousse. « réponds-moi seulement » t'interdit d'y toucher pour ce tour. Quand tu la mets à jour, ta réponse le dit d'une phrase simple, sans la recopier.

TES GESTES SONT QUATRE, TOUJOURS DANS CET ORDRE, ET CHACUN PASSE PAR UN OUTIL — l'écran lit ce que les outils écrivent sur la carte, jamais ta mise en page. Les gestes 1 et 2 se font à CHAQUE tour, le 3 quand un point le demande, le 4 selon la règle ci-dessus.

1. TITRER LA CARTE ET RÉSUMER LA DEMANDE, avant tout autre geste, en UN SEUL appel « board_update_card ». La carte porte un titre PROVISOIRE, recopié de la phrase de l'utilisateur : il tient la place, il ne dit pas le besoin. Donne « title » — trois à cinq mots SIMPLES ET VIVANTS qui disent le besoin (« Refonte du flux de cadrage », pas la phrase entière recopiée) — et « resumeDemande » — ce qui vient d'être demandé, en deux ou trois phrases simples, d'après le SEUL message reçu : tu n'as encore rien lu du projet, et ce résumé n'en parle pas. Il s'affiche aussitôt sous le point « Demande » du fil, sans attendre la fin de ton tour. Ces deux champs et RIEN D'AUTRE — le démon refuse le reste avant la lecture de la mémoire. AUX TOURS SUIVANTS, le titre est acquis : tu rappelles « board_update_card » avec le seul champ « resumeDemande », pour le message de CE tour-là.

2. OUVRIR LA MÉMOIRE DES SUJETS TOUCHÉS. La mémoire est une BASE DE CONNAISSANCES d'unités typées, et le CHANGELOG dit ce qui a déjà été fait ; leur accueil est déjà dans ton contexte : lis-le d'abord. Puis NOMME les mots précis (fichier, fonction, symptôme) et le CONTEXTE de la demande, et appelle l'outil « memoire », geste « chercher », avec « demande » et « contexte » : il rend des UNITÉS du projet et du global, chacune avec son identifiant ; « lire » ouvre une unité (« id »), une fiche numérotée ou le « changelog ». Recherche locale, sans quota. Tu ne recopies rien dans ta réponse. Tant que la mémoire n'est pas ouverte, tu n'ouvres AUCUN fichier, tu ne lances AUCUNE commande et tu n'écris pas la carte au-delà du titre : le démon te refuse ces gestes.

3. POSER CE QUI CHANGE LE TRAVAIL — D'ABORD LES CHOIX DE PRODUIT. Dès le premier échange sur un travail à cadrer, relève TOUS les choix qui reviennent à l'utilisateur et pose-les avec l'outil « ask_user » : ce que voit ou ne voit pas chaque personne, qui a le droit de faire quoi, les prix, qui paie et comment, les limites et quotas, la vie des comptes (création, invitation, départ), ce qui est gardé ou perdu, ce qui s'affiche au client. Ces choix-là NE SE DEVINENT JAMAIS : les écrire en « Je suppose que… » revient à décider à la place de l'utilisateur. Chaque question porte ses CHOIX possibles ET son champ « description » (ce qu'il faut savoir pour répondre, en une à trois phrases). UNE SEULE QUESTION À LA FOIS : relève la liste des choix, mais n'appelle « ask_user » que pour le PREMIER ; l'outil ATTEND la réponse et te la rend DANS LE MÊME TOUR. Relis alors cette réponse et pose la question SUIVANTE seulement si elle en DÉCOULE : jamais de question conditionnelle (« si vous gardez… »), jamais une question que la réponse précédente rend sans objet (« on supprime » règle tout ce qui concernait ce qu'on garde). Continue ainsi jusqu'à ce qu'il ne reste AUCUN point incertain. N'envoie JAMAIS deux « ask_user » dans le même message : le démon refuse la seconde. UN POINT TECHNIQUE INCERTAIN NE SE SUPPOSE PAS NON PLUS : tu le VÉRIFIES D'ABORD toi-même — lire le projet, lancer une commande, ouvrir la documentation — et tu l'écris comme un fait établi ; ce que tu ne peux pas vérifier se POSE lui aussi, en mots courants pour quelqu'un qui ne programme pas : ce que change chaque réponse, et celle que tu RECOMMANDES. Seule TA MANIÈRE DE CONSTRUIRE — ce que le projet fait déjà, ce qu'un développeur choisirait seul sans rien risquer — se décide sans demander, et s'écrit comme DÉCIDÉE, jamais comme supposée. TOUT CELA SE FAIT AVANT DE RENDRE LA COMPRÉHENSION : une supposition qui y reste la fait refuser, et tu devrais la réémettre entière. Un geste simple ou une précision qui ne change rien n'appelle AUCUNE question. Une question écrite en texte à la fin de ta réponse ne réveille personne. C'est aussi ici que tu ÉCRIS LA CARTE avec « board_update_card » : une description courte qui dit ce qui est attendu, et le champ « niveau » (« leger » pour un geste simple ou une tâche d'administration/rédaction, « standard » pour un travail de code ordinaire, « approfondi » pour un chantier). L'outil te répond avec le moteur, le modèle et la réflexion retenus.

4. RENDRE CE QUE TU AS COMPRIS — QUAND LA DISCUSSION A FAIT AVANCER LE TRAVAIL (voir plus haut), et alors en fin de tour, après ta réponse. Appelle « rendre_comprehension » avec « texte » (${FORME_DE_LA_COMPREHENSION}. Aucun détail d’implémentation, aucun chemin, aucun fichier à modifier : le plan vient après, sur demande. La dernière compréhension rendue t'est redonnée avec la carte : la nouvelle y intègre les précisions reçues, sans redérouler la conversation), « hypotheses » (un tableau VIDE : avec quelqu'un devant l'écran, plus rien ne se suppose, même technique, et l'outil REFUSE toute ligne, autant de fois qu'elle revient ; des lignes ne s'y écrivent que si ta demande t'INTERDIT « ask_user » — chacune porte alors son « texte », qui commence par « Je suppose que… », et sa « nature » — « technique » ou « produit »), « sujets » (les sujets de mémoire ouverts), puis « resumeDemande » (ce qui a été DEMANDÉ — il AFFINE la synthèse du geste 1, il ne la contredit pas) et « resumeComprehension » (ce que tu as COMPRIS) — chacun en deux ou trois phrases simples et concises, affichés sous les points « Demande » et « Compréhension » du fil pour qu'on les lise sans rien ouvrir. TU NE LAISSES AUCUNE QUESTION EN SUSPENS : tout ce que l'utilisateur peut juger SANS PROGRAMMER se pose au geste 3 avec « ask_user », MÊME APRÈS d'autres questions ; ce que la demande ou le projet tranche déjà, ou ce qu'il t'a laissé choisir, s'écrit comme DÉCIDÉ dans « texte », sans question ni supposition ; un point technique incertain se VÉRIFIE, sinon il se pose lui aussi. Dans un cadrage fait sans personne devant l'écran, chaque supposition se VALIDE ou se CORRIGE d'un clic sur la carte : celles que l'utilisateur a validées te sont redonnées comme SES décisions, et la compréhension suivante les écrit comme décidées, plus comme supposées. Le démon l'écrit sur la carte et l'écran l'affiche : ne le recopie pas en texte. Ta réponse en texte reste le cœur du tour : elle répond d'abord, puis dit d'une phrase que la compréhension a été mise à jour.

CE MÊME APPEL PORTE UN SECOND REGISTRE, « partieTechnique », ET IL EST OBLIGATOIRE. Il ne s'affiche pas : l'écran le range replié sous « Détails techniques », et il part TEL QUEL à l'agent qui exécutera la carte. C'est le seul endroit où le jargon est permis, et le seul dossier que cet agent recevra quand aucun plan n'est demandé. Trois parties : « taches » (la découpe du travail en étapes concrètes, avec les fichiers et fonctions repérés), « faits » (les décisions, pièges et conventions du projet à respecter, RECOPIÉS de la base de connaissances que tu viens d'ouvrir au geste 2, avec leurs identifiants — deux tiers des travaux exécutés ne l'ouvrent jamais : ce que tu n'écris pas ici, personne ne l'ira chercher) et « risques » (ce qui peut casser, et comment le vérifier). L'outil REFUSE une part technique sans découpe ni risques : depuis que le plan est facultatif, c'est le seul garde-fou avant la dépense.

LES COMPÉTENCES SE PROPOSENT TOUTES SEULES : C'EST BELUGA BUILD QUI LE FAIT, PAS TOI. À ta recherche dans la mémoire (« memoire », geste « chercher »), le démon cherche lui-même les compétences qui parlent de la demande et pose pour chacune un encadré dans le fil — trois au plus — ; ta recherche ne te répond qu'une fois que l'utilisateur les a tranchés, et son résultat se termine par la liste des compétences VALIDÉES (avec le chemin de leur mode d'emploi) et ÉCARTÉES. Tu ne poses donc JAMAIS la question des compétences avec « ask_user », et tu ne redemandes rien sur celles qui viennent d'être tranchées. Les validées s'écrivent dans « partieTechnique.faits » — son nom et ce qu'elle impose — et leur mode d'emploi s'ouvre si ton cadrage en dépend ; les écartées n'y figurent pas. L'agent qui exécute les reçoit EN ENTIER au lancement : il ne pose pas cette question non plus. Un résultat de recherche sans cette liste veut dire qu'aucune compétence ne correspondait : n'en propose pas de ton côté.

LE PLAN EST DEVENU FACULTATIF, ET CE N'EST PAS TOI QUI EN DÉCIDES. L'utilisateur dispose d'un interrupteur « Plan » près de son champ d'écriture. ÉTEINT — le cas ordinaire —, ton tour s'arrête sur la compréhension, et la carte peut partir au travail telle quelle : tu ne proposes pas de plan, tu n'en annonces pas. ALLUMÉ, tu reçois une consigne explicite qui te demande, DANS LE MÊME TOUR, de rendre aussi le plan complet par l'outil « rendre_plan », juste après la compréhension. Tant que cette consigne n'est pas venue, tu n'écris aucun plan. UN PLAN DÉJÀ RENDU NE CHANGE RIEN : le message suivant est un tour de discussion ordinaire.

LA CARTE EST-ELLE DANS LE BON PROJET ? Dès le geste 2, vérifie que la demande relève bien du projet où tu travailles. Si elle vise CLAIREMENT un autre projet, déplace-la toi-même avec « deplacer_vers_projet » (sans « projet », il liste ceux qui peuvent la recevoir), puis arrête ton tour sur une phrase : le cadrage reprend tout seul là-bas. En cas de doute entre plusieurs projets, demande avec « ask_user ». Ce geste n'existe que pendant le cadrage : une carte lancée ne change jamais de projet.

UN NOUVEAU MESSAGE NE REFAIT PAS LE TITRE, mais il refait la synthèse : « board_update_card » avec le seul champ « resumeDemande », puis le geste 2. Tu rouvres seulement la mémoire des sujets qui changent, tu réponds, tu redemandes ce qui manque, et tu ne rends de nouveau ce que tu as compris que si ce message a fait avancer le travail.

PARLE COMME DANS UN DIALOGUE : court, direct, naturel. Tu ne redis JAMAIS ce que l'utilisateur vient d'écrire, ni en ouverture ni en résumé ; pas de préambule, pas de récapitulatif. Une question de fond tient en quelques phrases qui concluent ; un accusé de réception, en une ligne. Ce qui reste interdit dans tous les cas : le compte rendu à titres, le rappel de ce que tu viens de faire, et le nom des outils que tu appelles. TU NE LANCES RIEN TOI-MÊME et tu ne proposes aucune autre carte : cette conversation EST la carte. Ce que tu supposes se dit comme une supposition.`;

/* ------------------------------------------------------------------ */
/* LE GESTE 1 EST UN VERROU : RIEN NE PASSE AVANT LE TITRE              */
/* ------------------------------------------------------------------ */

/**
 * LE TITRE SE POSE AU GESTE 1, ET LE GESTE 2 NE S'OUVRE PAS SANS LUI.
 *
 * Le déroulé du cadrage était demandé au modèle, pas tenu par le démon : il
 * ouvrait la mémoire et posait ses questions sans avoir titré la carte. Un
 * déroulé qui n'est pas SYNCHRONE ne se corrige pas par une consigne plus
 * insistante : il se verrouille.
 *
 * Le verrou est étroit et symétrique de celui de l'analyse : tant que la carte
 * s'appelle encore « Nouvelle tâche », le SEUL geste servi à l'agent de
 * cadrage est `board_update_card` portant le champ `title` — seul, ou
 * accompagné de la synthèse de la demande (`resumeDemande`), qui se rédige
 * depuis la même phrase et voyage donc dans le même appel. Tout le reste —
 * `project_memory`, `competences`, `ask_user`, `rendre_comprehension`, les
 * autres écritures de carte — est refusé, avec la phrase qui dit quoi faire à
 * la place.
 *
 * Une fois le titre posé, le verrou s'ouvre pour toujours : il ne se referme
 * ni au tour suivant, ni sur une relance.
 */
export function gesteAutoriseAvantLeTitreDeCadrage(etat: {
  /** Le nom de l'outil appelé, sans son préfixe de pont. */
  outil: string;
  /** Les champs réellement fournis par l'appel. */
  champs?: string[];
  /** La carte porte-t-elle déjà autre chose que « Nouvelle tâche » ? */
  titreDonne: boolean;
}): boolean {
  if (etat.titreDonne) return true;
  if (etat.outil !== 'board_update_card') return false;
  const fournis = (etat.champs ?? []).filter((champ) => champ !== 'cardId');
  /* Le titre reste DÛ : la synthèse l'accompagne, elle ne le remplace pas. */
  if (!fournis.includes('title')) return false;
  return fournis.every((champ) => (CHAMPS_DE_CARTE_AVANT_ANALYSE as readonly string[]).includes(champ));
}

/**
 * Ce qui est répondu à un geste tenté avant le titre. Comme
 * `REFUS_AVANT_ANALYSE`, il ne se contente pas de refuser : il dit l'appel
 * exact qui rouvre la suite.
 */
export const REFUS_AVANT_LE_TITRE =
  'Trop tôt : le geste 1 n’est pas fait. Appelle d’abord « board_update_card » avec « title » (trois à cinq mots tirés de la phrase de l’utilisateur) et « resumeDemande » (la synthèse de cette phrase), et rien d’autre. Tout le reste t’est servi juste après.';

/**
 * UNE CARTE ACCEPTÉE DEPUIS UNE PROPOSITION DU CHAT SUIT LE PARCOURS ENTIER.
 *
 * Accepter une proposition créait la carte, et rien d'autre : ni agent de
 * cadrage, ni jalon « Demande », ni compréhension. Le fil de la carte s'ouvrait
 * sur « Dites ce que vous voulez faire. » alors que l'agent du chat avait déjà
 * rédigé la demande (capture du 24.09.2026). Le clic « Accepter » vaut
 * désormais ce que vaut le « + » de « Planifié » suivi d'un premier message :
 * le point « Demande » porte le texte de l'agent (`demandeAfficheeDeProposition`)
 * et le cadrage reçoit cette demande-ci comme premier tour, jusqu'à la
 * compréhension — PAS plus loin, exactement comme une carte de la nuit
 * (`demandeDeCadrageDeLaNuit`, `shared/src/auto-amelioration.ts`).
 *
 * À LA DIFFÉRENCE DE LA NUIT, quelqu'un est devant l'écran : il vient de
 * cliquer. Une question par « ask_user » reste donc permise, comme dans tout
 * cadrage de jour.
 *
 * Règle PURE : aucun accès à la base ni au moteur, elle se teste seule.
 */
export function demandeDeCadrageDeProposition(carte: {
  title: string;
  description?: string;
  /** La synthèse du besoin écrite par l'agent du chat (champ « contexte »). */
  briefing?: string;
}): string {
  const description = String(carte.description ?? '').trim();
  const synthese = String(carte.briefing ?? '').trim();
  return `CETTE DEMANDE VIENT D'UNE PROPOSITION ACCEPTÉE DANS LA CONVERSATION DU CHEF D'ORCHESTRE. L'agent du chat a discuté le besoin avec l'utilisateur, a rédigé cette carte, et l'utilisateur vient de l'accepter : c'est ce besoin-là que tu cadres maintenant, exactement comme si l'utilisateur venait de te l'écrire. C'est un TRAVAIL À CADRER, pas une question : ce tour se termine par ta compréhension rendue.

TITRE POSÉ PAR L'AGENT DU CHAT : ${carte.title}
${description ? `\nCE QUI EST DEMANDÉ :\n${description}\n` : ''}${
    synthese ? `\nSYNTHÈSE DE L'ÉCHANGE AVEC L'UTILISATEUR (déjà affichée en tête de ta conversation) :\n${synthese}\n` : ''
}
DÉROULE TON PROCESSUS HABITUEL DE CADRAGE, sans en sauter un temps : la carte porte déjà un titre, garde-le s'il dit juste le besoin et affine-le sinon, et écris la synthèse de cette demande (« resumeDemande »). Ouvre la mémoire des sujets touchés, montre ce que tu y trouves, écris la carte en entier (description et niveau), puis RENDS CE QUE TU AS COMPRIS avec l'outil « rendre_comprehension » — ET ARRÊTE-TOI LÀ. Le plan ne se produit jamais de lui-même : c'est l'utilisateur qui le demande.

VÉRIFIE CE QUE L'AGENT DU CHAT AFFIRME avant de le reprendre : il n'a pas forcément ouvert le code. Ce dont tu n'es pas sûr se vérifie dans le projet ; ce qui reste incertain se pose avec « ask_user », jamais en supposition.`;
}

/**
 * CE QUE MONTRE LE POINT « DEMANDE » D'UNE CARTE ACCEPTÉE DEPUIS LE CHAT, dès
 * l'acceptation : le texte ENTIER est la synthèse rédigée par l'agent (à défaut
 * la description), le RÉSUMÉ sous le titre du point est la description — la
 * demande reformulée, courte. Le cadrage l'affinera à son geste 1
 * (`board_update_card`, champ `resumeDemande`).
 */
export function demandeAfficheeDeProposition(carte: {
  title: string;
  description?: string;
  briefing?: string;
}): { texte: string; resume?: string } {
  const description = String(carte.description ?? '').trim();
  const synthese = String(carte.briefing ?? '').trim();
  return {
    texte: synthese || description || carte.title,
    ...(description ? { resume: description } : {}),
  };
}

/**
 * LES PROJETS DU VOLET « NOUVEL AGENT » (barre du bas du tableau de bord, sur
 * téléphone) : les projets non archivés, du plus récemment actif au plus
 * ancien. L'activité d'un projet est la plus récente de trois dates : sa
 * dernière carte modifiée (`activite`, relevée en base par
 * `projects.activite` — jamais les cartes chargées dans le navigateur, qui
 * n'y sont pas pour un projet non consulté), sa dernière visite et sa
 * dernière modification. À égalité, par nom.
 */
export function projetsParActivite<P extends { id: string; name: string; archived?: boolean; updatedAt: number; lastVisitedAt?: number }>(
  projets: readonly P[],
  activite: Record<string, number | undefined> = {},
): P[] {
  const date = (p: P) => Math.max(activite[p.id] ?? 0, p.lastVisitedAt ?? 0, p.updatedAt ?? 0);
  return projets
    .filter((p) => !p.archived)
    .slice()
    .sort((a, b) => date(b) - date(a) || a.name.localeCompare(b.name));
}

/** Sans accents ni majuscules : « Réz » trouve « ProjetB ». */
function aplatirNom(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * LA RECHERCHE DU VOLET « NOUVEL AGENT » : garde, DANS L'ORDRE REÇU, les
 * projets dont le nom contient chaque mot tapé (un ET, jamais un OU), sans
 * tenir compte des accents ni des majuscules. Une recherche vide rend tout.
 */
export function filtrerProjetsParNom<P extends { name: string }>(projets: readonly P[], recherche: string): P[] {
  const mots = aplatirNom(recherche).split(/\s+/).filter(Boolean);
  if (!mots.length) return projets.slice();
  return projets.filter((p) => {
    const nom = aplatirNom(p.name);
    return mots.every((mot) => nom.includes(mot));
  });
}
