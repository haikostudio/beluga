import * as React from 'react';
import { Ear, EarOff, GripVertical, Volume2, VolumeX } from 'lucide-react';
import {
  CLE_VOIX_POSITION,
  DECALAGE_VOIX_DEFAUT,
  NOM_UTILISATEUR,
  bordDaccroche,
  correctionOuverture,
  decalageAccroche,
  decisionsOuvertes,
  estUnGlissement,
  formeDeReveil,
  gesteDOuverture,
  memeDecalage,
  phraseDecisionAttendue,
  phraseVocaleDeNotification,
  pileApres,
  placeRetenue,
  ramenerDansLEcran,
  sensDouverture,
  type ContexteDecision,
  type DecalageVoix,
  type PlaceVoix,
  type VoixOptions,
} from '@haikodev/shared';
import { client } from '@/lib/client';
import { usePref } from '@/lib/prefs';
import { useSurvol } from '@/lib/pointeur';
import { useTelephone } from '@/lib/telephone';
import { useApp } from '@/lib/use-app';
import { direVoix, lireNiveaux, taireVoix, useVoix } from '@/lib/voix';
import { lireNiveauxMicro, useEcoutePermanente } from '@/lib/ecoute';

/** La clé de préférence du bouton « Muet » (partagée avec la barre du haut). */
export const CLE_VOIX_MUETTE = 'voix.muet';

/**
 * La clé de préférence de l'ÉCOUTE PERMANENTE. Éteinte par défaut : le micro ne
 * s'ouvre jamais sans que l'interrupteur ait été allumé à la main. Retenue comme
 * les autres réglages de voix, donc côté serveur : la même sur tous les
 * appareils.
 */
export const CLE_VOIX_ECOUTE = 'voix.ecoute';

/** Combien de messages prononcés la liste dépliée MONTRE, le plus récent en tête. */
export const VOIX_MESSAGES_MAX = 10;

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
 * La pastille RÉDUITE quand le module est accroché à un bord : plus petite que
 * le rond, à moitié engagée hors de l'écran pour ne plus masquer le contenu.
 */
