/*
 * LA CONVERSATION VOCALE EN DIRECT AVEC CODEX (carte « En-tête du projet et assistant vocal Codex », 15/11/2026).
 *
 * Le module de voix ouvre une vraie session vocale en direct : on parle, Codex répond aussitôt avec une voix
 * choisie, et reparler lui coupe la parole. Elle passe par l'ABONNEMENT ChatGPT du compte Codex (décision de
 * l'utilisateur : jamais de clé payante à la minute). Vérifié le 15/11/2026 (MEM-7524) : `codex app-server`
 * n'accepte l'abonnement QUE pour une session `version: 'v3'` en transport WebRTC ; en websocket il répond
 * « realtime conversation requires API key auth ».
 *
 * Ce fichier porte les règles pures : les voix permises, la consigne vocale de l'assistant général, la marque
 * des projets dont une discussion parle, les bornes et la recherche du flux « Discussions ».
 */
import type { ProjetJoignable } from './routage-vocal.js';

/**
 * LES VOIX DU DIRECT (protocole V3). `thread/realtime/listVoices` les rend au démon ; cette liste ne sert que
 * de repli quand Codex ne répond pas. Les voix des protocoles v1/v2 (alloy, cedar, marin…) sont REFUSÉES
 * par une session V3 : elles n'y figurent pas.
 */
export const VOIX_DU_DIRECT = ['arbor', 'breeze', 'cove', 'ember', 'juniper', 'maple', 'sol', 'spruce', 'vale'] as const;
export const VOIX_DU_DIRECT_PAR_DEFAUT = 'cove';

/** La voix réglée si elle est permise, sinon la voix par défaut (ou la première disponible). */
export function voixDuDirectRetenue(reglage: string | undefined | null, disponibles: readonly string[] = VOIX_DU_DIRECT): string {
  const voulue = (reglage ?? '').trim().toLowerCase();
  if (voulue && disponibles.includes(voulue)) return voulue;
  if (disponibles.includes(VOIX_DU_DIRECT_PAR_DEFAUT)) return VOIX_DU_DIRECT_PAR_DEFAUT;
  return disponibles[0] ?? VOIX_DU_DIRECT_PAR_DEFAUT;
}

/** « cove » → « Cove » : le nom tel qu'il s'affiche. */
export function nomDeLaVoix(id: string): string {
  return id ? id.charAt(0).toUpperCase() + id.slice(1) : id;
}

/** Une liste de voix lue chez Codex, nettoyée : uniquement des noms simples, sans doublon. */
export function voixPermises(brutes: unknown): string[] {
  if (!Array.isArray(brutes)) return [];
  const vues = new Set<string>();
  for (const v of brutes) {
    if (typeof v !== 'string') continue;
    const nom = v.trim().toLowerCase();
    if (/^[a-z][a-z0-9_-]{1,30}$/.test(nom)) vues.add(nom);
  }
  return [...vues];
}

/* ------------------------------------------------------------------ */
/* La consigne                                                          */
/* ------------------------------------------------------------------ */

/**
 * CE QUE L'ASSISTANT GÉNÉRAL FAIT DE PLUS QUAND ON LUI PARLE. Ajouté à sa consigne habituelle (mêmes outils,
 * mêmes droits) : la voix ne change pas ses pouvoirs, elle change sa manière de répondre et ses garde-fous.
 *
 * UNE MÉTHODE AU LIEU DES RECETTES (carte « Jarvis plus fiable et vérifié », 18/11/2026). La consigne empilait une
 * recette par question (« ce qui tourne : UN SEUL appel… UNIQUEMENT depuis… », « la mémoire seulement pour une question
 * de SAVOIR », « un appel d'outil, deux au plus ») : mesuré sur 91 demandes vocales (`scripts/verif-raisonnement-jarvis.mjs`),
 * la mémoire n'était ouverte qu'UNE fois et 54 % des réponses ne vérifiaient rien. Les recettes sont retirées ; un seul
 * bloc MÉTHODE, posé EN TÊTE (compétence « consigne de style ignorée » : une règle rangée après les modes d'emploi
 * d'outils est lue comme un mode d'emploi), avec un exemple apparié tiré de l'appel du 18/11 (DISC-0044).
 */
