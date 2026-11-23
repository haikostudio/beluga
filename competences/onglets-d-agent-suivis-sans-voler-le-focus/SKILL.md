---
name: onglets-d-agent-suivis-sans-voler-le-focus
description: À utiliser quand une extension Chrome (MV3) laisse un automate ou un agent agir dans des onglets pendant que la personne regarde, avec un panneau latéral qui ne doit paraître QUE sur les onglets de l'agent : « je ne vois pas ce que fait l'agent », « il ouvre une fenêtre à part », « il me vole l'onglet pendant que je tape », « le panneau est partout », « le panneau ne suit pas d'un onglet à l'autre », « la capture d'un onglet en arrière-plan ne revient jamais ». Dit où ouvrir les onglets, comment poser un panneau par onglet, quand activer celui de l'agent et comment borner les captures.
etat: active
themes: extension, chrome, automatisation
symptomes: fenêtre à part pour l'agent, panneau latéral absent sur les onglets de l'agent, panneau latéral affiché sur tous les onglets, panneau qui ne suit pas vers un autre onglet du groupe, onglet volé pendant la frappe, capture qui ne revient pas
---

# onglets-d-agent-suivis-sans-voler-le-focus

## Procédure

1. Pas de fenêtre dédiée : l'agent travaille dans la fenêtre de la personne, dans un GROUPE d'onglets. Un panneau ne s'ouvre que dans un geste de la personne (`chrome.sidePanel.open` sans geste : « may only be called in response to a user gesture ») : une fenêtre à part n'en aurait donc jamais.
2. Groupe sur place : `chrome.tabs.group({ tabIds:[id] })` sans `createProperties` crée le groupe dans la fenêtre de l'onglet. Fenêtre de l'agent = celle de son groupe, sinon celle de l'onglet confié, sinon `chrome.windows.getLastFocused({ windowTypes:['normal'] })`.
3. PANNEAU PAR ONGLET, jamais global : ne PAS déclarer `side_panel.default_path` dans le manifest. Chaque onglet du groupe de l'agent (ou ouvert à la main) reçoit `chrome.sidePanel.setOptions({ tabId, path: 'panneau.html?onglet=<id>', enabled: true })` ; les autres `{ tabId, enabled: false }`. Un panneau d'onglet se masque hors groupe et revient au retour, mais il ne SUIT PAS vers un autre onglet du groupe (une instance par onglet) : à chaque geste de la personne dans le panneau (pointerdown/keydown, au plus toutes les 1,5 s), appeler `sidePanel.open({ tabId })` sur TOUS les onglets permis qui ne l'ont pas encore — plusieurs `open` dans le même geste sont acceptés. Tenir la liste des onglets permis EN MÉMOIRE (pas d'`await` avant `open`, sinon le geste est perdu).
4. Nouvel onglet : `chrome.tabs.create({ windowId, url, active:false })`, l'ajouter au groupe, poser son panneau, puis la règle de suivi.
5. Règle de suivi après chaque geste de l'agent : si l'onglet actif de la fenêtre est dans le MÊME groupe que l'onglet de l'agent ET que l'onglet visé a déjà son panneau → `chrome.tabs.update(id, { active:true })` ; sinon ne rien activer et prévenir l'interface (barre « l'agent agit sur … · Y aller ») ; « Y aller » ouvre le panneau sur l'onglet visé AVANT de l'activer (le clic est un geste).
6. Borner toute capture par le débogueur (`Page.captureScreenshot`) avec un `Promise.race` : un onglet en arrière-plan peut ne pas se dessiner ; l'image d'un film devient facultative (3 s), une capture demandée rend une erreur claire (10 s).

Référence : Beluga, extension-chrome/service-worker.js (`cheminDuPanneau`, `poserLesPanneaux`, `ongletsPermis`, `ouvrirSurLesOngletsPermis`, `suivreLAgent`) et extension-chrome/panneau.js (`etendreLePanneau`), extension 1.0.6 (décision DEC-509 du 09/11/2026).

## Vérification

Dans un vrai Chrome qui charge l'extension : après « ouvrir », `chrome.windows.getAll()` compte toujours une seule fenêtre, le groupe est dans la fenêtre de la personne, et l'onglet actif reste le sien tant qu'elle est hors du groupe. Le manifest ne contient pas `default_path` ; chaque onglet du groupe a son chemin `?onglet=<id>`. Le MASQUAGE réel ne se voit pas en ouvrant panneau.html comme page : charger une COPIE de l'extension dans un Chromium `headless:false` sous `xvfb-run`, ajouter à la copie de panneau.js un témoin `visibilitychange` écrit en `chrome.storage.session`, puis passer sur un onglet hors groupe (panneau masqué) et revenir (panneau rendu). Preuves : Beluga, `node scripts/verif-extension-chrome.mjs` (chemin par onglet, aucun panneau global, 80/80) et contrôle de bout en bout de l'extension du 09/11/2026.

## Pièges

- Garder l'ancien identifiant de fenêtre stocké « au cas où » fait rouvrir la vieille fenêtre : l'ignorer, les groupes existants restent valides là où ils sont.
- Activer l'onglet de l'agent sans regarder où est la personne lui vole le focus en pleine frappe ; activer un onglet du groupe SANS panneau fait disparaître le panneau sous ses yeux.
- Deux agents dans la même fenêtre : comparer les groupes, jamais la seule fenêtre.
- `setOptions({ tabId, enabled:false })` sur un onglet PERMIS détruit son panneau (il ne revient qu'au prochain geste) : ne désactiver que les onglets hors groupe.
- Reposer le même `path` ne recharge pas un panneau ouvert : inutile de le « rafraîchir » ainsi.

## Ce qui ne marche pas

Un panneau GLOBAL (`side_panel.default_path`) avec `setOptions({ tabId, enabled:false })` sur les onglets hors groupe : le panneau reste affiché partout (mesuré dans un vrai Chromium, extension Beluga 1.0.5). `setOptions({ enabled:false })` global ferme le panneau, et le remettre à true ne le rouvre pas. Une fenêtre dédiée à l'agent : le panneau y reste fermé.
