---
name: dev-browser
description: Le navigateur des agents, installé sur la machine pour tous les projets. À utiliser dès qu'un agent doit agir sur un site (ouvrir une page, cliquer, remplir un formulaire, se connecter à un compte, prendre une capture, lire une console en ligne) : « va sur tel site », « connecte-toi à la console », « la connexion redemande un code à chaque fois », « remplis ce formulaire », ou pour qu'une VEILLE lise une page connectée (« attendre que le réseau valide le profil »). Remplace agent-browser. Une session gardée par compte du coffre, ouverte à la première utilisation.
etat: active
themes: navigateur, outils, coffre
symptomes: la connexion redemande un SMS à chaque fois, l'agent doit se connecter à un site, agent-browser introuvable, il faut piloter une console en ligne, capture d'un site à prendre, waitForSelector expire alors que l'élément est là, page.$ rend null sur une page chargée
---

# dev-browser

## Procédure

Un vrai Chrome piloté par de courts scripts Puppeteer, depuis la ligne de commande (`dev-browser`, MIT, SawyerHood/dev-browser). Un démon reste chaud entre deux appels ; les pages NOMMÉES et les PROFILS gardent leur état. Installé sur le serveur (`/usr/bin/dev-browser`, version 1.0.0-rc.4, épinglée), donc disponible aux agents de TOUS les projets. Les contrôles automatiques des projets (scripts de vérification) restent sur Playwright + le Chrome du système : dev-browser sert à la navigation des AGENTS.

1. LIRE L'AIDE AVANT UN TRAVAIL NON TRIVIAL : `dev-browser --help` (guide complet), `dev-browser help <sujet>` (quickstart, pages, snapshot, refs, forms, waiting, errors, config).
2. SUR LE SERVEUR, TOUJOURS SANS ÉCRAN : `--headless`. Un appel = une étape :
   ```bash
   dev-browser --headless -b <profil> <<'EOF'
   const page = await browser.getPage("main");
   await page.goto("https://exemple.com");
   await page.snapshot({ interactive: true })
   EOF
   dev-browser --headless -b <profil> -e 'const p = await browser.getPage("main"); await p.click("ref/e6"); await p.waitForLoad(); p.url()'
   ```
   Capture : `(await p.shot()).path`, puis lire l'image.
3. UNE SESSION PAR COMPTE DU COFFRE (décision du 20/10/2026), ouverte À LA PREMIÈRE UTILISATION puis réutilisée par tous les agents, quel que soit le projet :
   - le profil porte le nom du compte : `-b <service>-<identifiant>` en minuscules (ex. `google-salut-haiko`, `stripe-prod`) ;
   - avant de se connecter : outil `coffre_fort`, « lister », puis lire la fiche du compte ; si la fiche porte déjà un « profil dev-browser » (case en plus), le réutiliser ;
   - ouvrir le site avec ce profil : déjà connecté, on travaille ; sinon, se connecter avec l'identifiant et le mot de passe du coffre, TAPÉS AU CLAVIER (`page.keyboard.type`, pas un remplissage direct) ;
   - un code SMS / double authentification : déclencher l'envoi, PUIS demander le code TOUT DE SUITE avec `ask_user`, dans le même tour — jamais un point laissé « non vérifié » pour ça ;
   - une fois connecté : écrire le nom du profil dans la fiche du coffre (`enregistrer`, case en plus « profil dev-browser »), pour que les agents suivants le reprennent.
4. Inactif 30 min, le navigateur se ferme ; cookies et connexion RESTENT sur le disque (`~/.dev-browser/v1/browsers/<profil>`). `--idle-timeout 0` le garde ouvert ; `dev-browser stop` arrête tout.
5. ATTENDRE UNE VALIDATION SUR UNE PAGE CONNECTÉE (profil en cours de vérification, application en revue) : ne pas demander « relancez-moi », poser une veille avec l'outil `veille_poser` en nommant le `profil`. La veille ne fait que LIRE : étapes `aller`, `attendre` (ms) et `verifierTexte` ; `leveeSi: "contenuAbsent"` quand c'est la DISPARITION d'un texte (« en cours de vérification ») qui dit que c'est validé. Le profil doit déjà exister (connexion faite une première fois). Carte 7c07ad du 20/10/2026.
6. Google en particulier : suivre aussi `consoles-google-pilotees-avec-session-durable` (« Essayer une autre méthode » → SMS ; par API plutôt qu'à l'écran dès que possible).

## Vérification

`dev-browser --version` rend `1.0.0-rc.4` ; `dev-browser --headless -t 60 -e 'const p = await browser.getPage("essai"); await p.goto("https://example.com"); await p.title()'` rend « Example Domain » ; `dev-browser browsers` liste les profils ouverts. Essai fait le 20/10/2026 (carte ba5bdd49). Lecture par le contenu : `(await p.content()).includes("Example Domain")` rend `true` sur la même page, alors que `p.$("h1")` rend null (essai du 20/10/2026, carte 7c07ad).

## Pièges

- Finir les lignes par un point-virgule (une ligne qui commence par `(` continue la précédente) ; rendre un objet en `({ a, b })`.
- `page.click` n'attend rien : `waitForSelector` d'abord. Les références `ref/eN` changent à chaque navigation : refaire un `snapshot`.
- SUR CE SERVEUR, `page.$`, `page.evaluate(() => document…)` et `waitForSelector` peuvent ne rien voir d'une page pourtant chargée (h1 introuvable sur example.com, délai dépassé) alors que `p.title()` et `p.content()` répondent : pour LIRE, chercher le texte dans `await p.content()` (balises retirées) ; pour agir, passer par `snapshot` et les `ref/eN`.
- `getByText` n'existe pas : c'est du Puppeteer, pas Playwright.
- `--headless` et sans `--headless` sont DEUX Chrome et DEUX jeux de profils : sur le serveur, toujours `--headless`.
- Jamais deux appels en parallèle sur la même page nommée d'un même profil.
- Les profils vivent dans le dossier personnel de l'utilisateur qui fait tourner les agents : un agent lancé sous un autre `HOME` ne les voit pas.
- JAMAIS de cookie, de jeton de session ni de mot de passe dans un message, une pièce jointe, un fichier du dépôt ou une capture partagée.
- Les sessions d'agents partagent une limite de 512 processus : un Chrome qui refuse de démarrer sous charge n'est pas une panne du site.
- Ne pas multiplier les tentatives de connexion : chaque essai peut envoyer un SMS et bloquer le compte.

## Ce qui ne marche pas

- `agent-browser` : son outil n'est pas installé sur le serveur (`command not found`) ; sa compétence est archivée au profit de celle-ci.
- La 0.2.9 (« latest » de npm) : ancienne génération, sans les profils nommés de la 1.0.