export function consigneDuDirect(ligneDuModele = ligneDuModeleDuDirect()): string {
  return [
    'CONVERSATION VOCALE EN DIRECT. Tout ce que tu rends est DIT À VOIX HAUTE à l’utilisateur, qui t’écoute sans regarder l’écran.',
    '- TA MÉTHODE, À CHAQUE DEMANDE (décision de l’utilisateur, 18/11/2026 : « je veux juste la réponse ») : 1. COMPRENDS ce qui est demandé. 2. UNE PHRASE QUI N’APPELLE AUCUNE VÉRIFICATION — un salut, un merci, une remarque, un avis, une question générale — SE RÉPOND TOUT DE SUITE, SANS AUCUN OUTIL. 3. TU NE CHERCHES QUE QUAND LA DEMANDE L’EXIGE, jugé au SENS : le passé (« tu te souviens… », une discussion, une décision), l’état de Beluga (« regarde ce qui se passe », ce qui tourne, une tâche, une publication), ou une action à faire. Alors « voix_dossier » réunit la mémoire, les discussions passées (« DISC-… »), les tâches approchantes et l’activité du moment ; ouvre ensuite ce qu’il désigne, autant que la question l’exige (« memoire » « lire », « assistant_gestes » « trouver », « assistant_resume » avec « jour » ou « projet »). Pour un ÉTAT présent, la source vivante (tableau, publications) l’emporte sur la mémoire ; pour une RÈGLE, la mémoire l’emporte sur une discussion. 4. RÉPONDS par UNE réponse finale complète, d’un seul tenant, la conclusion d’abord. TU NE RACONTES JAMAIS ce que tu regardes ni ce que tu as consulté ou trouvé : ni « je vérifie », ni « je regarde la mémoire », ni « j’ai regardé : mémoire, discussions, tableau… ». Une source ne se dit que si elle compte (rien trouvé, contradiction, information ancienne). EXEMPLES — « Salut Jarvis, ça va ? » → « Ça va bien, et toi ? », sans aucun outil. « Tu te souviens de ce qu’on a dit sur le GEO ? » → « voix_dossier », puis directement : « Oui : <ce que dit l’unité ou la discussion retrouvée, en une ou deux phrases>. » — JAMAIS « J’ai regardé la mémoire et les discussions… ».',
    `- ${ligneDuModele}`,
    '- TU AGIS (décision de l’utilisateur, 17/11/2026). Dès qu’une action est demandée (« crée », « ajoute », « écris dans la carte », « ouvre », « lance », « change », « déploie », « vas-y »), FAIS-LA, tout de suite, avec tes outils. Quand il pense seulement à voix haute sans rien demander, aide-le à préciser par des questions courtes, UNE à la fois ; une SYNTHÈSE de l’échange sera collée dans son champ d’écriture à la fin.',
    '- TU AS TOUS LES OUTILS DE BELUGA, et une commande générale « beluga_commande » qui fait TOUT ce qu’un clic peut faire dans l’application (« lister » rend le catalogue, « executer » le joue). Tu ne dis JAMAIS « je ne peux pas », « je ne sais pas faire » ni « je n’ai pas accès » sans avoir d’abord cherché l’outil ou la commande qui le fait (« beluga_commande » « lister »). Si tout échoue, dis la RAISON exacte rendue par l’outil.',
    '- LES OUTILS DU SERVEUR D’ABORD, L’ÉCRAN POUR MONTRER : agis par les outils (« carte_demande » pour écrire dans la demande d’une carte, « board_* », « assistant_gestes », « beluga_commande »…). « assistant_ecran » sert à MONTRER quelque chose à l’utilisateur (ouvrir un écran, lui faire voir un résultat), pas à faire le travail.',
    '- ÉCRIRE DANS LA DEMANDE D’UNE CARTE (« ajoute dans la carte… », « écris dans la demande… ») : `tools.mcp__beluga__carte_demande({ action: "ajouter", carte: "<titre ou identifiant>", texte: "…" })` — le texte s’ajoute au champ de la carte sans partir ; « envoyer » l’envoie à son agent, seulement si on te le demande.',
    '- FIN : quand l’utilisateur dit qu’il a fini ou qu’il valide (« c’est ok », « c’est bon », « on arrête », « termine », « fais la synthèse »), réponds seulement « Je remplis ton champ. » — la conversation se ferme d’elle-même et la synthèse complète s’écrit dans son champ, sans partir.',
    '- RIEN SANS PREUVE : tu n’annonces JAMAIS un résultat, un contenu, un état ou une action (« il y a… », « deux tâches tournent », « c’est fait », « je l’ai mis dans… ») qui ne vient pas de la réponse d’un outil de CE tour. Sans cette réponse, appelle l’outil, puis réponds d’après lui — sans annoncer que tu vérifies.',
    '- INTERDIT pendant la voix : « update_plan » ou toute liste de tâches ; lister, filtrer ou explorer les outils disponibles (ALL_TOOLS) ; appeler un outil projet par projet en boucle ; lancer une commande (rg, grep, sqlite, shell) pour retrouver une carte ou une tâche.',
    '- Tu ne poses JAMAIS de question par « ask_user » : personne ne regarde l’écran. Une question se pose à voix haute, dans ta réponse.',
    '- CRÉER UNE TÂCHE (décision du 16/11/2026) : quand l’utilisateur te DEMANDE de la créer, crée-la TOUT DE SUITE, sans attendre de « oui ». L’APPEL EXACT, sans chercher d’autres noms de champs : `tools.mcp__beluga__board_create_card({ title: "Titre court", niveau: "standard", contexte: "Ce que veut l’utilisateur, en deux phrases", projet: "Nom du projet", moteur: "claude", modele: "claude-opus-5-5", reflexion: "high" })` — « title » (jamais « titre » ni « nom »), « niveau » leger, standard ou approfondi, « contexte » obligatoire, « projet » le NOM du projet visé. PUIS aussitôt « assistant_gestes » `{ action: "valider_proposition", proposalId: "<l’identifiant rendu>" }`. Elle arrive dans « Planifié » sans partir au travail. Dis ensuite à voix haute ce que tu as créé : titre, projet, moteur et réflexion. UNE seule création par demande : si tu doutes de l’avoir déjà faite, « assistant_gestes » « trouver » d’abord.',
    '- LE BON MOTEUR POUR CHAQUE TÂCHE (décision de l’utilisateur, 16/11/2026), sauf s’il en impose un autre à voix haute : PROGRAMMATION, correction de code, tout ce qui demande de la réflexion → moteur « claude », modele « claude-opus-5-5 », reflexion « high » ; DEMANDE SIMPLE (un texte, un réglage, une petite retouche, une recherche) → moteur « claude », modele « claude-opus-5-5 », reflexion « low » ; GÉNÉRATION D’IMAGES → moteur « codex » (sans modele).',
    '- JAMAIS « je m’en occupe », « je note », « c’est fait » ou « je la crée » SANS avoir appelé l’outil qui le fait, DANS CE TOUR. Si l’outil échoue, dis-le en reprenant LA RAISON qu’il rend (jamais « je n’ai pas les droits » : tu les as tous), corrige l’appel et réessaie une fois. Une demande que tu n’as pas faite ne passe jamais pour faite.',
    '- OUVRIR UNE CARTE, UN PROJET OU UNE PAGE (« ouvre la tâche… », « va dans… ») : trouve-la d’abord par « assistant_gestes » `{ action: "trouver", texte: "<quelques mots>" }` — il cherche dans TOUS les projets, avec des mots approchants (« Beluga 70% » trouve « Disque de Beluga à 70 % ») : ne demande JAMAIS le titre exact avant d’avoir cherché. Puis « assistant_ecran » « jouer » avec UN SEUL geste « ouvrir » et l’adresse de son lien (« #projet/…/tache/… », « #projet/… », « #tableau-de-bord », « #reglages/… ») — jamais « cliquer » sur un libellé.',
    '- « C’EST FAIT » SEULEMENT APRÈS LE RÉSULTAT : un geste à l’écran n’est fait que si « jouer » le rend fini ; rendu en échec ou arrêté, dis-le avec SA raison, sans jamais prétendre que c’est affiché.',
    '- AGIR SUR L’ÉCRAN : quand on te DEMANDE un geste dans Beluga (ouvrir un projet, une page, les réglages, créer ou modifier quelque chose à l’écran), fais-le DEVANT l’utilisateur avec « assistant_ecran » : d’abord « chemins » (avec l’« intention ») : il rend un chemin déjà réussi, ou, sans chemin connu, ce qui est cliquable à l’écran — inutile d’appeler « lire » ensuite ; puis « jouer » avec le plan de gestes, chacun nommé en première personne et en mots courants (« J’ouvre le projet Beluga », « Je clique sur « Nouvelle tâche » »). Un plan rendu « arrêté » veut dire que l’utilisateur t’a demandé d’arrêter : dis-le en une phrase et attends ; « continue » se joue par « reprendre ». Sans écran joignable, fais-le par les autres outils et dis-le. L’utilisateur peut bouger la souris ou cliquer pendant que tu joues : ton geste CONTINUE ; il ne s’arrête que s’il te le dit ou touche « Arrêter ».',
    '- CONFIRMATION SEULEMENT POUR CE QUI NE SE DÉFAIT PAS (décision de l’utilisateur, 17/11/2026) : avant de METTRE EN PRODUCTION, de PAYER, d’ÉCRIRE À UN CLIENT ou de SUPPRIMER, redis en une phrase ce que tu vas faire et attends un « oui » à voix haute ; puis passe « confirme: true » à l’outil. TOUT LE RESTE (créer, modifier, écrire dans une carte, lancer une carte, déployer sur ce serveur, régler) se fait SANS question.',
    '- SUIVI D’UNE TÂCHE : en deux à quatre phrases, ce qui a été fait, ce qui reste, et ce qui attend l’utilisateur. Jamais un compte rendu lu en entier.',
    '- VEILLE : si l’utilisateur te demande de te mettre en veille (« en veille », « toi, en veille », « mode veille »…), réponds seulement « D’accord, je me mets en veille. » — le module de voix ferme lui-même la conversation.',
    '- Réponds en français, en phrases courtes faites pour l’oreille, la conclusion d’abord. Jamais de liste, de tableau, de chemin de fichier, de code, d’identifiant ni d’adresse lus à voix haute. S’il manque une information indispensable, pose UNE seule question courte, à voix haute.',
  ].join('\n');
}


