import * as React from 'react';

/**
 * LA VOIX PARTAGÉE — un seul son à la fois, d'où qu'il vienne.
 *
 * L'assistant parle tout seul aux moments clés (module de voix), et l'on peut
 * demander à écouter n'importe quel message de la conversation. Ces deux paroles
 * ne doivent JAMAIS se chevaucher : elles passent donc par le MÊME lecteur, ici.
 * Une nouvelle lecture arrête la précédente, quelle qu'en soit l'origine —
 * « une parole chasse l'autre ».
 *
 * On réutilise la voix du serveur par une adresse audio ordinaire
 * (`/api/speak`) — le moteur employé se décide là-bas, d'après la voix
 * choisie ; si le serveur n'a pas de voix, on retombe sur celle du navigateur.
 * Aucun réglage de
 * son propre ici : le Muet se décide chez l'appelant (l'annonce automatique le
 * respecte, la lecture manuelle passe outre) — quand on arrive jusqu'ici, c'est
 * qu'on veut parler.
 */

/** L'état visible de la voix : parle-t-elle, et pour quel élément ? */
export interface EtatVoix {
  /** Vrai tant qu'un son est en cours. */
  parle: boolean;
  /**
   * Ce qui est lu à l'instant : l'identifiant passé à `direVoix`, ou `null` pour
   * une annonce automatique sans clé. Sert au bouton d'un message à savoir si
   * c'est LUI qui parle (donc à basculer entre écouter et arrêter).
   */
  cle: string | null;
  /**
   * Où en est la lecture : une fraction de 0 à 1 quand la durée est connue (voix
   * Piper), « indetermine » quand elle ne l'est pas (voix de secours du
   * navigateur, qui ne dit pas où elle en est), `null` quand rien ne se lit ou
   * qu'on attend encore la durée. Sert à la barre de lecture du module de voix.
   */
  avancement: number | 'indetermine' | null;
}

let audio: HTMLAudioElement | null = null;
let etat: EtatVoix = { parle: false, cle: null, avancement: null };
const ecouteurs = new Set<() => void>();

/*
 * LE GARDE-FOU DE LA VOIX DU NAVIGATEUR. Quand le son du serveur (`/api/speak`)
 * ne peut pas jouer — la politique d'autoplay des mobiles le refuse tant qu'un
 * geste ne l'a pas débloqué — on retombe sur la voix du navigateur
 * (`speechSynthesis`). Or celle-ci, surtout sur téléphone, oublie souvent de
 * signaler sa fin (`onend`/`onerror` muets), ou ne démarre jamais faute de
 * geste : `parle` restait alors vrai à jamais, et le module de voix affichait
 * ses ondes vertes en continu sans revenir au rond au repos. On surveille donc
 * l'état RÉEL de la synthèse, et l'on referme dès qu'elle s'est tue ou n'a
 * jamais démarré. La cadence et la patience sont ici.
 */
let gardeSynthese: ReturnType<typeof setInterval> | null = null;
const GARDE_SYNTHESE_MS = 250;
/** Sans le moindre démarrage au bout de ce nombre de tics (~4 s), on referme. */
const GARDE_SYNTHESE_TICS = 16;

/** Arrête la surveillance de la voix du navigateur, s'il y en a une en cours. */
function arreterGardeSynthese(): void {
  if (gardeSynthese) {
    clearInterval(gardeSynthese);
    gardeSynthese = null;
  }
}

function publier(suivant: EtatVoix): void {
  etat = suivant;
  for (const prevenir of ecouteurs) prevenir();
}

/*
 * L'ÉCOUTE DU SON JOUÉ, pour que la ligne d'ondes suive le VRAI volume.
 *
 * On branche une analyse (Web Audio) sur l'élément audio déjà en place : le son
 * passe par un graphe `source → analyseur → sortie` et l'analyseur donne, à tout
 * instant, le niveau des fréquences entendues. On n'ajoute AUCUN son, aucun
 * micro : on ne mesure que ce que l'application joue elle-même.
 *
 * Un piège : router un élément par le graphe le fait jouer PAR le graphe. Si le
 * contexte audio est en veille (aucune interaction récente), le son ne sortirait
 * plus. On ne branche donc l'analyse QUE si le contexte tourne déjà ; sinon on
 * laisse l'élément jouer seul et la ligne d'ondes retombe sur son animation
 * régulière. Mieux vaut aucune analyse qu'un son perdu.
 */
let contexteAudio: AudioContext | null = null;
let source: MediaElementAudioSourceNode | null = null;
let analyseur: AnalyserNode | null = null;
let donneesFreq: Uint8Array | null = null;

