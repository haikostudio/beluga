---
name: second-titre-lisible-ecrit-par-un-petit-modele
description: À utiliser dès qu'une base de fiches écrites PAR et POUR des agents (mémoire, règles, journaux) doit devenir lisible par une personne sans casser ce que les agents lisent : « on ne comprend rien aux titres », « il faut un titre clair pour l'utilisateur », « afficher le titre avant le code », ou avant de faire réécrire des milliers de titres par un modèle.
etat: active
themes: ia, donnees, interface
symptomes: titres techniques illisibles à l'écran, code affiché avant le titre, réécriture de titres qui casse la recherche des agents
---

# second-titre-lisible-ecrit-par-un-petit-modele

## Procédure

1. Ne JAMAIS réécrire le titre existant : il sert au dédoublonnage, à l'index plein texte et au contexte des agents. Ajouter une SECONDE colonne (titre clair), NULL au départ, que les déclencheurs de l'index ne regardent pas.
2. Écrire une règle pure d'acceptation : 2 à 12 mots, plafond de signes, refus de ce qui trahit du code (nom de fichier à extension, `_` entre lettres, camelCase hors marques comme iPhone, accents graves, `()`, `=>`). Un titre refusé est simplement absent — la fiche entre quand même.
3. Laisser l'agent qui écrit la fiche donner ce titre (champ facultatif, gratuit) ; sinon une tâche de fond le remplit par LOTS (~50 par appel) avec un petit modèle bon marché : consigne courte (« 4 à 9 mots, ce que ça fait pour l'utilisateur, aucun nom technique »), réponse en tableau JSON lu entre le premier « [ » et le dernier « ] ».
4. Reprenable : ne lire que les fiches sans titre clair, poser avec `WHERE titre_clair IS NULL`, sans créer de version ; écarter pour le processus une fiche dont le modèle n'a rien rendu d'acceptable (pas de boucle) ; s'arrêter au premier refus du fournisseur et reprendre au réveil suivant (démarrage + après chaque écriture, avec une pause).
5. Une mise à jour garde le titre clair tant que le titre technique ne change pas ; un titre technique réécrit remet le clair à NULL.
6. À l'écran : titre clair d'abord, code entre parenthèses ; le titre technique passe dans les détails. Résoudre les titres d'une vue par UN appel groupé, en cache côté client — jamais une requête par ligne.

## Vérification

Essayer d'abord le vrai modèle sur un échantillon réel de 50 fiches SANS écrire (lecture seule) : compter les titres acceptés et relire leur qualité ; puis tests sur une base jetable avec un faux modèle injecté en option (pose, refus, reprise, arrêt sur panne, aucune version créée), et un contrôle navigateur qui vérifie « titre clair (code) » avec repli sur le titre technique.

## Pièges

- Un faux modèle exposé par une fonction exportée pour les tests est vu comme un export mort : le passer en option de la fonction de remplissage.
- Un modèle léger glisse encore des noms de technologie (« Traefik », « API ») : le crible attrape le code, pas les noms propres — acceptable, ou ajouter une liste de mots refusés.
- Une fonction de rendu passée à `.map(fn)` reçoit l'index en second argument : ne pas lui ajouter un paramètre facultatif, en faire une seconde fonction.
