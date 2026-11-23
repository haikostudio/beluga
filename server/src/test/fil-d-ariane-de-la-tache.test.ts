/**
 * LE FIL D'ARIANE DE LA PAGE D'UNE TÂCHE — demande du 15/10/2026.
 *
 * De gauche à droite : le bouton des services, « Tableaux de bord », le projet
 * avec son favicon, la branche, puis le nom de la tâche. Sur téléphone, la
 * barre a deux rangs : le menu principal tout en haut, puis le fil, qui
 * s'ouvre sur le bouton des services — plus de flèche de retour.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lire = (chemin: string) => readFileSync(new URL(`../../../web/src/${chemin}`, import.meta.url), 'utf8');

/*
 * LA BRANCHE EST LE DERNIER CRAN, APRÈS LE NOM DE LA TÂCHE (demande du
 * 27/10/2026, capture #f625 — « Branche après le titre » au changelog). Elle
 * était posée AVANT le titre depuis le 15/10 : ce test suit la décision
 * nouvelle, il ne l'affaiblit pas.
 */
test('la tâche écrit son fil : projet, son nom, puis la branche — plus de « Tableaux de bord »', () => {
  const carte = lire('components/card-panel.tsx');
  const projet = carte.indexOf('libelle: project.name');
  const branche = carte.indexOf('<BoutonDeBranche card={card} onVoirLaBranche');
  assert.ok(projet > 0, 'le projet ouvre le fil');
  assert.equal(carte.includes("libelle: t('Tableaux de bord')"), false, '« Tableaux de bord » a quitté le fil');
  assert.ok(branche > projet, 'la branche suit le projet');
  /* La branche est la SUITE du fil, derrière un séparateur, sauf pour le cahier des charges — et sur téléphone, où
     elle se pose à droite, avant les trois points (06/11/2026). */
  assert.match(carte, /suite=\{\s*voletDuCahier \|\| telephone \? undefined : \(\s*<>\s*<SeparateurDuFil \/>\s*<BoutonDeBranche card=\{card\}[^/]*\/>/);
  assert.doesNotMatch(carte, /avantTitre=\{\s*voletDuCahier \? undefined : \(\s*<>\s*<BoutonDeBranche/);
  const barre = lire('components/entete-de-zone.tsx');
  /* Dans le fil, la suite vient après le titre (le calque centré du téléphone, plus bas, a son propre titre). */
  const fil = barre.slice(barre.indexOf('const fil = ('), barre.indexOf('const droite = ('));
  assert.ok(fil.lastIndexOf('data-titre-de-zone') < fil.indexOf('{suite}'), 'la suite vient après le titre');
});

/*
 * DEMANDE DU 01/11/2026 (capture #d6cd, qui remplace celles du 14/10 et du 24/10) : sur téléphone, la page d'une
 * tâche n'a plus d'en-tête maître. UNE rangée : le menu principal à gauche, les services, le fil (projet, titre,
 * branche), puis les options à droite. Plus rien ne se replie au défilement que la barre des étapes.
 */
test('sur petit écran, une seule rangée : le menu à gauche du fil, les options à droite', () => {
  const barre = lire('components/entete-de-zone.tsx');
  assert.doesNotMatch(barre, /data-entete-maitre/, 'plus d’en-tête maître');
  assert.doesNotMatch(barre, /rangDuHautMasque/);
  const titre = barre.lastIndexOf('data-rang-du-titre');
  assert.ok(titre > 0);
  const rang = barre.slice(titre, titre + 600);
  assert.match(rang, /BoutonDuMenuPrincipal[\s\S]*data-avant-le-fil[\s\S]*\{fil\}[\s\S]*\{droite\}/);
  /* SUR TÉLÉPHONE (13/11/2026) : la flèche de retour à gauche, le nom du projet centré qui ouvre le menu principal (plus
     de ☰ ni de grille des services), les trois points seuls à droite — plus de rangée d'onglets dessous (14/11/2026). */
  const centre = barre.indexOf('data-titre-centre');
  assert.ok(centre > 0 && centre < titre, 'le téléphone a sa propre rangée, au titre centré');
  const rangTel = barre.slice(centre, titre);
  assert.match(rangTel, /data-cote-du-haut="gauche">\s*\{retour\}/);
  assert.match(rangTel, /data-cote-du-haut="droite">\s*\{finDuRangDuTitre\}\s*\{droite\}/);
  assert.match(rangTel, /data-calque-du-nom[\s\S]*<BoutonDuNomQuiOuvreLeMenu/);
  /* PLUS DE RANGÉE D'ONGLETS SOUS LE NOM (14/11/2026) : la barre d'onglets a disparu, téléphone compris. */
  assert.doesNotMatch(rangTel, /RangeeDOngletsTelephone/);
  assert.doesNotMatch(rangTel, /FeuilleDesServices/);
  const carte = lire('components/card-panel.tsx');
  assert.doesNotMatch(carte, /finDuRangDuTitre=\{\s*telephone && !voletDuCahier \? <BoutonDeBranche/);
  /* Aucune flèche de retour, aucune branche posée à droite. */
  assert.doesNotMatch(rang, /\{retour\}/);
  assert.doesNotMatch(rang, /data-suite-a-droite/);
  /* L'application fournit le menu principal à la barre de la tâche. */
  const app = lire('app.tsx');
  assert.match(app, /<FournirLeMenuPrincipal value=\{menuPrincipal\}>/);
});

test('seule la barre des étapes se replie, le fil rend sa hauteur', () => {
  const carte = lire('components/card-panel.tsx');
  assert.doesNotMatch(carte, /rangDuHautMasque/);
  assert.match(carte, /repliALOuverture\(fil\.scrollTop, fil\.scrollHeight - fil\.clientHeight, barre\)/);
});
