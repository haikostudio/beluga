---
name: jarvis-ouvrir-immediatement
description: À utiliser quand l'utilisateur demande à Jarvis, à la voix, d'ouvrir les tableaux de bord de Beluga : « Ouvrir immédiatement le tableau de bord principal », « va dans les tableaux de bord ». Un seul geste « ouvrir » à l'adresse #tableau-de-bord, jamais un clic sur un libellé.
etat: active
themes: jarvis, voix, interface
symptomes: Ouvrir immédiatement le tableau de bord principal, Je ne trouve pas Tableaux de bord à l'écran
projets: Beluga
---

# jarvis-ouvrir-immediatement

## Symptôme

Demandes d'origine : « Ouvrir immédiatement le tableau de bord principal ». Le chemin appris le 17/11/2026 (« cliquer » sur « Tableaux de bord ») a échoué sur iPhone le 18/11/2026 : « Je ne trouve pas « Tableaux de bord » à l'écran » — sur téléphone, le bouton du bas s'appelle « Tableaux » et le menu est replié.

## Procédure

Rejouer ce plan avec « assistant_ecran » « jouer » :

1. J'ouvre les tableaux de bord — `ouvrir` sur l'adresse `#tableau-de-bord` (jamais `cliquer` sur un libellé : il change entre ordinateur et téléphone).

## Vérification

Le geste revient « fait » dans l'encadré « Jarvis agit sur l'écran » et l'adresse de la page devient `#tableau-de-bord`, sur ordinateur comme sur téléphone. Corrigée le 18/11/2026 (carte « Ménage de la mémoire de la voix ») après l'échec de DISC-0038.

## Pièges

Un libellé visé au clic change d'un écran à l'autre (« Tableaux de bord » sur ordinateur, « Tableaux » sur téléphone, menu replié) : toujours passer par l'adresse.