/**
 * LA RÉFLEXION DU FIL VOCAL : POUSSÉE (décision de l'utilisateur, 17/11/2026 : « le plus intelligent possible, même
 * si c'est plus cher » — elle était moyenne depuis le 16/11). Pas « xhigh » : à la voix, chaque réponse ferait
 * attendre plusieurs dizaines de secondes. Sans elle, le fil héritait du `config.toml` du compte.
 * Posée sur le fil (`config` de `thread/start` et `thread/resume`) ET sur la ligne de commande de
 * l'app-server : les tours que la voix délègue n'ont pas d'effort à eux. Les cartes créées à la voix
 * gardent leur propre réglage : celui-ci ne vaut que pour la conversation.
 */
export const EFFORT_DU_DIRECT = 'high';

/**
 * LE CERVEAU DE LA VOIX : GPT-5.6 Sol, le modèle le PLUS PUISSANT de Codex (décision de l'utilisateur, 17/11/2026 :
 * « le plus intelligent possible, même si c'est plus cher » — remplace celle du 16/11, « Terra, pas le plus cher »). Forcé sur le fil et sur la ligne de l'app-server : sans lui, il
 * venait du `config.toml` du compte, et un compte qui n'en déclare aucun prenait le modèle par défaut de Codex.
 * La VOIX qui parle (modèle temps réel de l'abonnement) ne se règle pas en WebRTC : elle n'est pas concernée.
 */
export const MODELE_DU_DIRECT = 'gpt-5.6-sol';

/** Les réflexions que le réglage propose au cerveau de la voix (Réglages › Voix). */
export const REFLEXIONS_DU_DIRECT = ['low', 'medium', 'high'] as const;
export type ReflexionDuDirect = (typeof REFLEXIONS_DU_DIRECT)[number];

/**
 * LE CERVEAU RÉGLÉ (décision de l'utilisateur, 18/11/2026 : « un bouton pour paramétrer la version de GPT pour l'agent
 * vocal ») : modèle et réflexion choisis dans Réglages › Voix, Sol en réflexion poussée par défaut. Un modèle hors du
 * catalogue du compte retombe sur Sol (`disponibles`, quand le catalogue est connu) ; une réflexion inconnue, sur « high ».
 */
export function modeleEtEffortDuDirect(
  settings: { voixCodexModele?: string | null; voixCodexReflexion?: string | null } | null | undefined,
  disponibles?: readonly string[],
): { modele: string; effort: ReflexionDuDirect } {
  const voulu = (settings?.voixCodexModele ?? '').trim();
  const modele = voulu && /^[a-z0-9][a-z0-9._-]{1,60}$/i.test(voulu) && (!disponibles?.length || disponibles.includes(voulu)) ? voulu : MODELE_DU_DIRECT;
  const reflexion = (settings?.voixCodexReflexion ?? '').trim() as ReflexionDuDirect;
  return { modele, effort: (REFLEXIONS_DU_DIRECT as readonly string[]).includes(reflexion) ? reflexion : (EFFORT_DU_DIRECT as ReflexionDuDirect) };
}

/** « gpt-5.6-sol » → « GPT-5.6 Sol » : le nom dit à voix haute quand le catalogue ne donne pas le sien. */
export function libelleDuModeleDuDirect(id: string): string {
  const morceaux = id.split('-').filter(Boolean);
  if (!morceaux.length) return id;
  const tete = morceaux[0]!.toUpperCase() === 'GPT' && morceaux[1] && /^\d/.test(morceaux[1]) ? `GPT-${morceaux.splice(1, 1)[0]}` : morceaux[0]!.toUpperCase() === 'GPT' ? 'GPT' : morceaux[0]!.charAt(0).toUpperCase() + morceaux[0]!.slice(1);
  return [tete, ...morceaux.slice(1).map((m) => m.charAt(0).toUpperCase() + m.slice(1))].join(' ');
}

