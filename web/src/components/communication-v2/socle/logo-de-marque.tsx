import { PastilleProjet } from '@/components/pastille-projet';
import type { LigneDeMarque } from './contexte';

/** Le logo d'une marque : le favicon de son projet, sinon sa première lettre, sur un fond neutre. */
export function LogoDeMarque({ marque, taille = 18 }: { marque: Pick<LigneDeMarque, 'nom' | 'favicon'>; taille?: number }) {
  return <PastilleProjet project={{ name: marque.nom, favicon: marque.favicon ?? undefined }} taille={taille} />;
}
