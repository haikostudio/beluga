import * as React from 'react';
import { Volume2 } from 'lucide-react';
import {
  CLE_VOIX_POSITION,
  DECALAGE_VOIX_DEFAUT,
  NOM_UTILISATEUR,
  decalageRetenu,
  decisionsOuvertes,
  estUnGlissement,
  gesteDOuverture,
  memeDecalage,
  phraseDecisionAttendue,
  phraseVocaleDeNotification,
  pileApres,
  ramenerDansLEcran,
  type ContexteDecision,
  type DecalageVoix,
  type VoixOptions,
} from '@haikodev/shared';
import { client } from '@/lib/client';
import { usePref } from '@/lib/prefs';
import { useSurvol } from '@/lib/pointeur';
import { useApp } from '@/lib/use-app';

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
 * La ligne d'ondes : pendant la parole (`parle`), un flux d'ondes VERTES
 * animées ; au repos, cinq barres figées en vibration sonore symétrique. Le
 * même dessin sert le bouton du bas ET le pied du panneau déplié, pour que
 * l'historique soit AU-DESSUS et cette ligne EN DESSOUS.
 */
function LigneOndes({ parle }: { parle: boolean }) {
  if (parle) {
    return (
      <span data-onde-vocale className="flex items-center gap-0.5" aria-hidden>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <span
            key={i}
            className="h-5 w-1 origin-center rounded-full bg-success animate-onde"
            // Chaque barre décalée : l'onde ondule au lieu de battre d'un bloc.
            style={{ animationDelay: `${i * 90}ms` }}
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
 * Le bouton « Muet » de la barre du haut coupe la parole AUTOMATIQUE (jamais les
 * notifications visuelles ni le badge, jamais l'icône, jamais la réécoute
 * manuelle) ; son état est retenu en préférence.
 */
export function VoixAssistant() {
  const state = useApp();
  const [muet] = usePref<boolean>(CLE_VOIX_MUETTE, false);
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
  const [parle, setParle] = React.useState(false);
  // L'historique complet, relu au démarrage depuis le navigateur : jusqu'à cent
  // messages, le plus récent en tête. La liste dépliée n'en montre que dix.
  const [messages, setMessages] = React.useState<MessageDit[]>(lireHistorique);
  // Quel message est prononcé À L'INSTANT (son identifiant), et où en est la
  // lecture : une fraction de 0 à 1 quand la durée est connue (voix Piper),
  // « indetermine » quand elle ne l'est pas (voix de secours du navigateur),
  // `null` quand rien ne se lit ou qu'on attend encore la durée.
  const [enLecture, setEnLecture] = React.useState<number | null>(null);
  const [avancement, setAvancement] = React.useState<number | 'indetermine' | null>(null);

  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  // Un jeton par lecture : chaque écouteur (durée, avancement, fin, repli) vérifie
  // qu'il sert TOUJOURS la lecture en cours avant de toucher à l'écran — sinon une
  // parole finie clôturerait par erreur celle qui l'a remplacée.
  const jetonRef = React.useRef(0);
  // La valeur lue au fil de l'eau par les écouteurs, sans les réabonner.
  const muetRef = React.useRef(muet);
  // Un compteur stable pour distinguer deux messages au même texte. On repart
  // AU-DESSUS du plus grand identifiant déjà retenu, pour ne pas en refabriquer.
  const compteurRef = React.useRef(
    messages.reduce((max, m) => Math.max(max, m.id), 0),
  );

  const taire = React.useCallback(() => {
    // Toute lecture en cours devient périmée : ses écouteurs ne toucheront plus
    // à l'écran.
    jetonRef.current += 1;
    try {
      audioRef.current?.pause();
    } catch {
      /* l'audio était déjà arrêté */
    }
    audioRef.current = null;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setParle(false);
    setEnLecture(null);
    setAvancement(null);
  }, []);

  /**
   * Prononce une phrase. `force` fait passer la parole même en Muet : c'est la
   * réécoute manuelle, que le Muet ne bâillonne pas. Une parole chasse l'autre.
   * `id` désigne le message lu, pour le marquer dans la liste et faire avancer sa
   * barre de lecture.
   */
  const dire = React.useCallback((texte: string, force = false, id?: number) => {
    if ((muetRef.current && !force) || !texte) return;
    taire();
    const jeton = jetonRef.current;
    const estCourant = () => jetonRef.current === jeton;
    const audio = new Audio(`/api/speak?text=${encodeURIComponent(texte)}`);
    audioRef.current = audio;
    setParle(true);
    setEnLecture(id ?? null);
    // On n'affiche la barre qu'une fois la durée connue : le message est déjà
    // marqué, mais on ne montre pas d'avancement tant qu'on n'en tient pas un vrai.
    setAvancement(null);

    // La durée est-elle un vrai nombre ? Un flux sans en-tête donne l'infini.
    const dureeConnue = () => Number.isFinite(audio.duration) && audio.duration > 0;
    const fin = () => {
      if (!estCourant()) return;
      audioRef.current = null;
      setParle(false);
      setEnLecture(null);
      setAvancement(null);
    };
    audio.addEventListener('loadedmetadata', () => {
      if (estCourant() && dureeConnue()) setAvancement(0);
    });
    audio.addEventListener('timeupdate', () => {
      if (estCourant() && dureeConnue()) setAvancement(Math.min(1, audio.currentTime / audio.duration));
    });
    audio.addEventListener('ended', fin);

    // Le repli sur la voix du navigateur, une seule fois : l'erreur de l'élément
    // audio ET le rejet de `play()` peuvent se produire tous deux.
    let repliLance = false;
    const echec = () => {
      if (!estCourant() || repliLance) return;
      audioRef.current = null;
      if ('speechSynthesis' in window && (!muetRef.current || force)) {
        repliLance = true;
        // La voix de secours ne dit pas où en est la lecture : on marque le
        // message « en lecture » sans barre trompeuse.
        setAvancement('indetermine');
        const parole = new SpeechSynthesisUtterance(texte);
        parole.lang = 'fr-FR';
        parole.onend = fin;
        parole.onerror = fin;
        window.speechSynthesis.speak(parole);
      } else {
        fin();
      }
    };
    audio.addEventListener('error', echec);
    void audio.play().catch(echec);
  }, [taire]);

  /**
   * Une ANNONCE automatique : on la range en tête de l'historique (jusqu'à cent,
   * les plus vieux tombent), on l'écrit dans le navigateur pour qu'elle survive
   * au rechargement, puis on la prononce. On la garde même en Muet — la parole
   * se tait, mais la trace reste pour une réécoute plus tard.
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
    dire(texte, false, entree.id);
  }, [dire]);

  // Le son coupé fait taire ce qui parle à l'instant même.
  React.useEffect(() => {
    muetRef.current = muet;
    if (muet) taire();
  }, [muet, taire]);

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
  React.useEffect(() => taire, [taire]);

  // Comment le module se déplie : au survol à la souris, à l'appui au doigt.
  const survolPossible = useSurvol();
  const geste = gesteDOuverture(survolPossible);
  const [ouvert, setOuvert] = React.useState(false);
  const racineRef = React.useRef<HTMLDivElement | null>(null);

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
   * La place d'origine du module — sa boîte SANS décalage. On mesure la boîte
   * telle qu'elle est à l'écran et on retire le décalage déjà appliqué.
   */
  const ancre = React.useCallback(() => {
    const boite = racineRef.current?.getBoundingClientRect();
    if (!boite) return null;
    const d = decalageRef.current;
    return { left: boite.left - d.x, top: boite.top - d.y, width: boite.width, height: boite.height };
  }, []);

  /** Le module reste entièrement visible : on ramène le décalage dans les bords. */
  const recadrer = React.useCallback((valeur: DecalageVoix): DecalageVoix => {
    const boite = ancre();
    if (!boite) return valeur;
    return ramenerDansLEcran(valeur, boite, { width: window.innerWidth, height: window.innerHeight });
  }, [ancre]);

  // Au chargement et à chaque redimensionnement : une position venue d'un plus
  // grand écran (ou d'un téléphone tourné) est ramenée dans les bords, et le
  // corrigé est RANGÉ — sinon il reviendrait hors écran au prochain démarrage.
  React.useEffect(() => {
    const replacer = () => {
      if (glissementRef.current) return;
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
        transform: `translate(calc(-50% + ${decalage.x}px), ${decalage.y}px)`,
        // La métamorphose s'anime ; le déplacement, NON — un transform retardé
        // de 300 ms collerait au doigt avec un temps de retard.
        transitionProperty: 'width, height, border-radius',
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
        // Le même geste sert à déplier (appui immobile) et à déplacer (appui qui
        // glisse) : c'est le mouvement qui tranche, au-delà du seuil.
        onPointerDown={(event) => {
          if (event.button !== undefined && event.button !== 0) return;
          // Un déplacement au doigt ne produit AUCUN clic : sans cette remise à
          // zéro, le repère resterait armé et mangerait l'appui SUIVANT — le
          // module ne se déplierait plus jamais après avoir été déplacé.
          vientDeGlisserRef.current = false;
          glissementRef.current = {
            departX: event.clientX,
            departY: event.clientY,
            base: decalageRef.current,
            bouge: false,
          };
        }}
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
        <LigneOndes parle={parle && !ouvert} />
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
        <div className="shrink-0 border-b border-border px-3 py-2 text-[11.5px] font-medium text-muted">
          Derniers messages
        </div>
        {nb === 0 ? (
          <p className="flex-1 px-3 py-3 text-[12px] text-faint">Aucune annonce pour l’instant.</p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto py-1">
            {messages.slice(0, VOIX_MESSAGES_MAX).map((m) => {
              const lu = enLecture === m.id;
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
                    dire(m.texte, true, m.id);
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
        {/* Sous l'historique, la ligne d'ondes qui s'anime quand ça parle. */}
        <div
          data-pied-ondes
          className="grid h-9 shrink-0 place-items-center border-t border-border"
        >
          <LigneOndes parle={parle} />
        </div>
      </div>
    </div>
  );
}