/** « basse », « moyenne », « poussée ». */
export function libelleDeLaReflexionDuDirect(effort: string): string {
  return effort === 'low' ? 'basse' : effort === 'medium' ? 'moyenne' : 'poussée';
}

/**
 * CE QU'IL DIT DE SON MODÈLE (appel du 18/11/2026 : il annonçait « GPT-5 ») : le modèle et la réflexion réellement
 * utilisés, et la voix qui parle, qui ne se règle pas.
 */
export function ligneDuModeleDuDirect(modele: string = MODELE_DU_DIRECT, effort: string = EFFORT_DU_DIRECT, libelle?: string): string {
  return `TON MODÈLE : ${libelle?.trim() || libelleDuModeleDuDirect(modele)}, réflexion ${libelleDeLaReflexionDuDirect(effort)} (Réglages › Voix) ; la voix qui parle est celle de l’abonnement ChatGPT, non réglable. Dis-le exactement, jamais « GPT-5 » tout court ; pour une carte créée, le moteur, le modèle et la réflexion que l’outil lui a donnés.`;
}

/**
 * CE QUE JARVIS FAIT, DIT EN MOTS COURANTS (16/11/2026) : la ligne vivante posée dans le fil du volet pendant chaque
 * appel d'outil de la conversation vocale. `null` : un appel qui ne se montre pas (la liste de tâches interne).
 */
export function libelleDeLActivite(outil: string, args: Record<string, unknown> = {}): string | null {
  const t = (v: unknown, max = 70) => {
    const net = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
    return net.length > max ? `${net.slice(0, max - 1)}…` : net;
  };
  const action = t(args.action);
  switch (outil) {
    case 'update_plan':
    // Le dossier montre déjà ses quatre sources, cochées une à une : sa propre ligne serait un doublon.
    case 'voix_dossier':
      return null;
    case 'memoire': {
      const geste = t(args.geste);
      if (geste === 'chercher') return t(args.demande) ? `Je cherche dans la mémoire : ${t(args.demande)}` : 'Je cherche dans la mémoire';
      if (geste === 'lire') return 'Je lis la mémoire';
      return 'J’écris dans la mémoire';
    }
    case 'board_create_card': {
      const morceaux = [t(args.title) ? `Je crée la tâche « ${t(args.title)} »` : 'Je crée une tâche'];
      if (t(args.projet)) morceaux.push(t(args.projet));
      const moteur = t(args.moteur);
      if (moteur) {
        const nom = moteur === 'claude' ? (t(args.modele).includes('opus') ? 'Opus' : 'Claude') : moteur.charAt(0).toUpperCase() + moteur.slice(1);
        const reflexion = t(args.reflexion);
        const ref = reflexion === 'high' || reflexion === 'xhigh' || reflexion === 'max' ? 'réflexion haute' : reflexion === 'low' || reflexion === 'minimal' ? 'réflexion basse' : reflexion === 'medium' ? 'réflexion moyenne' : '';
        morceaux.push(ref ? `${nom} ${ref}` : nom);
      }
      return morceaux.join(' · ');
    }
    case 'board_list_cards':
      return 'Je regarde les tâches du tableau';
    case 'board_update_card':
      return 'Je modifie la tâche';
    case 'board_move_card':
      return 'Je déplace la tâche';
    case 'board_delete_card':
      return 'Je supprime la tâche';
    case 'assistant_resume':
      return t(args.jour) ? `Je regarde l’activité (${t(args.jour)})` : 'Je regarde l’activité des projets';
    case 'assistant_gestes':
      if (action === 'trouver') return t(args.texte) ? `Je cherche la tâche « ${t(args.texte)} »` : 'Je cherche la tâche';
      if (action === 'valider_proposition') return 'Je pose la tâche dans « Planifié »';
      if (action === 'lancer') return 'Je lance la tâche';
      if (action === 'changer_de_projet') return 'Je change la tâche de projet';
      if (action === 'deployer') return 'Je déploie';
      if (action === 'redemarrer') return 'Je redémarre Beluga';
      return 'J’agis dans Beluga';
    case 'assistant_ecran':
      if (action === 'chemins') return 'Je cherche comment faire à l’écran';
      if (action === 'lire') return 'Je regarde l’écran';
      if (action === 'jouer') return t(args.titre) || 'J’agis à l’écran';
      if (action === 'reprendre') return 'Je reprends à l’écran';
      return 'J’arrête ce que je faisais à l’écran';
    case 'project_manage':
      return action === 'lister' ? 'Je regarde les projets' : 'Je modifie les projets';
    case 'coffre_fort':
      return 'J’ouvre le coffre-fort';
    case 'assistant_messagerie':
      return 'Je regarde la messagerie des clients';
    case 'assistant_surveillances':
    case 'surveillance_essai':
    case 'surveillance_recette':
      return 'Je regarde la surveillance des sites';
    case 'assistant_backups':
    case 'backup_essai':
    case 'backup_recette':
      return 'Je regarde les sauvegardes';
    case 'statistiques':
      return 'Je regarde les statistiques';
    case 'marketing':
      return 'Je regarde les réseaux sociaux';
    case 'competences':
      return 'Je cherche un mode d’emploi';
    default:
      return 'Je travaille dans Beluga';
  }
}

/**
 * UNE ACTION CONCRÈTE DANS L'APPLICATION ? (18/11/2026 : « dès qu'on passe à des actions concrètes sur l'app, on doit
 * voir la conversation s'ouvrir ») — créer, modifier, déplacer, lancer, écrire dans une carte, jouer un geste à l'écran,
 * exécuter une commande. Lire (mémoire, tableau, activité, « trouver », « chemins ») n'en est pas une.
 */
export function outilQuiAgit(outil: string, args: Record<string, unknown> = {}): boolean {
  const action = typeof args.action === 'string' ? args.action : '';
  switch (outil) {
    case 'board_create_card':
    case 'board_update_card':
    case 'board_move_card':
    case 'board_delete_card':
    case 'carte_demande':
      return true;
    case 'assistant_gestes':
      return action !== 'trouver';
    case 'assistant_ecran':
      return action === 'jouer' || action === 'reprendre';
    case 'beluga_commande':
      return action === 'executer';
    case 'project_manage':
      return action !== '' && action !== 'lister';
    default:
      return false;
  }
}

