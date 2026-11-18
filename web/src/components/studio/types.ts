import type { CopieAlphaDApercu } from '@beluga/shared';
import type { ModelesChoisis, NoteDuStudio, Composition, Creation, DepenseStudio, EspaceStudio, ExportStudio, FormatStudio, MediaStudio, TimbreVoix } from '@beluga/shared';

/** Ce que rend `studio.creation.ouvrir` : tout ce que l'éditeur affiche, en une lecture. */
export interface DonneesCreation {
  creation: Creation;
  composition: Composition;
  projet: string;
  annulerRetablir: { annuler: boolean; retablir: boolean };
  medias: MediaStudio[];
  adressesMedias: Record<string, { url: string; genre: string; copieAlpha?: CopieAlphaDApercu }>;
  /** Fichier détouré → son original, et s'il a été remis. */
  fondsRetires?: Record<string, { original: string; remis: boolean }>;
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
  /** Le modèle retenu par type de fabrication (voix, musique, image, vidéo). */
  modelesChoisis?: ModelesChoisis;
  /** La tête de lecture laissée la dernière fois (`studio.selection`) : l'aperçu s'y rouvre. */
  curseurRetenu?: number;
  /** Les notes posées sur l'image. */
  notes?: NoteDuStudio[];
  /** Les versions nommées : numéro → nom. */
  jalons?: Record<number, string>;
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
  /** La clé du fournisseur de la voix est branchée (sans elle, la voix finale ne peut pas partir). */
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
  /** Le timbre publié par Google (voix Gemini) ; absent pour une voix ElevenLabs. */
  timbre?: TimbreVoix;
  /** Une voix ElevenLabs, fabriquée par kie.ai (31/10/2026). */
  fournisseur?: 'elevenlabs';
}
