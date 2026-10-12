import type { SentContextEtat } from './models.js';
import { consigneEnTeteDeSession } from './prefixe-cache.js';

/**
 * LE PROMPT RÉELLEMENT ENVOYÉ, DANS LA CONVERSATION ELLE-MÊME.
 *
 * Il n'y a ni pastille à cliquer, ni tiroir à ouvrir : ce qui est parti au
 * moteur se lit dans le fil, côté agent, une étape par information reçue
 * (`filVisuelDeLAgent`, rendu par `web/src/components/prompt-envoye.tsx`).
 * Le TEXTE ENTIER se lit par un lien qui se déplie sur place
 * (`partiesDuPromptEnvoye`). Aucun compteur de jetons : seulement du texte.
 */

/**
 * LA DEMANDE ELLE-MÊME, telle qu'elle est partie au moteur.
 *
 * Un tour lancé par un BOUTON — une carte qu'on démarre, une reprise, un
 * dépannage de publication — n'écrit aucune bulle de demande dans le fil :
 * personne n'a rien tapé. Le texte réellement envoyé existe pourtant, dans le
 * bloc « Demande utilisateur » de l'instantané. On le rend ici pour pouvoir
 * l'afficher AU-DESSUS du déroulé, là où une bulle se serait trouvée.
 */
export function demandeDuPromptEnvoye(contexte: SentContextEtat): string | undefined {
  const bloc = contexte.blocks.find((b) => b.kind === 'request');
  const texte = bloc?.text?.trim();
  return texte ? texte : undefined;
}

/** Une bulle courte du fil de recherche affiché côté agent. */
export interface BulleDuFilAgent {
  /** Clé stable : les nouvelles réponses s'ajoutent sans remplacer les précédentes. */
  cle: string;
  nature: 'requete' | 'recherche' | 'resume' | 'directives';
  titre: string;
  texte: string;
  reussie: boolean;
}

function couperTexteLisible(texte: string, maximum: number): string {
  const propre = texte.replace(/\s+/g, ' ').trim();
  if (propre.length <= maximum) return propre;
  const coupe = propre.slice(0, maximum - 1);
  const dernierEspace = coupe.lastIndexOf(' ');
  return `${coupe.slice(0, dernierEspace > maximum * 0.65 ? dernierEspace : coupe.length).trim()}…`;
}

/**
 * Retire l'habillage technique d'un résultat sans inventer ce qu'il dit.
 * On garde les premières phrases utiles ; les chemins, titres Markdown et
 * blocs de code restent dans le lecteur détaillé, pas dans la conversation.
 */
