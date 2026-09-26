/**
 * OÙ VIVENT LES COPIES DE TRAVAIL DES CARTES D'UN PROJET.
 *
 * La règle pure (`choisirLaRacineDesCopies`, `shared/src/dossier-de-carte.ts`)
 * dit : sur le disque local quand le dépôt est servi par le réseau, dans
 * `<projet>/.worktrees` sinon. Ici on lit ce que la règle demande —
 * `/proc/mounts`, le dossier local — et on garde la réponse par projet : les
 * montages ne changent pas en cours de route.
 *
 * Le dossier local est `<dépôt principal du démon>/data/copies` (ignoré par git,
 * sur le disque de la machine), `BELUGA_DATA/copies` dans un bac à sable de
 * test, ou `BELUGA_COPIES` posé à la main. `BELUGA_COPIES_LOCALES=1` force le
 * déménagement même pour un dépôt local : c'est ce qui permet aux tests de le
 * rejouer sans stockage distant.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  DOSSIER_DES_CARTES,
  cheminDossierDeCarte,
  choisirLaRacineDesCopies,
  lireLesMontages,
  typeDuSystemeDeFichiers,
  type MontageDuSysteme,
} from '@beluga/shared';
import { CONFIG } from './config.js';

function dossierLocalDesCopies(): string {
  const impose = process.env.BELUGA_COPIES?.trim();
  if (impose) return impose;
  const bacASable = process.env.BELUGA_DATA?.trim();
  if (bacASable) return path.join(bacASable, 'copies');
  return path.join(CONFIG.depotDuDemon, 'data', 'copies');
}

function montages(): MontageDuSysteme[] {
  try {
    return lireLesMontages(fs.readFileSync('/proc/mounts', 'utf8'));
  } catch {
    return [];
  }
}

function reel(chemin: string): string {
  try {
    return fs.realpathSync(chemin);
  } catch {
    return path.resolve(chemin);
  }
}

const connues = new Map<string, string>();

/** Le dossier où naissent les copies de ce projet (gardé en mémoire par projet). */
export function racineDesCopiesDuProjet(racine: string): string {
  const cle = `${path.resolve(racine)}|${process.env.BELUGA_COPIES ?? ''}|${process.env.BELUGA_COPIES_LOCALES ?? ''}|${process.env.BELUGA_DATA ?? ''}`;
  const deja = connues.get(cle);
  if (deja) return deja;
  const liste = montages();
  const local = dossierLocalDesCopies();
  let parentLocal = local;
  while (!fs.existsSync(parentLocal) && path.dirname(parentLocal) !== parentLocal) parentLocal = path.dirname(parentLocal);
  const choisie = choisirLaRacineDesCopies({
    racineDuProjet: path.resolve(racine),
    typeDuProjet: typeDuSystemeDeFichiers(reel(racine), liste),
    dossierLocal: local,
    typeDuDossierLocal: typeDuSystemeDeFichiers(reel(parentLocal), liste),
    forcerLocal: process.env.BELUGA_COPIES_LOCALES === '1',
  });
  connues.set(cle, choisie);
  return choisie;
}

/** Toutes les racines où une copie de ce projet peut vivre : l'historique et l'actuelle. */
export function racinesDesCopiesDuProjet(racine: string): string[] {
  const historique = `${path.resolve(racine)}/${DOSSIER_DES_CARTES}`;
  const actuelle = racineDesCopiesDuProjet(racine);
  return actuelle === historique ? [historique] : [actuelle, historique];
}

/**
 * LE DOSSIER DE TRAVAIL D'UNE CARTE. Une copie déjà ouverte à l'ANCIEN endroit
 * (`<projet>/.worktrees/…`, avant le déménagement) reste la sienne jusqu'à sa
 * fermeture : on ne rouvre pas une seconde copie à côté d'un travail en cours.
 */
export function dossierDeCarte(racine: string, titre: string, cardId: string): string {
  const actuel = cheminDossierDeCarte(racine, titre, cardId, racineDesCopiesDuProjet(racine));
  const historique = cheminDossierDeCarte(racine, titre, cardId);
  if (actuel !== historique && !fs.existsSync(actuel) && fs.existsSync(historique)) return historique;
  return actuel;
}
