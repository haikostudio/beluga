/*
 * LE PIED D'UNE PAGE DES RÉGLAGES (carte « Retrouver la gestion des accès clients », 24/11/2026).
 *
 * Les boutons d'une page vivent dans un PIED COLLÉ EN BAS, hors du défilement — jamais à la suite du contenu
 * (préférence « entête, contenu, pied »). Une rubrique des réglages est une seule page qui défile : la fenêtre pose donc
 * sous sa zone de défilement une place vide (`data-pied-page-reglages`), et une page y envoie son pied par un portail.
 * La place se cache tant qu'aucune page n'y a rien mis (`empty:hidden`). Hors de la fenêtre (aucune place fournie), le
 * pied se pose simplement à la suite du contenu.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';

const ContexteDuPied = React.createContext<HTMLElement | null>(null);

export const FournisseurDuPied = ContexteDuPied.Provider;

export function PiedDePageDeReglages({ children }: { children: React.ReactNode }) {
  const place = React.useContext(ContexteDuPied);
  if (!place) return <div className="pt-3">{children}</div>;
  return createPortal(children, place);
}
