import * as React from 'react';
import {
  ENREGISTREMENT_IMPOSSIBLE,
  RELECTURE_MS,
  REFUS_MICRO,
  SILENCE_FIN_MS,
  SON_INDISPONIBLE,
  assemblerDictee,
  extensionDuType,
  formatDEnregistrement,
  lireParole,
  type EtatEcoute,
} from '@haikodev/shared';
import { client } from './client';

/**
 * L'ÉCOUTE PERMANENTE — le micro ouvert, mais seulement si on l'a demandé.
 *
 * Ce fichier tient le MICRO et la DÉCOUPE ; ce que les phrases veulent dire est
 * décidé ailleurs, dans les règles pures (`shared/src/reveil-vocal.ts`), qui ne
 * connaissent ni son ni réseau. Ici : on ouvre le micro quand l'interrupteur est
 * allumé, on mesure le volume, on découpe ce qui est dit en TRANCHES séparées
 * par des silences, et l'on confie chaque tranche au chemin de transcription
 * DÉJÀ en place (`/api/transcribe`, le même que le bouton micro de la barre
 * d'écriture, qui ne bouge pas).
 *
 * Quatre règles qui ne se négocient pas :
 *   — rien ne s'ouvre tant que l'interrupteur est éteint ;
 *   — aucun son n'est gardé : la tranche est envoyée puis jetée, et le serveur
 *     efface son fichier temporaire dès la transcription faite ;
 *   — une tranche SILENCIEUSE ne part jamais — on n'envoie que ce qui a été dit ;
 *   — RIEN de ce qui touche au son ne casse la page : micro, son du navigateur
 *     et enregistreur sont tous les trois ouverts sous protection, et un
 *     navigateur qui n'en veut pas voit un message, jamais un écran vide.
 */

/**
 * Le volume (de 0 à 1) au-dessus duquel on considère que quelqu'un parle. Assez
 * haut pour ignorer le souffle d'une pièce, assez bas pour entendre une phrase
 * dite normalement à un mètre.
 */
const SEUIL_PAROLE = 0.06;

/**
 * Une tranche silencieuse ne dure jamais plus longtemps : l'enregistreur repart
 * à neuf, pour qu'un micro laissé ouvert toute la journée n'accumule rien.
 */
const TRANCHE_MAX_MS = 12_000;

/** Combien de barres l'onde du micro lit à l'analyseur. */
const BINS_MICRO = 128;

/* ------------------------------------------------------------------ */
/* Ce que le micro entend, pour la ligne d'ondes                       */
/* ------------------------------------------------------------------ */

let analyseurMicro: AnalyserNode | null = null;
let donneesMicro: Uint8Array | null = null;

/**
 * Les niveaux entendus AU MICRO à l'instant, un par barre demandée (0 à 1).
 * `null` quand aucun micro n'est ouvert — la ligne d'ondes retombe alors sur son
 * animation régulière. Jumeau de `lireNiveaux` (qui lit, lui, le son JOUÉ).
 */
export function lireNiveauxMicro(nombre: number): number[] | null {
  if (!analyseurMicro || !donneesMicro) return null;
  analyseurMicro.getByteFrequencyData(donneesMicro);
  const bins = donneesMicro.length;
  const utile = Math.max(nombre, Math.floor(bins * 0.7));
  const niveaux: number[] = [];
  for (let i = 0; i < nombre; i += 1) {
    const debut = Math.floor((i * utile) / nombre);
    const fin = Math.max(debut + 1, Math.floor(((i + 1) * utile) / nombre));
    let somme = 0;
    for (let j = debut; j < fin; j += 1) somme += donneesMicro[j];
    niveaux.push(Math.min(1, somme / (fin - debut) / 255));
  }
  return niveaux;
}

/* ------------------------------------------------------------------ */
/* Où va la phrase dictée                                              */
/* ------------------------------------------------------------------ */

/**
 * La phrase terminée est PUBLIÉE sur un canal unique. À QUI elle est adressée
 * (la conversation ouverte, le chef d'orchestre, une carte) est une décision qui
 * ne se prend pas ici : ce module dit ce qui a été dit, un seul endroit s'y
 * abonnera. En attendant, la phrase est annoncée en message court, si bien
 * qu'elle n'est jamais perdue en silence.
 */
export const EVENEMENT_DICTEE = 'haikodev:dictee';

export function publierDictee(texte: string): void {
  if (!texte) return;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENEMENT_DICTEE, { detail: { texte } }));
  }
  client.pushToast('info', `Dicté : ${texte}`);
}

/** S'abonner aux phrases dictées. Rend la fonction qui désabonne. */
export function surDictee(recevoir: (texte: string) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const ecouteur = (e: Event) => recevoir((e as CustomEvent<{ texte: string }>).detail.texte);
  window.addEventListener(EVENEMENT_DICTEE, ecouteur);
  return () => window.removeEventListener(EVENEMENT_DICTEE, ecouteur);
}

