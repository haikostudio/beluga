import * as React from 'react';
import { Ear, EarOff, GripVertical, MessagesSquare, Volume2, VolumeX } from 'lucide-react';
import {
  CLE_VOIX_POSITION,
  DECALAGE_VOIX_DEFAUT,
  NOM_UTILISATEUR,
  correctionOuverture,
  decalageRetenu,
  decisionsOuvertes,
  estCibleDeSaisie,
  estUnGlissement,
  formesDeReveil,
  raccourciDeclenche,
  gesteDOuverture,
  memeDecalage,
  phraseDecisionAttendue,
  phraseVocaleDeNotification,
  pileApres,
  ramenerDansLEcran,
  reponseVocaleDeLAgent,
  sensDouverture,
  texteAEcouter,
  type ContexteDecision,
  type DecalageVoix,
  type VoixOptions,
} from '@haikodev/shared';
import { client } from '@/lib/client';
import { usePref } from '@/lib/prefs';
import { useSurvol } from '@/lib/pointeur';
import { useTelephone } from '@/lib/telephone';
import { useApp } from '@/lib/use-app';
import { direVoix, lireNiveaux, taireVoix, useVoix } from '@/lib/voix';
import { lireNiveauxMicro, useEcoutePermanente } from '@/lib/ecoute';
import { lireNiveauxConversation, useConversationVocale } from '@/lib/conversation-vocale';
import { signalerEcouteVoulue } from '@/lib/micro';

/** La clé de préférence du bouton « Muet » (partagée avec la barre du haut). */
export const CLE_VOIX_MUETTE = 'voix.muet';

/**
 * La clé de l'ÉCOUTE PERMANENTE. Éteinte À CHAQUE OUVERTURE de l'application :
 * le micro ne s'ouvre jamais sans que l'interrupteur ait été allumé à la main,
 * DANS cette page. Elle était jadis retenue côté serveur, comme les autres
 * réglages de voix — allumée une fois sur un ordinateur, elle rouvrait le micro
 * toute seule au chargement suivant, sur le téléphone comme ailleurs, sans le
 * moindre geste : le repère orange du système s'allumait sans que rien ne le
 * demande. La clé ne sert donc plus qu'à EFFACER une valeur restée allumée.
 */
export const CLE_VOIX_ECOUTE = 'voix.ecoute';

/**
 * La clé du MODE CONVERSATION VOCALE. À CÔTÉ de l'écoute par mot de réveil
 * (`CLE_VOIX_ECOUTE`) : ici on parle SANS « Dis Haiko », l'agent répond à la
 * voix, et reparler coupe sa parole. Éteint à chaque ouverture, pour la même
 * raison.
 */
export const CLE_VOIX_CONVERSATION = 'voix.conversation';

/**
 * La clé qui dit que la place du module a DÉJÀ été remise à zéro une fois. La
 * place était jadis réécrite toute seule (recadrage au redimensionnement,
 * accroche à un bord), si bien qu'une correction faite ailleurs revenait sur
 * l'écran principal. On repart donc UNE fois d'une place neuve (bas au centre),
 * puis plus rien n'écrit la place sans un glissement volontaire. Le drapeau vit
 * en préférence serveur, donc partagé : la remise à zéro n'a lieu qu'une seule
 * fois, pas à chaque appareil ni à chaque rechargement.
 */
export const CLE_VOIX_REINIT = 'voix.reinit';

/** Combien de messages prononcés la liste dépliée MONTRE, le plus récent en tête. */
export const VOIX_MESSAGES_MAX = 10;

/**
 * Combien de tours du FIL DE CONVERSATION on garde en mémoire, le temps de
 * l'échange. Distinct de l'historique des annonces : ce fil ne vit qu'en
 * mémoire vive, il n'est ni retenu ni prononcé à nouveau — c'est un rappel
 * visuel de ce qu'on vient de se dire.
 */
export const FIL_CONVERSATION_MAX = 40;

/**
 * Combien de messages on GARDE en mémoire durable du navigateur. Au-delà, les
 * plus anciens sont oubliés. On en retient bien plus qu'on n'en affiche : la
 * liste n'en montre que dix, mais l'historique survit d'un rechargement à
 * l'autre et remonte plus loin si l'on veut réécouter.
 */
export const VOIX_HISTORIQUE_MAX = 100;

/** Où l'historique des messages prononcés se pose, dans le navigateur seul. */
export const CLE_VOIX_HISTORIQUE = 'haikodev.voix.historique';

/**
 * LA MÉTAMORPHOSE, en pixels. Le module est UN SEUL objet qui change de taille :
 * un rond au repos, un bloc un peu plus large quand il parle, un panneau quand
 * il est déplié. Les trois états se disent en nombres pour que le navigateur
 * puisse les INTERPOLER — une largeur en classe utilitaire sauterait d'un cran à
 * l'autre. `VOIX_MORPHISME_MS` est la durée commune : la boîte grandit, puis le
 * contenu se dévoile en fondu une fois la place faite.
 */
export const VOIX_MORPHISME_MS = 300;
/** Le rond au repos : un carré parfait, donc un cercle une fois arrondi. */
const VOIX_ROND = 44;
/**
 * L'espace, en pixels, entre le bord droit du rond et la POIGNÉE de déplacement.
 * Un petit vide pour que la poignée soit HORS du module : la survoler ne déplie
 * plus le panneau (elle n'est plus un descendant de la boîte qui écoute le survol).
 */
const VOIX_ECART_POIGNEE = 6;
/**
 * Combien de barres compose la ligne d'ondes ÉLARGIE : assez pour remplir tout
 * le pied du panneau (256 px) sans que les gros écarts ne le fassent paraître
 * vide, et réparties (`justify-between`) pour tenir aussi le bloc de parole sans
 * se chevaucher. C'est aussi le nombre de tranches de fréquences lues à
 * l'analyseur pendant la parole. Défini ICI, avant `VOIX_LARGEUR_PARLE`, qui en
 * DÉCOULE : le bloc de parole se dimensionne pour ce nombre de barres.
 */
const ONDES_LARGES = 16;
/**
 * La géométrie d'UNE barre d'ondes, en pixels : sa largeur (`w-1`), l'écart qui
 * la sépare de la suivante (`gap-0.5`) et la marge au bord du bloc (`px-3`). Ces
 * nombres SUIVENT les classes utilitaires de `LigneOndes` — c'est d'eux qu'on
 * déduit la largeur du bloc de parole, pour qu'aucune barre n'en dépasse.
 */
const ONDE_BARRE = 4;
const ONDE_ECART = 2;
const ONDE_MARGE = 12;
/**
 * Le bloc de parole, quand le module n'est pas déplié. Il est assez LARGE pour
 * contenir toutes ses ondes (les barres, leurs écarts et la même marge de chaque
 * côté qu'au repos) : élargir la ligne d'ondes sans élargir le bloc faisait
 * déborder les dernières barres, coupées par `overflow-hidden`. La largeur se
 * DÉDUIT donc du nombre de barres — en changer une la suit.
 */
const VOIX_LARGEUR_PARLE =
  ONDES_LARGES * ONDE_BARRE + (ONDES_LARGES - 1) * ONDE_ECART + 2 * ONDE_MARGE;
/** Le panneau déplié, borné à 80 % de l'écran pour les petits téléphones. */
const VOIX_LARGEUR_OUVERTE = 256;
/** Les hauteurs des trois zones du panneau, pour calculer celle du tout. */
const VOIX_HAUTEUR_ENTETE = 33;
const VOIX_HAUTEUR_PIED = 36;
const VOIX_HAUTEUR_LIGNE = 40;
/** Au-delà, la liste défile en elle-même plutôt que d'occuper tout l'écran. */
const VOIX_HAUTEUR_LISTE_MAX = 240;

/**
 * OÙ LA LIGNE D'ONDES SE POSE, en pixels depuis le BAS de la boîte. Cette boîte
 * est ancrée par le bas (position `fixed`, `bottom`), donc son bas ne bouge pas
 * quand elle grandit vers le haut : mesurer les ondes depuis ce bas les fait
 * glisser d'une place à l'autre sans dépendre de la hauteur du moment. Au repos,
 * les ondes sont CENTRÉES dans le rond ; dépliées, elles descendent au creux du
 * pied. Le même objet passe de l'une à l'autre — jamais dupliqué, jamais effacé.
 */
const VOIX_BAS_ONDES_REPOS = (VOIX_ROND - VOIX_HAUTEUR_PIED) / 2;
const VOIX_BAS_ONDES_OUVERT = 0;

/**
 * La hauteur du module déplié : l'en-tête, la liste (bornée), le pied d'ondes.
 * Elle suit le nombre de messages, pour qu'un historique vide n'ouvre pas un
 * grand rectangle presque nu.
 */
export function hauteurDepliee(nbMessages: number): number {
  const lignes = Math.min(nbMessages, VOIX_MESSAGES_MAX);
  const liste = lignes > 0 ? Math.min(lignes * VOIX_HAUTEUR_LIGNE, VOIX_HAUTEUR_LISTE_MAX) : VOIX_ROND;
  return VOIX_HAUTEUR_ENTETE + liste + VOIX_HAUTEUR_PIED;
}

