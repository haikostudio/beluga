/**
 * L'ACCÈS GITHUB DES AGENTS : DISPONIBLE PARTOUT, PAR DÉFAUT, SANS CARTE.
 *
 * L'outil GitHub en ligne de commande (`gh`) est déjà identifié sur le serveur,
 * mais il ne l'était que pour le DÉMON : consulter un dépôt, ouvrir une demande
 * de fusion, lire un ticket passait par le code du démon (`server/src/github.ts`),
 * donc par une carte. Un agent qui lançait `gh` dans son bac à sable dépendait,
 * lui, de la lisibilité du dossier personnel du serveur — invisible depuis un bac
 * à sable, et donc silencieusement inutilisable pour le chef d'orchestre.
 *
 * La réponse tient en deux gestes, tous deux ici :
 *   1. le JETON voyage dans l'ENVIRONNEMENT de chaque agent (`variablesGithub`) :
 *      `gh` n'a alors plus rien à lire sur le disque, il marche dans une copie de
 *      travail comme dans le bac à sable du chef, sous Claude comme sous Codex ;
 *   2. la capacité est ANNONCÉE dans l'accueil (`texteAccesGithub`) : un agent qui
 *      ne sait pas qu'il peut le faire ne le fait pas, et propose une carte pour
 *      un geste de dix secondes.
 *
 * Ce qui reste FERMÉ ne change pas : publier et mettre en ligne demeurent des
 * gestes de l'utilisateur. `gh` sert à consulter, ouvrir, commenter, pousser —
 * jamais à déclencher une mise en production.
 *
 * Rien ici ne touche ni base ni disque : la règle se lit et se rejoue seule.
 */

/**
 * Les variables qui rendent `gh` utilisable sans lire le disque.
 *
 * `GH_TOKEN` est celle que lit `gh` ; `GITHUB_TOKEN` est celle que lisent les
 * bibliothèques et les scripts qui parlent à l'API sans passer par `gh`. Les deux
 * sont posées pour qu'un agent n'ait pas à deviner laquelle son outil attend.
 * Sans jeton, on ne pose RIEN : mieux vaut un `gh` qui dit « non identifié » que
 * des variables vides qui écrasent une identification déjà en place.
 */
export function variablesGithub(jeton?: string): Record<string, string> {
  const propre = jeton?.trim();
  if (!propre) return {};
  return {
    GH_TOKEN: propre,
    GITHUB_TOKEN: propre,
    // Un tour d'agent n'est pas interactif : une question posée par `gh` figerait
    // le tour au lieu d'échouer. On coupe aussi l'annonce de mise à jour, qui
    // pollue la sortie lue par l'agent.
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
  };
}

/** Le nom des variables posées, pour les tests et les contrôles. */
export const VARIABLES_GITHUB = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_PROMPT_DISABLED', 'GH_NO_UPDATE_NOTIFIER'];

/**
 * L'annonce faite à l'agent au premier tour de sa session.
 *
 * Courte et opérante : ce qu'il peut faire, avec quelle commande, et la seule
 * limite. On nomme des gestes réels plutôt qu'une capacité abstraite — « tu as
 * accès à GitHub » ne fait rien lancer, « gh pr list » si.
 */
export function texteAccesGithub(): string {
  return (
    'GITHUB EST DIRECTEMENT ACCESSIBLE, sur ce projet comme sur tous les autres : ' +
    "l'outil `gh` est déjà identifié dans ton environnement, aucune carte à créer et rien à configurer. " +
    'Consulter un dépôt (`gh repo view`, `gh repo list`), lire ou ouvrir une demande de fusion ' +
    '(`gh pr list`, `gh pr view`, `gh pr create`), gérer les tickets (`gh issue list`, `gh issue create`), ' +
    'pousser une branche (`git push`) ou créer un dépôt privé (`gh repo create <nom> --private`) se font ' +
    'directement, dans le tour en cours. ' +
    "L'API s'atteint de la même façon (`gh api …`). " +
    'SEULE LIMITE : publier ou mettre en ligne reste un geste de l’utilisateur — on ne déclenche ni ' +
    'déploiement ni mise en production depuis GitHub.'
  );
}
