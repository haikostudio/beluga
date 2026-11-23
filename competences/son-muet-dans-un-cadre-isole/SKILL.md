---
name: son-muet-dans-un-cadre-isole
description: À utiliser dès qu'un lecteur rendu dans un cadre (`iframe` d'aperçu, de démo, d'éditeur vidéo, surtout `sandbox` ou d'une autre origine) reste MUET sur Chrome alors que le bouton « Lire » est dans la page autour : « l'image défile mais aucun son », « le son ne vient qu'après avoir cliqué dans l'aperçu », « ça sonne dans mes tests automatiques mais pas chez l'utilisateur ». Dit la cause (lecture automatique non déléguée au cadre), la correction en un attribut, et comment le mesurer sans se tromper.
etat: active
themes: audio, iframe, navigateur, video
symptomes: l'image défile sans aucun son, le son ne vient qu'après un clic dans l'aperçu, play() rejeté en NotAllowedError dans un iframe, le son marche dans les tests automatiques mais pas chez l'utilisateur, un extrait joué dans la page s'entend mais pas la lecture dans le cadre
---

# son-muet-dans-un-cadre-isole

## Symptôme

Dans un éditeur ou une démo, le bouton de lecture vit dans la page et le rendu dans un cadre. Sur un Chrome d'ordinateur l'image avance, le bouton du son est activé, et rien ne s'entend. Un son joué directement par la page (un extrait à écouter dans une liste) s'entend, lui. Un clic préalable DANS le cadre fait revenir le son.

## Cause

La règle de lecture automatique de Chrome n'autorise un document à sonner que s'il a reçu un geste. Un cadre d'une autre origine — ou un cadre `sandbox` sans `allow-same-origin`, dont l'origine est opaque — est un étranger : le clic reçu par la page ne compte pas pour lui, et un message (`postMessage`) n'est pas un geste. Chaque `play()` avec son y est rejeté (`NotAllowedError`), en silence si le code avale la promesse.

## Procédure

1. Confirmer : dans le cadre, compter les `play()` rejetés (attraper la promesse, noter `err.name`) ; relever `paused`, `muted`, `currentTime` du lecteur quelques secondes après un vrai clic sur le bouton de la page.
2. Corriger : ajouter `allow="autoplay"` sur l'`iframe`. La page délègue alors son autorisation au cadre : il sonne dès que la PAGE a reçu un geste. Garder `sandbox` tel quel, l'attribut ne l'affaiblit pas.
3. Garder le « déblocage dans le geste » déjà écrit pour l'iPhone (un `play()` puis `pause()` de chaque lecteur au moment du message de lecture) : Safari, lui, fait suivre le geste avec le message pendant environ une seconde, et n'obéit pas à `allow`.
4. Ne pas contourner en rendant le cadre de même origine (retirer `sandbox`) : on perd l'isolation pour un problème qu'un attribut règle.

## Vérification

Une sonde Playwright sur le Chrome du système lancé avec `--autoplay-policy=document-user-activation-required` : ouvrir l'écran, faire un VRAI clic (`locator.click`) sur le bouton de lecture de la page, sans jamais cliquer dans le cadre, attendre trois secondes, puis lire dans le cadre : zéro `play()` rejeté, lecteur `paused === false`, `muted === false`, `currentTime` qui avance entre deux relevés. La sonde doit échouer sans l'attribut et réussir avec.

## Pièges

- `frame.evaluate` de Playwright (et tout script exécuté par l'outil dans le cadre) lui donne un geste : la panne disparaît pendant qu'on la mesure. Relever par un script INJECTÉ dans la page du cadre, qui range ses mesures dans une variable, et ne les lire qu'une fois, à la fin.
- Un navigateur de test sans règle de lecture automatique (drapeaux par défaut de l'automatisation) laisse tout sonner : un contrôle vert n'y prouve rien.
- Un site souvent visité peut être exempté par Chrome (indice d'engagement) : la panne paraît alors intermittente d'une machine à l'autre.
- Un Chrome sans écran n'a pas de sortie son : on prouve que le lecteur JOUE, pas qu'on l'entend.

## Ce qui ne marche pas

- Chercher du côté du bouton « muet » ou du volume : ils étaient justes, c'est la lecture elle-même qui était refusée.
- Se fier au déblocage par message pensé pour l'iPhone : il ne vaut pas sur Chrome, où le message n'emporte aucun geste.
