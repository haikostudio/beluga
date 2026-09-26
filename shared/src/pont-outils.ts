/**
 * LE PONT D'OUTILS DU PROJET : a-t-il vraiment servi ?
 *
 * Les outils du projet (`project_memory`, `remember`, gestes de tableau) sont
 * servis au moteur par un petit programme, le « pont ». Rien ne prouvait qu'il
 * démarrait : un tour pouvait se dérouler entier SANS aucun outil, et le
 * compte rendu affirmait quand même avoir lu la mémoire. Un silence, jamais une
 * panne visible.
 *
 * Le pont s'annonce donc au démon : une fois quand il démarre, une fois quand
 * le moteur lui demande sa liste d'outils. Les règles ci-dessous lisent cette
 * trace et disent, en français, ce qui a manqué.
 */

/** Ce que le démon a vu du pont pendant UN tour. `null` : rien du tout. */
export type PassageDuPont = {
  /** Le pont a été lancé par le moteur et a répondu à la poignée de main. */
  demarre: boolean;
  /** Nombre d'outils rendus au moteur ; `null` : la liste n'a jamais été demandée. */
  outils: number | null;
  /**
   * AU MOINS UN APPEL D'OUTIL A ABOUTI DE BOUT EN BOUT pendant ce tour.
   *
   * Les deux champs au-dessus disent que les outils étaient à PORTÉE ; celui-ci
   * dit qu'ils ont SERVI. C'est la seule preuve qu'un tour a vraiment eu ses
   * moyens : une réponse écrite sans jamais avoir pu appeler `project_memory`,
   * `remember` ni le moindre geste de tableau n'est pas un travail livré, c'est
   * un travail fait à l'aveugle (`tourARejouerFauteDOutils`).
   */
  appelAbouti?: boolean;
} | null;

export type EtatDuPont = { ok: true } | { ok: false; raison: string };

export const PONT_ABSENT =
  "Les outils du projet ne sont jamais arrivés au moteur : le pont d'outils n'a pas démarré. " +
  'Ce tour s\'est donc fait SANS mémoire du projet, sans écriture de mémoire et sans geste de tableau — ' +
  'ce qui est dit de la mémoire dans la réponse n\'a pas été vérifié.';

export const PONT_SANS_LISTE =
  "Le pont d'outils du projet a démarré, mais le moteur ne lui a jamais demandé sa liste d'outils : " +
  'aucun outil du projet n\'a pu être appelé pendant ce tour.';

/**
 * LE PROGRAMME DU PONT N'EST MÊME PAS SUR LE DISQUE.
 *
 * C'est la seule cause de pont mort-né qu'aucun rejeu ne réparera : le fichier
 * `server/mcp-bridge.mjs` manque — projet jamais construit, construction
 * interrompue, fichier effacé. Sans elle, trois tours se rejouaient en silence
 * puis posaient une décision qui ne disait rien d'utile ; nommée, la panne se
 * répare en une commande.
 */
export const PONT_INTROUVABLE =
  "Le programme du pont d'outils est introuvable sur le disque (server/mcp-bridge.mjs) : " +
  'aucun outil du projet ne peut partir au moteur tant qu\'il manque. ' +
  'Le projet doit être reconstruit (npm run build:server).';

export const PONT_LISTE_VIDE =
  "Le pont d'outils du projet a démarré mais n'a rendu AUCUN outil : " +
  'ce tour s\'est fait sans mémoire du projet, sans écriture de mémoire et sans geste de tableau.';

/** Étiquette de l'étape en échec affichée dans la conversation. */
export const ETAPE_PONT = 'Outils du projet indisponibles';
/** Identifiant de cette étape : une seule par tour, jamais empilée. */
export const ETAPE_PONT_ID = 'pont-outils';

/**
 * Ce qui s'ajoute à la RÉPONSE elle-même quand le pont a manqué. L'étape rouge
 * (`ETAPE_PONT`) se replie dans un tiroir qu'on peut ne jamais ouvrir ; sans ce
 * bloc dans le texte, un moteur privé d'outils pouvait écrire « la proposition
 * a été refusée » ou « aucune carte n'a été créée » et cette phrase inventée
 * restait la seule chose lue — jamais corrigée par le fait réel : aucun outil
 * n'était disponible, rien n'a été tenté ni refusé.
 */