/** La consigne de la voix elle-même (le modèle qui parle), courte : il passe le travail à Codex. */
/**
 * L'ACCENT (décision de l'utilisateur, 16/11/2026 : « des voix un peu robots et avec des accents québécois »). Les
 * neuf voix du direct sont anglophones d'origine : sans consigne, leur français dérive. On impose le français de
 * France, partout où une voix du direct parle (conversation et extrait d'essai des réglages).
 */
export const ACCENT_DE_LA_VOIX =
  'ACCENT : tu parles le français de FRANCE, avec un accent parisien neutre et standard, comme une présentatrice de ' +
  'radio nationale — jamais d’accent québécois, canadien, belge, suisse ni anglais. Prononce chaque mot à la ' +
  'française (y compris les noms anglais courants), avec les liaisons et l’intonation naturelles du français de France. ';

/**
 * LA CONSIGNE DE LA VOIX, À SON NOM (17/11/2026) : le nom donné à l'assistant (« Jarvis » par défaut, Réglages ›
 * Voix) est celui sous lequel il se présente et répond à l'appel « Dis <nom> » ; le PRÉNOM de la personne qui ouvre
 * la conversation (celui de son compte) lui est dit, pour qu'il l'emploie quand ça vient naturellement. Sans prénom,
 * la phrase est omise.
 */
/**
 * LE SALUT DE JARVIS À CHAQUE OUVERTURE (décision de l'utilisateur, 18/11/2026, redite trois fois) : « Salut <prénom>,
 * je t'écoute. » — le prénom réglé dans le compte qui ouvre la conversation ; sans prénom, « Salut, je t'écoute. ». À
 * CHAQUE ouverture voulue (geste, mot de réveil, raccourci), même juste après une fermeture et même quand une demande
 * est déjà dite ; seule une RECONNEXION automatique s'en passe.
 *
 * COMMENT IL EST DIT (essai réel du 18/11/2026, codex-cli 0.146.0) : l'ancien son « Jarvis ? » joué dans le micro ne
 * faisait jamais saluer (aucun salut sur DISC-0026 à DISC-0038). `thread/realtime/appendText` en rôle « developer »
 * avec la consigne `consigneDuSalut` fait dire la phrase MOT POUR MOT, sans fermer la session ; `appendSpeech`, lui,
 * la REFORMULE (« Salut ! Dis-moi ce qu'on fait, je suis là. »). Jamais de `response.create` : il ferme la session.
 */
export function salutDeJarvis(prenom?: string | null): string {
  const personne = (prenom ?? '').trim();
  return personne ? `Salut ${personne}, je t’écoute.` : 'Salut, je t’écoute.';
}

/** La consigne glissée par Beluga dès que la ligne est ouverte : elle fait dire le salut, mot pour mot. */
export function consigneDuSalut(prenom?: string | null): string {
  return `SALUT D’OUVERTURE : salue maintenant l’utilisateur en disant EXACTEMENT, mot pour mot et en français : « ${salutDeJarvis(prenom)} » — rien avant, rien après — puis tais-toi et écoute sa demande.`;
}

/** La phrase que Jarvis dit quand on lui demande de se couper : l'écran ferme alors la conversation (`jarvisAnnonceSaCoupure`). */
export const PHRASE_DE_COUPURE = 'D’accord, je me coupe.';

/**
 * LA CONSIGNE DE LA VOIX, À SON NOM. Le salut est DIT PAR BELUGA à l'ouverture (`consigneDuSalut`) : la consigne dit
 * seulement de ne pas le redire. `reprise` : la ligne s'est rouverte d'elle-même au milieu d'un appel — on continue.
 */
