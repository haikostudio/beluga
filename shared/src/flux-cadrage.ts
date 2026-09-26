/**
 * LE LECTEUR DE L'HISTOIRE DU CADRAGE.
 *
 * Le parcours d'une carte ne se DÉDUIT plus du texte de ses messages : il vit
 * sur la carte (`shared/src/parcours-carte.ts`), écrit par les outils
 * `rendre_comprehension` et `rendre_plan`. Ce fichier portait la timeline en
 * huit temps, le découpage des réponses par étape et la reconnaissance du plan
 * à ses quatre titres ; tout cela a disparu avec le déroulé qu'il dessinait.
 *
 * Ce qui reste sert à LIRE ce qui a été écrit AVANT : les conversations où le
 * plan était rendu en clair, en markdown, à la fin d'une réponse. Ces
 * cartes-là existent encore, et leur fil doit rester lisible — jamais une
 * consigne, seulement un lecteur.
 *
 * Ni base, ni disque, ni moteur : tout se rejoue seul.
 */

import { PARTIES_DU_PLAN, jugerLePlan } from './plan-complet.js';
import { blocDesTachesOuvertPar } from './plan-gabarit.js';

/* ------------------------------------------------------------------ */
/* 1. LE CARROUSEL DES QUESTIONS                                       */
/* ------------------------------------------------------------------ */

/**
 * Quelle question montrer, quand plusieurs attendent. On avance sur la
 * PREMIÈRE sans réponse : répondre à l'une fait glisser sur la suivante, sans
 * clic. Quand toutes ont répondu, on reste sur la dernière plutôt que de
 * sauter dans le vide.
 */
export function questionAMontrer(etat: { repondues: boolean[]; choisie?: number }): number {
  const total = etat.repondues.length;
  if (total === 0) return 0;
  if (typeof etat.choisie === 'number' && etat.choisie >= 0 && etat.choisie < total) return etat.choisie;
  const premiere = etat.repondues.findIndex((r) => !r);
  return premiere === -1 ? total - 1 : premiere;
}

/* ------------------------------------------------------------------ */
/* 2. LE PLAN D'AVANT, RECONNU À SON TEXTE                              */
/* ------------------------------------------------------------------ */

/** Le minimum dont cette règle a besoin d'un message pour le juger. */
export interface MessageDePlanDeCadrage {
  role?: string;
  content?: string;
  /** Tant que le tour écrit, le texte n'est pas jugé : il n'est pas fini. */
  streaming?: boolean;
  /** Le drapeau posé par le démon quand la bascule « Plan » est allumée. */
  plan?: boolean;
}

/**
 * Ce message porte-t-il un plan écrit EN CLAIR ? Une réponse d'agent, finie,
 * dont le texte annonce les quatre parties — ou déjà marquée par le mode plan.
 * C'est ainsi que les cartes cadrées avant `rendre_plan` gardent leur plan
 * lisible dans le fil ; aucun geste n'en dépend plus.
 */
export function planDeCadrageRendu(message: MessageDePlanDeCadrage): boolean {
  if (message.role !== 'assistant' || message.streaming) return false;
  const texte = (message.content ?? '').trim();
  if (!texte) return false;
  return message.plan === true || jugerLePlan(texte).complet;
}

/**
 * LE PLAN NE DÉBORDE PAS SUR CE QUI LE PRÉCÈDE.
 *
 * Une réponse d'avant portait la discussion ET le plan. Cette règle coupe le
 * texte à l'endroit exact où le plan commence — le titre « # … » et sa phrase
 * en italique compris — pour que la discussion se lise sans le plan, et le
 * plan sans la discussion.
 *
 * Un texte sans plan rend tout dans `avant`, et `plan` vide.
 */
export function decouperAvantLePlan(texte: string): { avant: string; plan: string } {
  const lignes = (texte ?? '').split(/\r?\n/);
  const premiere = PARTIES_DU_PLAN[0];
  let debut = -1;
  for (let i = 0; i < lignes.length; i += 1) {
    const nu = lignes[i].trim();
    if (!/^#{1,6}\s/.test(nu)) continue;
    const sansDiese = nu
      .replace(/^#{1,6}\s*/, '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    if (premiere.intitules.some((intitule) => sansDiese === intitule)) {
      debut = i;
      break;
    }
  }
  if (debut < 0) return { avant: (texte ?? '').trim(), plan: '' };

  /* Le plan commence à son TITRE, pas à « ## Faisabilité » : on remonte sur le
     BLOC DES TÂCHES — le premier bloc du plan — ou sur la phrase en italique
     des plans d'avant, puis sur le « # … » qui les coiffe, en traversant les
     lignes vides. */
  let tete = debut;
  let remonte = debut - 1;
  let italiqueVue = false;
  let tachesVues = false;
  while (remonte >= 0) {
    const nu = lignes[remonte].trim();
    if (!nu) {
      remonte -= 1;
      continue;
    }
    if (/^#\s/.test(nu)) {
      tete = remonte;
      break;
    }
    if (!tachesVues && blocDesTachesOuvertPar(nu)) {
      tachesVues = true;
      tete = remonte;
      remonte -= 1;
      continue;
    }
    /* TANT QUE LE BLOC DES TÂCHES N'EST PAS ATTEINT, ses lignes se traversent :
       ce sont les tâches elles-mêmes, elles appartiennent au plan. */
    if (!tachesVues && lignes.slice(0, remonte).some((l) => blocDesTachesOuvertPar(l.trim()))) {
      remonte -= 1;
      continue;
    }
    if (!italiqueVue && /^[_*].+[_*]$/.test(nu)) {
      italiqueVue = true;
      tete = remonte;
      remonte -= 1;
      continue;
    }
    break;
  }
  return {
    avant: lignes.slice(0, tete).join('\n').trim(),
    plan: lignes.slice(tete).join('\n').trim(),
  };
}
