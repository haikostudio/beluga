import { extensionDuType } from '@beluga/shared';

/**
 * CE QUE LES DEUX MICROS PARTAGENT — l'écoute par mot de réveil (`ecoute.ts`)
 * et la conversation vocale (`conversation-vocale.ts`).
 *
 * Chaque hook garde son analyseur, son état React et ses propres réglages (seuil
 * de parole, silence qui clôt une phrase, négociation ou non du format) : seule
 * la PLOMBERIE — lire les niveaux d'un analyseur, découper ce qui est dit en
 * tranches `MediaRecorder`, les envoyer à `/api/transcribe` — vit ici.
 */

/** Combien de barres l'onde du micro lit à l'analyseur. */
export const BINS_MICRO = 128;

/**
 * Une tranche silencieuse ne dure jamais plus longtemps : l'enregistreur repart
 * à neuf, pour qu'un micro laissé ouvert toute la journée n'accumule rien.
 */
export const TRANCHE_MAX_MS = 12_000;

/**
 * Les niveaux entendus À UN ANALYSEUR à l'instant, un par barre demandée (0 à
 * 1). `null` quand aucun micro n'est ouvert — la ligne d'ondes retombe alors sur
 * son animation régulière.
 */
export function lireNiveaux(
  analyseur: AnalyserNode | null,
  donnees: Uint8Array | null,
  nombre: number,
): number[] | null {
  if (!analyseur || !donnees) return null;
  analyseur.getByteFrequencyData(donnees);
  const bins = donnees.length;
  const utile = Math.max(nombre, Math.floor(bins * 0.7));
  const niveaux: number[] = [];
  for (let i = 0; i < nombre; i += 1) {
    const debut = Math.floor((i * utile) / nombre);
    const fin = Math.max(debut + 1, Math.floor(((i + 1) * utile) / nombre));
    let somme = 0;
    for (let j = debut; j < fin; j += 1) somme += donnees[j];
    niveaux.push(Math.min(1, somme / (fin - debut) / 255));
  }
  return niveaux;
}