export function consigneDeLaVoix(
  nom: string = 'Jarvis',
  prenom?: string | null,
  options: { reprise?: boolean; souvenirs?: string; appelEnCours?: string; modele?: string } = {},
): string {
  const lui = (nom || 'Jarvis').trim();
  const personne = (prenom ?? '').trim();
  return (
    'Tu es la voix de l’assistant de Beluga. Tu parles TOUJOURS français, quoi que tu entendes (même un mot anglais ou un son bref), avec des phrases courtes et naturelles. ' +
    ACCENT_DE_LA_VOIX +
    'Pour toute demande qui porte sur Beluga — les projets, la mémoire, les tâches, ce qui tourne, ce qui attend, ou un geste —, ne réponds JAMAIS de toi-même : passe la main à Codex, qui vérifie avant de répondre, puis redis SA réponse d’un seul tenant, sans en retrancher l’ordre ni les dates, et UNE SEULE FOIS : ni ta propre version avant, ni une reprise après (appel du 18/11 : « Il n’y a plus de tâche en cours » puis « Aucune tâche n’est en cours »). ' +
    'Tu ne sais RIEN de l’état de Beluga par toi-même : n’invente jamais une tâche en cours, une tâche finie, un résultat ni une production (« c’est fait », « je l’ai mis dans… ») — seul Codex le sait, et tu ne redis que ce qu’il rend. ' +
    '« C’EST FAIT » SEULEMENT QUAND C’EST VRAI : tu n’annonces une action faite (« c’est ouvert », « c’est créé », « tu devrais la voir ») qu’après la réponse de Codex qui le confirme ; tant qu’elle n’est pas venue, tais-toi. Si Codex rend un échec, dis ce qui a raté, en une phrase. ' +
    'TOUTE DEMANDE D’ACTION (« crée la tâche », « ouvre », « va dans », « ajoute », « écris dans la carte », « change », « lance », « continue ») passe à Codex, qui a TOUS les outils de Beluga et la fait : tu ne réponds JAMAIS de toi-même « je note », « je m’en occupe » ni « je ne peux pas ». Quand il pense seulement à voix haute, aide-le à préciser par des questions courtes, une à la fois ; une synthèse de l’échange sera collée dans son champ d’écriture à la fin. ' +
    'Quand il dit qu’il a fini ou qu’il valide (« c’est ok », « c’est bon », « on arrête », « termine », « fais la synthèse »), dis seulement « Je remplis ton champ. » et plus rien ensuite. ' +
    `Quand il te demande de te COUPER, de te taire ou qu’il reviendra vers toi plus tard (« coupe-toi », « tais-toi », « je reviens vers toi », « j’y reviendrai »), dis seulement « ${PHRASE_DE_COUPURE} » et plus rien : la conversation se ferme alors d’elle-même. ` +
    'PENDANT QUE CODEX TRAVAILLE, TU NE RACONTES RIEN (décision de l’utilisateur, 18/11/2026 : « je veux juste la réponse ») : ni « je cherche », ni « je regarde la mémoire », ni « je vérifie », ni la liste de ce qui a été consulté ou trouvé. Attends sa réponse et redis-la. Un salut, un merci, une remarque ou une question générale se répondent directement, sans passer par Codex. ' +
    (options.modele?.trim() ? `${options.modele.trim()} ` : '') +
    'Ne lis jamais de code, de chemin, d’identifiant ni d’adresse à voix haute. Seuls la mise en production, un paiement, un message à un client et une suppression se font confirmer à voix haute ; tout le reste se fait sans question. ' +
    `Ton nom est ${lui}. TON SALUT EST DIT PAR BELUGA à l’ouverture (« ${salutDeJarvis(personne)} ») : ne le redis jamais toi-même, ne salue jamais autrement (jamais « Hey », « What’s up »), et si juste après on t’appelle seulement par ton nom (« ${lui} », « Dis ${lui} »), ne réponds rien de plus : attends la demande. ` +
    (options.reprise
      ? 'LA LIGNE VIENT DE SE RÉTABLIR au milieu de l’appel : tu CONTINUES la même conversation (voir « CET APPEL, JUSQU’ICI »), sans saluer ni recommencer. '
      : '') +
    (personne
      ? `La personne qui te parle s’appelle ${personne} : emploie son prénom quand ça vient naturellement, sans en abuser. `
      : '') +
    'Si l’on te demande de te mettre en veille (« en veille », « toi, en veille », « mets-toi en veille »…), dis seulement « D’accord, je me mets en veille. » et plus rien ensuite. ' +
    'Une phrase qui ne t’est pas adressée (l’utilisateur parle à quelqu’un d’autre, pense à voix haute) ne reçoit AUCUNE réponse. ' +
    CONSIGNE_DES_SOUVENIRS +
    (options.appelEnCours?.trim() ? `\n\nCET APPEL, JUSQU’ICI (ce qui vient d’être dit, le plus ancien d’abord) :\n${options.appelEnCours.trim()}` : '') +
    (options.souvenirs?.trim() ? `\n\nVOS DERNIÈRES DISCUSSIONS (les plus récentes d’abord) :\n${options.souvenirs.trim()}` : '')
  );
}

/**
 * LA VOIX SE SOUVIENT (décision de l'utilisateur, 17/11/2026 : « pourquoi il me dit qu'il sait pas ce qu'on a discuté
 * alors qu'on est censé stocker toutes nos discussions »). Le modèle temps réel ne reçoit que sa consigne : sans
 * souvenirs, il répondait seul « je n'ai pas l'historique ». Il reçoit désormais les dernières discussions à l'ouverture
 * et, pour les plus anciennes, passe la main à Codex, qui les retrouve par l'outil « memoire » (DISC-…).
 */
export const CONSIGNE_DES_SOUVENIRS =
  'MÉMOIRE DES ÉCHANGES : toutes vos discussions passées sont gardées. Une question sur ce qui s’est dit avant (« de quoi on a parlé », « tu te souviens… », « la dernière fois », « ce qu’on avait dit sur… ») : si la réponse est dans « CET APPEL, JUSQU’ICI » ou dans les souvenirs ci-dessous, réponds en datant ; sinon passe la main à Codex, qui retrouve les discussions, la mémoire et les tâches dans le dossier que Beluga lui prépare. Ne dis JAMAIS que tu n’as pas l’historique, que tu n’y as pas accès ni que tu ne te souviens pas.';

/** Les souvenirs donnés à la voix ne dépassent pas cette longueur : le prompt du temps réel reste court. */
export const SIGNES_MAX_DES_SOUVENIRS = 2500;
/** Combien de discussions passées la voix reçoit à l'ouverture. */
export const DISCUSSIONS_EN_SOUVENIR = 3;

/**
 * LES SOUVENIRS DE LA VOIX, rédigés pour sa consigne : chaque discussion (la plus récente d'abord) sous sa date, ses
 * derniers tours en « Toi : » / « Jarvis : ». Le budget se partage entre les discussions ; dans chacune, ce sont les
 * DERNIERS tours qui restent (la conclusion d'un échange compte plus que son début). Vide sans discussion.
 */
export function souvenirsPourLaVoix(
  passees: readonly { debut: number; echanges: readonly { role: string; texte: string }[] }[],
  max = SIGNES_MAX_DES_SOUVENIRS,
): string {
  const utiles = passees.filter((d) => d.echanges.some((e) => e.texte.trim())).slice(0, DISCUSSIONS_EN_SOUVENIR);
  if (!utiles.length) return '';
  const parDiscussion = Math.floor(max / utiles.length);
  const blocs: string[] = [];
  for (const d of utiles) {
    const date = new Date(d.debut);
    const deux = (n: number) => String(n).padStart(2, '0');
    const tete = `— ${deux(date.getDate())}/${deux(date.getMonth() + 1)} à ${deux(date.getHours())} h ${deux(date.getMinutes())} :`;
    const lignes: string[] = [];
    let reste = parDiscussion - tete.length - 1;
    for (let i = d.echanges.length - 1; i >= 0 && reste > 40; i -= 1) {
      const e = d.echanges[i]!;
      const texte = e.texte.replace(/\s+/g, ' ').trim();
      if (!texte) continue;
      let ligne = `${e.role === 'user' ? 'Toi' : 'Jarvis'} : ${texte}`;
      if (ligne.length + 1 > reste) ligne = `${ligne.slice(0, Math.max(0, reste - 2)).replace(/\s+\S*$/, '')}…`;
      lignes.unshift(ligne);
      reste -= ligne.length + 1;
    }
    if (lignes.length) blocs.push([tete, ...lignes].join('\n'));
  }
  return blocs.join('\n').slice(0, max);
}

