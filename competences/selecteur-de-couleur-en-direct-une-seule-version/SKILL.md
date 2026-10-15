---
name: selecteur-de-couleur-en-direct-une-seule-version
description: À utiliser dès qu'un champ couleur (`<input type="color">`, React ou autre) doit montrer la couleur dans un aperçu PENDANT le choix et n'enregistrer qu'une fois : « je change la couleur mais l'aperçu ne bouge pas », « la couleur ne s'enregistre que si je clique ailleurs », « chaque mouvement du sélecteur crée une version / une annulation », « la couleur montrée en direct ne s'enregistre jamais ».
etat: active
themes: interface, formulaires, navigateur
symptomes: couleur sans effet dans l'aperçu pendant le choix, couleur enregistrée seulement au clic ailleurs, une opération par mouvement de souris, couleur montrée en direct jamais enregistrée
---

# selecteur-de-couleur-en-direct-une-seule-version

## Symptôme

Le champ couleur n'agit qu'au `blur` : rien ne bouge pendant le choix, et la valeur ne part que si l'on clique ailleurs. Ou, à l'inverse, il agit à chaque `onChange` et chaque mouvement devient une opération enregistrée.

## Cause

Le sélecteur natif de Chrome et Safari ne fait pas perdre le focus au champ pendant le choix. React branche `onChange` sur l'événement `input`, qui part à CHAQUE mouvement ; l'événement natif `change`, qui part quand le sélecteur se referme, n'a pas d'équivalent React. Si l'aperçu renvoie ses styles calculés à l'écran, la couleur montrée en direct revient comme nouvelle « valeur » du champ.

## Procédure

1. Deux rappels distincts : `onApercu(v)` (montrer, sans rien enregistrer) et `onValider(v)` (enregistrer).
2. Sur `onChange` (événement `input`) : mettre à jour l'état local, puis appeler `onApercu` au plus une fois par image (`cancelAnimationFrame` + `requestAnimationFrame`).
3. Écouter l'événement NATIF `change` par une référence (`el.addEventListener('change', …)` dans un effet) : c'est la fermeture du sélecteur, on y appelle `onValider`. Garder aussi `onBlur` en filet.
4. Retenir la dernière valeur validée : ne rien envoyer si elle n'a pas changé (le `change` et le `blur` peuvent arriver tous les deux).
5. Pendant le choix (drapeau levé au premier `input`, baissé à la validation), NE PAS resynchroniser l'état depuis la prop : elle peut revenir de l'aperçu lui-même et deviendrait la valeur de départ, et la validation se croirait inutile.
6. Côté aperçu, montrer par le même chemin que le rendu final (mêmes déclarations CSS ou variable CSS) : l'aperçu ne doit pas promettre autre chose que ce qui sera enregistré.

## Vérification

Dans un vrai navigateur : poser la valeur par le setter natif (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)`) puis `dispatchEvent(new Event('input', { bubbles: true }))` SEUL → l'aperçu montre la couleur et rien n'est enregistré ; puis `dispatchEvent(new Event('change', { bubbles: true }))` → une seule opération enregistrée. Appliqué dans Beluga Build (contrôle `scripts/verif-studio.mjs`, section 19, carte 5beceac4, 06/10/2026).

## Pièges

- `page.fill` de Playwright envoie `input` ET `change` d'un coup : il ne prouve pas le « en direct ». Envoyer `input` seul d'abord.
- Une valeur reçue en prop pendant le choix n'est pas forcément celle du serveur : elle peut être l'écho de l'aperçu.

## Ce qui ne marche pas

Valider au seul `blur` : rien ne part tant qu'on ne clique pas ailleurs. Valider sur `onChange` de React : une opération (et une annulation) par mouvement. Valider après un délai fixe sans attendre la fermeture : plusieurs versions si l'utilisateur hésite.