/** Le contexte audio, créé une seule fois. `null` si le navigateur ne sait pas. */
function obtenirContexte(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!contexteAudio) {
    try {
      contexteAudio = new Ctx();
    } catch {
      return null;
    }
  }
  return contexteAudio;
}

/*
 * RÉVEILLER LE CONTEXTE AU PREMIER GESTE. Un contexte audio naît « suspendu » et
 * ne passe en « running » que réveillé PENDANT (ou après) un geste de
 * l'utilisateur : les navigateurs le refusent sans geste. Or `brancherAnalyse`
 * ne route le son par l'analyseur que si le contexte tourne DÉJÀ — sinon il
 * couperait le son. Réveillé seulement au moment d'une annonce (hors geste), le
 * `resume()` est asynchrone et le contexte est encore suspendu à l'instant où on
 * le teste : l'analyse ne prenait donc jamais au premier son, et l'onde retombait
 * toujours sur son animation régulière. On réveille donc le contexte au tout
 * premier geste (un clic, une touche, un appui), une fois pour toutes : quand un
 * son se joue ensuite, l'analyse peut router et lire le vrai volume.
 */
if (typeof window !== 'undefined') {
  const GESTES = ['pointerdown', 'keydown', 'touchstart'] as const;
  const reveiller = () => {
    const ctx = obtenirContexte();
    if (!ctx) {
      for (const e of GESTES) window.removeEventListener(e, reveiller);
      return;
    }
    void ctx
      .resume?.()
      .then(() => {
        // Réveillé : plus besoin d'écouter les gestes suivants.
        if (ctx.state === 'running') {
          for (const e of GESTES) window.removeEventListener(e, reveiller);
        }
      })
      .catch(() => {
        /* le navigateur a refusé : on retentera au prochain geste */
      });
  };
  for (const e of GESTES) window.addEventListener(e, reveiller, { passive: true });
}

/** Défait le graphe d'analyse en cours, sans toucher au son de l'élément. */
function detacherAnalyse(): void {
  try {
    source?.disconnect();
  } catch {
    /* déjà détaché */
  }
  try {
    analyseur?.disconnect();
  } catch {
    /* déjà détaché */
  }
  source = null;
  analyseur = null;
  donneesFreq = null;
}

/**
 * Branche l'analyse sur l'élément qui va jouer. Ne fait rien — et surtout ne
 * route rien — si le contexte audio n'est pas déjà actif, pour ne jamais couper
 * le son d'une annonce automatique (aucune interaction ne l'a précédée).
 */
function brancherAnalyse(element: HTMLAudioElement): void {
  detacherAnalyse();
  const ctx = obtenirContexte();
  if (!ctx) return;
  try {
    // On retente un réveil (le geste d'ouverture l'a en général déjà mis en
    // route) — mais on ne route par le graphe que s'il tourne VRAIMENT, sinon le
    // son passerait par un contexte suspendu et ne sortirait plus.
    void ctx.resume?.();
    if (ctx.state !== 'running') return;
    const src = ctx.createMediaElementSource(element);
    source = src;
    try {
      const an = ctx.createAnalyser();
      an.fftSize = 128;
      an.smoothingTimeConstant = 0.8;
      src.connect(an);
      an.connect(ctx.destination);
      analyseur = an;
      donneesFreq = new Uint8Array(an.frequencyBinCount);
    } catch {
      // L'analyseur a échoué mais l'élément est déjà routé : on garantit le son
      // en reliant la source directement à la sortie.
      try {
        src.connect(ctx.destination);
      } catch {
        /* rien de plus à tenter */
      }
      analyseur = null;
      donneesFreq = null;
    }
  } catch {
    // Navigateur qui refuse l'analyse, contexte indisponible : on renonce, le son
    // continue de jouer par l'élément lui-même.
    detacherAnalyse();
  }
}

/**
 * Les niveaux entendus à l'instant, un par barre demandée (de 0 à 1). `null`
 * quand aucune analyse n'est en place — voix de secours du navigateur, contexte
 * en veille, navigateur qui la refuse : la ligne d'ondes retombe alors sur son
 * animation régulière, jamais sur des barres figées. On lit les fréquences
 * BASSES à MÉDIUMS, là où vit la voix ; le haut du spectre resterait plat.
 */
export function lireNiveaux(nombre: number): number[] | null {
  if (!analyseur || !donneesFreq) return null;
  analyseur.getByteFrequencyData(donneesFreq);
  const bins = donneesFreq.length;
  const utile = Math.max(nombre, Math.floor(bins * 0.7));
  const niveaux: number[] = [];
  for (let i = 0; i < nombre; i += 1) {
    const debut = Math.floor((i * utile) / nombre);
    const fin = Math.max(debut + 1, Math.floor(((i + 1) * utile) / nombre));
    let somme = 0;
    for (let j = debut; j < fin; j += 1) somme += donneesFreq[j];
    niveaux.push(Math.min(1, somme / (fin - debut) / 255));
  }
  return niveaux;
}

