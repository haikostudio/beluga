---
name: trouver-la-base-reellement-servie
description: À utiliser dès qu'un enregistrement visible à l'écran reste introuvable dans la base locale, ou dès qu'un script SQLite lancé depuis un dossier de travail séparé échoue sur « no such table », ouvre un fichier vide, ou vise `data/...` alors que le service actif lit une autre base.
etat: active
themes: donnees, verification, publication, migration, tests, worktree
symptomes: la requête ne rend rien alors que l'écran affiche la donnée, l'enregistrement n'existe pas dans la base locale, no such table alors que l'application fonctionne, un fichier de base de zéro octet est apparu, un script lancé depuis un worktree vise la mauvaise base, la vraie base a des fichiers wal shm récents ailleurs
---

# trouver-la-base-reellement-servie

## Symptôme

Une donnée existe dans l'application ou le service répond normalement, mais la requête faite depuis le dossier de travail ne retrouve rien. Variante : un script d'administration ou de vérification ouvre SQLite et tombe sur « no such table », alors que l'application tourne. Dans la carte d'origine, `data/beluga.db` était un leurre vide dans le dossier consulté, tandis que la base réellement servie était un autre fichier non vide avec ses fichiers WAL/SHM.

## Cause

L'application en service et le dossier d'où part le script ne lisent pas forcément le même fichier de données. Un dossier de travail séparé, un renommage de base, une variable d'environnement différente ou un script avec chemin relatif peuvent faire ouvrir une base vide ou ancienne. SQLite aggrave le piège : ouvrir un chemin inexistant peut créer un fichier vide, puis l'erreur n'apparaît qu'à la première requête de table.

## Procédure

1. Identifier le service ou le serveur réellement utilisé : `systemctl cat <service>`, `ps aux | grep <processus>`, variables d'environnement et dossier de travail.
2. Lire dans le code la règle qui choisit le dossier de données et le nom de base, y compris les replis vers un ancien nom.
3. Lister les fichiers candidats avec chemin complet et taille : `ls -la <dossier>/*.db*`. Un fichier de zéro octet est un leurre ; un fichier non vide avec `-wal` et `-shm` récents est souvent la base active.
4. Ouvrir les candidats en lecture seule et vérifier les tables : `sqlite3 <chemin> ".tables"` ou l'option `fileMustExist` de la bibliothèque utilisée.
5. Rejouer la requête sur la base réellement servie, chemin complet en toutes lettres, avant de conclure que la donnée manque ou que l'interface ment.
6. Pour les scripts, centraliser la résolution de la base dans un helper partagé qui applique la même règle que le service : même variable de dossier, même choix de nom, refus des fichiers vides.
7. Remplacer les chemins SQLite écrits en dur par ce helper, puis ouvrir en lecture seule ou avec obligation d'existence pour éviter de recréer un fichier vide.
8. Si une donnée doit être supprimée ou migrée, recenser d'abord toutes les tables qui la référencent, puis passer par une migration ou un script d'administration traçable et idempotent.

## Vérification

- La commande qui affiche le chemin résolu par le helper rend un fichier non vide, pas un fichier créé à l'instant.
- `sqlite3 <chemin-résolu> ".tables"` liste les tables attendues.
- La requête d'existence sur l'identifiant recherché rend 1 sur cette base avant action, ou permet de conclure proprement qu'il est absent de la vraie base.
- Le script qui échouait sur « no such table » est rejoué tel quel et dépasse l'ouverture de la base.
- Après un changement de helper, une recherche dans les scripts ne montre plus de chemin de base écrit en dur hors du module de résolution.
- `ls -la <dossier>/*.db*` ne montre pas de nouveau fichier de zéro octet créé par le contrôle.

## Pièges

Un chemin relatif `data/...` depuis un worktree vise la copie locale, pas forcément le service. Un fichier de zéro octet au nom officiel peut avoir été créé par le script fautif et ne prouve rien. Une lecture directe d'une base SQLite active peut dépendre de fichiers WAL/SHM récents. Corriger un seul script laisse les autres recréer le piège. Le nom du fichier peut être identique dans deux dossiers différents : toujours rapporter le chemin complet.

## Ce qui ne marche pas

Conclure que la donnée n'existe pas après avoir interrogé la base du dossier courant. Corriger l'interface parce que la requête locale rend zéro ligne. Ouvrir SQLite sans mode lecture seule et créer un fichier vide. Supprimer une ligne à la main dans la production sans migration ni suppression des dépendances. Recopier la base servie dans le worktree pour faire passer un contrôle au lieu de faire viser la bonne base.
