/**
 * Les réglages d'agent portés par une carte PROPOSÉE dans la conversation.
 *
 * Le chef d'orchestre propose une carte pendant une conversation qui tourne,
 * elle, sur un moteur et un modèle précis. Sans réglage recopié, la carte
 * repartait sur le moteur par défaut du projet : on discutait avec Codex et on
 * se voyait proposer du Claude.
 *
 * La règle est ici, pure et rejouable : elle prend le SOUHAIT (ce qui est
 * sélectionné dans la barre d'écriture) et le CATALOGUE RÉEL des moteurs, et
 * rend un réglage entier, toujours cohérent — jamais un modèle emprunté à un
 * autre moteur.
 */

export type IdMoteur = 'claude' | 'codex';

export interface ModeleCatalogue {
  id: string;
  /** Niveaux de réflexion réellement proposés par CE modèle. */
  thinking: { id: string }[];
  defaultThinking?: string;
}

export interface MoteurCatalogue {
  id: IdMoteur;
  label: string;
  installed: boolean;
  models: ModeleCatalogue[];
  defaultModel?: string;
  /** Comptes de ce moteur utilisables tout de suite (quota non épuisé). */
  comptesDisponibles: number;
}

export interface SouhaitReglages {
  engine?: string;
  model?: string;
  thinking?: string;
}

export interface ReglagesProposition {
  engine: IdMoteur;
  model?: string;
  thinking: string;
  /**
   * Ce qui empêche ce réglage de partir tel quel, écrit en toutes lettres sur
   * la proposition. Vide quand tout va bien : on ne bascule jamais en silence.
   */
  avertissement?: string;
}

/** Le modèle retenu appartient TOUJOURS au moteur retenu. */
function modeleDuMoteur(moteur: MoteurCatalogue | undefined, souhaite: string | undefined): string | undefined {
  if (!moteur || !moteur.models.length) return undefined;
  if (souhaite && moteur.models.some((m) => m.id === souhaite)) return souhaite;
  const parDefaut = moteur.models.find((m) => m.id === moteur.defaultModel);
  return (parDefaut ?? moteur.models[0]).id;
}

/** Le niveau retenu doit exister pour le modèle retenu. */
function niveauDuModele(moteur: MoteurCatalogue | undefined, modele: string | undefined, souhaite: string | undefined): string {
  const info = moteur?.models.find((m) => m.id === modele);
  const niveaux = info?.thinking.map((t) => t.id) ?? [];
  if (!niveaux.length) return 'none';
  if (souhaite && niveaux.includes(souhaite)) return souhaite;
  if (info?.defaultThinking && niveaux.includes(info.defaultThinking)) return info.defaultThinking;
  return niveaux[0];
}

/**
 * Le réglage à poser sur une carte proposée.
 *
 * Trois principes, dans cet ordre :
 * 1. on suit le souhait de la conversation tant qu'il est réalisable ;
 * 2. le modèle vient TOUJOURS du catalogue du moteur retenu ;
 * 3. un obstacle (moteur absent, aucun compte) se DIT au lieu de se contourner.
 */
export function reglagesDeLaProposition(
  souhait: SouhaitReglages | undefined,
  catalogue: MoteurCatalogue[],
): ReglagesProposition | undefined {
  const installes = catalogue.filter((m) => m.installed);
  if (!installes.length) return undefined;

  const voulu = installes.find((m) => m.id === souhait?.engine);
  const absent = !!souhait?.engine && !voulu;
  const moteur = voulu ?? installes[0];

  // Le modèle souhaité ne vaut que s'il vient du moteur retenu : un identifiant
  // recopié d'un autre moteur est jeté, pas traîné.
  const memeMoteur = !absent;
  const model = modeleDuMoteur(moteur, memeMoteur ? souhait?.model : undefined);
  const thinking = niveauDuModele(moteur, model, memeMoteur ? souhait?.thinking : undefined);

  const avertissements: string[] = [];
  if (absent) {
    const nom = catalogue.find((m) => m.id === souhait?.engine)?.label ?? souhait?.engine;
    avertissements.push(`Le moteur ${nom} n'est pas installé : la carte partira sur ${moteur.label}.`);
  }
  if (moteur.comptesDisponibles <= 0) {
    avertissements.push(`Aucun compte disponible pour ${moteur.label} : la carte attendra qu'un compte se libère.`);
  }

  return {
    engine: moteur.id,
    model,
    thinking,
    ...(avertissements.length ? { avertissement: avertissements.join(' ') } : {}),
  };
}
