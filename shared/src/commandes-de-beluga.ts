/**
 * LES COMMANDES « / » DE BELUGA BUILD — communes à tous les moteurs.
 *
 * Le moteur ne les connaît pas : quand un message en porte (n'importe où, plusieurs se cumulent), le démon remplace le texte qui part au
 * moteur par sa CONSIGNE (`consigneDeLaCommandeDeBeluga`, appelée par `server/src/runtime.ts`), la bulle enregistrée
 * garde ce que l'utilisateur a écrit. Ce qui suit le nom est la PRÉCISION, recopiée dans la consigne.
 *
 * PRIORITÉ (`commandesDuMoteur`, `shared/src/commandes-slash.ts`) : une commande de Beluga l'emporte sur une commande
 * INTÉGRÉE au moteur de même nom (« /plan » de Claude ou Codex), mais une commande écrite sur le DISQUE (projet ou
 * compte) l'emporte sur Beluga — et la consigne ne s'applique alors pas (`server/src/runtime.ts` le vérifie).
 *
 * Chaque description est un littéral FRANÇAIS, clé du dictionnaire : l'écran la passe à `t()`, et
 * `scripts/verif-langues.mjs` l'exige dans les cinq langues. Les noms restent sans accent (`nomDeCommandeValable`).
 *
 * Une consigne ne commente JAMAIS le stockage des identifiants, ne publie rien, ne paie rien et n'envoie rien à un
 * client : ces gestes restent ceux de l'utilisateur.
 */

import { repereDOrdinateur } from './ordinateurs.js';
import { commandeDuMessage, commandesDuTexte, commandesReconnues, nomEtArgument, type CommandeDuTexte, type CommandeSlash } from './commandes-slash.js';
/* Le nom « captures » est écrit en dur : importer `capture-ecran.ts` (qui relit le paquet partagé) ferait une boucle au chargement. */

/** La consigne de « /captures » : l'échange de cadrage des captures, puis l'encadré « Capturer ». */
function consigneDesCaptures(precision: string): string {
  return [
    `L'utilisateur a lancé l'outil de CAPTURES D'ÉCRAN (commande /captures).${precision ? ` Sa précision : « ${precision} ».` : ''}`,
    '',
    'Mène l’échange de cadrage des captures, une question à la fois avec ask_user, seulement pour ce que tu ne peux pas déduire du projet :',
    '1. Ce qu’il faut capturer (site, application métier avec connexion, application installable, vidéo de parcours) et les pages précises.',
    '2. Les appareils (ordinateur, téléphone) et le thème (clair, sombre).',
    '3. Pour une application avec connexion : l’accès du coffre-fort à utiliser — un COMPTE DE DÉMONSTRATION, jamais de vraies données de clients.',
    'Puis appelle l’outil « capture » geste « proposer » avec la recette : l’utilisateur valide d’un clic dans l’encadré, et seulement alors tu appelles « capturer ».',
    'Une fois les images prises, propose d’en tirer une maquette (l’outil demande le style et le format) et une plaquette de présentation pour le client.',
  ].join('\n');
}

/**
 * CE QUE LE DÉMON SAIT DU PROJET COURANT, pour les commandes qui en ont besoin (« /securite » lance le script du dépôt
 * Beluga sur le dossier du projet). Absent : la consigne dit à l'agent où le trouver.
 */
export interface ContexteDeCommande {
  /** Le dépôt Beluga où vit `scripts/controle-securite.mjs`. */
  racineBeluga?: string;
  /** Le dossier du projet à contrôler. */
  dossier?: string;
  nomDuProjet?: string;
  /** L'adresse publique (ou d'essai) du projet, si elle est réglée. */
  adresse?: string;
  /** Les ordinateurs de la personne qui écrit (« /ordinateur:… ») : SEULEMENT les siens. */
  ordinateurs?: readonly { id: string; nom: string; repere: string }[];
}

/**
 * LA CONSIGNE DE « /ordinateur:<repère> » (carte « Choisir l'ordinateur visé depuis le téléphone », 15/11/2026) : le
 * démon a déjà retenu cet ordinateur pour la carte ; l'agent fait la demande LÀ, navigateur (outil « chrome ») et
 * applications (outil « ordinateur »). Un repère inconnu : le dire, rien d'autre.
 */