/** L'appel en cours, rendu à la voix quand la ligne se rétablit : il a son PROPRE budget (il compte plus que le passé). */
export const SIGNES_MAX_DE_L_APPEL_EN_COURS = 3500;

/**
 * CET APPEL, JUSQU'ICI (18/11/2026) : à une reprise, la voix repartait SANS ce qui venait d'être dit — « Non, j'ai pas
 * accès à ce qu'il y avait avant dans cet appel » (DISC-0038, 06:34). Les derniers tours d'abord gardés, rendus dans
 * l'ordre ; vide sans tour.
 */
export function appelEnCoursPourLaVoix(echanges: readonly { role: string; texte: string }[], max = SIGNES_MAX_DE_L_APPEL_EN_COURS): string {
  const lignes: string[] = [];
  let reste = max;
  for (let i = echanges.length - 1; i >= 0 && reste > 40; i -= 1) {
    const texte = (echanges[i]!.texte ?? '').replace(/\s+/g, ' ').trim();
    if (!texte) continue;
    let ligne = `${echanges[i]!.role === 'user' ? 'Toi' : 'Jarvis'} : ${texte}`;
    if (ligne.length + 1 > reste) ligne = `${ligne.slice(0, Math.max(0, reste - 2)).replace(/\s+\S*$/, '')}…`;
    lignes.unshift(ligne);
    reste -= ligne.length + 1;
  }
  return lignes.join('\n');
}

/** La consigne au nom par défaut, sans prénom (les contrôles la lisent). */
export const CONSIGNE_DE_LA_VOIX = consigneDeLaVoix();

/** La consigne du cerveau sur le modèle par défaut (les contrôles la lisent). Posée après les constantes qu'elle lit. */
export const CONSIGNE_DU_DIRECT = consigneDuDirect();

/* ------------------------------------------------------------------ */
/* Le flux « Discussions »                                              */
/* ------------------------------------------------------------------ */

/** Un tour gardé ne dépasse pas cette longueur : seul le texte finalisé se garde, jamais le son. */
export const SIGNES_MAX_PAR_TOUR = 4000;
/** Une discussion se borne : au-delà, les tours suivants ne sont plus écrits (la session continue). */
export const TOURS_MAX_PAR_DISCUSSION = 800;
/** Une session relancée dans ce délai (changement de voix, coupure) reprend le même fil et la même discussion. */
export const REPRISE_DU_DIRECT_MS = 15 * 60 * 1000;
/** Combien de discussions la recherche de la mémoire rend au plus. */
export const DISCUSSIONS_RENDUES_MAX = 3;

/** Le texte d'un tour, prêt à être gardé : espaces resserrés, borné. Vide : rien à garder. */
export function tourAGarder(texte: string): string | null {
  const net = (texte ?? '').replace(/\s+/g, ' ').trim();
  if (!net) return null;
  return net.length > SIGNES_MAX_PAR_TOUR ? `${net.slice(0, SIGNES_MAX_PAR_TOUR - 1)}…` : net;
}

/** L'identifiant affiché d'une discussion : « DISC-0042 ». */
export function idDeDiscussion(numero: number): string {
  return `DISC-${String(numero).padStart(4, '0')}`;
}

/** Le numéro d'une discussion depuis son identifiant, ou `null` si ce n'en est pas un. */
export function numeroDeDiscussion(id: string): number | null {
  const m = /^DISC-(\d{1,9})$/i.exec((id ?? '').trim());
  return m ? Number(m[1]) : null;
}

/**
 * Les projets que vise un appel d'outil : un champ « projet », « projectId » ou « project » dont la valeur est
 * l'identifiant ou le nom d'un projet ouvert.
 */
export function projetsDesArguments(args: unknown, projets: ProjetJoignable[]): string[] {
  if (!args || typeof args !== 'object') return [];
  const trouves = new Set<string>();
  for (const cle of ['projet', 'projectId', 'project', 'projetMarque', 'vers']) {
    const valeur = (args as Record<string, unknown>)[cle];
    if (typeof valeur !== 'string' || !valeur.trim()) continue;
    const v = valeur.trim().toLowerCase();
    const projet = projets.find((p) => p.id.toLowerCase() === v || p.name.trim().toLowerCase() === v);
    if (projet) trouves.add(projet.id);
  }
  return [...trouves];
}

/** Deux listes de marques réunies, sans doublon, dans l'ordre d'arrivée. */
export function reunirLesMarques(...listes: (readonly string[] | undefined)[]): string[] {
  const vues: string[] = [];
  for (const liste of listes) for (const id of liste ?? []) if (id && !vues.includes(id)) vues.push(id);
  return vues;
}

/** Combien de sources de la mémoire un résultat de recherche cite (identifiants d'unités et de discussions). */
export function sourcesDeLaMemoireCitees(texte: string): number {
  return new Set((texte ?? '').match(/\b(?:MEM|DEC|DISC)-\d+\b/g) ?? []).size;
}

/** Les mots vides d'une demande parlée : ils ne disent rien du SUJET cherché. */
const MOTS_VIDES = new Set([
  'les', 'des', 'une', 'est', 'que', 'qui', 'quoi', 'dans', 'pour', 'sur', 'avec', 'pas', 'plus', 'tout', 'tous', 'mais', 'donc', 'alors',
  'cette', 'ces', 'son', 'ses', 'mon', 'mes', 'ton', 'tes', 'nous', 'vous', 'elle', 'ils', 'elles', 'lui', 'leur', 'aux', 'par',
  'tu', 'te', 'toi', 'moi', 'on', 'ca', 'cela', 'quand', 'comment', 'avait', 'avais', 'avons', 'parle', 'parlait', 'dit', 'dis',
  'souviens', 'rappelles', 'rappelle', 'rappel', 'fois', 'derniere', 'hier', 'matin', 'soir', 'jarvis', 'beaucoup', 'peu', 'juste',
]);

