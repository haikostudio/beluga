---
name: panneau-lateral-chrome-limite-a-certains-onglets
description: À utiliser quand une extension Chrome (MV3, API sidePanel) ne doit montrer son panneau latéral que sur certains onglets (un groupe, un site) : « le panneau reste affiché partout », « setOptions enabled:false ne masque rien », « le panneau disparaît quand on change d'onglet dans le groupe », « sidePanel.open may only be called in response to a user gesture ». Dit ce que Chrome fait réellement et l'agencement qui marche.
etat: active
themes: extension, chrome
symptomes: panneau latéral visible sur tous les onglets, enabled false sans effet, panneau qui ne suit pas d'un onglet à l'autre, sidePanel.open refusé sans geste, panneau fermé pour de bon après désactivation
---

# panneau-lateral-chrome-limite-a-certains-onglets

## Procédure

1. Ne PAS déclarer `side_panel.default_path` dans le manifest : un panneau global ouvert reste affiché sur un onglet où `chrome.sidePanel.setOptions({ tabId, enabled: false })` a été posé (même avec un `path`).
2. Donner à chaque onglet permis SON panneau : `setOptions({ tabId, path: 'panneau.html?onglet=' + tabId, enabled: true })` ; aux autres `{ tabId, enabled: false }`. Le `?onglet=` permet au panneau de connaître son onglet et au service worker de savoir où un panneau est ouvert (`port.sender.url` des panneaux reliés) — `runtime.getContexts` rend `tabId: -1` pour tout panneau.
3. Un panneau d'onglet est masqué hors des onglets permis et revient au retour, mais il ne s'ouvre que dans un GESTE et ne suit pas seul vers un autre onglet : dans chaque geste (clic sur l'icône avec `openPanelOnActionClick:false` + `action.onClicked`, menu contextuel, clic ou touche DANS le panneau), appeler `chrome.sidePanel.open({ tabId })` pour l'onglet courant ET pour chaque onglet permis qui n'a pas encore son panneau — plusieurs `open` dans le même geste sont acceptés. Sans aucun await avant : la liste des onglets se tient d'avance en mémoire ou en `chrome.storage.session`.
4. Si l'extension change elle-même d'onglet actif (automate qui suit un agent), ne pas amener la personne sur un onglet sans panneau quand elle en a un sous les yeux : proposer un bouton dont le clic ouvre le panneau là-bas puis y va.
5. Ne jamais poser `enabled:false` sur un onglet qui doit garder son panneau : cela le DÉTRUIT, il ne revient qu'au prochain geste. `setOptions({ enabled: false })` sans tabId ferme tout sans rouvrir. Reposer le même `path` ne recharge pas un panneau ouvert.

## Vérification

Les cases d'un contrôle par `getOptions` ne prouvent rien de ce qui s'affiche. Charger une COPIE de l'extension, dont la page du panneau note `document.visibilityState` (événement `visibilitychange`) en `chrome.storage.session` sous une clé par `location.search`, dans le Chromium de Playwright `headless:false` (le Chrome de marque ≥ 137 ignore `--load-extension`) sous `xvfb-run -a` ; ouvrir le panneau par un clic dans une page de l'extension, passer d'onglet en onglet et lire les témoins depuis le service worker. Mesuré le 09/11/2026 (Chromium 1243, extension Beluga 1.0.6) : visible sur les onglets permis, hidden ailleurs, rendu au retour ; la variante à panneau global restait visible partout.

## Pièges

- Un panneau par onglet = une page par onglet : brouillon, minuteries et état ne se partagent pas ; chaque instance recharge ses données.
- `sidePanel.open` après un await dans le gestionnaire peut perdre le geste : tout ce qu'il faut ouvrir se connaît avant.
- Le mode « headless=new » charge l'extension mais n'affiche aucun panneau latéral : la preuve de visibilité se fait à l'écran (xvfb).
