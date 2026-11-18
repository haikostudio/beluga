import { garderEveilleTantQue } from './veille';
import { fermetureExigee } from '@beluga/shared';

/**
 * LA SEULE PORTE PAR OÙ UN MICRO S'OUVRE.
 *
 * Trois endroits ouvraient un micro chacun de leur côté — le bouton de dictée
 * de la barre d'écriture, l'écoute par mot de réveil, la conversation vocale —
 * et chacun le refermait à sa façon. Il suffisait qu'un seul oublie pour que le
 * repère orange du téléphone reste allumé sans que rien ne le demande.
 *
 * Désormais tout passe par ici : on ouvre par `ouvrirMicro`, on referme par la
 * PRISE rendue, et cette porte tient le REGISTRE de ce qui est ouvert. Deux
 * conséquences directes :
 *
 *   — `fermerTousLesMicros()` referme VRAIMENT tout, d'un seul geste : les
 *     pistes du flux, le contexte audio qui l'écoutait, les branchements ;
 *   — `microsOuverts()` dit combien il en reste, donc un contrôle peut le
 *     vérifier dans un vrai navigateur au lieu de le supposer.
 *
 * Sur iPhone, refermer le flux ne suffit PAS toujours : tant qu'un contexte
 * audio nourri par le micro reste ouvert, le système garde sa session
 * d'enregistrement — et son repère orange — allumée. La prise ferme donc le
 * contexte AVEC le flux, dans cet ordre : on débranche, on arrête les pistes,
 * on ferme le contexte.
 */

/** Une prise de micro ouverte : le flux, et de quoi tout refermer. */
export interface PriseMicro {
  /** Le flux du micro, à confier à l'enregistreur. */
  flux: MediaStream;
  /**
   * Confier à la prise le contexte audio (et sa source) qui écoute ce flux :
   * elle les refermera avec lui, jamais après.
   */
  brancher(contexte: AudioContext, source: AudioNode): void;
  /** Tout refermer. Rejouable sans risque : la seconde fois ne fait rien. */
  fermer(): void;
  /** La prise est-elle encore ouverte ? */
  ouverte(): boolean;
}

interface PriseInterne extends PriseMicro {
  raison: string;
}

const prises = new Set<PriseInterne>();

/** Le pont vers l'application iPhone (`natif/iOS/ControleurWeb.swift`), sans dépendre du module `natif`. */
function direAuNatifAudio(actif: boolean): void {
  (window as unknown as { __belugaNatif?: { envoyer?: (m: Record<string, unknown>) => void } }).__belugaNatif?.envoyer?.({ type: 'audio', actif });
}

/** Le délai laissé à l'iPhone pour passer en mode « appel » avant d'ouvrir le micro. */
const BASCULE_DE_SESSION_MS = 150;

/** Passe l'iPhone en mode « appel » (écho annulé, haut-parleur, vie écran verrouillé), AVANT la capture. */
async function poserLaSessionAudio(): Promise<void> {
  direAuNatifAudio(true);
  await new Promise((fini) => window.setTimeout(fini, BASCULE_DE_SESSION_MS));
}

/** Rend la session audio de l'iPhone : plus aucun micro ouvert. */
function rendreLaSessionAudio(): void {
  direAuNatifAudio(false);
}

/** Combien de micros sont ouverts à cet instant. Zéro au repos, toujours. */
export function microsOuverts(): number {
  return prises.size;
}

/** Pour quoi chaque micro ouvert l'a été — sert aux contrôles et au débogage. */
export function raisonsDesMicros(): string[] {
  return [...prises].map((p) => p.raison);
}

/** Referme TOUS les micros ouverts, quelle qu'en soit l'origine. */
export function fermerTousLesMicros(): void {
  for (const prise of [...prises]) prise.fermer();
}

/**
 * Ouvrir un micro. `raison` dit qui le demande (« dictée », « mot de réveil »,
 * « conversation ») : elle n'ouvre aucun droit, elle rend seulement lisible ce
 * qui est ouvert. L'appelant a DÉJÀ vérifié qu'un geste le demandait — cette
 * porte ne devine pas les intentions, elle tient le registre.
 */
