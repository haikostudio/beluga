import * as React from 'react';
import { texteApresRetrait } from '@beluga/shared';

/**
 * LE TEXTE DU CHAMP D'ÉCRITURE, LU EN DIRECT PAR CE QUI L'ENTOURE.
 *
 * Une idée d'un compte rendu (« Évolutions possibles », améliorations d'un
 * plan) se coche en s'écrivant dans le champ d'écriture. Sa case retenait le
 * CLIC, dans une liste tenue à part : effacer la ligne à la main laissait la
 * case cochée, et recharger la page la décochait alors que la ligne était
 * toujours dans le brouillon. La case se DÉDUIT donc du texte du champ, et de
 * lui seul — cochée quand la ligne y est, décochée dès qu'elle n'y est plus.
 *
 * Ce texte ne passe ni par l'état du fil ni par le magasin général : la frappe
 * redessinerait toute la conversation à chaque touche. Le champ le dépose ici
 * (`Composer`, prop `champ`), et seules les lignes à cocher s'y abonnent —
 * chacune ne se redessine que lorsque SA case bascule.
 */
export interface TexteDuChamp {
  lire: () => string;
  ecrire: (texte: string) => void;
  abonner: (rappel: () => void) => () => void;
}

/** Un par conversation affichée : deux barres d'écriture ouvertes ne se confondent pas. */
export function creerTexteDuChamp(): TexteDuChamp {
  let texte = '';
  const abonnes = new Set<() => void>();
  return {
    lire: () => texte,
    ecrire: (suite) => {
      if (suite === texte) return;
      texte = suite;
      abonnes.forEach((rappel) => rappel());
    },
    abonner: (rappel) => {
      abonnes.add(rappel);
      return () => {
        abonnes.delete(rappel);
      };
    },
  };
}

/** Le champ de la conversation affichée. Absent hors d'une conversation : rien n'est alors coché. */
export const ContexteTexteDuChamp = React.createContext<TexteDuChamp | null>(null);

/**
 * CETTE LIGNE EST-ELLE ÉCRITE DANS LE TEXTE ? La question se pose avec la règle
 * du retrait elle-même (`texteApresRetrait`, `shared/src/suggestions-de-plan.ts`) :
 * une ligne est « là » quand la décocher la reprendrait. Les deux ne peuvent
 * donc pas se contredire — une case cochée se décoche toujours au clic, et une
 * idée que l'utilisateur a complétée n'est plus la ligne d'origine.
 */
export function ligneDansLeTexte(texte: string, ligne: string): boolean {
  return texteApresRetrait(texte, ligne) !== texte;
}

const SANS_CHAMP = () => () => undefined;

/** Ces lignes sont-elles TOUTES dans le champ, à cet instant ? Une liste vide ne l'est jamais. */
export function useLignesDansLeChamp(lignes: readonly string[]): boolean {
  const champ = React.useContext(ContexteTexteDuChamp);
  return React.useSyncExternalStore(champ ? champ.abonner : SANS_CHAMP, () => {
    if (!champ || !lignes.length) return false;
    const texte = champ.lire();
    return lignes.every((ligne) => ligneDansLeTexte(texte, ligne));
  });
}
