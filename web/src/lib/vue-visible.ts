import * as React from 'react';

/**
 * LA VUE EST-ELLE SOUS LES YEUX ? (13/11/2026, onglets instantanés)
 *
 * Un onglet qu'on quitte reste MONTÉ, caché, pour revenir d'un coup (sa conversation, son défilement, son brouillon).
 * Ce qui ne vaut que pour ce qu'on regarde — marquer une réponse comme lue, recevoir un fichier glissé dans « le »
 * champ d'écriture — demande donc d'abord si sa vue est visible. Hors de tout onglet : visible.
 */
export const VueVisible = React.createContext(true);
export const useVueVisible = () => React.useContext(VueVisible);
