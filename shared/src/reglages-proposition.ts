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
 *
 * Depuis que le chef d'orchestre tourne sur un modèle économe, le MODÈLE de la
 * conversation ne se recopie plus tel quel : un chef qui trie sur un petit
 * modèle ferait exécuter toutes les cartes sur ce petit modèle. Le chef annonce
 * donc un NIVEAU (`niveau-agent.ts`), et c'est lui qui décide du modèle et de la
 * réflexion. Le MOTEUR, lui, reste celui de la conversation : discuter avec
 * Codex et se voir proposer du Claude n'a toujours aucun sens.
 */

import { reglagesDuNiveau, type NiveauAgent } from './niveau-agent.js';

export type IdMoteur = 'claude' | 'codex' | 'cursor';

export interface ModeleCatalogue {
  id: string;
  /** Le nom affiché par le moteur : sert à reconnaître une famille de modèles. */
  label?: string;
  /** Niveaux de réflexion réellement proposés par CE modèle. */
  thinking: { id: string }[];
  defaultThinking?: string;
  /** L'appétit en quota, tel que le catalogue le classe (voir `niveau-agent.ts`). */
  appetite?: 'light' | 'medium' | 'heavy';
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

/**
 * Ce que le chef d'orchestre demande pour la carte : un NIVEAU, jamais un
 * modèle. Le moteur, lui, reste celui de la conversation.
 */
export interface SouhaitNiveau {
  niveau?: NiveauAgent;
}

export interface ReglagesProposition {
  engine: IdMoteur;
  model?: string;
  thinking: string;
  /** Le palier demandé par le chef, retenu sur la carte pour être relu. */
  niveau?: NiveauAgent;
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
 * Quatre principes, dans cet ordre :
 * 1. le MOTEUR suit la conversation tant qu'il est réalisable ;
 * 2. le NIVEAU annoncé par le chef décide du modèle et de la réflexion ; sans
 *    niveau, on retombe sur le souhait de la conversation ;
 * 3. le modèle vient TOUJOURS du catalogue du moteur retenu ;
 * 4. un obstacle (moteur absent, aucun compte) se DIT au lieu de se contourner.
 */
export function reglagesDeLaProposition(
  souhait: (SouhaitReglages & SouhaitNiveau) | undefined,
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
  const duNiveau = souhait?.niveau ? reglagesDuNiveau(moteur, souhait.niveau) : undefined;
  const model = duNiveau
    ? duNiveau.model
    : modeleDuMoteur(moteur, memeMoteur ? souhait?.model : undefined);
  const thinking = duNiveau
    ? duNiveau.thinking
    : niveauDuModele(moteur, model, memeMoteur ? souhait?.thinking : undefined);

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
    ...(souhait?.niveau ? { niveau: souhait.niveau } : {}),
    ...(avertissements.length ? { avertissement: avertissements.join(' ') } : {}),
  };
}