/**
 * La hauteur du bandeau de DICTÉE : deux lignes de texte au-dessus du creux
 * d'ondes. C'est la forme que prend le module pendant qu'il écoute une phrase.
 */
const VOIX_HAUTEUR_DICTEE = 44 + VOIX_HAUTEUR_PIED;

/**
 * La géométrie de l'objet dans son état du moment. Le déplié l'emporte sur tout
 * le reste : on ne rétrécit pas un panneau qu'on est en train de lire parce que
 * l'assistant se met à parler. Vient ensuite la DICTÉE (le module s'élargit pour
 * montrer la phrase entendue), puis la parole. Les coins passent du cercle
 * (moitié du rond) au bloc arrondi, en continu.
 */
export function formeDuModule(
  ouvert: boolean,
  parle: boolean,
  nbMessages: number,
  dicte = false,
) {
  if (ouvert) {
    return { largeur: VOIX_LARGEUR_OUVERTE, hauteur: hauteurDepliee(nbMessages), rayon: 12 };
  }
  if (dicte) return { largeur: VOIX_LARGEUR_OUVERTE, hauteur: VOIX_HAUTEUR_DICTEE, rayon: 12 };
  if (parle) return { largeur: VOIX_LARGEUR_PARLE, hauteur: VOIX_ROND, rayon: 12 };
  return { largeur: VOIX_ROND, hauteur: VOIX_ROND, rayon: VOIX_ROND / 2 };
}

type DonneesVoix = Pick<
  ReturnType<typeof useApp>,
  'projects' | 'cards' | 'decisions'
>;

/** Un message déjà prononcé, gardé en mémoire côté navigateur pour le rejouer. */
interface MessageDit {
  id: number;
  texte: string;
}

/**
 * La clé passée à la voix partagée pour un message de l'historique. Un préfixe
 * propre à ce module évite de la confondre avec la clé d'un message de la
 * conversation (`BoutonEcoute`) : c'est ce qui permet à la barre de lecture de
 * ne suivre QUE le message annoncé qui se lit.
 */
function cleMessage(id: number): string {
  return `annonce-${id}`;
}

/**
 * L'historique déjà écrit dans le navigateur, relu au démarrage. Un stockage
 * absent, vide ou abîmé rend une liste vide plutôt qu'une erreur : la voix ne
 * dépend jamais de ce qui a été retenu.
 */
function lireHistorique(): MessageDit[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const brut = localStorage.getItem(CLE_VOIX_HISTORIQUE);
    if (!brut) return [];
    const lu = JSON.parse(brut);
    if (!Array.isArray(lu)) return [];
    return lu
      .filter((m): m is MessageDit => m && typeof m.id === 'number' && typeof m.texte === 'string')
      .slice(0, VOIX_HISTORIQUE_MAX);
  } catch {
    return [];
  }
}

/** On range l'historique côté navigateur, sans jamais faire échouer une annonce. */
function ecrireHistorique(liste: MessageDit[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CLE_VOIX_HISTORIQUE, JSON.stringify(liste));
  } catch {
    /* stockage plein ou refusé : la trace se perd, la voix continue */
  }
}

/**
 * De quoi parle la décision qui vient d'arriver sur `projectId` : le nom du
 * projet, et le titre de la tâche si la décision la plus récente y tient à une
 * carte. Sans projet repéré, on ne dit aucun nom (repli propre côté phrase).
 */
function contexteDecision(
  projectId: string | undefined,
  { projects, cards, decisions }: DonneesVoix,
): ContexteDecision | undefined {
  if (!projectId) return undefined;
  const projet = projects.find((p) => p.id === projectId)?.name;
  const duProjet = decisionsOuvertes(decisions).filter((d) => d.projectId === projectId);
  // La plus récemment posée : celle qui vient de faire monter le compte.
  const derniere = duProjet.reduce<(typeof duProjet)[number] | undefined>(
    (recente, d) => ((d.poseeA ?? 0) >= (recente?.poseeA ?? 0) ? d : recente),
    undefined,
  );
  const tache = derniere?.cardId ? cards[derniere.cardId]?.title : undefined;
  return { projet, tache };
}

/**
 * La ligne d'ondes. Deux visages, et son état ÉLARGI ne dépend QUE de la parole :
 *   — tant que la voix NE parle PAS (`!parle`), module fermé OU seulement ouvert
 *     au survol : cinq barres FIGÉES en vibration sonore symétrique, un petit
 *     paquet centré, AUCUNE animation. Un survol qui déplie le panneau alors
 *     qu'aucun son ne joue ne fait donc bouger aucune onde.
 *   — dès que ça parle (`parle`) : les barres s'ÉTALENT sur TOUTE la largeur du
 *     conteneur (`w-full`, `justify-between`), jamais un petit paquet au milieu
 *     du pied vide, et deviennent VERTES (le jeton de succès).
 * Pendant la parole, les barres vertes SUIVENT le VOLUME réellement entendu —
 * hautes quand la voix porte, presque plates dans les silences : chaque barre lit
 * une tranche de fréquences de l'analyseur du son (`lireNiveaux`), rafraîchie à
 * chaque image et LISSÉE pour un mouvement doux. Sans analyse possible (voix de
 * secours du navigateur, contexte audio en veille), on retombe sur l'animation
 * régulière (`animate-onde`) — jamais sur des barres figées, mais SEULEMENT
 * pendant la parole.
 * Un SEUL exemplaire vit dans le module — l'objet continu qui glisse du centre
 * du rond fermé au creux du pied déplié —, jamais deux qui se croiseraient.
 */
function LigneOndes({
  actif,
  lecteur,
  classeBarre,
  marque,
}: {
  /** L'onde s'anime-t-elle (parole, écoute par mot de réveil, ou conversation) ? */
  actif: boolean;
  /** D'où lire le volume : le son joué, le micro du réveil, ou celui de conversation. */
  lecteur: (nombre: number) => number[] | null;
  /** La couleur des barres : vert (parole), rouge (réveil), bleu (conversation). */
  classeBarre: string;
  /** Le repère lu par les vérifications, selon la source du son. */
  marque?: 'ecoute' | 'conversation';
}) {
  // Les barres, pilotées à la main (sans re-rendu) au fil du son.
  const barresRef = React.useRef<(HTMLSpanElement | null)[]>([]);
  // L'analyse est-elle en place ? Faux → l'animation régulière prend le relais.
  const [analyse, setAnalyse] = React.useState(false);
  const analyseRef = React.useRef(false);
  analyseRef.current = analyse;
  // La source du volume est relue au fil de l'eau, sans réabonner la boucle.
  const lecteurRef = React.useRef(lecteur);
  lecteurRef.current = lecteur;

  React.useEffect(() => {
    if (!actif) {
      if (analyseRef.current) setAnalyse(false);
      return;
    }
    let image = 0;
    // Un lissage par barre : la hauteur glisse vers sa cible au lieu de sauter.
    const lisse = new Array<number>(ONDES_LARGES).fill(0);
    const boucle = () => {
      const niveaux = lecteurRef.current(ONDES_LARGES);
      if (niveaux) {
        if (!analyseRef.current) setAnalyse(true);
        for (let i = 0; i < ONDES_LARGES; i += 1) {
          lisse[i] += (niveaux[i] - lisse[i]) * 0.35;
          const barre = barresRef.current[i];
          // Un plancher pour que la barre ne disparaisse jamais tout à fait.
          if (barre) barre.style.transform = `scaleY(${(0.15 + 0.85 * lisse[i]).toFixed(3)})`;
        }
      } else if (analyseRef.current) {
        setAnalyse(false);
      }
      image = requestAnimationFrame(boucle);
    };
    image = requestAnimationFrame(boucle);
    return () => cancelAnimationFrame(image);
  }, [actif]);

  if (actif) {
    // Parole, écoute ou conversation, analyse en place : hauteur pilotée par le
    // volume (boucle ci-dessus). Sinon (analyse indisponible, voix de secours) :
    // l'onde régulière — jamais des barres figées, mais SEULEMENT quand c'est
    // actif. La COULEUR dit la source : vert pour la parole, ROUGE pour le mot
    // de réveil, BLEU pour la conversation.
    const piloté = analyse;
    return (
      <span
        data-onde-vocale=""
        data-onde-large
        data-onde-ecoute={marque === 'ecoute' ? '' : undefined}
        data-onde-conversation={marque === 'conversation' ? '' : undefined}
        className="flex w-full items-center justify-between gap-0.5 px-3"
        aria-hidden
      >
        {Array.from({ length: ONDES_LARGES }, (_, i) => (
          <span
            key={i}
            ref={(el) => {
              barresRef.current[i] = el;
            }}
            className={`h-5 w-1 shrink-0 origin-center rounded-full ${classeBarre} ${
              piloté ? '' : 'animate-onde'
            }`}
            // Chaque barre décalée : l'onde ondule au lieu de battre d'un bloc.
            style={piloté ? { transform: 'scaleY(0.15)' } : { animationDelay: `${i * 60}ms` }}
          />
        ))}
      </span>
    );
  }
  return (
    <span data-icone-repos className="flex items-center gap-0.5" aria-hidden>
      {['h-1.5', 'h-3', 'h-4', 'h-3', 'h-1.5'].map((hauteur, i) => (
        <span key={i} className={`w-1 rounded-full bg-text ${hauteur}`} />
      ))}
    </span>
  );
}