export function noteDePontEnEchec(raison: string): string {
  return (
    `\n\n> [!WARNING]\n> ${raison} ` +
    "Une phrase ci-dessus qui parle d'un refus ou d'un choix n'en est pas un : " +
    "l'agent n'a rien pu appeler, faute d'outils."
  );
}

/**
 * Le tour a-t-il eu ses outils ? On ne juge PAS que le moteur s'en soit servi —
 * c'est son affaire — mais qu'ils aient été à sa portée.
 */
export function etatDuPont(passage: PassageDuPont, pontPresent = true): EtatDuPont {
  /*
   * LA CAUSE LA PLUS PRÉCISE PASSE DEVANT. Un pont dont le PROGRAMME manque ne
   * démarrera jamais, ni à ce tour ni au suivant : le dire évite trois rejeux
   * silencieux pour rien, et nomme le geste qui répare.
   */
  if (!pontPresent) return { ok: false, raison: PONT_INTROUVABLE };
  if (!passage || !passage.demarre) return { ok: false, raison: PONT_ABSENT };
  if (passage.outils === null) return { ok: false, raison: PONT_SANS_LISTE };
  if (passage.outils <= 0) return { ok: false, raison: PONT_LISTE_VIDE };
  return { ok: true };
}

/** Ce qu'il faut savoir d'un tour fini pour dire s'il doit être REJOUÉ. */
export interface TourPriveDOutils {
  /** Le pont a-t-il servi ses outils (`etatDuPont`) ? */
  pontOk: boolean;
  /** Le moteur n'a jamais été joint : c'est le lancement qui a raté, pas le pont. */
  moteurMuet: boolean;
  /** Le tour s'est-il terminé en échec, sans rapport rendu ? */
  echec: boolean;
  /**
   * AU MOINS UN APPEL D'OUTIL A ABOUTI (`PassageDuPont.appelAbouti`). C'est lui,
   * et non le fait d'avoir rendu du texte, qui dit qu'un tour a travaillé AVEC
   * ses outils.
   */
  outilAbouti?: boolean;
  /** L'arrêt a-t-il été demandé à la main ? Le geste humain l'emporte sur tout. */
  arretDemande?: boolean;
  /** Le tour part déjà sur une autre route : relève de compte, panne du fournisseur. */
  autreRoute?: boolean;
}

/**
 * CE TOUR DOIT-IL ÊTRE REJOUÉ FAUTE D'OUTILS ?
 *
 * Dire la panne ne suffisait pas. Un agent privé de son pont n'a ni la mémoire
 * du projet, ni l'écriture de mémoire, ni le moindre geste de tableau : il ne
 * peut même pas ranger sa propre carte. Quand ce tour-là tombe, l'échec n'est
 * pas celui de la tâche — la tâche n'a jamais eu ses moyens —, et la carte
 * restait pourtant figée en « En cours », sans agent au travail, jusqu'à ce
 * qu'on la reprenne à la main.
 *
 * UN TOUR QUI A RENDU DU TEXTE SANS JAMAIS JOINDRE SES OUTILS N'EST PAS UN
 * TRAVAIL LIVRÉ. La règle exigeait autrefois que le tour soit TOMBÉ (`echec`),
 * au motif qu'« un rapport rendu, même sans outils, est un travail livré ». Le
 * cas vécu le 08.09.2026 dit le contraire : privé de son pont, le moteur écrit
 * quand même un compte rendu — il ne sait pas qu'il lui manque quelque chose —,
 * affirme avoir lu la mémoire, croit avoir rangé sa carte, et cette réponse
 * REFERME la carte. L'encadré d'avertissement (`noteDePontEnEchec`) était alors
 * la seule protection : une phrase, contre un travail à refaire en entier.
 *
 * Ce qui décide n'est donc plus « le tour est-il tombé ? » mais « un appel
 * d'outil a-t-il abouti ? ». Un tour qui a VRAIMENT appelé ses outils garde son
 * ancien sort, qu'il ait fini ou non ; un tour dont le pont n'a jamais répondu
 * se rejoue, texte ou pas.
 *
 * Quatre garde-fous, tous nécessaires :
 *   — le pont a bien manqué ;
 *   — le moteur, lui, avait démarré : un moteur jamais joint dit une cause plus
 *     précise, et garde sa propre route (`colonneApresMoteurMuet`) ;
 *   — aucun appel d'outil n'a abouti de bout en bout du tour ;
 *   — personne n'a coupé à la main, et aucune autre route n'est déjà prise.
 */
