---
name: composants-ui-prets-a-l-emploi
description: À utiliser dès qu'il faut une section ou un effet d'interface soigné (bloc d'accueil, carte animée, texte qui se révèle, effet de particules) sans le dessiner de zéro : « ajoute un bloc d'accueil qui claque », « un effet comme sur les sites haut de gamme », « trouve un composant tout fait ». Indique où prendre des composants prêts, comment les faire adopter par l'agent et quelles licences vérifier.
etat: active
themes: interface, composants, design
symptomes: section à dessiner de zéro, consommation de jetons trop haute pour un composant, effet visuel haut de gamme voulu, licence de composant incertaine
---

# composants-ui-prets-a-l-emploi

## Symptôme

L'agent invente chaque section de zéro (résultat moyen, jetons dépensés), ou on veut un effet précis (texte animé, verre, particules) sans savoir où le prendre ni sous quelle licence.

## Cause

Des bibliothèques de composants éprouvés existent, pensées pour être remises directement à un agent : les utiliser évite de reconcevoir chaque bloc.

## Procédure

1. 21st.dev : bibliothèque de composants, souvent partagés par la communauté. Chercher ou filtrer, trier par « Most downloaded » (le tri apparaît dans la recherche et les filtres, pas dans les pages de catégories). Ouvrir un composant, utiliser le bouton « Copy prompt » (invite prête pour agent, souvent plus simple que le code brut, dont la copie peut demander une connexion). Invite : « Installe ce composant et remplace les images par les nôtres, en respectant mon système de design : [coller] ». Le gain en jetons est probable mais non mesuré.
2. reactbits.dev (dépôt github.com/DavidHDev/react-bits) : composants plus typés — textes animés, cartes en verre, effets de curseur. Invite : « Ajoute ceci au bloc d'accueil et accorde-le à mon système de design : [coller le code] », ou l'enregistrer dans le système de design. VÉRIFIER la licence de chaque composant dans son dépôt avant un produit payant.
3. canvasui.dev : 35 effets (liquide, verre, éclatement, particules) au moment du guide, gratuits, installés via le registre shadcn (ui.shadcn.com/docs/registry) que l'agent en ligne de commande sait utiliser. Il suffit de nommer l'effet : « Ajoute l'effet de révélation par particules de Canvas UI au titre du bloc d'accueil. Installe-le par le registre shadcn. » Licence MIT plus Commons Clause : usage libre dans un travail, revente interdite. Le serveur MCP shadcn est facultatif.
4. Annuaire général : creatorstoolbox.com/resources (plus de 150 ressources de design gratuites : composants animés, effets Three.js, icônes SVG, galeries de logos, kits de maquettes ; 162 résultats le 25 septembre 2026). Vérifier chaque ressource : certaines sont « Freemium » ou payantes.
5. Toujours accorder le composant au système de design du projet (couleurs, polices : voir « design-systeme-de-depart ») ; ne jamais laisser son style d'origine.
6. Pour le mouvement au défilement : voir « mouvement-web-gsap ».

## Vérification

Après ajout : le composant s'affiche avec les polices et couleurs du projet, sans erreur dans la console du navigateur. La licence de chaque composant retenu est notée dans le dépôt (fichier ou commentaire court avec le lien). Le poids de la page n'a pas explosé (comparer la taille des fichiers avant et après). Sur mobile, le composant reste lisible et ne bloque pas le défilement.

## Pièges

- Licence variable : composants de reactbits.dev et de la communauté à lire un par un ; Canvas UI interdit la revente (Commons Clause).
- Les effets lourds (particules, verre) coûtent en performance, surtout sur téléphone.
- Un composant copié tel quel garde le style de son auteur : le raccorder au système de design.
- Nombres, gratuité et licences datent de septembre 2026 : à revérifier sur les pages officielles.
- Les sites changent vite (noms de boutons, tris).

## Ce qui ne marche pas

Coller le code brut d'un composant qui demande une connexion peut donner une copie incomplète : préférer « Copy prompt ». Empiler cinq effets sur un seul écran rend la page lente et illisible.
