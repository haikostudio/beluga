import * as React from 'react';
import {
  PAUSE_CONVERSATION_MS,
  SEUIL_PAROLE_CONVERSATION,
  type EtatConversation,
} from '@haikodev/shared';
import { client } from './client';
import { ouvrirMicro, type PriseMicro } from './micro';
import { t } from '@/lib/langue';

/**
 * LE MODE CONVERSATION VOCALE, côté navigateur — le micro et sa boucle.
 *
 * À CÔTÉ de l'écoute par mot de réveil (`ecoute.ts`), qui ne bouge pas. Ici, on
 * réutilise le MÊME mécanisme éprouvé que le bouton micro de la barre d'écriture
 * (`recorder.tsx`) : `getUserMedia`, un `MediaRecorder` sans réglage de format
 * particulier, un blob `audio/webm` envoyé à `/api/transcribe`. La seule chose en
 * plus, c'est la DÉCOUPE au silence : on écoute en continu, et dès qu'une phrase
 * dite est suivie d'une pause (`PAUSE_CONVERSATION_MS`), la tranche part.
 *
 * Trois règles :
 *   — rien ne s'ouvre tant que l'interrupteur est éteint ;
 *   — aucun son n'est gardé : la tranche est envoyée puis jetée ;
 *   — REPARLER coupe la parole de l'assistant : au premier son de la voix, on
 *     prévient l'appelant (`onParole`), qui fait taire ce qui joue.
 */

/** Combien de barres l'onde du micro lit à l'analyseur. */
const BINS_MICRO = 128;
/** Une tranche muette ne s'accumule pas : on repart à neuf au bout de ce délai. */
const TRANCHE_MAX_MS = 12_000;

/* ------------------------------------------------------------------ */
/* Ce que le micro entend, pour la ligne d'ondes (bleue)               */
/* ------------------------------------------------------------------ */

let analyseurConversation: AnalyserNode | null = null;
let donneesConversation: Uint8Array | null = null;

/**
 * Les niveaux entendus AU MICRO de conversation à l'instant, un par barre
 * demandée (0 à 1). `null` quand aucun micro n'est ouvert. Jumeau de
 * `lireNiveauxMicro` (écoute par mot de réveil) et de `lireNiveaux` (son joué),
 * mais sur SON propre analyseur : les deux micros ne se marchent pas dessus.
 */
export function lireNiveauxConversation(nombre: number): number[] | null {
  if (!analyseurConversation || !donneesConversation) return null;
  analyseurConversation.getByteFrequencyData(donneesConversation);
  const bins = donneesConversation.length;
  const utile = Math.max(nombre, Math.floor(bins * 0.7));
  const niveaux: number[] = [];
  for (let i = 0; i < nombre; i += 1) {
    const debut = Math.floor((i * utile) / nombre);
    const fin = Math.max(debut + 1, Math.floor(((i + 1) * utile) / nombre));
    let somme = 0;
    for (let j = debut; j < fin; j += 1) somme += donneesConversation[j];
    niveaux.push(Math.min(1, somme / (fin - debut) / 255));
  }
  return niveaux;
}

export interface Conversation {
  /** Où en est le mode : éteint, à l'écoute, ou micro refusé. */
  etat: EtatConversation;
  /** Ce qui empêche d'écouter, en français simple. `null` quand tout va bien. */
  erreur: string | null;
}

export interface OptionsConversation {
  /** Une phrase dite est prête : à router vers l'agent. */
  onTexte: (texte: string) => void;
  /** L'utilisateur se met à parler : couper la parole de l'assistant (barge-in). */
  onParole: () => void;
}

/**
 * Ouvre le micro tant que `actif` est vrai, découpe ce qui est dit au silence,
 * confie chaque tranche à `/api/transcribe`, et rend le texte à `onTexte`. Rien
 * ne démarre tout seul : `actif` vient de l'interrupteur du module de voix,
 * éteint par défaut. L'effet ne dépend QUE de l'interrupteur (`[actif]`) : tout
 * le reste passe par des références, pour ne pas rouvrir le micro à chaque frappe.
 */