function lignesLisiblesDuResultat(texte: string): string[] {
  return texte
    .split('\n')
    .map((ligne) =>
      ligne
        .replace(/^\s{0,3}#{1,6}\s*/, '')
        .replace(/^\s*[-*]\s+/, '')
        .replace(/\*\*/g, '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^SUJET\s+«[^»]+»\s*:\s*/i, '')
        .replace(/^[a-z0-9]+(?:-[a-z0-9]+){2,}\s*:\s*/i, '')
        .replace(/(?:\/[\w.@-]+){2,}/g, 'un document du projet')
        .replace(/\b(?:web|server|shared|scripts|docs)\/(?:[\w.@-]+\/?)+/g, 'un document du projet')
        .trim(),
    )
    .filter((ligne) => ligne.length >= 16)
    .filter((ligne) => !/^SUJET\s+«/i.test(ligne))
    .filter((ligne) => !/^(faits|règles|contrôles|pool de compétences)\b.*:$/i.test(ligne))
    .filter((ligne) => !/^(```|const\b|let\b|var\b|import\b|export\b|function\b|class\b)/i.test(ligne))
    .filter((ligne) => !/^tenu automatiquement/i.test(ligne));
}

const TITRE_DE_DIRECTIVES = /^(?:règles?|contrôles?|directives?|instructions?|procédure|garde-fous?|pièges?)\b/i;
const TITRE_DE_SECTION = /^(?:faits?|règles?|contrôles?|directives?|instructions?|procédure|garde-fous?|pièges?|mémoire|compétences?)\b/i;
const MOT_DE_DIRECTIVE = /\b(?:doit|doivent|jamais|toujours|interdit|obligatoire|vérifi|contrôle|garder|conserver|retirer|afficher|appeler|demander|règle)\w*/i;

function lignesDeContexteDuResultat(texte: string): string[] {
  const lignes: string[] = [];
  for (const brute of texte.split('\n')) {
    const sansHabillage = brute.trim().replace(/^\s{0,3}#{1,6}\s*/, '').replace(/\*\*/g, '').trim();
    if (TITRE_DE_DIRECTIVES.test(sansHabillage) && /:\s*$/.test(sansHabillage)) break;
    lignes.push(...lignesLisiblesDuResultat(brute));
  }
  return lignes;
}

function extraitLisibleDuResultat(texte: string): string {
  return lignesDeContexteDuResultat(texte).slice(0, 2).join(' ');
}

/**
 * SECOND PASSAGE, CIBLÉ SUR LES DIRECTIVES.
 *
 * `project_memory` rend souvent d'abord les faits, puis les RÈGLES et les
 * CONTRÔLES du sujet. Le premier extrait lisible s'arrêtait aux faits : toute
 * la suite était bien conservée mais invisible. On reparcourt donc le résultat
 * exact, sans génération, en privilégiant ces sections nommées. Les anciennes
 * réponses sans titres gardent un repli par les mots directifs.
 */
function directivesLisiblesDuResultat(texte: string): string[] {
  const directives: string[] = [];
  let dansLesDirectives = false;

  for (const brute of texte.split('\n')) {
    const ligne = brute.trim().replace(/^\s{0,3}#{1,6}\s*/, '').replace(/\*\*/g, '').trim();
    if (!ligne || /^═+$/.test(ligne)) continue;

    if (TITRE_DE_SECTION.test(ligne) && /:\s*$/.test(ligne)) {
      dansLesDirectives = TITRE_DE_DIRECTIVES.test(ligne);
      if (dansLesDirectives) continue;
      continue;
    }
    if (!dansLesDirectives) continue;

    const [lisible] = lignesLisiblesDuResultat(brute);
    if (lisible) directives.push(lisible);
  }

  if (directives.length) return directives;
  return lignesLisiblesDuResultat(texte).filter((ligne) => MOT_DE_DIRECTIVE.test(ligne));
}

function texteDetailleDesDirectives(
  consultation: NonNullable<SentContextEtat['consultationsMemoire']>[number],
  resume: string,
): string | undefined {
  const dejaResume = resume.toLocaleLowerCase('fr');
  const lignes = (consultation.source === 'competence'
    ? lignesLisiblesDuResultat(consultation.resultat)
    : directivesLisiblesDuResultat(consultation.resultat))
    .filter((ligne) => !dejaResume.includes(ligne.toLocaleLowerCase('fr')))
    .filter((ligne, index, toutes) => toutes.indexOf(ligne) === index)
    .slice(0, 4);
  if (!lignes.length) return undefined;

  const nom = consultation.source === 'competence'
    ? 'Compétences partagées'
    : consultation.requete.trim()
      ? `Mémoire · ${couperTexteLisible(consultation.requete, 48)}`
      : 'Mémoire du projet';
  const texte = `${nom} :\n${lignes.map((ligne) => `• ${ligne}`).join('\n')}`;
  return texte.length <= 480 ? texte : `${texte.slice(0, 479).trimEnd()}…`;
}

/**
 * LE FIL VISIBLE CÔTÉ AGENT : une étape distincte par information reçue.
 *
 * La demande ouvre le fil, puis CHAQUE consultation ajoute ses propres blocs,
 * dans l'ordre où elle a rejoint l'instantané : recherche, résumé du contexte
 * utile, puis directives éventuelles. Les clés portent l'identifiant de la
 * consultation afin qu'une nouvelle réponse ne puisse ni remplir un ancien
 * bloc, ni l'écraser à l'écran.
 */
export function filVisuelDeLAgent(contexte: SentContextEtat): BulleDuFilAgent[] {
  const consultations = contexte.consultationsMemoire ?? [];
  if (!consultations.length) return [];

  const demande = demandeDuPromptEnvoye(contexte) ?? contexte.prompt?.trim() ?? '';
  const bulles: BulleDuFilAgent[] = [
    {
      cle: 'requete',
      nature: 'requete',
      titre: 'Requête reçue',
      texte: couperTexteLisible(demande, 220),
      reussie: true,
    },
  ];

  consultations.forEach((consultation) => {
    const recherche = consultation.source === 'competence'
      ? 'Le catalogue des compétences partagées a été consulté.'
      : consultation.requete.trim()
        ? `La mémoire du projet a été consultée sur « ${couperTexteLisible(consultation.requete, 80)} ».`
        : 'La carte de la mémoire du projet a été consultée.';
    bulles.push({
      cle: `${consultation.id}-recherche`,
      nature: 'recherche',
      titre: 'Recherche effectuée',
      texte: recherche,
      reussie: consultation.reussie,
    });

    const extrait = extraitLisibleDuResultat(consultation.resultat);
    const sujet = consultation.source === 'competence'
      ? 'les compétences disponibles'
      : consultation.requete.trim()
        ? `« ${couperTexteLisible(consultation.requete, 60)} »`
        : 'la mémoire du projet';
    const resume = !consultation.reussie
      ? extrait
        ? `La recherche sur ${sujet} n’a pas abouti : ${extrait}`
        : `La recherche sur ${sujet} n’a pas abouti.`
      : extrait
        ? `Pour ${sujet}, l’agent a retenu : ${extrait}`
        : `La recherche sur ${sujet} a bien répondu, mais son ancien texte n’est plus conservé.`;

    // Une compétence est déjà une directive : la résumer juste avant la
    // recopierait. Les résultats de mémoire, eux, gardent leur résumé propre.
    if (consultation.source !== 'competence') {
      bulles.push({
        cle: `${consultation.id}-resume`,
        nature: 'resume',
        titre: 'Résumé compris',
        texte: couperTexteLisible(resume, 360),
        reussie: consultation.reussie,
      });
    }

    const directives = texteDetailleDesDirectives(
      consultation,
      consultation.source === 'competence' ? '' : resume,
    );
    if (directives) {
      bulles.push({
        cle: `${consultation.id}-directives`,
        nature: 'directives',
        titre: 'Directives retrouvées',
        texte: directives,
        reussie: consultation.reussie,
      });
    }
  });

  return bulles;
}

/* ------------------------------------------------------------------ */
/* LE TEXTE ENTIER, ET CE QUE LE MOTEUR EN A RELU AU CACHE             */
/* ------------------------------------------------------------------ */

/**
 * Ce que le moteur a fait d'une partie du prompt :
 *  - `relu`  : relue au cache, le début de l'envoi étant identique au tour d'avant ;
 *  - `ecrit` : posée dans le cache à ce tour, pour être relue aux tours suivants ;
 *  - `neuf`  : envoyée neuve, ou sans que rien ne permette d'affirmer une relecture.
 */
export type EtatDeCache = 'relu' | 'ecrit' | 'neuf';

/** Une partie du texte envoyé, dans l'ordre où le moteur la reçoit. */
export interface PartieDuPromptEnvoye {
  cle: 'consigne' | 'message';
  /** Le titre, en français : l'écran le passe par `t()`. */
  titre: string;
  /** Le texte exact ; vide quand il a été purgé (`conserve` est alors faux). */
  texte: string;
  etat: EtatDeCache;
  /** Faux quand le texte a été retiré pour borner le disque : on le DIT. */
  conserve: boolean;
  /** Une précision en français, quand l'état seul ne dit pas tout. */
  note?: string;
}

/**
 * LE PROMPT ENVOYÉ, EN DEUX PARTIES : les consignes générales, puis le message.
 *
 * Le moteur ne rend qu'un COMPTE de jetons relus au cache (`usage.cachedInputTokens`),
 * jamais l'identité du texte relu. On n'affirme donc une relecture que pour ce
 * qui est connaissable : le PRÉFIXE de la session. Sous Claude, la consigne
 * entière EST ce préfixe (`consigneEnTeteDeSession`) : elle est « relue » dès le
 * deuxième tour, à condition que la mesure ne dise pas zéro. Sans mesure, on
 * retombe sur le repère `cached` du bloc, posé à l'envoi. L'historique du fil,
 * lui, vit chez le moteur : il est relu, mais il n'est pas recopiable ici.
 *
 * Règle PURE : aucune base, aucun disque, aucun chiffre rendu.
 */
export function partiesDuPromptEnvoye(contexte: SentContextEtat): PartieDuPromptEnvoye[] {
  const blocSysteme = contexte.blocks.find((bloc) => bloc.kind === 'system');
  const consigne = contexte.systemInstruction?.content || blocSysteme?.text || '';
  const enTete = consigneEnTeteDeSession(contexte.engine);

  let etat: EtatDeCache = 'neuf';
  let noteConsigne: string | undefined;
  if (!enTete) {
    noteConsigne =
      'Ce moteur place les consignes après l’historique du fil : leur relecture au cache ne peut pas être affirmée.';
  } else if (contexte.session === 'new') {
    etat = 'ecrit';
  } else {
    const relus = contexte.usage?.cachedInputTokens;
    etat = relus === undefined ? (blocSysteme?.cached ? 'relu' : 'neuf') : relus > 0 ? 'relu' : 'neuf';
  }

  const parties: PartieDuPromptEnvoye[] = [
    {
      cle: 'consigne',
      titre: contexte.systemInstruction?.kind === 'reminder' ? 'Rappel de méthode' : 'Consignes générales',
      texte: consigne,
      etat,
      conserve: consigne.trim().length > 0,
      ...(noteConsigne ? { note: noteConsigne } : {}),
    },
    {
      cle: 'message',
      titre: 'Message envoyé',
      texte: contexte.prompt ?? '',
      etat: 'neuf',
      conserve: (contexte.prompt ?? '').trim().length > 0,
      ...(contexte.history === 'retained_by_engine'
        ? { note: 'L’historique du fil, gardé par le moteur, n’est pas recopié ici.' }
        : {}),
    },
  ];
  return parties;
}

/* ------------------------------------------------------------------ */
/* OÙ POSER LE LIEN, SUR UNE CARTE                                      */
/* ------------------------------------------------------------------ */

/**
 * LE MESSAGE QU'UNE ENTRÉE « DEMANDE » DU JOURNAL DÉSIGNE.
 *
 * Sur une carte, la conversation est son parcours : la demande y est une entrée
 * du journal, pas une bulle de message. Elle garde pourtant l'identifiant du
 * message d'où elle vient (`donnees.messageId`, écrit par `journaliserLaDemande`),
 * et c'est ce message qui porte le texte envoyé (`sentContext`).
 */
export function messageDeLaDemande(donnees: string | undefined): string | undefined {
  if (!donnees) return undefined;
  try {
    const lu = JSON.parse(donnees) as { messageId?: unknown };
    return typeof lu.messageId === 'string' && lu.messageId ? lu.messageId : undefined;
  } catch {
    return undefined;
  }
}

/** Un tour du parcours : son message porteur, et l'agent qui l'a produit. */
export interface TourDuParcours {
  tourId: string;
  agentId: string;
}

/**
 * LES TOURS SANS BULLE DE DEMANDE, RANGÉS PAR POINT DU PARCOURS.
 *
 * Un tour lancé par un bouton (« Lancer », « Générer le plan ») n'écrit aucun
 * message d'utilisateur : le texte envoyé est porté par la RÉPONSE de l'agent,
 * dont l'identifiant est le `tourId` de ses entrées de journal. Chaque tour est
 * rangé UNE SEULE FOIS, au premier point où il paraît, dans l'ordre du parcours :
 * un tour qui laisse des traces dans « Travail » puis dans « Rapport » ne porte
 * qu'un lien. Le point « Demande » n'en reçoit jamais : ses bulles portent le leur.
 */
export function toursSansBulleParPoint(
  points: readonly {
    ancre: string;
    etape: string;
    entrees: readonly { tourId?: string; agentId?: string }[];
  }[],
): Map<string, TourDuParcours[]> {
  const vus = new Set<string>();
  const parPoint = new Map<string, TourDuParcours[]>();
  for (const point of points) {
    if (point.etape === 'demande') continue;
    for (const entree of point.entrees) {
      if (!entree.tourId || !entree.agentId || vus.has(entree.tourId)) continue;
      vus.add(entree.tourId);
      const liste = parPoint.get(point.ancre) ?? [];
      liste.push({ tourId: entree.tourId, agentId: entree.agentId });
      parPoint.set(point.ancre, liste);
    }
  }
  return parPoint;
}