/**
 * LA VOIX D'ASSISTANT PROACTIVE (PLAN §22, mémoire n°35, n°156).
 *
 * L'application parle d'elle-même aux moments qui comptent : une tâche qui se
 * termine (motif de notification « tache-terminee ») et une décision qui se met
 * à attendre (le compte d'« attention » qui monte). On réutilise la voix du
 * serveur par une adresse audio ordinaire (`/api/speak`) — le moteur qui la
 * fabrique se décide là-bas ; si le serveur n'a pas de voix, on retombe sur
 * celle du navigateur.
 *
 * Le module est TOUJOURS à l'écran, réduit en un petit rond au centre en bas. Au
 * repos, il montre cinq barres figées en vibration sonore symétrique. Au survol
 * (souris) ou à l'appui (doigt) — même choix que la pile des messages
 * (`(hover: hover) and (pointer: fine)`) —, il se MÉTAMORPHOSE : le rond lui-même
 * grandit en un panneau qui porte les dix derniers messages prononcés, le plus
 * récent en haut ; un clic les rejoue. Ce n'est pas un panneau qui apparaît à
 * côté d'un bouton : c'est le bouton devenu grand (`formeDuModule`, largeur,
 * hauteur et coins interpolés en `VOIX_MORPHISME_MS` millisecondes), le contenu
 * se dévoilant en fondu une fois la place faite. Pendant qu'il parle, le rond
 * s'OUVRE de la même façon en un bloc rectangulaire et l'icône devient un flux
 * d'ondes VERTES animées ; à la fin, il se referme et la vibration revient.
 *
 * Le bouton « Muet » vit DANS le panneau déplié, à côté de la voix qu'il
 * commande (plus dans le menu trois points du haut) : il coupe la parole
 * AUTOMATIQUE (jamais les notifications visuelles ni le badge, jamais l'icône,
 * jamais la réécoute manuelle) ; son état est retenu en préférence.
 */
/**
 * UN INTERRUPTEUR D'ÉCOUTE — éteint à chaque ouverture de l'application.
 *
 * Ce n'est PAS une préférence comme les autres. Un réglage retenu se retrouve au
 * chargement suivant ; ici, cela voudrait dire un micro qui s'ouvre sans que
 * personne ne l'ait demandé sur cet appareil-là, à cet instant-là — exactement le
 * repère orange qui s'allume tout seul sur le téléphone. L'état ne vit donc que
 * dans la page ouverte, et il repart de zéro à chaque fois.
 *
 * La valeur restée en base (d'avant cette règle, ou d'un autre appareil) est
 * ÉTEINTE une bonne fois : sans cela, elle mentirait sur ce que l'application
 * fait vraiment.
 */
function useInterrupteurDEcoute(cle: string): [boolean, (valeur: boolean) => void] {
  const [allume, setAllume] = React.useState(false);
  // La valeur retenue arrive du serveur APRÈS le premier rendu : on la surveille
  // au lieu de la lire une fois pour toutes, sinon on éteindrait un réglage
  // qu'on n'a pas encore reçu — et il resterait allumé en base pour toujours.
  const [retenu, oublier] = usePref<boolean>(cle, false);
  React.useEffect(() => {
    if (retenu) oublier(false);
  }, [retenu, oublier]);
  return [allume, setAllume];
}

