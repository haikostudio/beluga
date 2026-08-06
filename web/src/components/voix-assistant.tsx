import * as React from 'react';
import { GripVertical, Volume2, VolumeX } from 'lucide-react';
import {
  CLE_VOIX_POSITION,
  DECALAGE_VOIX_DEFAUT,
  NOM_UTILISATEUR,
  correctionOuverture,
  decalageRetenu,
  decisionsOuvertes,
  estUnGlissement,
  gesteDOuverture,
  memeDecalage,
  phraseDecisionAttendue,
  phraseVocaleDeNotification,
  pileApres,
  ramenerDansLEcran,
  sensDouverture,
  type ContexteDecision,
  type DecalageVoix,
  type VoixOptions,
} from '@haikodev/shared';
import { client } from '@/lib/client';
import { usePref } from '@/lib/prefs';
import { useSurvol } from '@/lib/pointeur';
import { useApp } from '@/lib/use-app';
import { direVoix, lireNiveaux, taireVoix, useVoix } from '@/lib/voix';

/** La clé de préférence du bouton « Muet » (partagée avec la barre du haut). */
export const CLE_VOIX_MUETTE = 'voix.muet';

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
/** Le bloc de parole, quand le module n'est pas déplié. */
const VOIX_LARGEUR_PARLE = 96;
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
 * La géométrie de l'objet dans son état du moment. Le déplié l'emporte sur la
 * parole : on ne rétrécit pas un panneau qu'on est en train de lire parce que
 * l'assistant se met à parler. Les coins passent du cercle (moitié du rond) au
 * bloc arrondi, en continu.
 */