export async function ouvrirMicro(raison: string): Promise<PriseMicro> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('micro indisponible');
  }
  /*
   * DANS L'APPLICATION IPHONE, LE MICRO N'ENTEND QUE LA VOIX PROCHE (demande de l'utilisateur, 16/11/2026 : « il écoutait
   * les conversations à côté »). On demande au téléphone d'effacer l'écho et le bruit ambiant ; la porte de niveau du
   * module de voix (`creerPorteDeNiveau`) écarte ensuite ce qui arrive faiblement. Ailleurs, rien ne change.
   */
  const natif = (window as unknown as { __belugaNatif?: { plateforme?: string } }).__belugaNatif?.plateforme === 'ios';
  /*
   * LE MODE « APPEL » DE L'IPHONE AVANT LA CAPTURE (carte « Jarvis n'entend ni ne répond », 17/11/2026). Il était posé
   * quand la conversation s'allumait, alors que le micro tournait déjà : changer le mode audio pendant une capture
   * l'interrompt, et la conversation s'ouvrait sans qu'aucun son ne parte. Il est désormais posé UNE fois, avant le
   * premier micro, et rendu après le dernier (`rendreLaSessionAudio`) — jamais changé pendant une capture.
   */
  if (natif && prises.size === 0) await poserLaSessionAudio();
  let flux: MediaStream;
  try {
    flux = await navigator.mediaDevices.getUserMedia({
      audio: natif ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } : true,
    });
  } catch (err) {
    if (natif && prises.size === 0) rendreLaSessionAudio();
    throw err;
  }

  let ouverte = true;
  let contexte: AudioContext | null = null;
  let source: AudioNode | null = null;

  const prise: PriseInterne = {
    raison,
    flux,
    brancher(ctx, src) {
      contexte = ctx;
      source = src;
      // Ouvert puis refermé pendant qu'on branchait : on ne garde rien.
      if (!ouverte) fermerLeSon();
    },
    ouverte: () => ouverte,
    fermer() {
      if (!ouverte) return;
      ouverte = false;
      prises.delete(prise);
      fermerLeSon();
      // Les pistes en dernier : une piste arrêtée pendant qu'un graphe la lit
      // encore laisse, sur certains navigateurs, la session d'enregistrement
      // ouverte.
      for (const piste of flux.getTracks()) {
        try {
          piste.stop();
        } catch {
          /* déjà arrêtée */
        }
      }
      // Le dernier micro refermé rend la session audio de l'iPhone (le repère orange s'éteint avec elle).
      if (natif && prises.size === 0) rendreLaSessionAudio();
    },
  };

  const fermerLeSon = () => {
    try {
      source?.disconnect();
    } catch {
      /* déjà débranchée */
    }
    source = null;
    const ctx = contexte;
    contexte = null;
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined);
  };

  prises.add(prise);
  return prise;
}

/*
 * QUITTER L'ÉCRAN REFERME LE MICRO. On ne laisse pas un micro ouvert derrière
 * soi : la page qu'on quitte (ou qu'on met en arrière-plan sans écoute voulue)
 * relâche tout. Le détail de ce qui compte est une règle pure et testée
 * (`fermetureExigee`, `shared/src/micro-demande.ts`) ; ici on ne fait que la
 * brancher sur les événements du navigateur.
 */

/** Une écoute VOULUE est-elle en cours ? Renseigné par le module de voix. */
let ecouteVoulue = false;

export function signalerEcouteVoulue(voulue: boolean): void {
  ecouteVoulue = voulue;
}

if (typeof window !== 'undefined') {
  // Un micro ouvert (dictée, enregistrement, conversation, mot de réveil) tient
  // la page éveillée : la veille ne coupe jamais ce qu'on est en train de dire.
  garderEveilleTantQue(() => prises.size > 0 || ecouteVoulue);
  const juger = (evenement: string) => {
    const visible = typeof document === 'undefined' ? true : document.visibilityState !== 'hidden';
    if (fermetureExigee({ evenement, visible, ecouteVoulue })) fermerTousLesMicros();
  };
  window.addEventListener('pagehide', () => juger('pagehide'));
  document.addEventListener('visibilitychange', () => juger('visibilitychange'));
}

/*
 * LE POINT D'ESSAI. Un contrôle en vrai navigateur doit pouvoir demander
 * combien de micros sont ouverts — sinon il ne juge que ce qu'on lui raconte.
 * Gardé par le MODE (jamais `import.meta.env.DEV`, qui suit NODE_ENV et vaut
 * « production » chez les agents), comme le point d'essai de l'écoute.
 */
if (import.meta.env.MODE !== 'production' && typeof window !== 'undefined') {
  const essai = ((window as unknown as { belugaEssai?: Record<string, unknown> }).belugaEssai ??= {});
  essai.micros = () => microsOuverts();
  essai.raisonsMicros = () => raisonsDesMicros();
}
