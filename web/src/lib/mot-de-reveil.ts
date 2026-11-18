/*
 * L'ATTENTE DU MOT DE RÉVEIL, SUR L'APPAREIL (carte « Veille privée et réveil « Dis Jarvis » », 16/11/2026).
 *
 * Bouton « Micro ouvert » du module de voix, conversation fermée : le micro est ouvert par la porte unique
 * (`lib/micro.ts`), et une petite reconnaissance vocale LOCALE (Vosk en WebAssembly, `vosk-browser`, modèle
 * français servi par le démon sous `/api/modele-de-reveil/…`) n'attend QUE le mot réglé (« Dis Jarvis ») — sa
 * grammaire est restreinte à ce mot et à « [unk] ». AUCUN son ne quitte l'appareil avant le mot : ni requête de
 * transcription, ni conversation, ni connexion. Le son des dernières secondes vit dans un tampon EN MÉMOIRE, vidé à
 * chaque fermeture de conversation.
 *
 * Au mot : `surReveil` ouvre la conversation (même chemin que le toucher sur les ondes). La conversation emprunte
 * la MÊME prise de micro (`EntreeDuDirect` : pas de seconde demande d'autorisation sur iPhone) ; sa piste sortante
 * rejoue d'abord le mot et ce qui l'a SUIVI (horodatage du résultat), puis le micro réel, sans trou ni doublon : le
 * retard pris pendant l'ouverture se rattrape en sautant les silences. Jamais un son d'avant le mot. Le mot transmis
 * fait répondre « Oui ? » à Jarvis quand rien ne le suit (consigne de la voix) : le direct n'accepte aucun geste
 * venu du dehors pour le faire parler (essai réel du 16/11/2026).
 *
 * Le modèle se charge à la PREMIÈRE ouverture du micro (un écran qu'on n'a pas ouvert ne se télécharge pas) et se
 * garde ensuite dans le navigateur. Un échec de chargement se DIT ; la conversation par les ondes reste possible.
 */
import * as React from 'react';
import {
  REFUS_MICRO,
  SEUIL_DE_PAROLE,
  SON_INDISPONIBLE,
  TAMPON_APRES_REVEIL_S,
  TAMPON_AVANT_REVEIL_S,
  debutDuMotDeReveil,
  creerPorteDeNiveau,
  grammaireDuReveil,
  niveauRms,
  paroleEntendue,
  type MesureDuMicro,
} from '@beluga/shared';
import { ouvrirMicro, type PriseMicro } from './micro';
import { t } from '@/lib/langue';
import { plateformeNative } from '@/lib/natif';

/** Le modèle servi par le démon. Nom versionné : un modèle neuf changera d'adresse, donc de cache. */
export const ADRESSE_DU_MODELE = '/api/modele-de-reveil/vosk-model-small-fr-0.22.tar.gz';

export type EtatDuReveil = 'eteint' | 'ouverture' | 'chargement' | 'attente' | 'conversation' | 'refuse' | 'erreur';

