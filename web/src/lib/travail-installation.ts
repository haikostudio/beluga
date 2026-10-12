import * as React from 'react';
import { sortieBornee, type EtatDesNouveautes, type TravailDInstallation } from '@beluga/shared';

/*
 * LE TRAVAIL D'INSTALLATION EN COURS, ET LES NOUVEAUTÉS DU DÉPÔT PUBLIC.
 *
 * Deux petits états qui ne vivent pas dans le magasin général : la sortie d'un
 * installateur arrive par dizaines de morceaux à la seconde, et chacun aurait
 * réveillé le tableau entier. Ici, seuls les écrans qui regardent le travail
 * sont prévenus — l'afficheur de terminal reçoit les morceaux un par un
 * (`suivreLaSortie`), les boutons ne reçoivent que les changements d'état.
 *
 * Le client y range ce que le démon diffuse (`installation.travail`,
 * `installation.sortie`, `installation.nouveautes`) ; l'écran y range ce que
 * `installation.etat` rend en entier, pour retrouver un travail après un
 * rechargement.
 */

type Ecouteur = () => void;

let travail: TravailDInstallation | null = null;
let nouveautes: EtatDesNouveautes | null = null;
const ecouteurs = new Set<Ecouteur>();
const ecouteursDeSortie = new Set<(donnees: string) => void>();

const prevenir = () => {
  for (const ecouteur of ecouteurs) ecouteur();
};

export const installationEnDirect = {
  travail: () => travail,
  nouveautes: () => nouveautes,

  sAbonner(ecouteur: Ecouteur): () => void {
    ecouteurs.add(ecouteur);
    return () => ecouteurs.delete(ecouteur);
  },

  /** Chaque morceau de sortie, au moment où il arrive : c'est ce que lit l'afficheur. */
  suivreLaSortie(ecouteur: (donnees: string) => void): () => void {
    ecouteursDeSortie.add(ecouteur);
    return () => ecouteursDeSortie.delete(ecouteur);
  },

  /**
   * L'ÉTAT D'UN TRAVAIL. Diffusé par le démon, il arrive SANS sa sortie (elle a
   * voyagé morceau par morceau) : on garde celle qu'on a accumulée, sauf si
   * c'est un autre travail qui commence.
   */
  recevoirLEtat(recu: TravailDInstallation): void {
    const leMeme = travail && travail.genre === recu.genre && travail.debut === recu.debut;
    travail = { ...recu, sortie: recu.sortie || (leMeme ? travail!.sortie : '') };
    prevenir();
  },

  recevoirLaSortie(genre: string, donnees: string): void {
    if (!travail || travail.genre !== genre) {
      travail = { genre, etat: 'en-cours', debut: Date.now(), sortie: '' };
    }
    travail = { ...travail, sortie: sortieBornee(travail.sortie + donnees) };
    for (const ecouteur of ecouteursDeSortie) ecouteur(donnees);
    prevenir();
  },

  /** Ce que `installation.etat` rend : le travail en entier, sortie comprise. */
  reprendre(recu: TravailDInstallation | null | undefined): void {
    if (!recu) return;
    // Un travail déjà suivi en direct en sait autant, ou plus : on ne recule pas.
    if (travail && travail.genre === recu.genre && travail.debut === recu.debut && travail.sortie.length >= recu.sortie.length) {
      if (travail.etat !== recu.etat) {
        travail = { ...travail, etat: recu.etat, fin: recu.fin, erreur: recu.erreur };
        prevenir();
      }
      return;
    }
    travail = recu;
    prevenir();
  },

  recevoirLesNouveautes(etat: EtatDesNouveautes | null | undefined): void {
    if (!etat) return;
    nouveautes = etat;
    prevenir();
  },
};

/** Le travail d'installation en cours (ou le dernier terminé), suivi en direct. */
export function useTravailDInstallation(): TravailDInstallation | null {
  return React.useSyncExternalStore(installationEnDirect.sAbonner, installationEnDirect.travail);
}

export function useNouveautes(): EtatDesNouveautes | null {
  return React.useSyncExternalStore(installationEnDirect.sAbonner, installationEnDirect.nouveautes);
}