/** Coupe net ce qui parle, sans rien relancer. */
export function taireVoix(): void {
  try {
    audio?.pause();
  } catch {
    /* l'audio était déjà arrêté */
  }
  audio = null;
  arreterGardeSynthese();
  detacherAnalyse();
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  if (etat.parle || etat.cle !== null || etat.avancement !== null) {
    publier({ parle: false, cle: null, avancement: null });
  }
}

/**
 * Prononce un texte. Arrête d'abord toute parole en cours. `cle` identifie la
 * source (un message de la conversation, par exemple) ; laissée à `null` pour
 * une annonce automatique. En cas de panne du serveur audio, on tente la voix
 * du navigateur. L'avancement de la lecture est publié au fil du son, pour la
 * barre de lecture du module de voix.
 */
export function direVoix(texte: string, cle: string | null = null): void {
  if (!texte) return;
  taireVoix();
  const element = new Audio(`/api/speak?text=${encodeURIComponent(texte)}`);
  audio = element;
  // On branche l'écoute du son joué (pour la ligne d'ondes) AVANT de jouer :
  // routée seulement si le contexte audio tourne déjà, sinon sans effet.
  brancherAnalyse(element);
  // Le message est marqué « en lecture » tout de suite ; on n'affiche un
  // avancement chiffré qu'une fois la vraie durée connue.
  publier({ parle: true, cle, avancement: null });

  // Un écouteur ne touche à l'état que s'il sert TOUJOURS la lecture en cours :
  // une parole finie ne doit pas clôturer celle qui l'a remplacée.
  const estCourant = () => audio === element;
  const dureeConnue = () => Number.isFinite(element.duration) && element.duration > 0;
  const fin = () => {
    if (estCourant()) {
      audio = null;
      arreterGardeSynthese();
      publier({ parle: false, cle: null, avancement: null });
    }
  };
  element.addEventListener('loadedmetadata', () => {
    if (estCourant() && dureeConnue()) publier({ parle: true, cle, avancement: 0 });
  });
  element.addEventListener('timeupdate', () => {
    if (estCourant() && dureeConnue()) {
      publier({ parle: true, cle, avancement: Math.min(1, element.currentTime / element.duration) });
    }
  });
  element.addEventListener('ended', fin);

  // Le repli sur la voix du navigateur, une seule fois : l'erreur de l'élément
  // audio ET le rejet de `play()` peuvent survenir tous deux. Son avancement est
  // inconnu : on garde le message marqué « en lecture » sans mentir sur une
  // position (la barre pulsera au lieu d'avancer).
  let repliLance = false;
  const repli = () => {
    if (!estCourant() || repliLance) return;
    // L'élément a échoué : son analyseur ne lit que du silence figé. On le
    // détache pour que la ligne d'ondes retombe sur son animation régulière
    // plutôt que sur des barres immobiles.
    detacherAnalyse();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      repliLance = true;
      publier({ parle: true, cle, avancement: 'indetermine' });
      const synthese = window.speechSynthesis;
      const parole = new SpeechSynthesisUtterance(texte);
      parole.lang = 'fr-FR';
      parole.onend = fin;
      parole.onerror = fin;
      synthese.speak(parole);
      // Garde-fou : `onend`/`onerror` sont muets sur bien des mobiles, et la
      // parole ne démarre parfois jamais (aucun geste préalable). On surveille
      // donc l'état réel de la synthèse — une fois qu'elle a parlé PUIS s'est
      // tue, ou qu'elle n'a jamais démarré après ~4 s, on referme, pour que
      // `parle` retombe à faux et que le module revienne au rond au repos.
      arreterGardeSynthese();
      let aParle = false;
      let tics = 0;
      const surveiller = () => {
        // Une autre parole a pris la main : cette surveillance ne sert plus.
        if (!estCourant()) {
          arreterGardeSynthese();
          return;
        }
        tics += 1;
        if (synthese.speaking || synthese.pending) {
          aParle = true;
        } else if (aParle || tics >= GARDE_SYNTHESE_TICS) {
          fin();
        }
      };
      gardeSynthese = setInterval(surveiller, GARDE_SYNTHESE_MS);
    } else {
      fin();
    }
  };
  element.addEventListener('error', repli);
  void element.play().catch(repli);
}

/** L'état de la voix, réactif : le composant se redessine à chaque changement. */
export function useVoix(): EtatVoix {
  return React.useSyncExternalStore(
    (prevenir) => {
      ecouteurs.add(prevenir);
      return () => ecouteurs.delete(prevenir);
    },
    () => etat,
    () => etat,
  );
}