export function tourARejouerFauteDOutils(tour: TourPriveDOutils): boolean {
  if (tour.pontOk) return false;
  if (tour.moteurMuet) return false;
  if (tour.outilAbouti) return false;
  if (tour.arretDemande) return false;
  if (tour.autreRoute) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Combien de fois on rejoue, et quand on demande à l'utilisateur       */
/* ------------------------------------------------------------------ */

/**
 * COMBIEN D'ESSAIS SILENCIEUX AVANT DE DÉRANGER QUELQU'UN.
 *
 * Un pont mort-né est presque toujours passager : la machine n'avait plus de
 * quoi lancer un processus à cette seconde-là. Repartir seul répare le cas
 * courant sans que personne n'ait rien à faire. Mais un rejeu sans plafond est
 * une boucle : une machine durablement saturée referait le tour indéfiniment,
 * en brûlant du quota à chaque passage. Trois essais, puis on demande.
 */
export const ESSAIS_DE_PONT_MAX = 3;

/**
 * LE DÉLAI AVANT CHAQUE REJEU, CROISSANT. Le premier essai reprend vite — une
 * saturation d'une seconde est déjà passée —, les suivants laissent à la
 * machine le temps de se vider. Au-delà de la liste, c'est la dernière valeur
 * qui s'applique.
 */
export const DELAIS_DE_REJEU_DU_PONT_MS = [60_000, 3 * 60_000, 5 * 60_000];

/** Ce qu'on fait d'un tour privé d'outils : le rejouer, ou demander. */
export type IssueDuPontMort =
  | { rejouer: true; essai: number; delaiMs: number }
  | { rejouer: false; essais: number };

/**
 * REJOUER, OU POSER LA DÉCISION ?
 *
 * `essaisPrecedents` compte les tours CONSÉCUTIFS déjà privés d'outils sur
 * cette carte (`scheduling.essaisSansOutils`). Il est remis à zéro dès qu'un
 * tour obtient ses outils : sans cela, une carte ancienne partirait avec un
 * crédit déjà épuisé et poserait sa décision au premier incident.
 */
export function issueDuPontMort(essaisPrecedents = 0): IssueDuPontMort {
  const faits = Math.max(0, Math.floor(essaisPrecedents));
  const essai = faits + 1;
  if (essai > ESSAIS_DE_PONT_MAX) return { rejouer: false, essais: faits };
  const delai = DELAIS_DE_REJEU_DU_PONT_MS[Math.min(faits, DELAIS_DE_REJEU_DU_PONT_MS.length - 1)];
  return { rejouer: true, essai, delaiMs: delai };
}

/**
 * LA TRACE REPLIÉE D'UN REJEU SILENCIEUX. Rien ne s'affiche en grand — c'est
 * tout l'intérêt du rejeu automatique —, mais rien n'est caché non plus : la
 * ligne se lit dans le fil de la carte, repliée avec le reste du détail.
 */
export function phraseDeRejeuDuPont(essai: number): string {
  return (
    `Les outils du projet n'ont pas répondu : le tour est rejoué (essai ${essai} sur ${ESSAIS_DE_PONT_MAX}), ` +
    'après reconstruction du pont.'
  );
}

/**
 * LA PHRASE DE LA DÉCISION, quand les rejeux silencieux sont épuisés. Elle dit
 * le nombre d'essais : sans lui, « les outils ne répondent pas » ressemble à un
 * premier incident, et l'on reclique « Relancer » pour rien.
 */
export function raisonDePontMortDefinitif(essais = ESSAIS_DE_PONT_MAX): string {
  return (
    `Les outils du projet ne répondent pas après ${essais} essais : le tour n'a ni mémoire du projet, ` +
    'ni écriture de mémoire, ni geste de tableau. Relancer, ignorer ou arrêter ?'
  );
}

/**
 * UN APPEL D'OUTIL APPARTIENT AU TOUR QUI L'A LANCÉ, ET À LUI SEUL.
 *
 * Le pont dit au démon quel AGENT il sert, en recopiant ce que sa configuration
 * porte. Cette configuration est un FICHIER sur le disque : s'il est resté là
 * après un tour, ou si le moteur en a lu un autre que le sien
 * (`shared/src/racine-cursor.ts`), l'appel arrive au nom d'un agent qui ne
 * travaille pas — et ce qu'il écrit part dans la conversation de quelqu'un
 * d'autre. C'est ainsi qu'une carte proposée s'est retrouvée dans le fil d'un
 * agent terminé deux heures plus tôt, dans un autre projet.
 *
 * Chaque tour porte donc un identifiant à lui, posé dans la configuration au
 * lancement. Le démon n'accepte l'appel que si cet identifiant est celui du tour
 * qui tourne VRAIMENT pour cet agent. Le refus se dit au moteur en toutes
 * lettres : mieux vaut un outil qui répond « ce n'est pas ton tour » qu'une
 * carte écrite chez le voisin.
 *
 * Une configuration ÉCRITE AVANT cette règle ne porte aucun identifiant : tant
 * que l'agent a bien un tour en cours, l'appel passe — un déploiement ne doit
 * pas couper les tours déjà partis.
 */
export const TOUR_TERMINE =
  "Refusé : ce tour est terminé. L'appel vient d'une configuration d'outils périmée — " +
  "rien n'a été écrit, et rien ne doit l'être au nom d'un autre agent.";

export const TOUR_ETRANGER =
  "Refusé : cet outil appartient à un autre tour que le tien. L'appel vient d'une configuration " +
  "d'outils qui n'est pas celle de ce tour — rien n'a été écrit.";

/** Ce que le démon sait au moment d'un appel d'outil. */
export interface AppelDuPont {
  /** L'identifiant de tour recopié par le pont ; absent d'une vieille configuration. */
  tourAnnonce?: string;
  /** L'identifiant du tour qui tourne pour cet agent ; absent : aucun tour. */
  tourEnCours?: string;
}

/** L'appel vient-il bien du tour qui tourne ? */
export function appelDuPontRecevable(appel: AppelDuPont): EtatDuPont {
  if (!appel.tourEnCours) return { ok: false, raison: TOUR_TERMINE };
  if (appel.tourAnnonce && appel.tourAnnonce !== appel.tourEnCours) {
    return { ok: false, raison: TOUR_ETRANGER };
  }
  return { ok: true };
}

/**
 * Les serveurs d'outils ÉTRANGERS déclarés dans la configuration d'un moteur.
 *
 * Codex lit sa propre `config.toml`, où l'utilisateur peut avoir branché
 * d'autres serveurs. Quand l'un d'eux propose lui aussi une mémoire, le modèle
 * l'appelle À LA PLACE de celle du projet et croit avoir lu la mémoire : c'est
 * exactement ce qui se voyait dans les tours du 4 août (`chercher_memoire`
 * appelé, `project_memory` jamais). On les éteint le temps d'un tour d'agent.
 *
 * Les trois écritures TOML d'un même serveur sont reconnues :
 * `[mcp_servers.nom]`, `[mcp_servers.nom.tools.x]` et `mcp_servers.nom = { … }`.
 */
export function serveursTiers(configToml: string, garde = 'beluga'): string[] {
  const noms = new Set<string>();
  for (const ligne of configToml.split('\n')) {
    const texte = ligne.trim();
    if (texte.startsWith('#')) continue; // ligne mise de côté : elle ne branche rien
    const entete = texte.match(/^\[\s*mcp_servers\s*\.\s*([A-Za-z0-9_.-]+?)\s*(?:\.[A-Za-z0-9_."-]+)*\s*\]/);
    const affectation = texte.match(/^mcp_servers\s*\.\s*([A-Za-z0-9_-]+)\s*(?:\.[A-Za-z0-9_.-]+)?\s*=/);
    const nom = (entete?.[1] ?? affectation?.[1] ?? '').split('.')[0];
    if (nom && nom !== garde) noms.add(nom);
  }
  return [...noms];
}
