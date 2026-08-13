/**
 * RELANCER LE MOTEUR APRÈS UNE PANNE DU FOURNISSEUR — sans jamais repartir de zéro.
 *
 * Le tour lance le moteur, attend, et regarde comment il s'est arrêté. Si c'est
 * une panne PASSAGÈRE du fournisseur (erreur 500, moteur surchargé, lien coupé —
 * `shared/src/panne-passagere.ts`), on attend, puis on relance le MÊME fil, avec
 * une consigne qui dit de continuer là où il s'était arrêté. Trois nouveaux
 * essais au plus, attente croissante.
 *
 * Tout ce qui touche à la base, aux messages et aux étapes reste dans le démon :
 * ce fichier ne fait qu'ORCHESTRER, avec une attente injectable — c'est ce qui
 * rend la boucle rejouable dans un contrôle sans attendre une minute.
 */
import {
  ESSAIS_MAX,
  MotifDePanne,
  attenteAvantNouvelEssai,
  motifDePannePassagere,
} from '@haikodev/shared';

/** Ce que rend un moteur qui s'est arrêté. */
export interface ResultatDeTour {
  ok: boolean;
  error?: string;
}

/** L'état du tour tel que le démon le voit à l'instant où le moteur rend la main. */
export interface EtatDuTour {
  /** L'erreur vue PENDANT le tour (événement du moteur), remise à zéro à chaque essai. */
  erreur?: string;
  /** Le texte écrit jusqu'ici : c'est là qu'apparaît la bannière du fournisseur. */
  texte?: string;
  /** Un arrêt demandé à la main ferme la porte : on ne relance jamais par-dessus. */
  arretDemande?: boolean;
  /** Un arrêt de quota garde sa propre route (« avec quel compte poursuivre ? »). */
  limiteQuota?: boolean;
}

export interface OptionsDeRelance {
  /**
   * Lance le moteur et rend sa poignée. `essai` vaut 0 au premier départ, puis
   * 1, 2, 3 pour les relances ; `motif` dit pourquoi on relance (rien au départ).
   */
  lancer: (essai: number, motif: MotifDePanne | null) => { finished: Promise<ResultatDeTour> };
  etat: () => EtatDuTour;
  /** Juste avant d'attendre : c'est là que le démon pose l'étape visible. */
  avantNouvelEssai?: (info: { essai: number; motif: MotifDePanne; attenteMs: number }) => void;
  /** Juste après qu'un nouvel essai a rendu la main. */
  apresNouvelEssai?: (info: { essai: number; motif: MotifDePanne; ok: boolean }) => void;
  /** L'attente réelle. Remplacée dans les contrôles pour ne pas attendre pour de vrai. */
  attendre?: (ms: number) => Promise<void>;
  /** Le nombre de NOUVEAUX essais autorisés. Borné par défaut à `ESSAIS_MAX`. */
  essaisMax?: number;
}

export interface Relance {
  /** Le résultat du DERNIER essai : c'est lui qui fait foi pour la suite du tour. */
  result: ResultatDeTour;
  /** Combien de nouveaux essais ont été tentés (0 = le moteur n'a pas eu à repartir). */
  essais: number;
  /**
   * La panne qui reste après tous les essais, ou `null` quand il n'y en a plus.
   * Renseignée, le tour est INTERROMPU par le fournisseur — pas raté par l'agent.
   */
  panne: MotifDePanne | null;
}

const attenteReelle = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function lancerAvecRelances(options: OptionsDeRelance): Promise<Relance> {
  const essaisMax = Math.max(0, options.essaisMax ?? ESSAIS_MAX);
  const attendre = options.attendre ?? attenteReelle;

  let essais = 0;
  let result = await options.lancer(0, null).finished;

  for (;;) {
    const etat = options.etat();
    const motif = motifDePannePassagere({
      ok: result.ok && !etat.erreur,
      arretDemande: etat.arretDemande,
      limiteQuota: etat.limiteQuota,
      erreur: etat.erreur ?? result.error,
      texte: etat.texte,
    });
    // Plus de panne : le tour est allé au bout, ou il est tombé pour une autre
    // raison — un échec ordinaire, qui se dit comme tel.
    if (!motif) return { result, essais, panne: null };
    if (essais >= essaisMax) return { result, essais, panne: motif };

    essais += 1;
    const attenteMs = attenteAvantNouvelEssai(essais);
    options.avantNouvelEssai?.({ essai: essais, motif, attenteMs });
    await attendre(attenteMs);
    // L'attente est longue : l'utilisateur a pu arrêter la carte entre-temps.
    if (options.etat().arretDemande) return { result, essais: essais - 1, panne: motif };

    result = await options.lancer(essais, motif).finished;
    options.apresNouvelEssai?.({
      essai: essais,
      motif,
      ok: result.ok && !options.etat().erreur,
    });
  }
}
