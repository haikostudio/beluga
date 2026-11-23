---
name: installation-en-une-commande-sur-serveur-neuf
description: À utiliser dès qu'une application auto-hébergée doit pouvoir s'installer par quelqu'un d'autre que son auteur, sur un serveur Linux tout neuf : « rends le projet installable sur un VPS », « écris un script d'installation », « le service ne démarre pas chez le client », « il n'a pas de nom de domaine, comment avoir du https ? », « comment créer le premier compte sans mot de passe par défaut ? », « l'utilisateur ne doit pas retourner dans le terminal », « fais installer cet outil depuis l'interface », « l'outil est installé mais l'application ne le voit pas ». Donne la découpe du script, l'adresse sécurisée sans domaine, le premier accès par lien, l'installation des outils depuis l'écran avec sa sortie en direct, et la façon de le prouver sur un serveur loué puis supprimé.
etat: active
themes: deploiement, serveur, securite, installation, verification
symptomes: le service ne démarre pas sur une autre machine, un compte ou un chemin de l'auteur écrit dans l'unité systemd, le clone échoue faute de clé SSH, un mot de passe par défaut ou tiré au hasard perdu dans un journal, pas de https sans nom de domaine, une question du script ignorée quand il est lancé par curl et bash, un outil installé sous root invisible du service, la notice renvoie vers des fichiers absents, l'utilisateur doit coller une commande dans un terminal qu'il n'a pas, un code à recopier depuis le terminal, le courriel envoyé par le serveur n'arrive jamais, une mise à jour qui écrase des modifications locales
---

# installation-en-une-commande-sur-serveur-neuf

## Symptôme

L'application tourne chez son auteur depuis des mois. Installée ailleurs, elle ne démarre pas, écrit à la mauvaise personne, laisse la première personne venue créer le compte principal, ou renvoie sans cesse son nouvel utilisateur dans un terminal pour finir l'installation.

## Cause

Ce qui n'a jamais été exécuté sur une machine nue n'a jamais été vérifié. Le compte système, les chemins, le nom de domaine, les adresses de courriel et les outils déjà posés de l'auteur se sont glissés dans le code et dans l'unité de service. Et l'auteur, lui, a toujours un terminal ouvert : il ne voit pas que « collez cette commande » ou « recopiez ce code » est une impasse pour quelqu'un qui vient de fermer le sien.

## Procédure

1. PARTIR DE CE QUI EST RÉELLEMENT PUBLIÉ, pas du dépôt de travail : extraire l'arbre public dans un dossier jetable, y lancer installation, construction et démarrage. Les fichiers privés qu'un script importe ou que la notice cite sautent aux yeux.

2. UN SEUL SCRIPT, REJOUABLE (`curl … | sudo bash`). Chaque étape reconnaît qu'elle est déjà faite (`dpkg -s`, `command -v`, `id compte`, `[ -d dossier/.git ]`). Prévoir `--a-blanc`.
   - outils par les dépôts officiels, `DEBIAN_FRONTEND=noninteractive` ;
   - un COMPTE SYSTÈME dédié, jamais root ; fichier sudoers écrit en provisoire, validé par `visudo -cf`, PUIS installé en 440 ;
   - cloner en HTTPS, dans un dossier que le compte peut lire (`/opt/<app>`) ;
   - `mkdir` + `chown` sur le dossier CIBLE seulement.

3. CE QUI EST VITAL S'INSTALLE AVEC LE RESTE, pas « en option plus tard » (un modèle à télécharger, un outil dont une fonction centrale dépend). Mais son échec — réseau, disque — n'arrête PAS l'installation : il est dit, et l'application propose de le réparer d'un bouton.

4. L'UNITÉ SYSTEMD EST UN MODÈLE : compte, groupe, dossier personnel et chemin y sont remplacés à la pose (`sed` ancré). Vérifier que le rendu, sur la machine de l'auteur, est IDENTIQUE à l'unité en place.

5. HTTPS SANS NOM DE DOMAINE : `<ip-avec-tirets>.sslip.io` répond par l'IP elle-même ; Caddy y obtient un vrai certificat en quelques secondes. Vérifier qu'un domaine donné mène déjà à la machine (`getent ahostsv4`) avant d'écrire le reverse-proxy ; sinon retomber sur l'adresse provisoire. La question d'un script lancé par `curl | bash` se lit sur `/dev/tty`.

6. LE PREMIER COMPTE PAR UN LIEN. Le service tire un CODE à usage unique, gardé haché ; le script finit sur `https://<adresse>/?installation=<code>`. Tant qu'aucun administrateur n'existe, la page d'accueil est la page de création du compte : le code du lien y entre dans un champ CACHÉ, la saisie ne revient que sans lien ou après un refus. Règles : la page ne JUGE PAS le code à l'affichage (essai gratuit sinon) ; essais comptés par adresse, comparaison en temps constant, porte fermée dès le compte créé ; `cache-control: no-store`, `referrer-policy: no-referrer`, `history.replaceState` pour sortir le code de l'adresse ; une commande locale donne un lien neuf ; un refus sans rapport avec le code (mot de passe trop court) le garde.

7. PLUS DE TERMINAL APRÈS LE LIEN : L'APPLICATION INSTALLE ELLE-MÊME. Le service tourne déjà sous le bon compte : c'est lui qui lance l'installateur d'un outil, donc l'outil atterrit là où il le cherchera.
   - l'écran envoie un GENRE (« tel outil »), jamais une commande : la ligne exécutée est écrite côté serveur, un genre inconnu est refusé, le geste est réservé aux administrateurs ;
   - un seul travail à la fois ; la commande répond dès le lancement, la sortie est diffusée en direct et gardée (bornée à sa fin) pour qu'un écran rechargé la retrouve ;
   - à l'écran : un bouton qui dit son départ, et un terminal en lecture (xterm, `convertEol`, `disableStdin`) à côté de la page, ou déplié sous le bouton sur écran étroit ;
   - `npm install -g` : `sudo -n env "PATH=$PATH" …` ; installateur « par utilisateur » : `bash -lc` sous le compte du service ;
   - la commande ne se montre qu'en REPLI, après un échec.

