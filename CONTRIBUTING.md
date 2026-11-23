# Contribuer à Beluga Build

Merci de vouloir améliorer Beluga Build. Tout se passe sur GitHub : idées, défauts, votes,
discussions et propositions de code.

## Où aller

| Vous voulez… | Allez dans |
|---|---|
| Signaler un défaut | **Issues** → « Signaler un défaut » |
| Proposer une idée, voter, en discuter | **Discussions** → « Idées » (votez avec 👍) |
| Poser une question | **Discussions** → « Questions » |
| Proposer du code, une traduction, une compétence | une **pull request** (voir plus bas) |
| Signaler une faille de sécurité | **jamais en public** : voir [SECURITY.md](SECURITY.md) |

## Proposer du code

1. Copiez le dépôt (fork), créez une branche, faites votre changement.
2. Construisez et lancez les tests :

   ```bash
   NODE_ENV=development npm install --include=dev
   npm run build
   npm test
   ```

3. Ouvrez une pull request vers `main`, en disant **ce que le changement fait pour la personne
   qui utilise Beluga** et comment vous l'avez vérifié (une capture aide beaucoup pour l'interface).
4. Un robot vous demande de signer l'[accord des contributeurs](CLA.md), une seule fois, par un
   commentaire. Sans signature, la proposition ne peut pas être reprise.

### Comment une proposition est reprise

Ce dépôt public est le **miroir** du dépôt de travail de Beluga Build : il est réécrit à chaque
version, et une pull request n'y est donc jamais fusionnée directement. Quand votre proposition
est retenue, l'équipe la **rapatrie** dans le dépôt de travail en vous créditant comme auteur
(`Co-authored-by`), puis elle repart au public avec la version suivante. La pull request est alors
fermée avec un lien vers l'enregistrement public qui la contient : c'est normal, votre travail est
bien dedans.

### Ce qui aide une proposition à passer

- Un changement **petit et ciblé** : un défaut, une amélioration. Pour un gros chantier, ouvrez
  d'abord une discussion.
- Les **règles pures** (sans base ni disque) vont dans `shared/`, avec leur test.
- Tout texte affiché passe par `t('…')` : l'interface existe en cinq langues.
- Aucun élément de formulaire natif dans l'interface (`select`, case à cocher, date…) : les
  composants de `web/src/components/ui/` existent pour ça.
- **Aucune donnée personnelle** dans le code : ni adresse, ni clé, ni nom de client, ni chemin de
  votre machine. Le miroir refuse de publier un fichier qui en contient.

## Le code de conduite

Chaque échange ici suit le [code de conduite](CODE_OF_CONDUCT.md).