function consigneDeLOrdinateur(precision: string, ctx: ContexteDeCommande = {}, argument: string | null = null): string {
  const trouve = argument ? ctx.ordinateurs?.find((o) => o.id === argument || o.repere === repereDOrdinateur(argument)) : undefined;
  if (!trouve) {
    return [
      `L'utilisateur vise un ordinateur avec la commande /ordinateur${argument ? `:${argument}` : ''}, mais ${argument ? `aucun de ses ordinateurs ne s'appelle « ${argument} »` : 'sans dire lequel'}.${avecPrecision(precision)}`,
      '',
      'Montre-lui ses ordinateurs (outil « ordinateur », geste « lister ») et demande-lui par ask_user lequel viser. N’agis sur aucun ordinateur avant sa réponse.',
    ].join('\n');
  }
  return [
    `L'utilisateur demande d'agir SUR L'ORDINATEUR « ${trouve.nom} » (commande /ordinateur:${trouve.repere}) : il est désormais retenu pour cette carte.${avecPrecision(precision, ' Il n’a rien précisé d’autre.')}`,
    '',
    `Fais la demande sur « ${trouve.nom} » : son navigateur avec l’outil « chrome », ses applications (Mac) avec l’outil « ordinateur » (« ouvrir_application »). S’il ne répond pas, dis-le et arrête-toi : ne bascule jamais sur un autre ordinateur.`,
    precision ? '' : 'Sans autre précision, confirme simplement que cet ordinateur est retenu et dis s’il est allumé (outil « ordinateur », geste « lister »).',
  ]
    .filter(Boolean)
    .join('\n');
}

const entreGuillemets = (v: string): string => `"${v.replace(/(["\\$`])/g, '\\$1')}"`;

/**
 * LA CONSIGNE DE « /securite » : lancer le VRAI contrôle (`scripts/controle-securite.mjs`, compétence
 * `beluga-controle-de-securite-d-un-projet`), rendre son rapport tel quel, puis proposer une carte par point. Jamais de
 * correction d'office, jamais un mot sur le stockage des identifiants.
 */
function consigneDeSecurite(precision: string, ctx: ContexteDeCommande = {}): string {
  const racine = ctx.racineBeluga ?? '<dépôt Beluga>';
  const dossier = ctx.dossier ? entreGuillemets(ctx.dossier) : '<dossier du projet>';
  const nom = ctx.nomDuProjet ? entreGuillemets(ctx.nomDuProjet) : '"<nom du projet>"';
  const adresse = ctx.adresse ? ` --adresse ${entreGuillemets(ctx.adresse)}` : '';
  const commande = `cd ${entreGuillemets(racine)} && node scripts/controle-securite.mjs ${dossier} --nom ${nom}${adresse} --json`;
  return [
    `L'utilisateur demande un CONTRÔLE DE SÉCURITÉ du projet courant (commande /securite).${avecPrecision(precision)}`,
    '',
    `1. Lance le contrôle réel : \`${commande}\`. Il prend de quelques secondes à deux minutes (audit des composants) : attends sa fin, ne le coupe pas. S'il manque \`server/dist\` dans ce dépôt, construis d'abord : \`NODE_ENV=development npm run build:server\`.`,
    ctx.adresse
      ? ''
      : '   Aucune adresse publique n’est réglée pour ce projet : si tu la trouves dans ses réglages ou sa documentation, ajoute « --adresse https://… » ; sinon les entêtes ne sont pas contrôlés et le rapport le dit.',
    '2. Rends le champ « rapport » TEL QUEL, en mots courants : classé par gravité (critique, élevée, moyenne, faible), chaque point avec « Ce qui risque » et « Ce qu’on propose », puis « Ce qui a été vérifié ». La précision de l’utilisateur restreint ou oriente ce compte rendu, elle ne retire aucun point critique.',
    '3. Propose ensuite UNE carte par point retenu avec « board_create_card », à partir du champ « cartes » (titre et description déjà rédigés, ligne « Vérification » comprise) ; pour un autre projet que Beluga, renseigne son champ « projet ».',
    'Ne modifie RIEN toi-même : aucune correction d’office. Le stockage des identifiants dans le projet est un choix assumé : ne le signale pas.',
  ]
    .filter(Boolean)
    .join('\n');
}

interface CommandeDeBeluga {
  nom: string;
  /** Littéral français, clé du dictionnaire. */
  description: string;
  /** La consigne envoyée au moteur ; `precision` est ce que l'utilisateur a écrit après le nom (peut être vide). */
  consigne: (precision: string, contexte?: ContexteDeCommande, argument?: string | null) => string;
  /** La commande prend un argument collé (« /ordinateur:mac-mini »). */
  argument?: boolean;
}

const avecPrecision = (precision: string, defaut = ''): string =>
  precision ? ` Sa précision : « ${precision} ».` : defaut;

