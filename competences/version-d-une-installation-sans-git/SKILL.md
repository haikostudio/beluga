---
name: version-d-une-installation-sans-git
description: À utiliser dès qu'un programme installé chez d'autres doit annoncer sa version à partir de git (git log, git describe) et que certaines installations arrivent avec une version vide : « la version est vide pour une installation », « git log échoue dans le service », « installé depuis un ZIP ou une archive », « dubious ownership ». Donne la chaîne de replis qui ne rend jamais vide.
etat: active
themes: installation, deploiement, statistiques
symptomes: version vide au central, git log échoue sous systemd, dubious ownership, code téléchargé en ZIP sans .git
---

# version-d-une-installation-sans-git

## Symptôme

Un serveur central qui reçoit des signaux d'installations voit certaines versions vides, alors que d'autres arrivent bien au format « AAAA-MM-JJ sha ».

## Cause

La version vient d'un appel `git log -1 --format=%cs %h` qui rend '' en cas d'échec. Il échoue quand : git n'est pas dans le PATH du service ; le dépôt appartient à un autre compte que celui du service (git refuse, « dubious ownership ») ; le code a été téléchargé en ZIP GitHub ou extrait d'une archive, sans dossier .git.

## Procédure

1. Appeler git avec `-c safe.directory=<dossier>` (la ligne de commande est une configuration protégée : elle lève le refus pour CE dossier seulement, sans toucher la config globale).
2. Si git échoue ou rend vide : lire `.git` à la main. `.git` peut être un FICHIER (`gitdir: …`, copie de travail) : suivre le lien, et `commondir` pour les réfs. HEAD → `ref: refs/heads/x` → fichier de réf libre, sinon ligne de `packed-refs`. Sha court = 7 premiers signes.
3. Date : objet commit LIBRE `objects/ab/cdef…` décompressé (zlib inflate), ligne `committer … <secondes> <+hhmm>` → jour dans le fuseau du commiteur (comme `%cs`). Objet tassé (pack) : date du fichier de réf à défaut.
4. Sans .git : date de modification de `package.json` (une archive GitHub et `tar -xzf` gardent la date du commit) → « AAAA-MM-JJ » seule.
5. Garder un format compatible avec le tri du central : « AAAA-MM-JJ sha » ou « AAAA-MM-JJ ».

## Vérification

Essai à quatre cas : dépôt neuf (objet libre) égal à `git log -1 --format=%cs %h` ; dépôt après `git gc` + `git pack-refs --all` (sha juste, date présente) ; dossier sans .git avec package.json daté (`utimes`) → la date ; dossier vide → '' sans exception. Preuve : Beluga, carte « Statistiques des installations libres », commit 0860c4a5, `server/src/test/version-installation.test.ts`.

## Pièges

- `git log %h` rallonge le sha court selon la taille du dépôt (8 signes et plus) : le repli à 7 signes reste comparable par préfixe, pas par égalité stricte.
- Ne pas poser `safe.directory=*` en configuration globale de la machine depuis le programme.
- Sur un dépôt fraîchement cloné, l'objet commit est dans un pack : ne pas planter, prendre la date du fichier de réf.