export function VoixAssistant() {
  const state = useApp();
  const [muet, setMuet] = usePref<boolean>(CLE_VOIX_MUETTE, false);
  /*
   * ANCRÉ DANS LE MENU DU BAS, SUR TÉLÉPHONE. Là, le module ne flotte plus
   * librement : il vient se poser AU CENTRE du menu du bas (la colonne du milieu
   * lui est laissée, voir web/src/app.tsx), débordant un peu en haut et en bas
   * comme un bouton d'action. Il garde tout ce qu'il sait faire — parler, montrer
   * ses ondes, s'ouvrir, écouter — mais ne se DÉPLACE plus (pas de glissement,
   * pas de poignée) : ces gestes n'ont plus de sens à cette place. La place
   * mémorisée (`range`) n'est PAS effacée : elle ressert dès qu'on repasse sur
   * grand écran.
   */
  const ancreMenu = useTelephone();
  const ancreMenuRef = React.useRef(ancreMenu);
  ancreMenuRef.current = ancreMenu;
  // Le prénom réglé (défaut « Chris ») et l'heure du moment personnalisent chaque
  // phrase : ils sont relus au fil de l'eau, sans réabonner les écouteurs.
  const nom = state.settings?.voixNom || NOM_UTILISATEUR;
  const voixOptsRef = React.useRef<VoixOptions>({ nom });
  voixOptsRef.current = { nom };
  /** Les options fraîches, avec l'heure de l'annonce : ton plus bref le soir. */
  const optsMaintenant = React.useCallback(
    (): VoixOptions => ({ nom: voixOptsRef.current.nom, heure: new Date().getHours() }),
    [],
  );
  // La voix est PARTAGÉE avec l'écoute d'un message de la conversation : un seul
  // son à la fois, d'où qu'il vienne. L'onde s'anime dès que ça parle, peu
  // importe la source.
  // La voix est PARTAGÉE et publie aussi QUOI se lit (`cle`) et OÙ EN EST la
  // lecture (`avancement`) : la barre de lecture du module en découle, sans
  // audio propre ici.
  const { parle, cle: cleVoix, avancement } = useVoix();
  // L'historique complet, relu au démarrage depuis le navigateur : jusqu'à cent
  // messages, le plus récent en tête. La liste dépliée n'en montre que dix.
  const [messages, setMessages] = React.useState<MessageDit[]>(lireHistorique);
  // La valeur lue au fil de l'eau par les écouteurs, sans les réabonner.
  const muetRef = React.useRef(muet);
  // Un compteur stable pour distinguer deux messages au même texte. On repart
  // AU-DESSUS du plus grand identifiant déjà retenu, pour ne pas en refabriquer.
  const compteurRef = React.useRef(
    messages.reduce((max, m) => Math.max(max, m.id), 0),
  );

  /**
   * Une ANNONCE automatique : on la range en tête de l'historique (jusqu'à cent,
   * les plus vieux tombent), on l'écrit dans le navigateur pour qu'elle survive
   * au rechargement, puis — sauf en Muet — on la prononce. On la garde même en
   * Muet : la parole se tait, mais la trace reste pour une réécoute plus tard.
   * Prononcée, elle porte sa clé, pour que la barre de lecture suive le message.
   */
  const annoncer = React.useCallback((texte: string) => {
    if (!texte) return;
    compteurRef.current += 1;
    const entree = { id: compteurRef.current, texte };
    setMessages((liste) => {
      const suivante = [entree, ...liste].slice(0, VOIX_HISTORIQUE_MAX);
      ecrireHistorique(suivante);
      return suivante;
    });
    if (!muetRef.current) direVoix(texte, cleMessage(entree.id));
  }, []);

  // Le son coupé fait taire ce qui parle à l'instant même.
  React.useEffect(() => {
    muetRef.current = muet;
    if (muet) taireVoix();
  }, [muet]);

  // Fin de tâche : la notification déjà émise porte le titre réel de la carte, et
  // parfois un RÉSUMÉ (`event.voix`) tiré du vrai contenu de la réponse — on le
  // préfère au repli par titre. Sinon, on refabrique depuis le titre.
  React.useEffect(
    () =>
      client.onNotify((event) => {
        const texte = event.voix ?? phraseVocaleDeNotification(event.motif, event.title, optsMaintenant());
        if (texte) annoncer(texte);
      }),
    [annoncer, optsMaintenant],
  );

  /*
   * Décision attendue : on suit le compte d'attention, rangé PAR PROJET. On ne
   * parle qu'à la HAUSSE — une décision de plus — jamais sur le déjà-là du
   * chargement ni quand une décision est traitée. La décision passe par ce
   * compte et non par la notification, sinon on l'entendrait deux fois.
   *
   * De quel projet parle la décision qui arrive ? Celui dont le compte a monté.
   * Sur ce projet, la décision la plus récente donne, si elle tient à une carte,
   * le titre de la tâche — plus parlant que le seul nom du projet.
   */
  const attention = state.attention;
  // Projets, cartes et décisions relus au fil de l'eau, sans réabonner l'effet.
  const donneesRef = React.useRef({ projects: state.projects, cards: state.cards, decisions: state.decisions });
  donneesRef.current = { projects: state.projects, cards: state.cards, decisions: state.decisions };

  const precedent = React.useRef<{ total: number; parProjet: Record<string, number> } | null>(null);
  React.useEffect(() => {
    const parProjet = attention;
    const total = Object.values(parProjet).reduce((somme, n) => somme + n, 0);
    const avant = precedent.current;
    precedent.current = { total, parProjet };
    if (avant === null) return;
    if (total <= avant.total) return;

    const projectId = Object.keys(parProjet).find(
      (id) => (parProjet[id] ?? 0) > (avant.parProjet[id] ?? 0),
    );
    annoncer(
      phraseDecisionAttendue(total - avant.total, contexteDecision(projectId, donneesRef.current), optsMaintenant()),
    );
  }, [attention, annoncer, optsMaintenant]);

  // À la fermeture, on ne laisse pas un son continuer dans le vide.
  React.useEffect(() => taireVoix, []);

  /*
   * L'ÉCOUTE PERMANENTE. L'interrupteur vit dans le panneau déplié, à côté du
   * Muet ; éteint, RIEN n'est ouvert — pas de micro, pas de flux, pas d'envoi.
   * Il est ÉTEINT à chaque ouverture de l'application (`useInterrupteurDEcoute`) :
   * seul un geste fait dans CETTE page ouvre un micro.
   * Allumé, le micro guette « Dis Haiko » ; le mot passé, la phrase est
   * recueillie, relue deux secondes à l'écran, puis publiée. Tout le mécanisme
   * (micro, découpe par le silence, transcription) vit dans `useEcoutePermanente` ;
   * ici, on ne fait que l'afficher.
   */
  const [ecouteAllumee, setEcouteAllumee] = useInterrupteurDEcoute(CLE_VOIX_ECOUTE);
  // Le mot de réveil réglé (« Dis Haiko » par défaut), sous ses DEUX formes
  // comparées : ses lettres, et ce qu'il sonne — la transcription n'écrit
  // presque jamais « Haiko », mais elle en écrit toujours le son.
  const reveil = React.useMemo(
    () => formesDeReveil(state.settings?.voixReveil),
    [state.settings?.voixReveil],
  );
  const ecoute = useEcoutePermanente(ecouteAllumee, reveil);
  // Lu par le raccourci clavier, qui ne se réabonne pas à chaque bascule.
  const ecouteAllumeeRef = React.useRef(ecouteAllumee);
  ecouteAllumeeRef.current = ecouteAllumee;

  /*
   * LE RACCOURCI CLAVIER qui bascule l'écoute, réglé dans l'onglet Système
   * (`Settings.voixRaccourci`, vide par défaut). Un écouteur global l'attend où
   * que l'on soit — mais jamais pendant qu'on tape dans un champ, et jamais si
   * aucun raccourci n'est réglé. On relit la préférence d'écoute au moment de
   * l'appui par une référence : le setter n'a pas de forme « inverse la
   * valeur », et on évite de réabonner l'écouteur à chaque bascule.
   */
  const raccourci = state.settings?.voixRaccourci;
  React.useEffect(() => {
    if (!raccourci) return;
    const surTouche = (event: KeyboardEvent) => {
      if (!raccourciDeclenche(event, raccourci)) return;
      const actif = document.activeElement as HTMLElement | null;
      if (estCibleDeSaisie({ tagName: actif?.tagName, editable: actif?.isContentEditable })) return;
      event.preventDefault();
      setEcouteAllumee(!ecouteAllumeeRef.current);
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [raccourci, setEcouteAllumee]);
  // Une dictée est en cours : le module s'élargit pour montrer la phrase, et les
  // ondes passent au rouge. La relecture en fait partie — la phrase est encore là.
  const dicteEnCours = ecoute.etat === 'ecoute' || ecoute.etat === 'relit';

  /*
   * LE MODE CONVERSATION VOCALE, À CÔTÉ de l'écoute par mot de réveil. Allumé, on
   * parle SANS « Dis Haiko » : la phrase dite part au bon projet (routage
   * inchangé, commande `voix.demande`), et la réponse de l'agent est LUE à voix
   * haute. Reparler coupe cette parole (`onParole` → `taireVoix`). Les ondes sont
   * BLEUES (le micro du réveil, lui, reste rouge).
   */
  const [conversationAllumee, setConversationAllumee] = useInterrupteurDEcoute(CLE_VOIX_CONVERSATION);
  // Lu par les écouteurs (fermeture au survol-sort, appui-dehors) sans les
  // réabonner : tant qu'on converse, le panneau reste ouvert pour montrer le fil.
  const conversationAllumeeRef = React.useRef(conversationAllumee);
  conversationAllumeeRef.current = conversationAllumee;
  // La réponse qu'on attend d'un agent après avoir envoyé une phrase parlée :
  // relue au fil de l'eau par l'effet ci-dessous, sans le réabonner.
  const attenteReponseRef = React.useRef<{ agentId: string; depuis: number } | null>(null);

  /*
   * LE FIL DE LA CONVERSATION. Mes phrases parlées et les réponses de l'agent,
   * en alternance, montrées dans le module pendant l'échange (les plus récentes
   * en bas, le fil défile tout seul). Il ne vit qu'en mémoire vive : à la
   * différence de l'historique des annonces, on ne le retient pas et on ne le
   * prononce pas à nouveau — c'est un rappel visuel de ce qu'on vient de se dire.
   */
  interface TourDeFil {
    id: number;
    role: 'user' | 'assistant';
    texte: string;
  }
  const [fil, setFil] = React.useState<TourDeFil[]>([]);
  const filIdRef = React.useRef(0);
  const ajouterAuFil = React.useCallback((role: 'user' | 'assistant', texte: string) => {
    const propre = texte.trim();
    if (!propre) return;
    filIdRef.current += 1;
    const entree: TourDeFil = { id: filIdRef.current, role, texte: propre };
    setFil((f) => [...f, entree].slice(-FIL_CONVERSATION_MAX));
  }, []);

  const envoyerConversation = React.useCallback(async (texte: string) => {
    const phrase = texte.trim();
    if (!phrase) return;
    // Ma phrase entre dans le fil dès qu'elle part : on la voit sans attendre.
    ajouterAuFil('user', phrase);
    try {
      const depuis = Date.now();
      const res = await client.call<{ agentId?: string; question?: string }>({
        type: 'voix.demande',
        texte: phrase,
      });
      // Une QUESTION posée est déjà dite par la voix (montée d'attention) : on
      // n'attend une réponse à lire que si la phrase a été DÉPOSÉE chez un agent.
      // La question, elle, s'écrit tout de suite dans le fil.
      if (res?.question) ajouterAuFil('assistant', res.question);
      if (res?.agentId && !res.question) {
        attenteReponseRef.current = { agentId: res.agentId, depuis };
      }
    } catch {
      client.pushToast('error', "La demande vocale n’a pas pu partir.");
    }
  }, [ajouterAuFil]);

  /*
   * QUITTER L'ÉCRAN REFERME LE MICRO — sauf si une écoute a été VOULUE. La porte
   * unique (`lib/micro.ts`) referme tout quand la page part ou passe en
   * arrière-plan ; une écoute demandée à la main, elle, survit à un simple coup
   * d'œil sur une autre application, sinon elle se couperait sans jamais revenir.
   */
  React.useEffect(() => {
    signalerEcouteVoulue(ecouteAllumee || conversationAllumee);
  }, [ecouteAllumee, conversationAllumee]);

  const conversation = useConversationVocale(conversationAllumee, {
    onTexte: envoyerConversation,
    // Reparler coupe net la parole de l'assistant : on ne répond pas par-dessus.
    onParole: () => taireVoix(),
  });
  const conversationEcoute = conversation.etat === 'ecoute';

  // Lire la réponse de l'agent à voix haute, une fois le tour fini. On attend que
  // l'agent soit au repos ET qu'un message d'assistant soit arrivé APRÈS l'envoi,
  // puis on le prononce (nettoyé pour l'oreille). On passe outre le Muet : la
  // conversation vocale EST une demande explicite de parler.
  const agents = state.agents;
  const messagesParAgent = state.messages;
  React.useEffect(() => {
    const attente = attenteReponseRef.current;
    if (!attente) return;
    const agent = agents[attente.agentId];
    const auRepos = !agent || (agent.status !== 'running' && agent.status !== 'starting');
    if (!auRepos) return;
    const brut = reponseVocaleDeLAgent(messagesParAgent[attente.agentId] ?? [], attente.depuis);
    if (!brut) return;
    attenteReponseRef.current = null;
    // La réponse s'affiche dans le fil ET se dit à voix haute : voix + texte.
    const aLire = texteAEcouter(brut);
    ajouterAuFil('assistant', aLire || brut);
    if (aLire) direVoix(aLire, `conversation-${attente.agentId}`);
  }, [agents, messagesParAgent, ajouterAuFil]);

  /*
   * DÉMARRER (ou arrêter) la conversation d'un CLIC. Le geste vit sur le
   * graphique d'ondes du module ouvert : un clic lance l'écoute, un second
   * l'arrête. En l'allumant, on déplie le panneau pour montrer le fil ; on le
   * garde ensuite ouvert tant qu'on converse (voir les fermetures plus bas).
   */
  const basculerConversation = React.useCallback(() => {
    const prochain = !conversationAllumeeRef.current;
    setConversationAllumee(prochain);
    if (prochain) setOuvert(true);
  }, [setConversationAllumee]);

  // Le fil défile jusqu'au dernier tour : le plus récent reste visible.
  const filRef = React.useRef<HTMLUListElement | null>(null);
  React.useEffect(() => {
    const el = filRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [fil]);

  // Comment le module se déplie : au survol à la souris, à l'appui au doigt.
  const survolPossible = useSurvol();
  const geste = gesteDOuverture(survolPossible);
  const [ouvert, setOuvert] = React.useState(false);
  const racineRef = React.useRef<HTMLDivElement | null>(null);
  // Lu par le redimensionnement (effet non réabonné à chaque ouverture).
  const ouvertRef = React.useRef(ouvert);
  ouvertRef.current = ouvert;

  // La taille de la fenêtre, suivie pour recalculer le côté d'ouverture à chaque
  // redimensionnement. On la lit tout de suite : ce composant vit côté client.
  const [fenetre, setFenetre] = React.useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
  }));

  /*
   * OÙ SE POSE LE ROND QUAND IL EST ANCRÉ AU MENU. On mesure la barre du bas
   * (`nav[data-menu-bas]`, rendue AVANT ce module dans l'arbre) et l'on aligne le
   * CENTRE du rond sur le centre de la barre : le rond de 44 px déborde alors un
   * peu de la barre (~36 px de haut). La valeur est la distance, en pixels, du
   * BAS de la boîte au bas de l'écran ; la boîte étant ancrée par le bas, le rond
   * garde sa place quand le panneau grandit vers le haut. `null` hors téléphone
   * (le module retrouve alors sa place flottante d'origine).
   */
  const [ancrageBas, setAncrageBas] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    if (!ancreMenu) {
      setAncrageBas(null);
      return;
    }
    const bloc = document.querySelector('nav[data-menu-bas]')?.firstElementChild;
    if (!bloc) return;
    const r = bloc.getBoundingClientRect();
    const centre = r.top + r.height / 2;
    setAncrageBas(window.innerHeight - centre - VOIX_ROND / 2);
  }, [ancreMenu, fenetre.width, fenetre.height]);

  // La ligne du BAS du rond fermé, en pixels d'écran : c'est là que le bouton se
  // pose, et la référence pour poser le panneau autour de lui. Mesurée quand le
  // module est fermé (où la correction d'ouverture est nulle), rafraîchie au
  // redimensionnement même panneau ouvert.
  const baseBasRef = React.useRef<number | null>(null);
  // La correction d'ouverture appliquée au dernier rendu — sert à retrouver la
  // ligne de base depuis la boîte mesurée quand le panneau est ouvert.
  const corrRef = React.useRef<DecalageVoix>({ x: 0, y: 0 });
  // Le bouton est-il saisi (appui ou glissement) ? Alors le déplacement suit le
  // doigt sans transition ; sinon la métamorphose anime aussi le transform, pour
  // que le côté ancré reste fixe pendant que le panneau grandit.
  const [saisi, setSaisi] = React.useState(false);

  // Au doigt, un appui hors du module le referme (les navigateurs tactiles ne
  // fabriquent pas de « survol-sort » fiable).
  React.useEffect(() => {
    if (geste !== 'appui' || !ouvert) return;
    const dehors = (e: PointerEvent) => {
      // Tant qu'on converse, le panneau reste ouvert : le fil doit rester lisible.
      if (conversationAllumeeRef.current) return;
      if (!racineRef.current?.contains(e.target as Node)) {
        setOuvert((o) => pileApres(o, 'appui-dehors', geste));
      }
    };
    document.addEventListener('pointerdown', dehors);
    return () => document.removeEventListener('pointerdown', dehors);
  }, [geste, ouvert]);

  /*
   * OÙ LE MODULE SE POSE. Sa place est retenue dans le COMPTE, par le même
   * mécanisme que le bloc en bas à droite : une préférence serveur, donc la
   * même sur tous les appareils. Ce qu'on retient est un DÉCALAGE par rapport
   * à la place d'origine (bas au centre) ; jamais une position absolue.
   *
   * La place n'est écrite QUE par un glissement volontaire — jamais par le
   * recadrage de visibilité (qui corrige l'affichage du moment sans rien
   * ranger) ni par une accroche automatique à un bord (supprimée) : lâché
   * quelque part, le module y reste. Pendant qu'on tire, la position « vive »
   * (`vif`) mène la danse : l'écran suit le doigt sans écrire au serveur à
   * chaque pixel, et la place n'est rangée qu'au relâchement.
   */
  const [range, rangerDecalage] = usePref<DecalageVoix>(CLE_VOIX_POSITION, DECALAGE_VOIX_DEFAUT);
  const [vif, setVif] = React.useState<DecalageVoix | null>(null);
  // La place retenue, ramenée à un décalage libre `{x, y}`.
  const place = decalageRetenu(range);

  /*
   * REMISE À ZÉRO, UNE SEULE FOIS. La place était jadis réécrite toute seule ;
   * on repart donc d'une place neuve (bas au centre) une fois pour toutes, dès
   * que les préférences sont chargées (`state.settings` posé au même moment).
   * Le drapeau vit en préférence serveur, partagé : la remise à zéro n'a lieu
   * qu'une fois, jamais à chaque appareil ni à chaque rechargement, et ne
   * touche plus rien dès qu'un glissement volontaire a fixé une place.
   */
  const [dejaReinit, setDejaReinit] = usePref<boolean>(CLE_VOIX_REINIT, false);
  React.useEffect(() => {
    if (!state.settings || dejaReinit) return;
    rangerDecalage(DECALAGE_VOIX_DEFAUT);
    setDejaReinit(true);
  }, [state.settings, dejaReinit, rangerDecalage, setDejaReinit]);

  // Lu par les écouteurs de glissement sans les réabonner à chaque pixel. Il
  // porte le décalage EFFECTIF du dernier rendu.
  const decalageRef = React.useRef<DecalageVoix>({ x: place.x, y: place.y });

  // Le module est-il DÉPLOYÉ (panneau ouvert, ou dictée en cours) ? Sert à la
  // mesure de la ligne du bas, qui ne vaut que module non déployé.
  const deploye = ouvert || dicteEnCours;
  // Le décalage EFFECTIF. Ancré au menu (téléphone) : décalage NUL, on ne lit
  // pas la place mémorisée (mais on ne l'efface pas non plus) — le module se
  // centre sur le menu du bas. Sinon : la position vive pendant un glissement,
  // ou la place retenue.
  const decalage: DecalageVoix = ancreMenu ? { x: 0, y: 0 } : vif ?? { x: place.x, y: place.y };
  decalageRef.current = decalage;

  // D'où PART un glissement : la place effective courante.
  const baseGlissementRef = React.useRef(decalage);
  baseGlissementRef.current = decalage;

  // Le glissement en cours : d'où il part, et depuis quelle place.
  const glissementRef = React.useRef<
    { departX: number; departY: number; base: DecalageVoix; bouge: boolean } | null
  >(null);
  // Un glissement qui vient de finir ne doit pas déplier le module au relâchement.
  const vientDeGlisserRef = React.useRef(false);

  /**
   * Amorcer un glissement. Le MÊME geste sert au doigt (depuis le bouton, où il
   * partage l'appui qui déplie) et à la souris (depuis la poignée dédiée) : c'est
   * le mouvement qui tranche, au-delà du seuil `SEUIL_GLISSEMENT_VOIX`.
   */
  const commencerGlissement = React.useCallback((event: React.PointerEvent) => {
    if (event.button !== undefined && event.button !== 0) return;
    // Un déplacement ne produit AUCUN clic : sans cette remise à zéro, le repère
    // resterait armé et mangerait l'appui SUIVANT — le module ne se déplierait
    // plus jamais après avoir été déplacé.
    vientDeGlisserRef.current = false;
    glissementRef.current = {
      departX: event.clientX,
      departY: event.clientY,
      // On part de la place effective du moment : le module suit le pointeur.
      base: baseGlissementRef.current,
      bouge: false,
    };
    // Saisi : le transform suit le pointeur sans transition tant que le geste
    // n'est pas relâché.
    setSaisi(true);
  }, []);

  /**
   * La place d'origine du BOUTON — le rond fermé SANS décalage. C'est toujours ce
   * rond (44 px) que l'on borne, jamais le panneau ouvert : le bouton ne doit pas
   * bouger quand on déplie, et sa place retenue est celle du rond. Le centre est
   * au milieu de l'écran, le bas vient de la ligne mesurée (moins le décalage
   * déjà appliqué). Un repli mesure la boîte tant que la ligne n'est pas connue.
   */
  const ancre = React.useCallback(() => {
    if (typeof window === 'undefined') return null;
    let bas = baseBasRef.current;
    if (bas == null) {
      const boite = racineRef.current?.getBoundingClientRect();
      if (!boite) return null;
      bas = boite.bottom - corrRef.current.y;
    }
    const originBas = bas - decalageRef.current.y;
    return {
      left: window.innerWidth / 2 - VOIX_ROND / 2,
      top: originBas - VOIX_ROND,
      width: VOIX_ROND,
      height: VOIX_ROND,
    };
  }, []);

  /** Le module reste entièrement visible : on ramène le décalage dans les bords. */
  const recadrer = React.useCallback((valeur: DecalageVoix): DecalageVoix => {
    const boite = ancre();
    if (!boite) return valeur;
    return ramenerDansLEcran(valeur, boite, { width: window.innerWidth, height: window.innerHeight });
  }, [ancre]);

  // La ligne du bas du rond, mesurée tant que le module est FERMÉ (ou en train de
  // parler) : là, aucune correction d'ouverture ne la décale, donc le bas de la
  // boîte EST le bas du rond. Elle sert d'ancre au recadrage et de repère pour
  // choisir le côté d'ouverture.
  React.useLayoutEffect(() => {
    // Déployé (panneau ouvert OU dictée en cours), la correction d'ouverture
    // décale la boîte : la mesure ne vaudrait plus le bas du rond.
    if (deploye) return;
    const boite = racineRef.current?.getBoundingClientRect();
    if (boite) baseBasRef.current = boite.bottom;
  }, [deploye, decalage.x, decalage.y, parle, conversationEcoute, fenetre.width, fenetre.height]);

  // Au chargement et à chaque redimensionnement : on suit la taille de la fenêtre
  // (pour recalculer le côté d'ouverture), on rafraîchit la ligne de base même
  // panneau ouvert (un redimensionnement n'anime pas la boîte, la mesure est
  // nette), et une position venue d'un plus grand écran est ramenée dans les
  // bords POUR L'AFFICHAGE seulement (`setVif`) — JAMAIS rangée dans la
  // préférence : ce recadrage automatique écrivait la place sans geste de
  // l'utilisateur, si bien qu'une correction faite ailleurs (petit écran,
  // clavier virtuel) revenait sur l'écran principal. Seul un glissement range
  // désormais.
  React.useEffect(() => {
    const replacer = () => {
      setFenetre({ width: window.innerWidth, height: window.innerHeight });
      if (glissementRef.current) return;
      // Ancré au menu, la place est imposée : on ne recadre ni ne range rien —
      // surtout, on n'écrase pas la place mémorisée, qui ressert sur grand écran.
      if (ancreMenuRef.current) return;
      // La fenêtre vient peut-être de changer de taille : le bas du rond a
      // bougé AVEC elle. On le RE-MESURE tout de suite — le navigateur a déjà
      // refait la mise en page dans cet événement `resize` — avant de recadrer.
      // Fermé, la correction d'ouverture est nulle ; ouvert, on la retranche (le
      // DOM la porte encore, ce rendu n'ayant pas encore été refait).
      const boite = racineRef.current?.getBoundingClientRect();
      if (boite) baseBasRef.current = boite.bottom - corrRef.current.y;
      const actuel = decalageRef.current;
      const corrige = recadrer(actuel);
      if (memeDecalage(corrige, actuel)) return;
      // Affichage seul : on montre la place corrigée sans TOUCHER à la
      // préférence. Rien n'est rangé sans un glissement volontaire.
      setVif(corrige);
    };
    replacer();
    window.addEventListener('resize', replacer);
    return () => window.removeEventListener('resize', replacer);
  }, [recadrer]);

  React.useEffect(() => {
    const bouger = (event: PointerEvent) => {
      const g = glissementRef.current;
      if (!g) return;
      const dx = event.clientX - g.departX;
      const dy = event.clientY - g.departY;
      if (!g.bouge && !estUnGlissement(dx, dy)) return;
      g.bouge = true;
      event.preventDefault();
      setVif(recadrer({ x: g.base.x + dx, y: g.base.y + dy }));
    };
    const lacher = () => {
      const g = glissementRef.current;
      if (!g) return;
      glissementRef.current = null;
      setSaisi(false);
      if (!g.bouge) return;
      vientDeGlisserRef.current = true;
      // Lâché quelque part, le module Y RESTE : aucune accroche automatique à un
      // bord. On range simplement la place où on l'a posé (ramenée dans l'écran
      // pour rester attrapable). C'est le SEUL chemin qui écrit la préférence.
      const pose = recadrer(decalageRef.current);
      setVif(pose);
      rangerDecalage({ x: pose.x, y: pose.y });
    };
    window.addEventListener('pointermove', bouger, { passive: false });
    window.addEventListener('pointerup', lacher);
    window.addEventListener('pointercancel', lacher);
    return () => {
      window.removeEventListener('pointermove', bouger);
      window.removeEventListener('pointerup', lacher);
      window.removeEventListener('pointercancel', lacher);
    };
  }, [recadrer, rangerDecalage]);

  const nb = messages.length;
  // Le panneau ouvert montre le FIL DE CONVERSATION dès qu'on converse (ou qu'un
  // échange vient d'avoir lieu), sinon l'historique des annonces. Sa hauteur suit
  // ce qu'il montre : les tours du fil, ou les annonces.
  const enConversation = conversationAllumee || fil.length > 0;
  const nbPanneau = enConversation ? Math.max(fil.length, 2) : nb;
  // Le MÊME objet s'agrandit, qu'on le survole, qu'il parle, ou qu'il écoute la
  // conversation : dans ces deux derniers cas, il lui faut la place des ondes.
  const forme = formeDuModule(ouvert, parle || conversationEcoute, nbPanneau, dicteEnCours);
  // Le contenu se dévoile UNE FOIS la place faite : à l'ouverture il attend que
  // la boîte ait grandi, à la fermeture il s'efface d'abord, puis elle rétrécit.
  const attenteContenu = ouvert ? VOIX_MORPHISME_MS * 0.55 : 0;

  // LA SOURCE DES ONDES, par ordre de priorité : la conversation qu'on écoute
  // (BLEU, micro de conversation), puis la dictée du mot de réveil (ROUGE, micro
  // du réveil), puis la parole de l'assistant (VERT, son joué). Sinon, au repos.
  const ondeSource: {
    actif: boolean;
    lecteur: (nombre: number) => number[] | null;
    classeBarre: string;
    marque?: 'ecoute' | 'conversation';
  } = conversationEcoute
    ? { actif: true, lecteur: lireNiveauxConversation, classeBarre: 'bg-info', marque: 'conversation' }
    : dicteEnCours
      ? { actif: true, lecteur: lireNiveauxMicro, classeBarre: 'bg-danger', marque: 'ecoute' }
      : { actif: parle, lecteur: lireNiveaux, classeBarre: 'bg-success' };

  // DE QUEL CÔTÉ LE PANNEAU S'OUVRE. Le bouton (rond fermé) ne bouge pas : on
  // calcule sa boîte à l'écran (centre au milieu de la fenêtre + décalage, bas
  // sur la ligne mesurée), on choisit le côté où il reste de la place, et on en
  // tire une correction à AJOUTER au transform. Cette correction est nulle
  // module fermé, et s'anime avec la largeur/hauteur si bien que le côté ancré
  // (là où est le bouton) reste fixe pendant la métamorphose.
  const rondBas = baseBasRef.current ?? fenetre.height;
  const rondBoite = {
    left: fenetre.width / 2 + decalage.x - VOIX_ROND / 2,
    top: rondBas - VOIX_ROND,
    width: VOIX_ROND,
    height: VOIX_ROND,
  };
  const tailleForme = { width: forme.largeur, height: forme.hauteur };
  const sens = sensDouverture(rondBoite, tailleForme, {
    width: fenetre.width,
    height: fenetre.height,
  });
  const corr = correctionOuverture(sens, tailleForme, { width: VOIX_ROND, height: VOIX_ROND });
  corrRef.current = corr;

  return (
    <>
    <div
      ref={racineRef}
      data-module-voix
      data-parle={parle ? '' : undefined}
      data-ouvert={ouvert ? '' : undefined}
      // Ancré au centre du menu du bas (téléphone) : repère pour les vérifications.
      data-ancre-menu={ancreMenu ? '' : undefined}
      // Où en est l'écoute permanente : « eteinte », « guette », « ecoute »,
      // « relit » ou « refusee ». Un seul attribut, lu par les vérifications.
      data-etat-ecoute={ecoute.etat}
      // UN SEUL objet : le rond du repos EST le panneau déplié. Largeur, hauteur
      // et coins sont des nombres, donc le navigateur les interpole ; rien ne
      // surgit à côté, rien ne saute. La classe `-translate-x-1/2` a disparu :
      // un seul transform porte le centrage d'origine ET le décalage retenu.
      className="fixed bottom-20 left-1/2 z-30 max-w-[80vw] overflow-hidden border border-border bg-surface/90 shadow-lg backdrop-blur transition-all ease-out sm:bottom-6"
      style={{
        // Ancré au menu, la ligne du bas vient de la mesure de la barre (safe-area
        // déjà comprise) : on écrase alors `bottom` et la marge de sécurité.
        ...(ancreMenu && ancrageBas != null
          ? { bottom: `${ancrageBas}px`, marginBottom: 0 }
          : { marginBottom: 'env(safe-area-inset-bottom)' }),
        width: `${forme.largeur}px`,
        height: `${forme.hauteur}px`,
        borderRadius: `${forme.rayon}px`,
        // Un seul transform porte le centrage d'origine, le décalage retenu ET la
        // correction d'ouverture (pour placer le panneau autour du bouton).
        transform: `translate(calc(-50% + ${decalage.x + corr.x}px), ${decalage.y + corr.y}px)`,
        // La métamorphose s'anime, correction d'ouverture COMPRISE, pour que le
        // côté ancré reste fixe pendant que le panneau grandit. Mais pendant un
        // glissement, le transform NE s'anime pas — un transform retardé de
        // 300 ms collerait au doigt avec un temps de retard.
        transitionProperty: saisi
          ? 'width, height, border-radius'
          : 'width, height, border-radius, transform',
        transitionDuration: `${VOIX_MORPHISME_MS}ms`,
      }}
      onMouseEnter={() => setOuvert((o) => pileApres(o, 'survol-entre', geste))}
      // Tant qu'on converse, on ne referme pas au survol-sort : le fil reste là.
      onMouseLeave={() =>
        setOuvert((o) => (conversationAllumee ? o : pileApres(o, 'survol-sort', geste)))
      }
      onClick={() => {
        // Un déplacement qui vient de finir ne déplie pas le module.
        if (vientDeGlisserRef.current) {
          vientDeGlisserRef.current = false;
          return;
        }
        setOuvert((o) => pileApres(o, 'appui-dedans', geste));
      }}
    >
      {/* Premier visage : l'icône seule, au centre de l'objet réduit. */}
      <button
        type="button"
        data-icone-voix
        aria-expanded={ouvert}
        aria-label={
          parle
            ? 'L’assistant parle'
            : `Voix de l’assistant — ${nb} message${nb > 1 ? 's' : ''} à réécouter — tirer pour le déplacer`
        }
        title="Voix de l’assistant — tirer pour le déplacer"
        // AU DOIGT SEULEMENT, le bouton porte le glissement : le même appui sert
        // à déplier (immobile) et à déplacer (qui glisse). À la souris, ce bouton
        // s'efface au survol (l'ouverture le rend `pointer-events-none`) et ne
        // peut plus être attrapé — c'est la POIGNÉE dédiée qui prend le relais.
        onPointerDown={survolPossible || ancreMenu ? undefined : commencerGlissement}
        className={`absolute inset-0 grid place-items-center transition-opacity hover:bg-raised ${
          ouvert ? 'pointer-events-none opacity-0' : 'opacity-100'
        }`}
        style={{
          // Sans cela, un doigt qui tire ferait défiler la page au lieu de
          // déplacer le module.
          touchAction: 'none',
          transitionDuration: `${VOIX_MORPHISME_MS / 2}ms`,
          transitionDelay: ouvert ? '0ms' : `${VOIX_MORPHISME_MS * 0.55}ms`,
        }}
      >
        {/* La ligne d'ondes n'est PLUS ici : elle vit à part, en objet continu
            (voir plus bas), pour ne pas s'effacer quand ce bouton fond. Ce
            bouton ne reste que pour saisir l'appui, le survol et le glissement. */}
      </button>

      {/* Second visage : le même objet devenu grand, l'historique dedans. */}
      <div
        data-liste-voix
        aria-hidden={!ouvert}
        className={`absolute inset-0 flex flex-col transition-opacity ${
          ouvert ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        style={{
          transitionDuration: `${VOIX_MORPHISME_MS / 2}ms`,
          transitionDelay: `${attenteContenu}ms`,
        }}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2 text-[11.5px] font-medium text-muted">
          <span>{enConversation ? 'Conversation' : 'Derniers messages'}</span>
          {/* LE MODE CONVERSATION VOCALE, à côté de l'écoute et du Muet. Allumé,
              on parle SANS mot de réveil, l'agent répond à la voix, et reparler
              coupe sa parole. Bleu quand il écoute (les ondes le sont aussi),
              rouge si le micro est refusé. L'appui ne replie pas le module. */}
          <button
            type="button"
            data-interrupteur-conversation
            aria-pressed={conversationAllumee}
            onClick={(e) => {
              e.stopPropagation();
              setConversationAllumee(!conversationAllumee);
            }}
            className={`ml-auto flex items-center rounded-md p-1 transition-colors hover:bg-raised ${
              conversation.etat === 'refusee'
                ? 'text-danger'
                : conversationAllumee
                  ? 'text-info'
                  : 'text-muted'
            }`}
            title={
              conversation.etat === 'refusee'
                ? 'Micro refusé — cliquer pour réessayer la conversation'
                : conversationAllumee
                  ? 'Arrêter la conversation vocale'
                  : 'Parler à l’assistant : il écoute, répond à la voix, et reparler le coupe'
            }
            aria-label={
              conversationAllumee ? 'Arrêter la conversation vocale' : 'Démarrer la conversation vocale'
            }
          >
            <MessagesSquare className="h-4 w-4" />
          </button>
          {/* L'ÉCOUTE PERMANENTE, à côté du Muet : les deux réglages de la voix
              vivent au même endroit. Éteinte par défaut ; allumée, elle ouvre le
              micro et guette « Dis Haiko ». L'appui ne replie pas le module. */}
          <button
            type="button"
            data-interrupteur-ecoute
            aria-pressed={ecouteAllumee}
            onClick={(e) => {
              e.stopPropagation();
              setEcouteAllumee(!ecouteAllumee);
            }}
            className={`flex items-center rounded-md p-1 transition-colors hover:bg-raised ${
              ecoute.etat === 'refusee'
                ? 'text-danger'
                : ecouteAllumee
                  ? 'text-success'
                  : 'text-muted'
            }`}
            title={
              ecoute.etat === 'refusee'
                ? 'Micro refusé — cliquer pour réessayer l’écoute'
                : ecouteAllumee
                  ? 'Couper l’écoute permanente'
                  : `Écouter en permanence, et se réveiller sur « ${state.settings?.voixReveil || 'Dis Haiko'} »`
            }
            aria-label={
              ecouteAllumee ? 'Couper l’écoute permanente' : 'Allumer l’écoute permanente'
            }
          >
            {ecouteAllumee ? <Ear className="h-4 w-4" /> : <EarOff className="h-4 w-4" />}
          </button>
          {/* Le réglage « Muet » vit ICI, dans le panneau déplié, à côté de la
              voix qu'il commande — plus dans le menu trois points du haut. Il ne
              change RIEN au comportement : il bascule la même préférence
              `voix.muet`, coupe la seule parole automatique, et la réécoute d'un
              message passe toujours outre. L'appui ne replie pas le module. */}
          <button
            type="button"
            data-muet-voix
            aria-pressed={muet}
            onClick={(e) => {
              e.stopPropagation();
              setMuet(!muet);
            }}
            className={`flex items-center rounded-md p-1 transition-colors hover:bg-raised ${
              muet ? 'text-muted' : 'text-success'
            }`}
            title={muet ? 'Rétablir la voix automatique' : 'Couper la voix automatique'}
            aria-label={muet ? 'Rétablir la voix automatique' : 'Couper la voix automatique'}
          >
            {muet ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
        </div>
        {/* Le micro refusé se DIT ici, en toutes lettres, en plus du message court
            poussé au moment du refus : l'écoute ne tombe jamais en silence. */}
        {ecoute.erreur && (
          <p data-erreur-micro className="shrink-0 px-3 py-2 text-[11.5px] text-danger">
            {ecoute.erreur}
          </p>
        )}
        {conversation.erreur && (
          <p data-erreur-conversation className="shrink-0 px-3 py-2 text-[11.5px] text-danger">
            {conversation.erreur}
          </p>
        )}
        {enConversation ? (
          /* LE FIL DE LA CONVERSATION : mes phrases (à droite, bleutées) et les
             réponses de l'agent (à gauche), en alternance, le plus récent en bas.
             Le fil défile tout seul jusqu'au dernier tour. */
          <ul
            ref={filRef}
            data-fil-conversation
            className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-2"
          >
            {fil.length === 0 ? (
              <li className="text-[12px] text-faint">Je vous écoute…</li>
            ) : (
              fil.map((tour) => (
                <li
                  key={tour.id}
                  data-tour-fil
                  data-role={tour.role}
                  className={`flex ${tour.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <span
                    className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-[12.5px] ${
                      tour.role === 'user' ? 'bg-info/15 text-text' : 'bg-raised text-text'
                    }`}
                  >
                    {tour.texte}
                  </span>
                </li>
              ))
            )}
          </ul>
        ) : nb === 0 ? (
          <p className="flex-1 px-3 py-3 text-[12px] text-faint">Aucune annonce pour l’instant.</p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto py-1">
            {messages.slice(0, VOIX_MESSAGES_MAX).map((m) => {
              const lu = cleVoix === cleMessage(m.id);
              return (
              <li key={m.id}>
                <button
                  type="button"
                  data-message-voix
                  data-en-lecture={lu ? '' : undefined}
                  aria-current={lu ? 'true' : undefined}
                  // L'appui garde le module ouvert : on ne le rabat pas d'un clic.
                  onClick={(e) => {
                    e.stopPropagation();
                    // Réécoute manuelle : elle passe outre le Muet, et porte sa
                    // clé pour que la barre de lecture suive CE message.
                    direVoix(m.texte, cleMessage(m.id));
                  }}
                  className={`flex w-full items-start gap-2 px-3 py-2 text-left text-[12.5px] text-text hover:bg-raised ${
                    lu ? 'bg-raised' : ''
                  }`}
                  aria-label={`Réécouter : ${m.texte}`}
                >
                  <Volume2
                    className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${lu ? 'text-success' : 'text-muted'}`}
                  />
                  <span className="min-w-0 flex-1 line-clamp-2">{m.texte}</span>
                </button>
                {/* La barre de lecture, sous le seul message en cours : elle
                    avance avec le son (couleur des ondes vertes) quand la durée
                    est connue, ou pulse discrètement quand elle ne l'est pas. */}
                {lu && avancement !== null && (
                  <div
                    data-barre-lecture
                    className="mx-3 mb-1.5 h-0.5 overflow-hidden rounded-full bg-border"
                    aria-hidden
                  >
                    {avancement === 'indetermine' ? (
                      <div className="h-full w-full animate-pulse-soft bg-success/70" />
                    ) : (
                      <div
                        className="h-full bg-success"
                        style={{
                          width: `${Math.round(avancement * 100)}%`,
                          transition: 'width 150ms linear',
                        }}
                      />
                    )}
                  </div>
                )}
              </li>
              );
            })}
          </ul>
        )}
        {/* Un creux réservé sous l'historique : la ligne d'ondes CONTINUE (hors
            de cette liste, pour ne jamais clignoter) vient s'y poser. */}
        <div className="h-9 shrink-0 border-t border-border" aria-hidden />
      </div>

      {/* LA PHRASE ENTENDUE. Elle se pose juste au-dessus du creux d'ondes, quel
          que soit l'état du module : fermé, il s'élargit pour elle
          (`formeDuModule`) ; ouvert, elle couvre le bas de l'historique. Un CLIC
          la jette — c'est le geste demandé, jumeau du mot « Annule ». Pendant la
          relecture (deux secondes), un liseré rappelle qu'elle part bientôt. */}
      {dicteEnCours && (
        <button
          type="button"
          data-dictee
          data-relecture={ecoute.etat === 'relit' ? '' : undefined}
          onClick={(e) => {
            e.stopPropagation();
            ecoute.annuler();
          }}
          title="Cliquer pour jeter la phrase"
          aria-label={`Phrase entendue : ${ecoute.dictee || '…'} — cliquer pour la jeter`}
          className={`absolute inset-x-0 flex items-center gap-2 border-t border-border bg-surface px-3 py-2 text-left text-[12.5px] text-text ${
            ecoute.etat === 'relit' ? 'border-t-danger' : ''
          }`}
          style={{ bottom: `${VOIX_HAUTEUR_PIED}px` }}
        >
          <span className="h-2 w-2 shrink-0 animate-pulse-soft rounded-full bg-danger" aria-hidden />
          <span className="min-w-0 flex-1 line-clamp-2">
            {ecoute.dictee || <span className="text-faint">Je vous écoute…</span>}
          </span>
        </button>
      )}

      {/* LE MICRO EST-IL OUVERT ? Un point rouge discret sur le module tant que
          l'écoute guette le mot de réveil : un micro ouvert ne se cache pas.
          Il s'efface dès qu'une dictée commence (le bandeau le dit mieux). */}
      {ecoute.etat === 'guette' && (
        <span
          data-temoin-micro
          className="pointer-events-none absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-danger"
          aria-hidden
        />
      )}

      {/* LA LIGNE D'ONDES, OBJET CONTINU ET UNIQUE. Elle n'est ni dans l'icône
          (qui s'efface) ni dans l'historique (qui fond) : elle vit à part,
          TOUJOURS visible, et GLISSE du centre du rond fermé jusqu'au creux du
          pied déplié pendant les mêmes 300 ms que la boîte. Jamais dupliquée,
          jamais invisible — c'est elle qui remplace le fondu croisé d'avant.
          Sans clic (`pointer-events-none`), pour ne rien voler au bouton
          d'en dessous ni aux messages de l'historique. */}
      <div
        data-pied-ondes
        aria-hidden={ouvert ? undefined : true}
        // `inset-x-0` : le pied prend TOUTE la largeur du module du moment (44 px
        // fermé, 96 px en parlant, 256 px ouvert). La ligne d'ondes centrée au
        // repos s'y étale d'elle-même dès qu'elle passe en pleine largeur.
        // Module FERMÉ, les ondes ne captent rien (`pointer-events-none`) : au
        // doigt, l'appui sur le rond doit ouvrir le panneau, pas basculer l'écoute.
        // Module OUVERT, les ondes DEVIENNENT le bouton qui lance la conversation.
        className={`absolute inset-x-0 flex items-center justify-center ${
          ouvert ? '' : 'pointer-events-none'
        }`}
        style={{
          bottom: `${ouvert ? VOIX_BAS_ONDES_OUVERT : VOIX_BAS_ONDES_REPOS}px`,
          height: `${VOIX_HAUTEUR_PIED}px`,
          transitionProperty: 'bottom',
          transitionDuration: `${VOIX_MORPHISME_MS}ms`,
          transitionTimingFunction: 'ease-out',
        }}
      >
        {ouvert ? (
          // UN CLIC SUR LE GRAPHIQUE D'ONDES lance l'écoute, un second l'arrête.
          // On arrête la propagation pour ne pas replier le panneau du même clic.
          <button
            type="button"
            data-bascule-conversation
            aria-pressed={conversationAllumee}
            onClick={(e) => {
              e.stopPropagation();
              basculerConversation();
            }}
            title={
              conversationAllumee
                ? 'Arrêter la conversation vocale'
                : 'Cliquer pour parler à l’assistant : il écoute et répond'
            }
            aria-label={
              conversationAllumee ? 'Arrêter la conversation vocale' : 'Démarrer la conversation vocale'
            }
            className="flex h-full w-full items-center justify-center"
          >
            <LigneOndes
              actif={ondeSource.actif}
              lecteur={ondeSource.lecteur}
              classeBarre={ondeSource.classeBarre}
              marque={ondeSource.marque}
            />
          </button>
        ) : (
          <LigneOndes
            actif={ondeSource.actif}
            lecteur={ondeSource.lecteur}
            classeBarre={ondeSource.classeBarre}
            marque={ondeSource.marque}
          />
        )}
      </div>
    </div>

      {/* LA POIGNÉE DE DÉPLACEMENT, À LA SOURIS SEULEMENT. Sur ordinateur, le
          module fermé s'ouvre au SURVOL et le bouton d'icône s'efface aussitôt :
          on ne peut plus l'attraper pour tirer. Cette poignée vit HORS du module —
          un frère de la boîte, pas un descendant — posée juste à l'extérieur du
          coin bas-droit du rond, à `VOIX_ECART_POIGNEE` px du bord : la survoler
          ne déplie donc PLUS le panneau (elle ne déclenche pas le `onMouseEnter`
          de la boîte). Elle est ancrée au ROND fermé (jamais au panneau qui
          grandit) ; son transform suit le décalage retenu, donc elle suit le
          module quand on le déplace. Elle ne sert qu'à tirer le module FERMÉ, et
          disparaît DÈS QUE le panneau est ouvert (`!ouvert`) : ancrée au coin
          bas-droit du rond, elle chevaucherait sinon le panneau déplié. Elle
          revient une fois le module refermé. Le déplacement se fait donc toujours
          module fermé — hors survol, la poignée est là. Aucune poignée au doigt
          (`survolPossible` faux) : l'appui déplie et le bouton porte déjà le
          glissement. */}
      {survolPossible && !ouvert && !ancreMenu && (
        <button
          type="button"
          data-poignee-voix
          aria-label="Déplacer la voix de l’assistant"
          title="Tirer pour déplacer"
          onPointerDown={commencerGlissement}
          className="fixed bottom-20 left-1/2 z-30 grid h-6 w-6 cursor-grab place-items-center text-faint transition-transform ease-out hover:text-muted active:cursor-grabbing sm:bottom-6"
          style={{
            marginBottom: 'env(safe-area-inset-bottom)',
            // Placée à droite du rond fermé, alignée sur son bas : bord gauche de
            // la poignée = bord droit du rond + l'écart. Le décalage retenu la
            // fait suivre le module ; la correction d'ouverture n'entre PAS
            // (elle est ancrée au rond, qui ne bouge pas à l'ouverture).
            transform: `translate(${VOIX_ROND / 2 + decalage.x + VOIX_ECART_POIGNEE}px, ${decalage.y}px)`,
            // La poignée glisse instantanément avec le module quand on le tire
            // (saisi), et s'anime doucement sinon (recadrage au redimensionnement).
            transitionProperty: saisi ? 'none' : 'transform',
            transitionDuration: `${VOIX_MORPHISME_MS}ms`,
            // Un curseur qui tire ne doit pas faire défiler la page (sans effet à
            // la souris, mais sûr si un pointeur grossier atteint cette poignée).
            touchAction: 'none',
          }}
        >
          <GripVertical className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </>
  );
}