8. LES COURRIELS : poser un agent d'envoi local qui n'écoute que la machine (`postfix`, `inet_interfaces = loopback-only`, préconfiguré par `debconf-set-selections`), MAIS ne jamais le supposer utilisable : beaucoup d'hébergeurs ferment le port 25 sortant. Offrir un vrai envoi d'essai qui sonde la sortie et le dit, puis un service SMTP quelconque en relais.

9. CE QUI CHANGE D'UNE INSTALLATION À L'AUTRE devient un RÉGLAGE vide par défaut, et la fonction qui en dépend s'éteint sans lui. Un contrôle refuse l'arbre public tant qu'il contient le domaine ou l'adresse de l'auteur. Un serveur d'essai ne reprend pas les valeurs de l'auteur, sinon ses captures mentent sur ce qu'un nouvel utilisateur verra.

10. REJOUER NE DOIT RIEN ÉCRASER : si l'installation a été personnalisée (un distant à soi, un fichier modifié, un enregistrement local), le script ne touche plus au code et le dit.

11. PROUVER SUR UN VRAI SERVEUR LOUÉ, puis le supprimer : plus petit type qui construit l'application, étiquette dédiée, clé SSH tirée pour l'essai ; archive de l'arbre ; script ; adresse vérifiée DU DEHORS avec certificat ; parcours au navigateur (lien, installation d'un outil PAR LE BOUTON, sortie visible) ; REDÉMARRER la machine ; rejouer le script ; supprimer dans un `finally` et prouver par l'API.

## Vérification

Le script passe `bash -n`. Sur l'arbre public extrait : installation, construction et démarrage passent, la base neuve porte zéro compte et zéro donnée, la page d'accueil est celle du code, le lien y fait entrer le code sans compter d'essai, un mauvais code ne crée rien, le bon ne sert qu'une fois. Le bouton d'installation se juge avec un FAUX installateur (une ligne inoffensive donnée par l'environnement d'un serveur d'essai seulement) : départ dit dès le clic, sortie affichée, second lancement refusé, sortie relue après rechargement. Un geste qui appelle un outil extérieur (`gh`) se juge avec un FAUX outil posé en tête du `PATH` du serveur d'essai. Sur un serveur loué : `systemctl is-active` et `is-enabled` répondent, `curl https://<adresse>/health` passe SANS `-k`, le port interne n'est pas joignable du dehors, l'agent d'envoi n'écoute que `127.0.0.1:25`, le service répond après un redémarrage, le script rejoué rend 0 sans rien changer, l'API du fournisseur rend 404 sur le serveur de l'essai. Mesuré le 12/10/2026 sur un Hetzner cx23 (Ubuntu 24.04), 37 points sur 37 : installation en 143 s avec un modèle de 836 Mo, certificat en quelques secondes, un outil posé par le bouton en 9 s, service reparti 25 s après le redémarrage, port 25 sortant fermé (constaté et dit par l'essai de courriel).

## Pièges

- `npm install` avec `NODE_ENV=production` saute les dépendances de développement : la construction échoue (« tsc: not found »). Installer avec `NODE_ENV=development --include=dev`.
- Un service qui écrit son journal dans le dépôt a besoin que le dossier existe AVANT le premier démarrage, au bon propriétaire.
- Le fichier livré avec Caddy sert une page d'accueil : le reconnaître (`/usr/share/caddy`), le garder de côté, le remplacer par des `import` ; sur un Caddyfile personnalisé, AJOUTER les imports.
- Un pare-feu actif (`ufw`) doit laisser passer 80 et 443, sinon aucun certificat n'arrive.
- Ne supprimer par l'API du fournisseur que ce qui porte l'étiquette de l'essai ET le bon préfixe de nom : le même jeton voit les serveurs de production.
- Le lien d'installation ne doit pas rester dans le journal gardé de l'essai : le retirer avant de l'archiver.
- Les types de serveurs d'un fournisseur changent : essayer plusieurs types et plusieurs lieux avant de conclure.
- Les paquets dont l'application dépend en service sans jamais les nommer (`tmux`, `dig`) manquent sur une machine nue : relire les `spawn` du serveur.
- Un contrôle qui clique le bouton d'installation sur un serveur d'essai sans faux installateur lance le VRAI téléchargement.
- Un dépôt nu créé par un faux outil garde sa branche par défaut : vérifier la branche poussée (`for-each-ref refs/heads`), pas son `HEAD`.

## Ce qui ne marche pas

- Juger l'installation sur la machine de travail : Node, git, le compte et le domaine y sont déjà, tout passe.
- Un identifiant et un mot de passe tirés au hasard, écrits une fois dans le journal du service : personne ne les retrouve.
- Afficher un code à recopier et des commandes à coller « écrites pour le bon compte » : techniquement juste, refusé par l'utilisateur — il n'a plus de terminal sous la main. Un lien et un bouton.
- Lancer le service de l'auteur sur une COPIE de sa base pour vérifier qu'il n'a rien perdu : le démon rejoue ses minuteurs et envoie de vrais courriels. Ouvrir la copie et appeler les fonctions, sans démarrer le service.
- Supposer que le serveur peut envoyer ses courriels lui-même : port 25 sortant fermé chez l'hébergeur de l'essai comme chez celui de l'auteur.