const REGISTRE: readonly CommandeDeBeluga[] = [
  {
    nom: 'securite',
    description: 'Contrôle de sécurité du projet, classé par gravité',
    consigne: (p, ctx) => consigneDeSecurite(p, ctx),
  },
  {
    nom: 'captures',
    description: "Captures d'écran propres, maquettes et plaquette client",
    consigne: (p) => consigneDesCaptures(p),
  },
  {
    nom: 'plan',
    description: 'Préparer un plan détaillé avant d’agir',
    consigne: (p) =>
      [
        `L'utilisateur demande un PLAN avant toute action (commande /plan).${avecPrecision(p)}`,
        '',
        'Lis ce qu’il faut dans le projet, puis prépare un plan détaillé : ce que le projet fait aujourd’hui, ce qui doit changer, les étapes dans l’ordre, les risques et la façon de vérifier.',
        'N’exécute rien et ne modifie aucun fichier. Si tu cadres une carte, rends ce plan avec l’outil « rendre_plan » ; sinon écris-le dans ta réponse et demande par ask_user s’il faut le réaliser.',
      ].join('\n'),
  },
  {
    nom: 'verifier',
    description: 'Vérifier le travail dans la vraie application',
    consigne: (p) =>
      [
        `L'utilisateur demande de VÉRIFIER le travail dans la vraie application (commande /verifier).${avecPrecision(p)}`,
        '',
        'Lance l’application réelle (serveur d’essai ou adresse d’essai du projet, en suivant sa compétence de test), essaie ce qui a été changé comme l’utilisateur le ferait, et rejoue les contrôles du projet qui le touchent.',
        'Joins les captures d’écran utiles, et dis ce qui marche, ce qui casse et ce qui n’a pas pu être essayé, avec la raison.',
      ].join('\n'),
  },
  {
    nom: 'compte-rendu',
    description: 'Résumé de ce qui a été fait et de ce qui reste',
    consigne: (p) =>
      [
        `L'utilisateur demande un COMPTE RENDU (commande /compte-rendu).${avecPrecision(p)}`,
        '',
        'Résume en mots courants, sans nom de fichier ni de fonction : ce qui a été fait, ce qu’on peut constater à l’écran, ce qui reste à faire et ce qui attend une décision. Ne lance aucun nouveau travail.',
      ].join('\n'),
  },
  {
    nom: 'memoire',
    description: 'Retenir ou retrouver un fait du projet',
    consigne: (p) =>
      [
        `L'utilisateur s'adresse à la MÉMOIRE du projet (commande /memoire).${avecPrecision(p, ' Il n’a rien précisé.')}`,
        '',
        'Si sa précision est une QUESTION ou un sujet, cherche-le avec l’outil « memoire » (geste « chercher », puis « lire » l’unité utile) et réponds en citant ce que la base dit.',
        'Si c’est un FAIT à retenir, propose-le avec l’outil « memoire » (geste « proposer ») ou « remember », en remplaçant l’unité devenue fausse ; dis ce qui a été retenu ou refusé, et pourquoi.',
        'Sans précision, demande par ask_user ce qu’il veut retrouver ou retenir.',
      ].join('\n'),
  },
  {
    nom: 'nouvelle-carte',
    description: 'Proposer une carte à part sur le tableau',
    consigne: (p) =>
      [
        `L'utilisateur demande une NOUVELLE CARTE (commande /nouvelle-carte).${avecPrecision(p, ' Il n’a rien précisé.')}`,
        '',
        'Propose une carte avec l’outil « board_create_card » : un titre court, une description qui dit ce qu’il faut faire et pourquoi, et le bon projet. Elle naît dans « Planifié » : rien ne se lance sans le clic de l’utilisateur.',
        'Sans précision, demande par ask_user ce que la carte doit faire. Ne fais pas le travail de la carte toi-même.',
      ].join('\n'),
  },
  {
    nom: 'publier',
    description: 'Préparer la mise en ligne, sans rien publier',
    consigne: (p) =>
      [
        `L'utilisateur parle de PUBLIER (commande /publier).${avecPrecision(p)}`,
        '',
        'Montre ce qui attend la mise en ligne : les changements non enregistrés, les enregistrements pas encore poussés, les cartes du lot « À déployer ». Dis ce qui serait mis en ligne, en mots courants.',
        'Ne lance AUCUNE publication, aucun déploiement ni redémarrage : la mise en ligne est un geste de l’utilisateur, par son bouton « Déployer ». Rappelle-le-lui.',
      ].join('\n'),
  },
  {
    nom: 'sauvegarde',
    description: 'Lancer une sauvegarde du projet',
    consigne: (p) =>
      [
        `L'utilisateur demande une SAUVEGARDE (commande /sauvegarde).${avecPrecision(p)}`,
        '',
        'Avec l’outil « services », service backup : lis d’abord les sauvegardes du projet et leur dernier point, puis lance une sauvegarde. Dis quand elle est partie et où en est la précédente.',
      ].join('\n'),
  },
  {
    nom: 'surveillance',
    description: 'État des sites surveillés et contrôle relancé',
    consigne: (p) =>
      [
        `L'utilisateur demande l'état de la SURVEILLANCE (commande /surveillance).${avecPrecision(p)}`,
        '',
        'Avec l’outil « services », service surveillance : lis l’état et l’historique récent des sites surveillés du projet, et relance un contrôle si l’utilisateur le demande ou si un site paraît en panne. Résume en mots courants ce qui va et ce qui ne va pas.',
      ].join('\n'),
  },
  {
    nom: 'statistiques',
    description: 'Les visites du site, en clair',
    consigne: (p) =>
      [
        `L'utilisateur demande les STATISTIQUES de visite (commande /statistiques).${avecPrecision(p)}`,
        '',
        'Avec l’outil « statistiques », lis les visites du projet sur la période demandée (sinon les trente derniers jours) : nombre de visites, pages les plus vues, provenances, évolution. Résume ce qui ressort en quelques points et propose une piste d’amélioration.',
      ].join('\n'),
  },
  {
    nom: 'video',
    description: 'Lancer une vidéo dans le Studio',
    consigne: (p) =>
      [
        `L'utilisateur demande une VIDÉO (commande /video).${avecPrecision(p, ' Il n’a rien précisé.')}`,
        '',
        'Une vidéo se fait TOUJOURS dans le Studio : outil « services », service studio, action « video », avec son directeur artistique — jamais montée par toi. La version gratuite d’abord ; rien de payant sans le clic de l’utilisateur.',
        'Sans précision, demande par ask_user, une question à la fois, le sujet et le format voulus.',
      ].join('\n'),
  },
  {
    nom: 'coffre',
    description: 'Retrouver ou ranger un accès du coffre-fort',
    consigne: (p) =>
      [
        `L'utilisateur s'adresse au COFFRE-FORT (commande /coffre).${avecPrecision(p, ' Il n’a rien précisé.')}`,
        '',
        'Avec l’outil « coffre_fort » : commence par « lister ». S’il cherche un accès, retrouve-le et dis à quoi il sert, sans recopier le secret dans ta réponse. S’il en donne un nouveau, enregistre-le avec « enregistrer » : une fiche par secret, du bon type, chaque valeur dans sa case.',
      ].join('\n'),
  },
  {
    nom: 'ordinateur',
    description: 'Agir sur un de vos ordinateurs',
    argument: true,
    consigne: (p, ctx, argument) => consigneDeLOrdinateur(p, ctx, argument ?? null),
  },
  {
    nom: 'aide',
    description: 'Les commandes de Beluga et à quoi elles servent',
    consigne: (p) =>
      [
        `L'utilisateur demande l'AIDE des commandes « / » de Beluga (commande /aide).${avecPrecision(p)}`,
        '',
        'Présente-lui ces commandes en mots courants, une ligne chacune avec un exemple d’usage, sans en lancer aucune :',
        ...REGISTRE.map((c) => `- /${c.nom} — ${c.description}`),
        'Rappelle qu’on peut écrire une précision après le nom (par exemple « /securite la page de connexion »).',
      ].join('\n'),
  },
];

