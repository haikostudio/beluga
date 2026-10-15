---
name: champ-de-mot-de-passe-avec-oeil-et-generateur
description: À utiliser dès qu'un formulaire (React ou HTML simple) porte un champ de mot de passe, de phrase secrète, de clé ou de jeton : « ajoute l'œil pour voir le mot de passe », « un bouton pour générer le mot de passe », « champ de mot de passe sans œil », « on ne voit pas ce qu'on tape », « la confirmation ne correspond jamais », ou avant d'écrire un `type="password"` à la main. Dit où poser l'œil, quand ajouter le générateur (création seulement), comment il remplit la confirmation et comment le vérifier.
etat: active
themes: interface, formulaires, composants, design
symptomes: champ de mot de passe sans œil, pas de bouton pour générer un mot de passe, confirmation à retaper à la main, mot de passe généré invisible, faute de frappe dans un mot de passe masqué, clé collée impossible à relire
---

# champ-de-mot-de-passe-avec-oeil-et-generateur

## Symptôme

Un champ de mot de passe masqué ne laisse ni relire ce qu'on tape ni proposer un mot de passe solide : l'utilisateur se trompe dans la confirmation, choisit un mot de passe faible, ou colle une clé sans pouvoir vérifier qu'elle est entière. Chaque écran posait son propre champ, avec ou sans aide, selon l'humeur du moment.

## Cause

Le `type="password"` natif n'offre rien de plus que le masquage. L'œil et le générateur sont des choix d'interface : sans UN composant commun, chaque nouveau formulaire les oublie.

## Procédure

1. UN SEUL composant de champ secret dans la bibliothèque d'interface du projet (ex. `ChampMotDePasse`), qui enveloppe l'`<input>` dans une boîte `position: relative` et pose les boutons DANS le champ, à droite (`position:absolute; inset-y-0; right:6px`), avec la marge droite de l'input élargie (≈ 40 px pour un bouton, ≈ 70 px pour deux). Boutons `type="button"` (jamais de soumission), sans bordure, icône 14-15 px, fond transparent, survol discret.
2. L'ŒIL partout où il y a un secret : il bascule `type` entre `password` et `text`, change d'icône (œil / œil barré), porte `aria-pressed` et un `aria-label` / `title` « Afficher le mot de passe » / « Masquer le mot de passe ».
3. Le GÉNÉRATEUR seulement là où l'on CRÉE un mot de passe (création de compte, nouveau mot de passe, phrase secrète que l'on choisit). Jamais sur une connexion, un « mot de passe actuel », une clé ou un jeton à coller, ni sur le mot de passe d'un service existant (base, SSH, site étudié) : il n'y aurait rien à générer.
4. Le générateur : `crypto.getRandomValues` (jamais `Math.random`), 20 signes, alphabet sans signes ambigus (pas de 0/O/o, 1/l/I, 5/S, 2/Z), au moins une minuscule, une majuscule, un chiffre et un symbole simple (`-_.!@#%+=`), tirage sans biais (rejet des valeurs au-delà du dernier multiple entier), mélange de Fisher-Yates. Écrire la règle UNE fois (module partagé) et, pour une page HTML servie sans l'application, la réécrire en JavaScript en ligne à partir des MÊMES familles de signes.
5. Un clic sur « générer » REMPLIT la saisie ET la confirmation avec la même valeur, puis montre les deux EN CLAIR : l'état « visible » est partagé par les deux champs (prop contrôlée `visible` / `onVisibleChange` tenue par le parent), pour qu'on puisse noter le mot de passe.
6. `autocomplete="new-password"` sur les champs de création, `current-password` sur une connexion, `off` sur une clé ou un jeton ; `spellcheck=false`, `autocapitalize=off`.
7. Le mot de passe généré se fait dans le navigateur : il ne passe jamais par le serveur avant l'envoi du formulaire, n'est jamais journalisé, et une page qui se réaffiche après un refus ne le remet pas dans le champ.
8. Verrouiller la règle par un contrôle automatique : un test qui parcourt les écrans et refuse tout `type="password"` posé ailleurs que dans le composant commun.

## Vérification

Dans un vrai navigateur (Playwright, Chrome du système) : cliquer « générer » remplit la saisie et la confirmation avec la même valeur de 20 signes, et les deux passent en `type="text"` ; cliquer l'œil rebascule en `password` et l'icône change. Sur une page de connexion : l'œil est là, le générateur absent. Le test automatique « aucun type password posé à la main » passe, et une capture montre les boutons à l'intérieur du champ, à droite, sans déborder du texte saisi.

## Pièges

- Une règle CSS générique `button { … }` de la page (bouton principal plein) s'applique aussi aux petits boutons du champ : leur donner une règle plus précise (`.champ-mdp .actions button`).
- Oublier d'élargir la marge droite de l'input : le texte passe sous les icônes.
- Un œil par champ mais un état « visible » séparé : après génération, la confirmation reste masquée et l'utilisateur croit qu'elle est vide.
- Mettre le générateur sur une connexion ou un « mot de passe actuel » : il écrase ce que l'utilisateur devait taper.
- `crypto.randomUUID` et `crypto.subtle` exigent HTTPS ; `crypto.getRandomValues` non — c'est lui qu'il faut sur une page d'installation servie en HTTP.
- Un bouton sans `type="button"` dans un `<form>` soumet le formulaire.

## Ce qui ne marche pas

Poser l'œil À CÔTÉ du champ (un bouton de plus dans la rangée) : la rangée déborde sur téléphone et l'œil ne se lit plus comme faisant partie du champ. Générer avec `Math.random` ou en repliant un octet par modulo : prévisible ou biaisé. Laisser chaque écran écrire son propre champ : le prochain formulaire l'oublie.