const VOIX_PASTILLE = 30;
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
function LigneOndes({ parle, ecoute }: { parle: boolean; ecoute: boolean }) {
  // Les barres, pilotées à la main (sans re-rendu) au fil du son.
  const barresRef = React.useRef<(HTMLSpanElement | null)[]>([]);
  // L'analyse est-elle en place ? Faux → l'animation régulière prend le relais.
  const [analyse, setAnalyse] = React.useState(false);
  const analyseRef = React.useRef(false);
  analyseRef.current = analyse;
  // L'ÉCOUTE l'emporte sur la parole : quand le micro recueille une phrase, les
  // ondes disent d'abord qu'on est entendu. Elles suivent alors le volume du
  // MICRO (`lireNiveauxMicro`) et non celui du son joué.
  const vif = ecoute || parle;

  React.useEffect(() => {
    if (!vif) {
      if (analyseRef.current) setAnalyse(false);
      return;
    }
    let image = 0;
    // Un lissage par barre : la hauteur glisse vers sa cible au lieu de sauter.
    const lisse = new Array<number>(ONDES_LARGES).fill(0);
    const boucle = () => {
      const niveaux = ecoute ? lireNiveauxMicro(ONDES_LARGES) : lireNiveaux(ONDES_LARGES);
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
  }, [vif, ecoute]);

  if (vif) {
    // Parole ou écoute, analyse en place : hauteur pilotée par le volume (boucle
    // ci-dessus). Sinon (analyse indisponible, voix de secours) : l'onde
    // régulière — mais on n'arrive ici QUE quand ça parle ou que ça écoute,
    // jamais sur un simple survol muet. La COULEUR dit lequel des deux : vert
    // quand l'assistant parle, ROUGE quand le micro recueille une phrase.
    const piloté = analyse;
    return (
      <span
        data-onde-vocale=""
        data-onde-large
        data-onde-ecoute={ecoute ? '' : undefined}
        className="flex w-full items-center justify-between gap-0.5 px-3"
        aria-hidden
      >
        {Array.from({ length: ONDES_LARGES }, (_, i) => (
          <span
            key={i}
            ref={(el) => {
              barresRef.current[i] = el;
            }}
            className={`h-5 w-1 shrink-0 origin-center rounded-full ${
              ecoute ? 'bg-danger' : 'bg-success'
            } ${piloté ? '' : 'animate-onde'}`}
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
export function VoixAssistant() {
  const state = useApp();
  const [muet, setMuet] = usePref<boolean>(CLE_VOIX_MUETTE, false);
  /*
   * ANCRÉ DANS LE MENU DU BAS, SUR TÉLÉPHONE. Là, le module ne flotte plus
   * librement : il vient se poser AU CENTRE du menu du bas (la colonne du milieu
   * lui est laissée, voir web/src/app.tsx), débordant un peu en haut et en bas
   * comme un bouton d'action. Il garde tout ce qu'il sait faire — parler, montrer
   * ses ondes, s'ouvrir, écouter — mais ne se DÉPLACE plus (pas de glissement,
   * pas d'accroche, pas de poignée) : ces gestes n'ont plus de sens à cette
   * place. La place mémorisée (`range`) n'est PAS effacée : elle ressert dès
   * qu'on repasse sur grand écran.
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
   * Allumé, le micro guette « Dis Haiko » ; le mot passé, la phrase est
   * recueillie, relue deux secondes à l'écran, puis publiée. Tout le mécanisme
   * (micro, découpe par le silence, transcription) vit dans `useEcoutePermanente` ;
   * ici, on ne fait que l'afficher.
   */
  const [ecouteAllumee, setEcouteAllumee] = usePref<boolean>(CLE_VOIX_ECOUTE, false);
  // Le mot de réveil réglé (« Dis Haiko » par défaut), sous sa forme comparée.
  const formeReveil = formeDeReveil(state.settings?.voixReveil);
  const ecoute = useEcoutePermanente(ecouteAllumee, formeReveil);
  // Une dictée est en cours : le module s'élargit pour montrer la phrase, et les
  // ondes passent au rouge. La relecture en fait partie — la phrase est encore là.
  const dicteEnCours = ecoute.etat === 'ecoute' || ecoute.etat === 'relit';

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
   * à la place d'origine (bas au centre), plus — quand le module est ACCROCHÉ
   * à un bord — le bord où il l'est ; jamais une position absolue.
   *
   * Pendant qu'on tire, la position « vive » (`vif`) mène la danse : l'écran
   * suit le doigt sans écrire au serveur à chaque pixel. La place n'est rangée
   * qu'au relâchement, avec ou sans accroche selon où on a lâché.
   */
  const [range, rangerDecalage] = usePref<PlaceVoix>(CLE_VOIX_POSITION, DECALAGE_VOIX_DEFAUT);
  const [vif, setVif] = React.useState<DecalageVoix | null>(null);
  // La place retenue : décalage libre, ou décalage + bord d'accroche. Pendant un
  // glissement (`vif` posé), l'accroche est en suspens : on montre le rond libre.
  const place = placeRetenue(range);
  // Ancré au menu, jamais d'accroche à un bord : le module a une place imposée.
  const accrochee = !ancreMenu && place.bord !== undefined && vif === null;

  // Lu par les écouteurs de glissement sans les réabonner à chaque pixel. Il
  // porte le décalage EFFECTIF du dernier rendu.
  const decalageRef = React.useRef<DecalageVoix>({ x: place.x, y: place.y });
  // La ligne du bas du rond SANS décalage, déduite de la dernière mesure :
  // `baseBas = originBas + décalage rendu`, donc on retranche le décalage du
  // rendu PRÉCÉDENT (encore dans `decalageRef`). La boîte étant ancrée par le
  // bas quelle que soit sa taille, ce calcul vaut pour la pastille comme pour le
  // panneau. `null` tant qu'aucune mesure n'a eu lieu.
  const originBas =
    baseBasRef.current != null ? baseBasRef.current - decalageRef.current.y : null;

  // Le décalage EFFECTIF. Hors accroche (ou pendant un glissement), c'est le
  // décalage libre. Accroché, il est calculé depuis le bord : pastille à moitié
  // dehors quand le module est fermé, rond entier collé au bord quand il est
  // ouvert (le panneau se déploie ensuite vers l'intérieur).
  // Le module est-il DÉPLOYÉ (panneau ouvert, ou dictée en cours) ? Accroché à un
  // bord, il ne se montre alors plus en pastille demi-dehors : il revient au ras
  // du bord, sinon la phrase entendue s'afficherait à moitié hors de l'écran.
  const deploye = ouvert || dicteEnCours;
  // Ancré au menu : décalage NUL, on ne lit pas la place mémorisée (mais on ne
  // l'efface pas non plus). Le module se centre alors sur le menu du bas, dont
  // la hauteur donne la ligne du bas de la boîte (`ancrageBas`, plus bas).
  const decalage: DecalageVoix = ancreMenu
    ? { x: 0, y: 0 }
    : vif ??
      (accrochee && place.bord && originBas != null
        ? decalageAccroche(
            place.bord,
            place,
            originBas,
            { width: fenetre.width, height: fenetre.height },
            deploye ? VOIX_ROND : VOIX_PASTILLE,
            !deploye,
          )
        : { x: place.x, y: place.y });
  decalageRef.current = decalage;

  // D'où PART un glissement : la place libre courante, ou — si le module est
  // accroché — le rond entier collé au bord (il « rentre » d'abord, puis suit le
  // pointeur), pour ne pas sauter au premier mouvement.
  const baseGlissement: DecalageVoix =
    accrochee && place.bord && originBas != null
      ? decalageAccroche(
          place.bord,
          place,
          originBas,
          { width: fenetre.width, height: fenetre.height },
          VOIX_ROND,
          false,
        )
      : decalage;
  const baseGlissementRef = React.useRef(baseGlissement);
  baseGlissementRef.current = baseGlissement;
  // Lu par le relâchement (effet non réabonné) : l'origine et l'accroche rangée.
  const originBasRef = React.useRef<number | null>(originBas);
  originBasRef.current = originBas;
  const accrocheeStoreeRef = React.useRef(place.bord !== undefined);
  accrocheeStoreeRef.current = place.bord !== undefined;

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
      // Accroché, on part du rond entier collé au bord : la pastille « rentre »
      // et suit le pointeur, sans saut.
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
  }, [deploye, decalage.x, decalage.y, parle, fenetre.width, fenetre.height]);

  // Au chargement et à chaque redimensionnement : on suit la taille de la fenêtre
  // (pour recalculer le côté d'ouverture), on rafraîchit la ligne de base même
  // panneau ouvert (un redimensionnement n'anime pas la boîte, la mesure est
  // nette), et une position venue d'un plus grand écran est ramenée dans les
  // bords, le corrigé étant RANGÉ — sinon il reviendrait hors écran au prochain
  // démarrage.
  React.useEffect(() => {
    const replacer = () => {
      setFenetre({ width: window.innerWidth, height: window.innerHeight });
      if (glissementRef.current) return;
      // Ancré au menu, la place est imposée : on ne recadre ni ne range rien —
      // surtout, on n'écrase pas la place mémorisée, qui ressert sur grand écran.
      if (ancreMenuRef.current) return;
      // Accroché, la place se recalcule à chaque rendu depuis le bord et la
      // fenêtre : rien à recadrer ni à ranger. La règle de visibilité ne vaut
      // que pour les places LIBRES.
      if (accrocheeStoreeRef.current) return;
      if (ouvertRef.current) {
        const boite = racineRef.current?.getBoundingClientRect();
        if (boite) baseBasRef.current = boite.bottom - corrRef.current.y;
      }
      const actuel = decalageRef.current;
      const corrige = recadrer(actuel);
      if (memeDecalage(corrige, actuel)) return;
      setVif(null);
      rangerDecalage(corrige);
    };
    replacer();
    window.addEventListener('resize', replacer);
    return () => window.removeEventListener('resize', replacer);
    // `rangerDecalage` est stable (clé fixe) ; `range` déclenche la relecture.
  }, [recadrer, rangerDecalage, range]);

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
      const pose = recadrer(decalageRef.current);
      // Lâché tout près d'un bord ? Le module s'y ACCROCHE en pastille ; sinon il
      // reste à sa place libre. Tirer un module accroché vers le centre le
      // décroche donc naturellement (plus aucun bord proche au relâchement).
      const originActuel = originBasRef.current;
      const bord =
        originActuel != null
          ? bordDaccroche(
              {
                left: window.innerWidth / 2 + pose.x - VOIX_ROND / 2,
                top: originActuel + pose.y - VOIX_ROND,
                width: VOIX_ROND,
                height: VOIX_ROND,
              },
              { width: window.innerWidth, height: window.innerHeight },
            )
          : null;
      if (bord) {
        // La place accrochée se recalcule au rendu : on efface la position vive.
        setVif(null);
        rangerDecalage({ x: pose.x, y: pose.y, bord });
      } else {
        setVif(pose);
        rangerDecalage({ x: pose.x, y: pose.y });
      }
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
  // Le MÊME objet s'agrandit, qu'on le survole ou qu'il se mette à parler. Mais
  // ACCROCHÉ et fermé, il se réduit en pastille — même en parlant : l'accroche
  // ne coupe ni la voix ni les ondes, elle range seulement le module hors du
  // chemin. Le survol/appui le rouvre en panneau (via `ouvert`), comme partout.
  const forme =
    accrochee && !ouvert && !dicteEnCours
      ? { largeur: VOIX_PASTILLE, hauteur: VOIX_PASTILLE, rayon: VOIX_PASTILLE / 2 }
      : formeDuModule(ouvert, parle, nb, dicteEnCours);
  // Le contenu se dévoile UNE FOIS la place faite : à l'ouverture il attend que
  // la boîte ait grandi, à la fermeture il s'efface d'abord, puis elle rétrécit.
  const attenteContenu = ouvert ? VOIX_MORPHISME_MS * 0.55 : 0;

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
      data-accrochee={accrochee ? '' : undefined}
      data-bord={accrochee ? place.bord : undefined}
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
      onMouseLeave={() => setOuvert((o) => pileApres(o, 'survol-sort', geste))}
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
          <span>Derniers messages</span>
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
            className={`ml-auto flex items-center rounded-md p-1 transition-colors hover:bg-raised ${
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
        {nb === 0 ? (
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
        aria-hidden
        // `inset-x-0` : le pied prend TOUTE la largeur du module du moment (44 px
        // fermé, 96 px en parlant, 256 px ouvert). La ligne d'ondes centrée au
        // repos s'y étale d'elle-même dès qu'elle passe en pleine largeur.
        className="pointer-events-none absolute inset-x-0 flex items-center justify-center"
        style={{
          bottom: `${ouvert ? VOIX_BAS_ONDES_OUVERT : VOIX_BAS_ONDES_REPOS}px`,
          height: `${VOIX_HAUTEUR_PIED}px`,
          transitionProperty: 'bottom',
          transitionDuration: `${VOIX_MORPHISME_MS}ms`,
          transitionTimingFunction: 'ease-out',
        }}
      >
        <LigneOndes parle={parle} ecoute={dicteEnCours} />
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