/** Les commandes de Beluga pour le menu « / », dans l'ordre du registre (le menu les trie par nom). */
export const COMMANDES_DE_BELUGA: readonly CommandeSlash[] = REGISTRE.map((c) => ({
  nom: c.nom,
  description: c.description,
  origine: 'beluga' as const,
  ...(c.argument ? { argument: true } : {}),
}));

/** L'entrée du registre pour un nom écrit (« ordinateur:mac-mini » trouve « ordinateur », qui prend un argument). */
function entreeDuRegistre(nom: string): CommandeDeBeluga | undefined {
  const exacte = REGISTRE.find((r) => r.nom === nom);
  if (exacte) return exacte;
  const { base, argument } = nomEtArgument(nom);
  const parBase = argument ? REGISTRE.find((r) => r.nom === base) : undefined;
  return parBase?.argument ? parBase : undefined;
}

/** L'argument d'une commande à argument (« mac-mini » pour « /ordinateur:mac-mini »), ou `null`. */
export function argumentDeLaCommande(texte: string, nom: string): string | null {
  for (const c of commandesDuTexte(texte)) {
    const { base, argument } = nomEtArgument(c.nom);
    if (base === nom && argument) return argument;
  }
  return null;
}

/**
 * LES COMMANDES DE BELUGA QUE PORTE UN MESSAGE, n'importe où dans le texte et dans l'ordre (`commandesDuTexte`) : elles
 * se cumulent. Un même nom écrit deux fois ne compte qu'une fois.
 */
