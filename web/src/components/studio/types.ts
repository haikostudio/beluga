import type { Composition, Creation, DepenseStudio, EspaceStudio, ExportStudio, FormatStudio, MediaStudio, TimbreVoix } from '@beluga/shared';

/** Ce que rend `studio.creation.ouvrir` : tout ce que l'éditeur affiche, en une lecture. */
export interface DonneesCreation {
  creation: Creation;
  composition: Composition;
  projet: string;
  annulerRetablir: { annuler: boolean; retablir: boolean };
  medias: MediaStudio[];
  adressesMedias: Record<string, { url: string; genre: string }>;
  exports: ExportStudio[];
  depenses: DepenseStudio[];
  depenseTotale: number;
  espace: EspaceStudio;
  voixEssai: { id: string; label: string }[];
  /** Les vingt voix finales du Studio. */
  voixFinales: VoixFinale[];
  voixEnEssai: number;
  rendu: { pret: boolean };
  /** Le modèle de cette création, s'il a été validé. */
  modele: { id: string; version: number; majLe: number } | null;
  /** Les modèles du projet (bibliothèque). */
  modeles: ResumeModele[];
  /** Les projets vers lesquels un modèle peut être copié. */
  projets: { id: string; name: string }[];
}

/** Ce que l'écran montre d'un modèle. */
export interface ResumeModele {
  id: string;
  projectId: string;
  creationId?: string;
  origineId?: string;
  titre: string;
  formats: FormatStudio[];
  version: number;
  afficheId?: string;
  duree: number;
  scenes: number;
  creeLe: number;
  majLe: number;
}

export interface DevisDeVoix {
  segments: { id: string; texte: string; voix: string }[];
  secondes: number;
  plafond: number;
  modele: string;
  /** La clé OpenRouter de Beluga Build est au coffre-fort (sans elle, la voix finale ne peut pas partir). */
  cle: boolean;
  solde: number | null;
}

export interface LigneCreation extends Creation {
  projet: string;
  duree: number;
  voixEnEssai: number;
}

export interface VoixFinale {
  id: string;
  label: string;
  genre: 'femme' | 'homme';
  timbre: TimbreVoix;
}