/** Ce que la conversation en direct emprunte au micro du réveil. */
export interface EntreeDuDirect {
  /** Le flux sortant (tampon d'après le mot, puis micro réel) et sa piste, à donner à la connexion. */
  flux: MediaStream;
  piste: MediaStreamTrack;
  /** Le niveau du micro réel, pour les ondes. */
  analyseur: AnalyserNode;
  /**
   * LA CONVERSATION SE PRÉPARE (carte « Jarvis n'entend ni ne répond », 17/11/2026) : ouverte d'un geste, tout ce qui
   * est dit À PARTIR D'ICI est gardé en mémoire, sur l'appareil, puis transmis dès que la ligne est ouverte — on parle
   * sans attendre que Jarvis soit là. Rien ne part avant `commencer`.
   */
  preparer(): void;
  /** La conversation a-t-elle été ouverte par le mot de réveil (et non par un geste) ? */
  parReveil(): boolean;
  /** L'utilisateur a-t-il parlé depuis `preparer` ? Oui : Jarvis répond à ses mots ; non : il le salue. */
  paroleDepuisLaPreparation(): boolean;
  /**
   * Fait entendre un son au direct (l'appel « Jarvis ? » qui le fait saluer), dans le MÊME contexte audio que le micro :
   * il tourne déjà, alors qu'un contexte neuf créé hors geste reste suspendu sur iPhone (le salut s'y perdait). Rend
   * faux si le son n'a pas pu partir.
   */
  faireEntendre(adresse: string): Promise<boolean>;
  /** Ce que le traitement du son mesure, pour le contrôle de vie de la conversation. */
  mesurer(): MesureDuMicro;
  /** Relance le contexte audio coupé (appel entrant, passage en mode appel de l'iPhone…). */
  relancer(): void;
  /** La conversation est établie : la piste commence à porter le son (le mot et sa suite, puis le micro réel). */
  commencer(): void;
  /** La conversation est fermée : la piste se tait, le tampon se vide, l'attente du mot reprend. */
  finir(): void;
  /**
   * LA SOURDINE RÉELLE (18/11/2026) : le micro ne capte plus rien — la piste du micro réel est éteinte, donc ni Jarvis,
   * ni le mot de réveil, ni les ondes ne reçoivent de son ; `false` la rallume (sans nouveau geste : la capture reste ouverte).
   */
  sourdine(coupe: boolean): void;
}

export interface AttenteDuMot {
  etat: EtatDuReveil;
  erreur: string | null;
  entree: EntreeDuDirect | null;
}

/* ------------------------------------------------------------------ */
/* Le modèle, chargé une seule fois par page                            */
/* ------------------------------------------------------------------ */

type ModeleVosk = Awaited<ReturnType<typeof import('vosk-browser')['createModel']>>;
let modele: Promise<ModeleVosk> | null = null;

function chargerLeModele(): Promise<ModeleVosk> {
  modele ??= import('vosk-browser')
    .then(({ createModel }) => createModel(new URL(ADRESSE_DU_MODELE, window.location.href).href, -1))
    .catch((err) => {
      modele = null;
      throw err;
    });
  return modele;
}

/* ------------------------------------------------------------------ */
/* Le petit son de la veille                                            */
/* ------------------------------------------------------------------ */

/** Deux notes douces et descendantes (~250 ms), fabriquées sur place : aucun fichier. */
export function jouerLeSonDeVeille(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const depart = ctx.currentTime + 0.02;
    [660, 440].forEach((frequence, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequence;
      const debut = depart + i * 0.13;
      gain.gain.setValueAtTime(0, debut);
      gain.gain.linearRampToValueAtTime(0.08, debut + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, debut + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(debut);
      osc.stop(debut + 0.13);
    });
    (window as any).__belugaSonsDeVeille = ((window as any).__belugaSonsDeVeille ?? 0) + 1;
    window.setTimeout(() => void ctx.close().catch(() => undefined), 600);
  } catch {
    /* sans son, la veille se fait quand même */
  }
}

/* ------------------------------------------------------------------ */
/* Le hook                                                              */
/* ------------------------------------------------------------------ */

/**
 * Tient le micro ouvert et attend le mot tant que `actif` est vrai (Voix activée ET Micro ouvert). `mot` est le mot
 * réglé, relu à chaque résultat. `surReveil` est appelé UNE fois par réveil.
 */