export function commandesDeBelugaDuMessage(texte: string): CommandeDuTexte[] {
  const vus = new Set<string>();
  return commandesDuTexte(texte).filter((c) => {
    const entree = entreeDuRegistre(c.nom);
    if (!entree || vus.has(entree.nom)) return false;
    vus.add(entree.nom);
    return true;
  });
}

/** La première commande de Beluga d'un message, ou `null` — le démon ne relit le disque que s'il y en a une. */
export function commandeDeBelugaDuMessage(texte: string): string | null {
  return commandesDeBelugaDuMessage(texte)[0]?.nom ?? null;
}

/**
 * LES COMMANDES DEVIENNENT UNE DEMANDE À L'AGENT. Rend la consigne qui remplace le texte envoyé au moteur, ou `null`
 * si le message ne porte aucune commande de Beluga. Celles que `masquees` nomme (relevées sur le disque pour ce
 * moteur) ne comptent pas : la commande du disque l'emporte. Un message qui S'OUVRE sur une commande du moteur (ou du
 * disque) part toujours tel quel : aucune consigne ne la recouvre.
 *
 * PLUSIEURS COMMANDES : chaque consigne, dans l'ordre du texte, sous une tête qui les annonce. La PRÉCISION est le
 * texte qui reste une fois toutes les commandes retirées — la même pour chacune.
 */
export function consigneDeLaCommandeDeBeluga(
  texte: string,
  masquees: readonly string[] = [],
  contexte: ContexteDeCommande = {},
): string | null {
  const nette = texte.trim();
  const enTete = commandeDuMessage(nette);
  if (enTete && (masquees.includes(enTete) || !entreeDuRegistre(enTete))) return null;
  const trouvees = commandesDeBelugaDuMessage(nette).filter((c) => !masquees.includes(c.nom));
  if (!trouvees.length) return null;
  // Toutes les occurrences sont retirées (un nom écrit deux fois aussi), puis les blancs resserrés.
  const aRetirer = commandesDuTexte(nette).filter((c) => trouvees.some((t) => entreeDuRegistre(t.nom) === entreeDuRegistre(c.nom)));
  let precision = nette;
  for (const c of [...aRetirer].reverse()) precision = precision.slice(0, c.debut) + precision.slice(c.fin);
  precision = precision
    .replace(/[ \t\u00a0]{2,}/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
  const consignes = trouvees.map((c) => entreeDuRegistre(c.nom)!.consigne(precision, contexte, nomEtArgument(c.nom).argument));
  if (consignes.length === 1) return consignes[0]!;
  return [
    `L'utilisateur a combiné ${consignes.length} commandes de Beluga dans un même message : ${trouvees
      .map((c) => `/${c.nom}`)
      .join(', ')}. Traite-les toutes, dans cet ordre.`,
    ...consignes.map((consigne, rang) => `\n--- ${rang + 1}. /${trouvees[rang]!.nom} ---\n${consigne}`),
  ].join('\n');
}

/**
 * LES COMMANDES « / » D'UN MESSAGE ENVOYÉ SE LISENT EN PASTILLES, comme dans le champ qui les a écrites : celles de
 * Beluga partout, et la commande en tête du message (celle que le moteur a reçue) aussi. Chacune devient un lien
 * « commande: » que le Markdown des bulles dessine en pastille (`inline`, `web/src/lib/markdown.tsx`) ; le texte
 * ENREGISTRÉ — celui qu'on copie — garde « /nom ».
 */
export function commandesEnPastilles(texte: string): string {
  const tete = commandeDuMessage(texte);
  const connues: CommandeSlash[] =
    tete && !entreeDuRegistre(tete)
      ? [...COMMANDES_DE_BELUGA, { nom: tete, origine: 'moteur' }]
      : [...COMMANDES_DE_BELUGA];
  let sortie = texte;
  for (const c of [...commandesReconnues(texte, connues)].reverse()) {
    sortie = `${sortie.slice(0, c.debut)}[/${c.nom}](commande:${c.nom})${sortie.slice(c.fin)}`;
  }
  return sortie;
}
