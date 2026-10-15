import * as React from 'react';
import { ideeDejaEnvoyee, ligneEstDansLeTexte } from '@beluga/shared';

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
  return ligneEstDansLeTexte(texte, ligne);
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

/**
 * LES MESSAGES DÉJÀ PARTIS, tels que la conversation les a envoyés. Une idée
 * dont la ligne figure dans l'un d'eux est retenue pour de bon : sa case reste
 * cochée après l'envoi, et ne se rouvre plus (`useIdeeEnvoyee`).
 *
 * La liste ne change que lorsqu'un message part : `useTextesEnvoyes` rend la
 * MÊME liste tant que les textes sont les mêmes, pour que la réponse de l'agent
 * qui s'écrit signe après signe ne redessine pas les cases.
 */
const AUCUN_MESSAGE: readonly string[] = [];
export const ContexteTextesEnvoyes = React.createContext<readonly string[]>(AUCUN_MESSAGE);

export function useTextesEnvoyes(messages: readonly { role: string; content?: unknown }[]): readonly string[] {
  const derniere = React.useRef<readonly string[]>(AUCUN_MESSAGE);
  const suivante = messages
    .filter((message) => message.role === 'user' && typeof message.content === 'string' && message.content.trim())
    .map((message) => message.content as string);
  const identique =
    suivante.length === derniere.current.length && suivante.every((texte, i) => texte === derniere.current[i]);
  if (!identique) derniere.current = suivante.length ? suivante : AUCUN_MESSAGE;
  return derniere.current;
}

/** Cette ligne est-elle déjà partie dans un message de la conversation ? */
export function useIdeeEnvoyee(ligne: string): boolean {
  return ideeDejaEnvoyee(React.useContext(ContexteTextesEnvoyes), ligne);
}