export function useConversationVocale(actif: boolean, opts: OptionsConversation): Conversation {
  const [etat, setEtat] = React.useState<EtatConversation>('eteinte');
  const [erreur, setErreur] = React.useState<string | null>(null);

  const onTexteRef = React.useRef(opts.onTexte);
  onTexteRef.current = opts.onTexte;
  const onParoleRef = React.useRef(opts.onParole);
  onParoleRef.current = opts.onParole;

  React.useEffect(() => {
    if (!actif) {
      setEtat('eteinte');
      setErreur(null);
      return;
    }

    let vivant = true;
    // LA PRISE de micro : ouverte par la porte unique (`lib/micro.ts`), elle
    // referme le flux ET le contexte audio qui l'écoute, d'un seul geste.
    let prise: PriseMicro | null = null;
    let flux: MediaStream | null = null;
    let enregistreur: MediaRecorder | null = null;
    let image = 0;
    let morceaux: Blob[] = [];
    // Cette tranche porte-t-elle de la parole ? Sinon elle ne part jamais.
    let aParle = false;
    let debutTranche = 0;
    let dernierSon = 0;
    // Est-on DÉJÀ en train d'entendre la voix ? Sert au barge-in : on ne coupe la
    // parole de l'assistant qu'au PREMIER son, pas à chaque image.
    let enParole = false;

    const renoncer = (message: string) => {
      if (!vivant) return;
      vivant = false;
      cancelAnimationFrame(image);
      analyseurConversation = null;
      donneesConversation = null;
      morceaux = [];
      prise?.fermer();
      prise = null;
      flux = null;
      setEtat('refusee');
      setErreur(message);
      client.pushToast('error', message);
    };

    /** Envoyer la tranche au serveur, puis la jeter. Aucun son n'est gardé. */
    const transcrire = async (blob: Blob) => {
      try {
        const reponse = await fetch('/api/transcribe', {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream', 'x-audio-ext': 'webm' },
          body: blob,
        });
        const data = (await reponse.json().catch(() => ({}))) as {
          ok?: boolean;
          text?: string;
          error?: string;
        };
        if (!vivant) return;
        if (reponse.ok && data.ok && data.text) onTexteRef.current(String(data.text));
      } catch {
        // Le serveur n'a pas répondu : la tranche suivante repartira. L'écoute
        // continue, on ne casse rien.
      }
    };

    /** Clore la tranche en cours et en ouvrir une neuve. */
    const couperLaTranche = (garder: boolean) => {
      const courant = enregistreur;
      if (!courant || courant.state === 'inactive') return;
      const aEnvoyer = garder && aParle;
      courant.onstop = () => {
        const blob = new Blob(morceaux, { type: courant.mimeType || 'audio/webm' });
        morceaux = [];
        if (aEnvoyer && blob.size > 0) void transcrire(blob);
        if (vivant && flux) ouvrirUneTranche();
      };
      try {
        courant.stop();
      } catch {
        if (vivant && flux) ouvrirUneTranche();
      }
    };

    /** Ouvrir une tranche, comme le bouton micro de la barre : sans réglage. */
    const ouvrirUneTranche = () => {
      if (!flux || !vivant) return;
      let rec: MediaRecorder;
      try {
        rec = new MediaRecorder(flux);
      } catch {
        renoncer("L’enregistrement audio n’est pas disponible dans ce navigateur.");
        return;
      }
      morceaux = [];
      aParle = false;
      debutTranche = Date.now();
      rec.ondataavailable = (e) => e.data.size && morceaux.push(e.data);
      try {
        rec.start();
      } catch {
        renoncer("L’enregistrement audio n’est pas disponible dans ce navigateur.");
        return;
      }
      enregistreur = rec;
    };

    const demarrer = async () => {
      if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        renoncer("L’enregistrement audio n’est pas disponible dans ce navigateur.");
        return;
      }
      try {
        prise = await ouvrirMicro('conversation vocale');
        flux = prise.flux;
      } catch {
        if (!vivant) return;
        setEtat('refusee');
        setErreur('Micro refusé — cliquer pour réessayer.');
        client.pushToast('error', t('Micro refusé — la conversation vocale ne peut pas écouter.'));
        return;
      }
      // L'interrupteur s'est éteint pendant que le micro s'ouvrait : on le rend.
      if (!vivant) {
        prise.fermer();
        prise = null;
        flux = null;
        return;
      }
      setErreur(null);
      setEtat('ecoute');

      let analyseur: AnalyserNode;
      let temps: Uint8Array;
      try {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) throw new Error('aucun contexte audio');
        const contexte = new Ctx();
        const source = contexte.createMediaStreamSource(flux);
        // Le contexte est confié à la PRISE : il se fermera avec le micro.
        prise.brancher(contexte, source);
        analyseur = contexte.createAnalyser();
        analyseur.fftSize = BINS_MICRO * 2;
        analyseur.smoothingTimeConstant = 0.8;
        source.connect(analyseur);
        temps = new Uint8Array(analyseur.fftSize);
      } catch {
        renoncer('Le son n’est pas disponible dans ce navigateur.');
        return;
      }
      analyseurConversation = analyseur;
      donneesConversation = new Uint8Array(analyseur.frequencyBinCount);

      ouvrirUneTranche();
      if (!vivant) return;

      const boucle = () => {
        if (!vivant) return;
        analyseur.getByteTimeDomainData(temps);
        let pic = 0;
        for (const valeur of temps) pic = Math.max(pic, Math.abs(valeur - 128) / 128);
        const maintenant = Date.now();
        if (pic > SEUIL_PAROLE_CONVERSATION) {
          // Le PREMIER son de la voix coupe la parole de l'assistant : on ne
          // parle pas par-dessus qui nous répond.
          if (!enParole) {
            enParole = true;
            onParoleRef.current();
          }
          aParle = true;
          dernierSon = maintenant;
        } else {
          enParole = false;
          if (aParle && maintenant - dernierSon > PAUSE_CONVERSATION_MS) {
            couperLaTranche(true);
          } else if (!aParle && maintenant - debutTranche > TRANCHE_MAX_MS) {
            couperLaTranche(false);
          }
        }
        image = requestAnimationFrame(boucle);
      };
      image = requestAnimationFrame(boucle);
    };

    void demarrer().catch(() =>
      renoncer("L’enregistrement audio n’est pas disponible dans ce navigateur."),
    );

    return () => {
      vivant = false;
      cancelAnimationFrame(image);
      analyseurConversation = null;
      donneesConversation = null;
      try {
        if (enregistreur && enregistreur.state !== 'inactive') {
          enregistreur.onstop = null;
          enregistreur.stop();
        }
      } catch {
        /* déjà arrêté */
      }
      morceaux = [];
      // La prise referme tout : les pistes du flux ET le contexte audio.
      prise?.fermer();
      prise = null;
      flux = null;
    };
  }, [actif]);

  return { etat, erreur };
}