/** L'enregistreur existe-t-il seulement ? Sur un navigateur trop ancien, inutile d'ouvrir un micro qu'on ne saura pas enregistrer. */
export function enregistreurDisponible(): boolean {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/** Le format d'une tranche : celui négocié au navigateur, ou un repli fixe. */
export interface EtatFormat {
  mimeType?: string;
  extension: string;
}

/** L'état d'une tranche en cours, partagé entre `ouvrirUneTranche` et `couperLaTranche`. */
export interface BoiteTranche {
  format: EtatFormat;
  enregistreur: MediaRecorder | null;
  morceaux: Blob[];
  aParle: boolean;
  debutTranche: number;
}

export function nouvelleBoiteTranche(format: EtatFormat): BoiteTranche {
  return { format, enregistreur: null, morceaux: [], aParle: false, debutTranche: 0 };
}

export interface DecoupeMicroOptions {
  /** Le flux à enregistrer, lu à l'instant de chaque tranche (pas figé à la création). */
  flux: () => MediaStream | null;
  /** Le module tourne-t-il encore ? */
  vivant: () => boolean;
  /**
   * Le navigateur a-t-il le dernier mot ? `true` : on retente SANS rien imposer
   * au premier refus, et l'extension suit le format réellement accepté (comme
   * l'écoute par mot de réveil). `false` : un seul essai, sans aucun réglage
   * imposé (comme le bouton micro de la barre et la conversation vocale).
   */
  negocierFormat: boolean;
  /** Le micro n'a décidément pas pu s'ouvrir : à dire, puis abandonner. */
  onImpossible: (message: string) => void;
  messageImpossible: string;
  /** Une tranche complète est revenue transcrite. */
  onTexte: (texte: string) => void;
  /**
   * La transcription a échoué. `null` : le serveur n'a pas répondu du tout.
   * Sinon : la réponse était en erreur, avec le message du serveur s'il y en a
   * un, et son code sinon.
   */
  onEchecTranscription?: (echec: { erreur?: string; status: number } | null) => void;
  /** Une transcription vient de réussir, après un échec précédent. */
  onTranscriptionReussie?: () => void;
  /** Le type par défaut du blob envoyé quand ni l'enregistreur ni le format négocié n'en donnent un. */
  mimeTypeParDefaut?: string;
}

/** La découpe en tranches : ouverture, arrêt, envoi à la transcription. */
export function creerDecoupeMicro(boite: BoiteTranche, opts: DecoupeMicroOptions) {
  /** Envoyer la tranche au serveur, puis la jeter. Aucun son n'est gardé. */
  const transcrire = async (blob: Blob) => {
    try {
      const reponse = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'x-audio-ext': boite.format.extension },
        body: blob,
      });
      const data = await reponse.json().catch(() => ({}) as { ok?: boolean; text?: string; error?: string });
      if (!opts.vivant()) return;
      if (!reponse.ok || !data.ok) {
        opts.onEchecTranscription?.({ erreur: data.error, status: reponse.status });
        return;
      }
      opts.onTranscriptionReussie?.();
      if (data.text) opts.onTexte(String(data.text));
    } catch {
      // Le serveur n'a pas répondu du tout : l'écoute continue (la tranche
      // suivante repart), mais on ne laisse pas croire qu'elle comprend.
      opts.onEchecTranscription?.(null);
    }
  };

  /**
   * Ouvrir une tranche. Sans négociation : un seul essai, sans rien imposer.
   * Avec négociation : le format imposé est celui que le navigateur a dit
   * accepter ; s'il le refuse quand même, on retente SANS rien imposer, et ce
   * n'est qu'après ce second refus que l'on renonce, en le disant.
   */
  const ouvrirUneTranche = () => {
    const flux = opts.flux();
    if (!flux || !opts.vivant()) return;
    let rec: MediaRecorder;
    try {
      rec = boite.format.mimeType
        ? new MediaRecorder(flux, { mimeType: boite.format.mimeType })
        : new MediaRecorder(flux);
    } catch {
      if (!opts.negocierFormat) {
        opts.onImpossible(opts.messageImpossible);
        return;
      }
      try {
        rec = new MediaRecorder(flux);
        boite.format = { mimeType: undefined, extension: 'webm' };
      } catch {
        opts.onImpossible(opts.messageImpossible);
        return;
      }
    }
    if (opts.negocierFormat) {
      // Le navigateur a le dernier mot sur le format : c'est le sien qui nomme
      // le fichier envoyé, jamais celui qu'on avait espéré.
      boite.format = {
        mimeType: rec.mimeType || boite.format.mimeType,
        extension: extensionDuType(rec.mimeType || boite.format.mimeType),
      };
    }
    boite.morceaux = [];
    boite.aParle = false;
    boite.debutTranche = Date.now();
    rec.ondataavailable = (e) => e.data.size && boite.morceaux.push(e.data);
    try {
      rec.start();
    } catch {
      opts.onImpossible(opts.messageImpossible);
      return;
    }
    boite.enregistreur = rec;
  };

  /**
   * Clore la tranche en cours et en ouvrir une neuve. Le morceau part à la
   * transcription seulement si quelqu'un y a parlé.
   */
  const couperLaTranche = (garder: boolean) => {
    const courant = boite.enregistreur;
    if (!courant || courant.state === 'inactive') return;
    const aEnvoyer = garder && boite.aParle;
    courant.onstop = () => {
      const blob = new Blob(boite.morceaux, {
        type: courant.mimeType || boite.format.mimeType || opts.mimeTypeParDefaut || '',
      });
      boite.morceaux = [];
      if (aEnvoyer && blob.size > 0) void transcrire(blob);
      if (opts.vivant() && opts.flux()) ouvrirUneTranche();
    };
    try {
      courant.stop();
    } catch {
      // Un enregistreur déjà tombé : on repart sur une tranche neuve plutôt
      // que de laisser l'écoute muette pour toujours.
      if (opts.vivant() && opts.flux()) ouvrirUneTranche();
    }
  };

  return { ouvrirUneTranche, couperLaTranche };
}