export function useAttenteDuMot(actif: boolean, mot: string, surReveil: () => void): AttenteDuMot {
  const [etat, setEtat] = React.useState<EtatDuReveil>('eteint');
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [entree, setEntree] = React.useState<EntreeDuDirect | null>(null);
  const motRef = React.useRef(mot);
  const surReveilRef = React.useRef(surReveil);
  surReveilRef.current = surReveil;
  // Un mot changé dans les réglages refait la grammaire : on le relit à chaque reprise de l'attente.
  const refaireRef = React.useRef<(() => void) | null>(null);
  React.useEffect(() => {
    if (motRef.current === mot) return;
    motRef.current = mot;
    refaireRef.current?.();
  }, [mot]);

  React.useEffect(() => {
    if (!actif) {
      setEtat('eteint');
      setErreur(null);
      setEntree(null);
      return;
    }
    let vivant = true;
    let prise: PriseMicro | null = null;
    let ctx: AudioContext | null = null;
    let reconnaisseur: InstanceType<ModeleVosk['KaldiRecognizer']> | null = null;
    // L'attente du mot est-elle branchée (modèle chargé) ? La conversation est-elle ouverte ?
    let modeleCharge = false;
    let enConversation = false;
    /* La porte de niveau : seulement dans l'application iPhone (`shared/src/porte-de-niveau.ts`). */
    const porte = plateformeNative() === 'ios' ? creerPorteDeNiveau() : null;

    /* Le tampon circulaire : les échantillons du micro, repérés par leur rang absolu depuis l'ouverture. */
    let taux = 48_000;
    let pas = 4096; // la taille d'un bloc du traitement
    let tampon = new Float32Array(1);
    let ecrit = 0; // rang absolu du prochain échantillon reçu
    /* Le réveil en cours : où commence le rejeu (début du mot), où en est la lecture. */
    let reveille = false;
    let debutDuReconnaisseur = 0; // rang absolu du premier échantillon donné au reconnaisseur
    let debutDuMot: number | null = null;
    let rangAuReveil = 0;
    let lecture: number | null = null; // rang du prochain échantillon rejoué ; null = la piste se tait
    const attentesDuDebut: Array<(rang: number) => void> = [];
    /* La préparation d'une conversation ouverte d'un geste : d'où rejouer, et le niveau de chaque bloc entendu depuis. */
    let rangDuGeste: number | null = null;
    let niveauxDepuisLeGeste: number[] = [];
    /* Le son injecté sur la piste sortante (l'appel « Jarvis ? »), à la place du micro le temps qu'il dure. */
    let injection: Float32Array | null = null;
    let injectionLue = 0;
    let finDInjection: (() => void) | null = null;
    /* Les mesures du contrôle de vie : blocs vus, plus forts niveaux entendu et envoyé depuis la dernière lecture. */
    let blocs = 0;
    let entenduMax = 0;
    let envoyeMax = 0;
    // L'état à montrer hors conversation quand le modèle n'est pas (ou pas encore) là.
    let etatSansModele: EtatDuReveil = 'chargement';

    const lire = (rang: number) => tampon[((rang % tampon.length) + tampon.length) % tampon.length]!;

    const resoudreLeDebut = (rang: number) => {
      if (debutDuMot !== null) return;
      debutDuMot = Math.max(rangAuReveil - taux * TAMPON_AVANT_REVEIL_S, Math.min(rang, ecrit));
      for (const f of attentesDuDebut.splice(0)) f(debutDuMot);
    };

    /** Le réveil : `debut` est le rang du premier échantillon du mot — rien d'avant ne partira. */
    const declencher = (debut: number) => {
      if (reveille || enConversation) return;
      reveille = true;
      rangAuReveil = ecrit;
      debutDuMot = null;
      resoudreLeDebut(debut);
      if (vivant) setEtat('conversation');
      surReveilRef.current();
    };

    /** Un résultat DÉFINITIF, horodaté : seul lui peut réveiller (les partiels faisaient de faux réveils). */
    const surResultat = (mots: Array<{ word: string; start: number; end: number; conf?: number }>) => {
      if (!vivant || enConversation || reveille || !Array.isArray(mots) || mots.length === 0) return;
      const debut = debutDuMotDeReveil(mots, motRef.current);
      if (debut === null) return;
      declencher(debutDuReconnaisseur + Math.round(debut * taux));
    };

    const nouveauReconnaisseur = (m: ModeleVosk) => {
      try {
        reconnaisseur?.remove();
      } catch {
        /* déjà retiré */
      }
      const r = new m.KaldiRecognizer(taux, grammaireDuReveil(motRef.current));
      r.setWords(true);
      r.on('result', (message: any) => surResultat(message?.result?.result ?? []));
      reconnaisseur = r;
      debutDuReconnaisseur = ecrit;
    };

    /** Revenir à l'attente du mot : tampon vidé, reconnaisseur neuf, piste muette. */
    const reprendre = () => {
      reveille = false;
      debutDuMot = null;
      lecture = null;
      enConversation = false;
      rangDuGeste = null;
      niveauxDepuisLeGeste = [];
      injection = null;
      finDInjection?.();
      tampon.fill(0);
      attentesDuDebut.splice(0);
      if (modeleCharge) void chargerLeModele().then((m) => vivant && nouveauReconnaisseur(m));
      if (vivant) setEtat(modeleCharge ? 'attente' : etatSansModele);
    };
    refaireRef.current = () => {
      if (!enConversation && modeleCharge) reprendre();
    };
    const renoncer = (message: string, refus: boolean) => {
      if (!vivant) return;
      setEtat(refus ? 'refuse' : 'erreur');
      setErreur(message);
    };

    const demarrer = async () => {
      setEtat('ouverture');
      setErreur(null);
      try {
        prise = await ouvrirMicro('mot de réveil');
      } catch {
        renoncer(REFUS_MICRO, true);
        return;
      }
      if (!vivant) {
        prise.fermer();
        return;
      }
      let analyseur: AnalyserNode;
      let destination: MediaStreamAudioDestinationNode;
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) throw new Error('aucun contexte audio');
        ctx = new Ctx();
        taux = ctx.sampleRate;
        tampon = new Float32Array(Math.round(taux * (TAMPON_AVANT_REVEIL_S + TAMPON_APRES_REVEIL_S)));
        const source = ctx.createMediaStreamSource(prise.flux);
        // Le contexte est confié à la PRISE : il se fermera avec le micro, d'un seul geste.
        prise.brancher(ctx, source);
        analyseur = ctx.createAnalyser();
        analyseur.fftSize = 64;
        source.connect(analyseur);
        destination = ctx.createMediaStreamDestination();
        const traitement = ctx.createScriptProcessor(4096, 1, 1);
        pas = traitement.bufferSize;
        traitement.onaudioprocess = (e) => {
          const entreeSon = e.inputBuffer.getChannelData(0);
          const sortie = e.outputBuffer.getChannelData(0);
          // 1. Garder ce qui est entendu, en mémoire seulement.
          for (let i = 0; i < entreeSon.length; i += 1) tampon[(ecrit + i) % tampon.length] = entreeSon[i]!;
          ecrit += entreeSon.length;
          blocs += 1;
          const niveauEntendu = niveauRms(entreeSon);
          if (niveauEntendu > entenduMax) entenduMax = niveauEntendu;
          // 1 ter. Une conversation qui se prépare : on note si l'utilisateur parle déjà (rien ne part encore).
          if (rangDuGeste !== null && lecture === null && niveauxDepuisLeGeste.length < 2000) niveauxDepuisLeGeste.push(niveauEntendu);
          // 1 bis. Hors conversation, le bruit de fond de l'endroit apprend son plancher à la porte.
          if (porte && lecture === null) porte.juger(niveauRms(entreeSon), (pas / taux) * 1000);
          // 2. Le mot : seul le reconnaisseur LOCAL entend, tant qu'on l'attend.
          if (reconnaisseur && !enConversation && !reveille) {
            try {
              reconnaisseur.acceptWaveformFloat(new Float32Array(entreeSon), taux);
            } catch {
              /* un morceau refusé ne casse pas l'attente */
            }
          }
          // 3. La piste sortante : muette, sauf conversation ouverte.
          if (lecture === null) {
            sortie.fill(0);
            return;
          }
          // 3 bis. Un son injecté (l'appel « Jarvis ? ») passe à la place du micro ; ce qui est dit pendant ce temps
          //        reste dans le tampon et suit juste après.
          if (injection) {
            const son = injection;
            for (let i = 0; i < sortie.length; i += 1) sortie[i] = injectionLue + i < son.length ? son[injectionLue + i]! : 0;
            injectionLue += sortie.length;
            const envoye = niveauRms(sortie);
            if (envoye > envoyeMax) envoyeMax = envoye;
            if (injectionLue >= son.length) {
              injection = null;
              finDInjection?.();
            }
            return;
          }
          // Un retard pris (tampon d'après le mot) se rattrape en sautant les silences, jamais la parole.
          let rang = Math.max(lecture, ecrit - tampon.length + pas);
          while (ecrit - rang > 2 * pas) {
            let fort = false;
            for (let i = 0; i < pas; i += 1) {
              if (Math.abs(lire(rang + i)) > SEUIL_DE_PAROLE / 2) {
                fort = true;
                break;
              }
            }
            if (fort) break;
            rang += pas;
          }
          for (let i = 0; i < sortie.length; i += 1) sortie[i] = rang + i < ecrit ? lire(rang + i) : 0;
          lecture = Math.min(rang + sortie.length, ecrit);
          // 4. La porte de niveau (application iPhone) : ce qui arrive faiblement — une voix à l'autre bout de la
          //    pièce — ne part pas au direct. Le début du mot rejoué passe toujours (porte ouverte d'office au réveil).
          if (porte && !porte.juger(niveauRms(sortie), (pas / taux) * 1000)) sortie.fill(0);
          const envoye = niveauRms(sortie);
          if (envoye > envoyeMax) envoyeMax = envoye;
        };
        source.connect(traitement);
        traitement.connect(destination);
        // Le traitement doit être relié à la sortie pour tourner : par un gain NUL, on ne s'entend jamais soi-même.
        const silence = ctx.createGain();
        silence.gain.value = 0;
        traitement.connect(silence).connect(ctx.destination);
      } catch {
        prise.fermer();
        prise = null;
        renoncer(SON_INDISPONIBLE, false);
        return;
      }
      const piste = destination.stream.getAudioTracks()[0]!;
      const contexte = ctx!;
      /* LE SON COUPÉ SE RELANCE DE LUI-MÊME (17/11/2026) : sur iPhone, un appel entrant ou le passage en mode « appel »
         interrompt le contexte audio — le traitement s'arrête et la piste sortante se tait sans rien dire. */
      const relancer = () => {
        if (vivant && contexte.state !== 'running' && contexte.state !== 'closed') void contexte.resume().catch(() => undefined);
      };
      contexte.onstatechange = relancer;
      const pisteDuMicro = prise!.flux.getAudioTracks()[0];
      if (pisteDuMicro) pisteDuMicro.onunmute = relancer;
      const sortieDuDirect: EntreeDuDirect = {
        flux: destination.stream,
        piste,
        analyseur,
        preparer: () => {
          if (reveille || enConversation || rangDuGeste !== null) return;
          rangDuGeste = ecrit;
          niveauxDepuisLeGeste = [];
          relancer();
        },
        parReveil: () => reveille,
        paroleDepuisLaPreparation: () => paroleEntendue(niveauxDepuisLeGeste, (pas / taux) * 1000),
        faireEntendre: async (adresse) => {
          try {
            if (contexte.state !== 'running') await contexte.resume().catch(() => undefined);
            const reponse = await fetch(adresse);
            if (!reponse.ok) return false;
            const decode = await contexte.decodeAudioData(await reponse.arrayBuffer());
            if (!vivant || lecture === null || contexte.state !== 'running') return false;
            // Rendu au taux du contexte par le décodage : on le lit tel quel, au même pas que le micro.
            injection = decode.getChannelData(0).slice();
            injectionLue = 0;
            porte?.ouvrirPendant(decode.duration * 1000 + 500);
            await new Promise<void>((fini) => {
              const secours = window.setTimeout(() => fini(), decode.duration * 1000 + 3000);
              finDInjection = () => {
                window.clearTimeout(secours);
                finDInjection = null;
                fini();
              };
            });
            return true;
          } catch {
            injection = null;
            return false;
          }
        },
        mesurer: () => {
          const mesure: MesureDuMicro = {
            blocs,
            contexte: contexte.state,
            entendu: entenduMax,
            envoye: envoyeMax,
            pisteFinie: pisteDuMicro?.readyState === 'ended',
          };
          entenduMax = 0;
          envoyeMax = 0;
          return mesure;
        },
        relancer,
        commencer: () => {
          const parReveil = reveille;
          enConversation = true;
          if (vivant) setEtat('conversation');
          if (!parReveil) {
            // Le mode audio a pu changer depuis que le fond a été appris : la porte le réapprend, et laisse passer
            // d'office les premières secondes (ce qui a été dit pendant la connexion, puis la première phrase).
            porte?.oublier();
            const debut = rangDuGeste === null ? ecrit : Math.max(rangDuGeste, ecrit - tampon.length + pas);
            porte?.ouvrirPendant(((ecrit - debut) / taux) * 1000 + 3000);
            // Ce qui a été dit depuis le geste part en premier ; les silences se rattrapent tout seuls.
            lecture = debut;
            return;
          }
          // Le mot et la phrase qui suit passent entiers : la porte reste ouverte le temps du rejeu.
          porte?.ouvrirPendant(((ecrit - (debutDuMot ?? rangAuReveil)) / taux) * 1000 + 1500);
          // Le rejeu part du DÉBUT du mot, dès qu'il est connu ; d'ici là, la piste se tait.
          if (debutDuMot !== null) lecture = debutDuMot;
          else attentesDuDebut.push((debut) => (lecture = debut));
        },
        finir: () => {
          // La sourdine ne survit pas à la conversation : l'attente du mot retrouve son micro.
          if (pisteDuMicro) pisteDuMicro.enabled = true;
          if (!enConversation && !reveille) return;
          reprendre();
        },
        sourdine: (coupe) => {
          if (pisteDuMicro && pisteDuMicro.readyState === 'live') pisteDuMicro.enabled = !coupe;
        },
      };
      if (!vivant) return;
      setEntree(sortieDuDirect);

      // Le modèle, chargé à la première ouverture du micro. Pendant ce temps, l'état le DIT.
      setEtat('chargement');
      try {
        const m = await chargerLeModele();
        if (!vivant) return;
        modeleCharge = true;
        nouveauReconnaisseur(m);
        if (!enConversation) setEtat('attente');
      } catch {
        etatSansModele = 'erreur';
        if (!vivant) return;
        if (!enConversation) setEtat('erreur');
        setErreur(t('Le détecteur du mot « {v0} » n’a pas pu se charger : touchez les ondes pour parler.', { v0: motRef.current }));
      }
    };

    // Le point d'essai : provoquer un réveil SANS voix, par le même chemin que la détection.
    if (import.meta.env.MODE !== 'production') {
      const essai = ((window as any).belugaEssai ??= {});
      essai.reveil = () => {
        if (!vivant || !prise) return false;
        const mots = motRef.current.split(/\s+/).filter(Boolean);
        surResultat(mots.map((word, i) => ({ word, start: (ecrit - debutDuReconnaisseur) / taux + i * 0.3, end: (ecrit - debutDuReconnaisseur) / taux + (i + 1) * 0.3, conf: 1 })));
        return true;
      };
    }

    void demarrer();

    return () => {
      vivant = false;
      refaireRef.current = null;
      try {
        reconnaisseur?.remove();
      } catch {
        /* déjà retiré */
      }
      reconnaisseur = null;
      tampon = new Float32Array(1);
      // La prise referme tout : les pistes du micro ET le contexte audio (donc le traitement et la piste sortante).
      prise?.fermer();
      prise = null;
      ctx = null;
      setEntree(null);
      if (import.meta.env.MODE !== 'production') delete (window as any).belugaEssai?.reveil;
    };
  }, [actif]);

  return { etat, erreur, entree };
}