/* ------------------------------------------------------------------ */
/* Le hook : micro, tranches, transcription                            */
/* ------------------------------------------------------------------ */

export interface Ecoute {
  /** Où en est l'écoute : éteinte, en guet, en dictée, en relecture, refusée. */
  etat: EtatEcoute;
  /** La phrase dictée à cet instant, telle qu'elle s'affiche. */
  dictee: string;
  /** Ce qui empêche d'écouter, en français simple. `null` quand tout va bien. */
  erreur: string | null;
  /** Jeter la phrase en cours sans rien envoyer (le clic, ou « Annule »). */
  annuler: () => void;
}

/**
 * Ouvre le micro tant que `actif` est vrai, guette le mot de réveil, puis
 * recueille la phrase. Rien ne démarre tout seul : `actif` vient de
 * l'interrupteur du module de voix, éteint par défaut.
 */
export function useEcoutePermanente(actif: boolean): Ecoute {
  const [etat, setEtat] = React.useState<EtatEcoute>('eteinte');
  const [dictee, setDictee] = React.useState('');
  const [erreur, setErreur] = React.useState<string | null>(null);

  // Les valeurs lues par les minuteries et la boucle du micro, sans les
  // réabonner à chaque frappe.
  const etatRef = React.useRef(etat);
  etatRef.current = etat;
  const dicteeRef = React.useRef(dictee);
  dicteeRef.current = dictee;
  // L'instant du dernier son entendu : c'est LUI qui mesure le silence.
  const dernierSonRef = React.useRef(0);
  // La minuterie qui clôt la dictée après le silence, et celle de la relecture.
  const finRef = React.useRef<number | null>(null);
  const relectureRef = React.useRef<number | null>(null);

  const oublierMinuteries = React.useCallback(() => {
    if (finRef.current) window.clearTimeout(finRef.current);
    if (relectureRef.current) window.clearTimeout(relectureRef.current);
    finRef.current = null;
    relectureRef.current = null;
  }, []);

  /** Jeter ce qui est en cours et revenir au guet (ou à l'extinction). */
  const annuler = React.useCallback(() => {
    oublierMinuteries();
    setDictee('');
    setEtat((e) => (e === 'eteinte' || e === 'refusee' ? e : 'guette'));
  }, [oublierMinuteries]);

  /** La phrase est complète : on la montre le temps de la relire, puis elle part. */
  const clore = React.useCallback(() => {
    const phrase = dicteeRef.current.trim();
    if (!phrase) return;
    oublierMinuteries();
    setEtat('relit');
    relectureRef.current = window.setTimeout(() => {
      relectureRef.current = null;
      publierDictee(phrase);
      setDictee('');
      setEtat((e) => (e === 'relit' ? 'guette' : e));
    }, RELECTURE_MS);
  }, [oublierMinuteries]);

  /**
   * UNE PHRASE ENTENDUE. C'est le seul point d'entrée du texte : la tranche
   * transcrite y arrive, et le point d'essai de la page y injecte une phrase
   * fabriquée — même chemin, donc ce qu'un script vérifie est bien ce qui
   * tourne pour de vrai.
   */
  const recevoirParole = React.useCallback(
    (texte: string) => {
      const courant = etatRef.current;
      if (courant === 'eteinte' || courant === 'refusee') return;

      const lu = lireParole(texte, courant === 'ecoute');
      // « Annule » est entendu À TOUT MOMENT, la relecture comprise : ces deux
      // secondes sont justement le temps qu'on a pour se raviser. C'est le
      // pendant du clic sur la phrase, qui la jette lui aussi.
      if (lu.annulation) {
        annuler();
        return;
      }
      // Une phrase NOUVELLE, en revanche, ne se mêle pas à celle qui part.
      if (courant === 'relit') return;
      if (!lu.reveil && courant !== 'ecoute') return;

      const suite = assemblerDictee(lu.reveil ? '' : dicteeRef.current, lu.suite);
      dicteeRef.current = suite;
      setDictee(suite);
      setEtat('ecoute');

      // La dictée est close par le SILENCE : on repart du dernier son entendu,
      // donc une tranche déjà suivie de deux secondes de calme part tout de
      // suite, et une phrase reprise entre-temps attend son tour. Une dictée
      // encore VIDE (« Dis Haiko » seul) n'est jamais close : on attend la suite.
      if (finRef.current) window.clearTimeout(finRef.current);
      finRef.current = null;
      if (!suite) return;
      const attendu = Math.max(0, SILENCE_FIN_MS - (Date.now() - dernierSonRef.current));
      finRef.current = window.setTimeout(() => {
        finRef.current = null;
        clore();
      }, attendu);
    },
    [annuler, clore],
  );

  // Le point d'essai de la page : provoquer une parole SANS micro, pour juger le
  // module dans un vrai navigateur. Gardé par le MODE (jamais `import.meta.env.DEV`,
  // qui suit NODE_ENV et vaut « production » chez les agents).
  React.useEffect(() => {
    if (import.meta.env.MODE === 'production' || typeof window === 'undefined') return;
    const essai = ((window as any).haikodevEssai ??= {});
    essai.parole = (texte: string) => recevoirParole(texte);
    return () => {
      delete essai.parole;
    };
  }, [recevoirParole]);

  /* ---------------- Le micro lui-même ---------------- */

  /*
   * Ce que la boucle du micro doit atteindre, sans en DÉPENDRE. L'effet
   * ci-dessous ouvre un micro : il ne doit se remonter QUE lorsque
   * l'interrupteur change. S'il dépendait de `recevoirParole` — donc
   * d'`annuler` et de `clore` —, la moindre reconstruction de ces fonctions
   * fermerait le micro pour le rouvrir aussitôt : sur un téléphone, une
   * demande d'autorisation à répétition et une écoute qui ne tient jamais. On
   * passe donc par une référence, relue à chaque phrase.
   */
  const recevoirParoleRef = React.useRef(recevoirParole);
  recevoirParoleRef.current = recevoirParole;
  const oublierMinuteriesRef = React.useRef(oublierMinuteries);
  oublierMinuteriesRef.current = oublierMinuteries;

  React.useEffect(() => {
    if (!actif) {
      oublierMinuteriesRef.current();
      setEtat('eteinte');
      setDictee('');
      setErreur(null);
      return;
    }

    let vivant = true;
    let flux: MediaStream | null = null;
    let contexte: AudioContext | null = null;
    let enregistreur: MediaRecorder | null = null;
    let image = 0;
    let morceaux: Blob[] = [];
    // Cette tranche porte-t-elle de la parole ? Sinon elle ne part jamais.
    let aParle = false;
    let debutTranche = 0;
    // Le format que le navigateur a ACCEPTÉ, et l'extension qui part avec lui.
    let format = { mimeType: undefined as string | undefined, extension: 'webm' };

    /** Tout refermer et le DIRE : on ne laisse jamais un micro ouvert pour rien. */
    const renoncer = (message: string) => {
      if (!vivant) return;
      vivant = false;
      cancelAnimationFrame(image);
      analyseurMicro = null;
      donneesMicro = null;
      morceaux = [];
      flux?.getTracks().forEach((piste) => piste.stop());
      flux = null;
      void contexte?.close().catch(() => undefined);
      contexte = null;
      setEtat('refusee');
      setErreur(message);
      client.pushToast('error', message);
    };

    /** Envoyer la tranche au serveur, puis la jeter. Aucun son n'est gardé. */
    const transcrire = async (blob: Blob) => {
      try {
        const reponse = await fetch('/api/transcribe', {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream', 'x-audio-ext': format.extension },
          body: blob,
        });
        const data = await reponse.json();
        if (!vivant) return;
        if (data.ok && data.text) recevoirParoleRef.current(String(data.text));
      } catch {
        // Une tranche perdue n'arrête pas l'écoute : la suivante repart.
      }
    };

    /**
     * Clore la tranche en cours et en ouvrir une neuve. Le morceau part à la
     * transcription seulement si quelqu'un y a parlé.
     */
    const couperLaTranche = (garder: boolean) => {
      const courant = enregistreur;
      if (!courant || courant.state === 'inactive') return;
      const aEnvoyer = garder && aParle;
      courant.onstop = () => {
        const blob = new Blob(morceaux, { type: courant.mimeType || format.mimeType || '' });
        morceaux = [];
        if (aEnvoyer && blob.size > 0) void transcrire(blob);
        if (vivant && flux) ouvrirUneTranche();
      };
      try {
        courant.stop();
      } catch {
        // Un enregistreur déjà tombé : on repart sur une tranche neuve plutôt
        // que de laisser l'écoute muette pour toujours.
        if (vivant && flux) ouvrirUneTranche();
      }
    };

    /**
     * Ouvrir une tranche. Le format imposé est celui que le navigateur a dit
     * accepter ; s'il le refuse quand même, on retente SANS rien imposer, et
     * ce n'est qu'après ce second refus que l'on renonce, en le disant.
     */
    const ouvrirUneTranche = () => {
      if (!flux || !vivant) return;
      let rec: MediaRecorder;
      try {
        rec = format.mimeType
          ? new MediaRecorder(flux, { mimeType: format.mimeType })
          : new MediaRecorder(flux);
      } catch {
        try {
          rec = new MediaRecorder(flux);
          format = { mimeType: undefined, extension: 'webm' };
        } catch {
          renoncer(ENREGISTREMENT_IMPOSSIBLE);
          return;
        }
      }
      // Le navigateur a le dernier mot sur le format : c'est le sien qui nomme
      // le fichier envoyé, jamais celui qu'on avait espéré.
      format = { mimeType: rec.mimeType || format.mimeType, extension: extensionDuType(rec.mimeType || format.mimeType) };
      morceaux = [];
      aParle = false;
      debutTranche = Date.now();
      rec.ondataavailable = (e) => e.data.size && morceaux.push(e.data);
      try {
        rec.start();
      } catch {
        renoncer(ENREGISTREMENT_IMPOSSIBLE);
        return;
      }
      enregistreur = rec;
    };

    const demarrer = async () => {
      // L'enregistreur existe-t-il seulement ? Sur un navigateur trop ancien,
      // inutile d'ouvrir un micro qu'on ne saura pas enregistrer.
      if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        renoncer(ENREGISTREMENT_IMPOSSIBLE);
        return;
      }
      // On demande au navigateur ce qu'il accepte AVANT de lui imposer quoi que
      // ce soit ; aucun format commun = on le laisse choisir lui-même.
      const estAccepte =
        typeof MediaRecorder.isTypeSupported === 'function'
          ? (type: string) => MediaRecorder.isTypeSupported(type)
          : null;
      const choisi = formatDEnregistrement(estAccepte);
      format = { mimeType: choisi.mimeType, extension: choisi.extension };

      try {
        flux = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        if (!vivant) return;
        setEtat('refusee');
        setErreur(REFUS_MICRO);
        client.pushToast('error', REFUS_MICRO);
        return;
      }
      if (!vivant) {
        flux.getTracks().forEach((p) => p.stop());
        return;
      }
      setErreur(null);
      setEtat('guette');

      // Le son du navigateur : c'est lui qui mesure le volume, donc qui sait où
      // finissent les phrases. Refusé, l'écoute n'a plus de sens — on le dit.
      let analyseur: AnalyserNode;
      let temps: Uint8Array;
      try {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) throw new Error('aucun contexte audio');
        contexte = new Ctx();
        const source = contexte.createMediaStreamSource(flux);
        analyseur = contexte.createAnalyser();
        analyseur.fftSize = BINS_MICRO * 2;
        analyseur.smoothingTimeConstant = 0.8;
        source.connect(analyseur);
        // On ne relie PAS l'analyseur à la sortie : on écoute, on ne rejoue rien.
        temps = new Uint8Array(analyseur.fftSize);
      } catch {
        renoncer(SON_INDISPONIBLE);
        return;
      }
      analyseurMicro = analyseur;
      donneesMicro = new Uint8Array(analyseur.frequencyBinCount);

      ouvrirUneTranche();
      if (!vivant) return;

      const boucle = () => {
        if (!vivant) return;
        analyseur.getByteTimeDomainData(temps);
        let pic = 0;
        for (const valeur of temps) pic = Math.max(pic, Math.abs(valeur - 128) / 128);
        const maintenant = Date.now();
        if (pic > SEUIL_PAROLE) {
          aParle = true;
          dernierSonRef.current = maintenant;
          // Quelqu'un reprend la parole : la dictée ne se clôt pas maintenant.
          if (finRef.current) {
            window.clearTimeout(finRef.current);
            finRef.current = null;
          }
        } else if (aParle && maintenant - dernierSonRef.current > SILENCE_FIN_MS) {
          // Silence après une phrase : la tranche est complète, elle part.
          couperLaTranche(true);
        } else if (!aParle && maintenant - debutTranche > TRANCHE_MAX_MS) {
          // Rien n'a été dit depuis longtemps : on repart à neuf sans rien envoyer.
          couperLaTranche(false);
        }
        image = requestAnimationFrame(boucle);
      };
      image = requestAnimationFrame(boucle);
    };

    // Une panne imprévue du son ne doit JAMAIS remonter jusqu'à la page : elle
    // s'affiche dans le module et l'application continue.
    void demarrer().catch(() => renoncer(ENREGISTREMENT_IMPOSSIBLE));

    return () => {
      vivant = false;
      cancelAnimationFrame(image);
      oublierMinuteriesRef.current();
      analyseurMicro = null;
      donneesMicro = null;
      try {
        if (enregistreur && enregistreur.state !== 'inactive') {
          enregistreur.onstop = null;
          enregistreur.stop();
        }
      } catch {
        /* déjà arrêté */
      }
      morceaux = [];
      flux?.getTracks().forEach((piste) => piste.stop());
      void contexte?.close().catch(() => undefined);
    };
    // L'INTERRUPTEUR, et lui seul : tout le reste passe par des références.
  }, [actif]);

  return { etat, dictee, erreur, annuler };
}
