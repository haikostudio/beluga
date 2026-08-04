#!/usr/bin/env node
/**
 * Remise en accord du tableau du projet Root avec la réalité de son dépôt.
 *
 * Constat : le dossier servi (`/var/www/root-storage-dashboard`) n'est PAS un
 * dépôt git ; le vrai dépôt du tableau de bord est `/home/paseo/rsd-work`. Des
 * cartes sont donc passées en « Terminé », dans le lot à publier puis en
 * « Archivé » sans qu'aucune ligne n'ait bougé nulle part.
 *
 * Ce script ne SUPPRIME rien et ne publie rien : il déplace les cartes fautives
 * et écrit sur chacune la raison, en clair, à la fin de sa description. Il est
 * rejouable : une carte déjà annotée n'est pas annotée deux fois.
 *
 *   node scripts/remise-en-etat-cartes-root.mjs           # montre sans écrire
 *   node scripts/remise-en-etat-cartes-root.mjs --ecrire  # applique
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = require(path.join(racine, 'node_modules/better-sqlite3'));

const ECRIRE = process.argv.includes('--ecrire');
const MARQUE = '— Remise en état du tableau —';

/**
 * Le verdict carte par carte, établi en comparant les dates des cartes aux
 * enregistrements de `/home/paseo/rsd-work` et aux dates de modification des
 * fichiers servis. `colonne: null` = la carte reste où elle est.
 */
const VERDICTS = [
  {
    id: '801f1aba-d920-41db-8843-f6247f7cf545',
    titre: 'Afficher tous les comptes CLI connectés + accélérer le tableau de bord',
    colonne: null,
    raison:
      "Vérification : du code a bien été écrit, mais dans le dépôt du service qui fournit les données (`/home/paseo/rsd-work`, enregistrements 456fab5 et cb06381), pas dans le dossier servi qui n'est pas un dépôt. La carte reste archivée.",
  },
  {
    id: 'bc023d79-3bf3-4ff5-bfa4-70f27c265f64',
    titre: 'Ouvrir le projet Invia : maintenance du site et du serveur',
    colonne: null,
    raison:
      'Vérification : la page servie a réellement été modifiée pendant ce travail (fiche Invia ajoutée, sauvegarde `index.html.bak-invia`). La carte reste archivée.',
  },
  {
    id: '3beb4463-9391-4559-9338-106a393c1bc2',
    titre: 'Supprimer Paseo du serveur — archive conservée',
    colonne: null,
    raison:
      'Vérification : la page servie a réellement été modifiée (mention de Paseo retirée du texte d’accueil), en plus du retrait des services. La carte reste archivée.',
  },
  {
    id: '65dcc0f5-7078-487d-8fa6-5c94959fe1bc',
    titre: 'Uniformiser le déroulé des agents Codex sur celui de Claude',
    colonne: null,
    raison:
      "Vérification : du code a bien été écrit, mais dans le dépôt de HaikoDev (enregistrements 7caa658 et e7fc4f5), pas dans celui de Root — la carte est classée sous le mauvais projet. Elle reste archivée, le travail existe.",
  },
  {
    id: '25e6e243-cc80-4702-b33d-f8a9854ac5f5',
    titre: 'Archiver Paseo en zip — sans rien supprimer',
    colonne: 'done',
    raison:
      "Vérification : aucune ligne de code n'a été modifiée — le travail demandé était une archive (206 Mo, présente et vérifiée), pas une livraison de code. La carte sort d'« Archivé » : elle est terminée, mais elle n'avait rien à publier.",
  },
  {
    id: 'd96efa6d-f71b-4f6e-9e0b-b435c70d7320',
    titre: 'Organiser les blocs en onglets persistants',
    colonne: 'todo',
    raison:
      "Vérification : rien n'a été modifié dans le projet. Une version préparée existe seulement dans un dossier de sauvegarde (`index.html.candidate`) et n'a jamais été appliquée à la page servie. La carte repart en « À faire » : le travail reste à poser.",
  },
  {
    id: 'b13057d1-92ad-4db9-a744-31a6cf6830d0',
    titre: "Améliorer l'interface du gestionnaire de fichiers",
    colonne: 'todo',
    raison:
      "Vérification : rien n'a été modifié dans le projet. Une version préparée existe seulement dans un dossier de sauvegarde, et son propre compte rendu précise qu'elle n'a pas été appliquée. La carte repart en « À faire » : le travail reste à poser.",
  },
];

const db = new Database(path.join(racine, 'data/haikodev.db'));
const maintenant = Date.now();

function positionSuivante(projectId, colonne) {
  const ligne = db
    .prepare('SELECT MAX(position) AS m FROM cards WHERE project_id = ? AND column_key = ?')
    .get(projectId, colonne);
  return Math.max((ligne?.m ?? 0) + 1, maintenant);
}

for (const verdict of VERDICTS) {
  const ligne = db.prepare('SELECT data FROM cards WHERE id = ?').get(verdict.id);
  if (!ligne) {
    console.log(`ABSENTE  ${verdict.titre}`);
    continue;
  }
  const carte = JSON.parse(ligne.data);
  const depart = carte.column;

  const dejaAnnotee = (carte.description ?? '').includes(MARQUE);
  if (!dejaAnnotee) {
    carte.description = `${carte.description ?? ''}\n\n${MARQUE}\n${verdict.raison}`.trim();
  }

  if (verdict.colonne && verdict.colonne !== carte.column) {
    carte.column = verdict.colonne;
    carte.position = positionSuivante(carte.projectId, verdict.colonne);
  }
  carte.updatedAt = maintenant;

  const cible = verdict.colonne ?? depart;
  console.log(`${depart} → ${cible}  ${dejaAnnotee ? '(déjà annotée) ' : ''}${verdict.titre}`);

  if (!ECRIRE) continue;
  db.prepare(
    'UPDATE cards SET column_key = ?, position = ?, data = ?, updated_at = ? WHERE id = ?',
  ).run(carte.column, carte.position, JSON.stringify(carte), maintenant, verdict.id);
}

db.close();
console.log(ECRIRE ? '\nÉcrit.' : "\nRien écrit — relancer avec --ecrire pour appliquer.");
