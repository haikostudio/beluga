---
name: telechargement-d-un-lot-sans-liste-dans-l-adresse
description: À utiliser dès qu'un bouton télécharge un LOT dont la taille varie (archive zip de fichiers choisis, export de N lignes) par un simple lien, ou devant « Site non disponible », « HTTP 431 », « ça marche avec 10 fichiers mais pas avec 400 » : la liste ne doit pas passer dans l'adresse, on prépare par POST puis on télécharge une adresse courte.
etat: active
themes: serveur, navigateur, interface
symptomes: Site non disponible au téléchargement, HTTP 431 Request Header Fields Too Large, le téléchargement marche pour un petit lot et casse pour un gros
---

# telechargement-d-un-lot-sans-liste-dans-l-adresse

## Procédure

1. Mesure d'abord : rejoue la demande avec 100, puis 300 éléments (curl ou fetch). Si la réponse devient 431 (Node : 16 Ko d'entêtes par défaut, adresse + cookies), la cause est la longueur de l'adresse, pas le serveur.
2. Sépare la VÉRIFICATION (droits par élément, plafond, fichiers présents) de la fabrication du fichier, pour pouvoir l'appeler sans rien produire.
3. `POST /route` avec la liste dans un corps JSON : vérifie tout, puis garde la liste en mémoire sous un jeton aléatoire (≥ 128 bits), lié au compte, avec une durée de vie courte (~10 min) et un plafond du nombre de lots. Rends `{ adresse: '/route?lot=<jeton>' }`, ou le statut et `{ error }` en clair.
4. `GET /route?lot=` : relis le lot pour le MÊME compte seulement, revérifie les droits avec le compte courant, puis envoie le fichier en flux. Laisse le jeton relisible pendant sa vie (HEAD, reprise du navigateur).
5. Côté écran : au clic, le bouton passe en « en cours », fait le POST, puis suit l'adresse courte par un lien `<a download>` ; un refus du POST s'affiche avec sa raison. Les navigateurs acceptent un téléchargement par lien lancé juste après un `await`.

## Vérification

Script qui envoie un gros lot (≥ 400 éléments aux identifiants longs) : le POST rend 200 et une adresse de moins de 120 signes ; le GET rend 200, le bon type, et le bon nombre d'entrées (pour un zip : le champ « total » de l'enregistrement de fin de répertoire, signature 50 4B 05 06, octet +10) ; sans session : 401 ; jeton inconnu : refus clair ; au-delà du plafond : 400 avec la consigne. Tests unitaires du lot : autre compte, jeton périmé, inconnu → refusés. Preuve : Beluga, carte « Téléchargement des images en zip », commit 505f06cb.

## Pièges

- Un simple lien de téléchargement ne remonte AUCUNE erreur à la page : un 431, un 400 ou un 403 ne montre qu'une page d'erreur du navigateur. Toute validation doit se faire au POST, là où l'écran peut lire la réponse.
- Le jeton ne doit porter que la liste, jamais une permission : un jeton volé ou partagé ne doit rien ouvrir pour un autre compte.
- Purger les lots périmés à chaque accès et plafonner leur nombre, sinon la mémoire grossit à chaque clic.
- Relever la limite d'entêtes du serveur (`--max-http-header-size`) ne fait que déplacer la panne, que les mandataires (Caddy, nginx) peuvent aussi refuser.