export function formeDuModule(ouvert: boolean, parle: boolean, nbMessages: number) {
  if (ouvert) {
    return { largeur: VOIX_LARGEUR_OUVERTE, hauteur: hauteurDepliee(nbMessages), rayon: 12 };
  }
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

/** Combien de barres dessinent la ligne d'ondes pendant la parole. */
const VOIX_NB_BARRES = 8;

/**
 * La ligne d'ondes : pendant la parole (`parle`), un flux d'ondes VERTES qui
 * suivent le VOLUME réellement entendu — hautes quand la voix porte, presque
 * plates dans les silences. Chaque barre lit une tranche de fréquences de
 * l'analyseur du son (`lireNiveaux`), rafraîchie à chaque image et LISSÉE pour
 * un mouvement doux, sans saccade. Quand l'analyse n'est pas possible (voix de
 * secours du navigateur, contexte audio en veille), on retombe proprement sur
 * l'animation régulière d'avant (`animate-onde`) — jamais sur des barres figées.
 *
 * Au repos, cinq barres figées en vibration sonore symétrique. Un SEUL
 * exemplaire vit dans le module — l'objet continu qui glisse du centre du rond
 * fermé au creux du pied déplié —, jamais un dans le bouton et un autre au pied
 * qui se croiseraient en fondu.
 */
function LigneOndes({ parle }: { parle: boolean }) {
  // Les barres, pilotées à la main (sans re-rendu) au fil du son.
  const barresRef = React.useRef<(HTMLSpanElement | null)[]>([]);
  // L'analyse est-elle en place ? Faux → l'animation régulière prend le relais.
  const [analyse, setAnalyse] = React.useState(false);
  const analyseRef = React.useRef(false);
  analyseRef.current = analyse;

  React.useEffect(() => {
    if (!parle) {
      if (analyseRef.current) setAnalyse(false);
      return;
    }
    let image = 0;
    // Un lissage par barre : la hauteur glisse vers sa cible au lieu de sauter.
    const lisse = new Array<number>(VOIX_NB_BARRES).fill(0);
    const boucle = () => {
      const niveaux = lireNiveaux(VOIX_NB_BARRES);
      if (niveaux) {
        if (!analyseRef.current) setAnalyse(true);
        for (let i = 0; i < VOIX_NB_BARRES; i += 1) {
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
  }, [parle]);

  if (parle) {
    return (
      <span data-onde-vocale className="flex items-center gap-0.5" aria-hidden>
        {Array.from({ length: VOIX_NB_BARRES }, (_, i) => (
          <span
            key={i}
            ref={(el) => {
              barresRef.current[i] = el;
            }}
            className={`h-5 w-1 origin-center rounded-full bg-success ${analyse ? '' : 'animate-onde'}`}
            // Analyse active : hauteur pilotée par le volume, mise à jour par la
            // boucle ci-dessus. Sinon, l'onde régulière, chaque barre décalée
            // pour onduler au lieu de battre d'un bloc.
            style={analyse ? { transform: 'scaleY(0.15)' } : { animationDelay: `${i * 90}ms` }}
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
 * à attendre (le compte d'« attention » qui monte). On réutilise Piper par une
 * adresse audio ordinaire (`/api/speak`) ; si le serveur n'a pas de voix, on
 * retombe sur celle du navigateur.
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
   * à la place d'origine (bas au centre), jamais une position absolue.
   *
   * Pendant qu'on tire, la position « vive » (`vif`) mène la danse : l'écran
   * suit le doigt sans écrire au serveur à chaque pixel. Le décalage n'est
   * rangé qu'au relâchement.
   */
  const [range, rangerDecalage] = usePref<DecalageVoix>(CLE_VOIX_POSITION, DECALAGE_VOIX_DEFAUT);
  const [vif, setVif] = React.useState<DecalageVoix | null>(null);
  const decalage = vif ?? decalageRetenu(range);
  // Lu par les écouteurs de glissement sans les réabonner à chaque pixel.
  const decalageRef = React.useRef(decalage);
  decalageRef.current = decalage;

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
      base: decalageRef.current,
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
    if (ouvert) return;
    const boite = racineRef.current?.getBoundingClientRect();
    if (boite) baseBasRef.current = boite.bottom;
  }, [ouvert, decalage.x, decalage.y, parle, fenetre.width, fenetre.height]);

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
      setVif(pose);
      rangerDecalage(pose);
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
  // Le MÊME objet s'agrandit, qu'on le survole ou qu'il se mette à parler.
  const forme = formeDuModule(ouvert, parle, nb);
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
    <div
      ref={racineRef}
      data-module-voix
      data-parle={parle ? '' : undefined}
      data-ouvert={ouvert ? '' : undefined}
      // UN SEUL objet : le rond du repos EST le panneau déplié. Largeur, hauteur
      // et coins sont des nombres, donc le navigateur les interpole ; rien ne
      // surgit à côté, rien ne saute. La classe `-translate-x-1/2` a disparu :
      // un seul transform porte le centrage d'origine ET le décalage retenu.
      className="fixed bottom-20 left-1/2 z-30 max-w-[80vw] overflow-hidden border border-border bg-surface/90 shadow-lg backdrop-blur transition-all ease-out sm:bottom-6"
      style={{
        marginBottom: 'env(safe-area-inset-bottom)',
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
        onPointerDown={survolPossible ? undefined : commencerGlissement}
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
            className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition-colors hover:bg-raised ${
              muet ? 'text-warning' : 'text-success'
            }`}
            title={muet ? 'Rétablir la voix automatique' : 'Couper la voix automatique'}
            aria-label={muet ? 'Rétablir la voix automatique' : 'Couper la voix automatique'}
          >
            {muet ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            {muet ? 'Coupée' : 'Active'}
          </button>
        </div>
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
        className="pointer-events-none absolute left-1/2 grid place-items-center"
        style={{
          bottom: `${ouvert ? VOIX_BAS_ONDES_OUVERT : VOIX_BAS_ONDES_REPOS}px`,
          height: `${VOIX_HAUTEUR_PIED}px`,
          transform: 'translateX(-50%)',
          transitionProperty: 'bottom',
          transitionDuration: `${VOIX_MORPHISME_MS}ms`,
          transitionTimingFunction: 'ease-out',
        }}
      >
        <LigneOndes parle={parle} />
      </div>

      {/* LA POIGNÉE DE DÉPLACEMENT, À LA SOURIS SEULEMENT. Sur ordinateur, le
          module s'ouvre au SURVOL et le bouton d'icône s'efface aussitôt : on ne
          peut plus l'attraper pour tirer. Cette poignée discrète, posée en bas à
          droite, porte donc le glissement — elle reste attrapable panneau ouvert
          (jamais `pointer-events-none`), suit le module, et un survol qui la vise
          déplie le panneau sans rien déplacer tant que le seuil n'est pas franchi.
          Aucune poignée au doigt (`survolPossible` faux) : l'appui déplie et le
          bouton lui-même porte déjà le glissement. */}
      {survolPossible && (
        <button
          type="button"
          data-poignee-voix
          aria-label="Déplacer la voix de l’assistant"
          title="Tirer pour déplacer"
          onPointerDown={commencerGlissement}
          className="absolute bottom-0 right-0 z-10 grid h-6 w-6 cursor-grab place-items-center text-faint transition-colors hover:text-muted active:cursor-grabbing"
          // Un curseur qui tire ne doit pas faire défiler la page (sans effet à
          // la souris, mais sûr si un pointeur grossier atteint cette poignée).
          style={{ touchAction: 'none' }}
        >
          <GripVertical className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