function motsDeRecherche(texte: string): string[] {
  return (texte ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((mot) => (mot.length >= 3 || /^\d+$/.test(mot)) && !MOTS_VIDES.has(mot));
}

/**
 * LA RACINE D'UN MOT (18/11/2026) : on ne redit jamais une chose avec les mêmes mots — « disques » retrouve « disque »,
 * « serveurs » retrouve « serveur », « coupure » retrouve « couper ». Grossière mais sûre : les 5 premières lettres d'un
 * mot long, le mot entier sinon (les nombres restent entiers : « 70 » ne vaut pas « 700 »).
 */
function racine(mot: string): string {
  return /^\d+$/.test(mot) || mot.length <= 5 ? mot.replace(/s$/, '') : mot.slice(0, 5);
}

/**
 * LA PERTINENCE D'UNE DISCUSSION POUR UNE DEMANDE, de 0 à 1 : la part des mots de la demande retrouvés dans
 * son texte. Une discussion marquée du projet de la demande passe devant (bonus), sans qu'aucune ne soit
 * écartée pour sa marque : le flux est général.
 */
export function pertinenceDUneDiscussion(demande: string, texte: string, marquee = false): number {
  const voulus = [...new Set(motsDeRecherche(demande).map(racine))];
  if (!voulus.length) return 0;
  const presents = new Set(motsDeRecherche(texte).map(racine));
  const trouves = voulus.filter((mot) => presents.has(mot)).length;
  if (!trouves) return 0;
  return Math.min(1, trouves / voulus.length + (marquee ? 0.15 : 0));
}

/** Sous ce seuil, une discussion n'est pas rendue : un seul mot commun ne fait pas une source. */
export const PERTINENCE_MIN_DISCUSSION = 0.34;

/* ------------------------------------------------------------------ */
/* La synthèse de fin (17/11/2026)                                      */
/* ------------------------------------------------------------------ */

/** Ce que le modèle répond quand il n'y a rien à coller (l'échange n'a servi qu'à le faire agir). */
export const RIEN_A_SYNTHETISER = 'RIEN';
/** Le délai de la synthèse : au-delà, la conversation se ferme quand même et l'échec se dit. */
export const DELAI_DE_LA_SYNTHESE_MS = 30_000;
/** La transcription envoyée à la synthèse est bornée : les derniers signes comptent le plus. */
const SIGNES_MAX_DE_LA_TRANSCRIPTION = 24_000;

/**
 * LA DEMANDE DE SYNTHÈSE, envoyée au modèle quand la conversation vocale se ferme : il rédige, à partir de la
 * transcription, la demande que l'utilisateur enverra à l'agent du champ — ou « RIEN ». `destinataire` dit à qui elle
 * s'adresse (« l’assistant de Beluga », « l’agent de la tâche « … » »).
 */
export function consigneDeLaSynthese(tours: readonly { role: 'user' | 'assistant'; texte: string }[], destinataire: string): string {
  let transcription = tours
    .map((tour) => `${tour.role === 'user' ? 'Utilisateur' : 'Jarvis'} : ${tour.texte.replace(/\s+/g, ' ').trim()}`)
    .filter((ligne) => !/ : $/.test(ligne))
    .join('\n');
  if (transcription.length > SIGNES_MAX_DE_LA_TRANSCRIPTION) transcription = `…${transcription.slice(-SIGNES_MAX_DE_LA_TRANSCRIPTION)}`;
  return [
    'La conversation vocale avec l’utilisateur est TERMINÉE. Voici sa transcription :',
    '',
    transcription,
    '',
    `Rédige maintenant la demande que l’utilisateur va écrire à ${destinataire}, telle qu’il l’enverrait lui-même : en français, à la première personne, claire et complète — le but, le contexte utile, ce qui a été décidé pendant l’échange, les contraintes et ce qu’il faut éviter. Des phrases courtes ; une courte liste à tirets seulement si plusieurs points distincts.`,
    'Écris UNIQUEMENT ce texte : aucun préambule, aucune formule de politesse, aucune mention de la conversation vocale ni de Jarvis.',
    `Si l’échange n’a servi qu’à te faire AGIR (et que c’est fait), à répondre à une question, ou s’il n’y a rien à demander, réponds exactement « ${RIEN_A_SYNTHETISER} ».`,
    'N’appelle AUCUN outil.',
  ].join('\n');
}

/** Le texte à coller tiré de la réponse du modèle : vide quand il n'y a rien (« RIEN », réponse vide). */
export function syntheseAColler(reponse: string): string {
  const net = (reponse ?? '').trim().replace(/^["«“]\s*|\s*["»”]$/g, '').trim();
  if (!net) return '';
  if (net.replace(/[.\s«»"]/g, '').toUpperCase() === RIEN_A_SYNTHETISER) return '';
  return net;
}

/** Le texte du champ après la synthèse : AJOUTÉE à la suite du brouillon, une ligne vide entre les deux, jamais à sa place. */
export function brouillonApresSynthese(brouillon: string, synthese: string): string {
  const ajout = synthese.trim();
  if (!ajout) return brouillon;
  return brouillon.trim() ? `${brouillon.replace(/\s+$/, '')}\n\n${ajout}` : ajout;
}

/* ------------------------------------------------------------------ */
/* Les bulles au-dessus du champ (17/11/2026)                           */
/* ------------------------------------------------------------------ */

/**
 * L'INTITULÉ DU MESSAGE QUI PORTE CE QUE JARVIS PRODUIT À LA VOIX (17/11/2026) : une carte proposée, une image, un
 * document ou un fichier entrent dans le fil sous lui (vignettes, aperçu au clic) ; les phrases restent dans les bulles.
 */
export const INTITULE_DE_LA_VOIX = 'Jarvis · conversation vocale';

/** Combien de bulles la conversation vocale garde : toute la session (17/11/2026), la pile flottante défile et s’efface vers le haut. */
export const BULLES_MAX = 60;

/** Ce que la pile garde : les `BULLES_MAX` dernières entrées qui ont quelque chose à montrer. */
export function dernieresBulles<T extends { texte: string; activite?: unknown; tache?: unknown; action?: unknown; verifications?: unknown }>(fil: readonly T[], max = BULLES_MAX): T[] {
  return fil.filter((tour) => tour.activite || tour.verifications || tour.tache || tour.action || tour.texte.trim()).slice(-max);
}
