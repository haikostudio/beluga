import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BORNES_DE_VECTORISATION,
  COUVERTURE_VECTEURS_MIN,
  DIMENSIONS_LOCAL,
  DUREE_MAX_PAR_NUIT_MS,
  FENETRE_VECTORISATION_HEURES,
  HEURE_VECTORISATION,
  PERIODE_VECTORISATION_MS,
  RAISON_TERRAIN_SANS_SENS,
  TRANCHES_MAX_PAR_NUIT,
  PLAFOND_PASSAGE_SIGNES,
  PRIORITE,
  SCORE_MINIMUM_VECTEUR,
  attenteAvantEssai,
  choisirPassages,
  classerPassages,
  cosinus,
  decisionDeVectorisation,
  decouperCodeEnPassages,
  estDocumentMarkdown,
  estFichierDeCode,
  estFichierDeConfig,
  heureDeVectorisation,
  modeDeRecherche,
  normaliserLeVecteur,
  raisonSansVectorisationDite,
  reponseRejouable,
  sensUtileSur,
  texteAVectoriser,
  vecteurUtilisable,
  type PassageClasse,
  type PassageIndexe,
} from '@haikodev/shared';

/*
 * LES RÈGLES DE LA RECHERCHE PAR LE SENS, éprouvées SEULES : aucun réseau,
 * aucune base, aucune clé. Ce qui touche au fournisseur est éprouvé pour de vrai
 * par `scripts/verif-recherche-passages.mjs`.
 */

/* ------------------------------------------------------------------ */
/* Le format des vecteurs                                              */
/* ------------------------------------------------------------------ */

function vecteurDEssai(remplir: (i: number) => number): number[] {
  return Array.from({ length: DIMENSIONS_LOCAL }, (_, i) => remplir(i));
}

test('un vecteur normalisé est de longueur 1, et un vecteur nul le reste', () => {
  const norme = normaliserLeVecteur(vecteurDEssai((i) => (i % 7) - 3));
  assert.ok(Math.abs(cosinus(norme, norme) - 1) < 1e-9, 'son cosinus avec lui-même vaut 1');
  assert.deepEqual(normaliserLeVecteur([0, 0, 0]), [0, 0, 0], 'un vecteur nul ne se divise pas par zéro');
});

test('un vecteur de mauvaise taille, ou tout à zéro, n’est pas utilisable', () => {
  assert.equal(vecteurUtilisable(undefined), false);
  assert.equal(vecteurUtilisable([1, 2, 3]), false, 'mauvaise taille');
  assert.equal(vecteurUtilisable(vecteurDEssai(() => 0)), false, 'tout à zéro');
  assert.equal(vecteurUtilisable(vecteurDEssai((i) => i + 1)), true);
  assert.equal(vecteurUtilisable(Float32Array.from(vecteurDEssai((i) => i + 1))), true, 'les flottants 32 bits aussi');
});

test('le texte vectorisé porte la source et le titre DEVANT le corps', () => {
  const texte = texteAVectoriser({ source: 'docs/regles/cartes.md', titre: 'Une carte naît', texte: 'Corps.' });
  assert.match(texte, /^docs\/regles\/cartes\.md — Une carte naît/);
  assert.match(texte, /Corps\.$/);
});

/* ------------------------------------------------------------------ */
/* Quand on bascule sur le sens, et quand on ne bascule pas            */
/* ------------------------------------------------------------------ */

const BON_VECTEUR = vecteurDEssai((i) => Math.sin(i));

test('sans vecteur de question, la recherche reste sur les mots — et le dit', () => {
  const mode = modeDeRecherche({ vecteurQuestion: undefined, total: 100, vectorises: 100 });
  assert.equal(mode.vecteurs, false);
  assert.match(mode.raison ?? '', /vectorisée/);
});

test('un index à moitié vectorisé ne bascule pas : les deux échelles ne se comparent pas', () => {
  const mode = modeDeRecherche({ vecteurQuestion: BON_VECTEUR, total: 100, vectorises: 50 });
  assert.equal(mode.vecteurs, false);
  assert.match(mode.raison ?? '', /50 %/);
  const assez = modeDeRecherche({
    vecteurQuestion: BON_VECTEUR,
    total: 100,
    vectorises: Math.ceil(COUVERTURE_VECTEURS_MIN * 100),
  });
  assert.equal(assez.vecteurs, true);
  assert.equal(assez.raison, undefined);
});

test('un index vide ne bascule jamais', () => {
  assert.equal(modeDeRecherche({ vecteurQuestion: BON_VECTEUR, total: 0, vectorises: 0 }).vecteurs, false);
});

/* ------------------------------------------------------------------ */
/* Deux terrains, deux réglages — et c'est le terrain qui décide       */
/* ------------------------------------------------------------------ */

test('au LANCEMENT d’une carte, le classement se fait par les mots, index parfaitement préparé compris', () => {
  const mode = modeDeRecherche({
    terrain: 'lancement',
    vecteurQuestion: BON_VECTEUR,
    total: 100,
    vectorises: 100,
  });
  assert.equal(mode.vecteurs, false);
  // Un CHOIX, pas un repli : sans ce drapeau, la bulle afficherait « par les
  // MOTS · 100 % de la documentation préparée », la phrase même de la panne.
  assert.equal(mode.choisi, true);
  assert.equal(mode.raison, RAISON_TERRAIN_SANS_SENS);
  assert.equal(mode.couverture, 1);
});

test('en CONVERSATION, le sens reprend la main dès que l’index le permet', () => {
  const mode = modeDeRecherche({
    terrain: 'conversation',
    vecteurQuestion: BON_VECTEUR,
    total: 100,
    vectorises: 100,
  });
  assert.equal(mode.vecteurs, true);
  assert.equal(mode.choisi, undefined);
  assert.equal(sensUtileSur('conversation'), true);
  assert.equal(sensUtileSur('lancement'), false);
});

test('le terrain ne fabrique jamais un faux « choisi » : un vrai repli reste un repli', () => {
  // La conversation garde ses trois refus d'origine, terrain ou pas.
  const sansIndex = modeDeRecherche({
    terrain: 'conversation',
    vecteurQuestion: BON_VECTEUR,
    total: 100,
    vectorises: 50,
  });
  assert.equal(sansIndex.vecteurs, false);
  assert.equal(sansIndex.choisi, undefined);
  assert.match(sansIndex.raison ?? '', /50 %/);
});

/* ------------------------------------------------------------------ */
/* Le classement par le sens réel                                      */
/* ------------------------------------------------------------------ */

function passage(source: string, texte: string, vecteur?: number[]): PassageIndexe {
  return { source, titre: '', sujet: 's', priorite: PRIORITE.normale, texte, empreinte: [], vecteur };
}

test('en mode vecteurs, c’est le VECTEUR qui classe, pas les mots communs', () => {
  const proche = vecteurDEssai((i) => Math.sin(i));
  const loin = vecteurDEssai((i) => Math.cos(i * 3));
  const classes = classerPassages(
    [
      passage('loin.md', 'Un texte qui parle de tout autre chose.', normaliserLeVecteur(loin)),
      passage('proche.md', 'Un texte qui parle de tout autre chose.', normaliserLeVecteur(proche)),
    ],
    'la question posée',
    { vecteurQuestion: normaliserLeVecteur(proche), poids: { sens: 0.7, mots: 0.3 } },
  );
  assert.equal(classes[0].source, 'proche.md');
  assert.ok(classes[0].sens > classes[1].sens);
});

test('un passage encore sans vecteur ne perd que le sens, jamais ses mots exacts', () => {
  const classes = classerPassages(
    [passage('sans.md', 'Le fichier carte-sql.ts range les colonnes.', undefined)],
    'carte-sql.ts',
    { vecteurQuestion: BON_VECTEUR, poids: { sens: 0.7, mots: 0.3 } },
  );
  assert.equal(classes[0].sens, 0, 'aucun sens sans vecteur');
  assert.ok(classes[0].mots > 0, 'mais les mots exacts comptent toujours');
});

/* ------------------------------------------------------------------ */
/* Le code ne prend pas toute la place                                 */
/* ------------------------------------------------------------------ */

function classe(source: string, priorite: number, score: number): PassageClasse {
  return { source, titre: '', sujet: 's', priorite, texte: 'x'.repeat(40), score, sens: score, mots: 0, jetons: 10 };
}

test('deux passages de code au plus, même s’ils sont les mieux classés', () => {
  const choix = choisirPassages(
    [
      classe('a.ts', PRIORITE.code, 0.9),
      classe('b.ts', PRIORITE.code, 0.8),
      classe('c.ts', PRIORITE.code, 0.7),
      classe('docs/regles/cartes.md', PRIORITE.regle, 0.6),
    ],
    { maxCode: 2, plafond: 1000 },
  );
  assert.equal(choix.gardes.filter((p) => p.priorite === PRIORITE.code).length, 2);
  assert.ok(choix.gardes.some((p) => p.source.startsWith('docs/')), 'la documentation garde sa place');
});

/* ------------------------------------------------------------------ */
/* Le seuil de pertinence : ce qu'il laisse passer, ce qu'il refuse    */
/* ------------------------------------------------------------------ */

/*
 * LES CHIFFRES VIENNENT DU BALAYAGE de `scripts/audit-memoire-rag.mjs`
 * (section 5 bis, relevé du 16/08/2026, 120 cartes réelles) : une question
 * ÉTRANGÈRE au projet ne dépasse pas 0,33, et le dernier passage réellement
 * retenu sur une vraie demande est en moyenne à 0,42. Le seuil doit donc vivre
 * ENTRE les deux — au-dessus du hors sujet, sous ce qu'une vraie demande sert.
 */
test('le seuil du mode sens refuse une question hors sujet sans couper une vraie demande', () => {
  assert.ok(SCORE_MINIMUM_VECTEUR > 0.33, 'au-dessus du meilleur score mesuré d’une question hors sujet');
  assert.ok(SCORE_MINIMUM_VECTEUR < 0.42, 'sous le score moyen du dernier passage retenu sur une vraie demande');

  /* Un classement de question ÉTRANGÈRE : rien ne passe, donc l'index reprend sa place. */
  const horsSujet = choisirPassages(
    [
      classe('docs/regles/interface.md', PRIORITE.regle, 0.33),
      classe('docs/regles/cartes.md', PRIORITE.regle, 0.31),
      classe('CLAUDE.md', PRIORITE.regle, 0.28),
    ],
    { minimum: SCORE_MINIMUM_VECTEUR, plafond: 1000 },
  );
  assert.equal(horsSujet.gardes.length, 0, 'aucun passage servi : c’est ce qui rend au repli son rôle');

  /* Une vraie demande garde les siens. */
  const vraieDemande = choisirPassages(
    [
      classe('docs/regles/publication.md', PRIORITE.regle, 0.6),
      classe('docs/regles/cartes.md', PRIORITE.regle, 0.45),
      classe('CLAUDE.md', PRIORITE.regle, 0.42),
    ],
    { minimum: SCORE_MINIMUM_VECTEUR, plafond: 1000 },
  );
  assert.equal(vraieDemande.gardes.length, 3);
});

/* ------------------------------------------------------------------ */
/* Quels fichiers entrent dans l'index, et comment on les coupe        */
/* ------------------------------------------------------------------ */

test('les dossiers de machine et les fichiers construits restent dehors', () => {
  assert.equal(estFichierDeCode('server/src/passages.ts'), true);
  assert.equal(estFichierDeCode('web/src/styles.css'), true);
  assert.equal(estFichierDeCode('node_modules/truc/index.js'), false);
  assert.equal(estFichierDeCode('server/dist/passages.js'), false);
  assert.equal(estFichierDeCode('.worktrees/carte/server/src/a.ts'), false);
  assert.equal(estFichierDeCode('shared/dist/index.d.ts'), false);
  assert.equal(estFichierDeCode('web/public/app.min.js'), false);
  assert.equal(estFichierDeCode('README.md'), false, 'le Markdown a son propre chemin');
});

test('un fichier de code se coupe sous le plafond, chaque morceau nommé par sa déclaration', () => {
  const code = [
    'import fs from "node:fs";',
    '',
    'export function premiere() {',
    ...Array.from({ length: 90 }, (_, i) => `  const ligne${i} = "du texte assez long pour remplir le plafond";`),
    '}',
    '',
    'export function seconde() {',
    ...Array.from({ length: 90 }, (_, i) => `  const autre${i} = "du texte assez long pour remplir le plafond";`),
    '}',
  ].join('\n');
  const passages = decouperCodeEnPassages('server/src/essai.ts', code);
  assert.ok(passages.length >= 2, 'plusieurs morceaux');
  assert.ok(
    passages.every((p) => p.texte.length <= PLAFOND_PASSAGE_SIGNES),
    'aucun morceau ne dépasse le plafond',
  );
  assert.ok(passages.every((p) => p.priorite === PRIORITE.code), 'tous en priorité code');
  assert.ok(
    passages.some((p) => p.titre === 'premiere') && passages.some((p) => p.titre === 'seconde'),
    'les déclarations donnent les titres',
  );
});

/* ------------------------------------------------------------------ */
/* Les pannes du fournisseur                                           */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Le rendez-vous : toutes les six heures, deux ampleurs               */
/* ------------------------------------------------------------------ */

test('le rendez-vous revient toutes les six heures, à n’importe quelle heure', () => {
  const nuit = new Date('2026-08-16T01:30:00').getTime();
  assert.equal(decisionDeVectorisation({ clePosee: true, maintenant: nuit, heureCourante: 1 }).lancer, true);
  assert.equal(decisionDeVectorisation({ clePosee: true, maintenant: nuit, heureCourante: 2 }).lancer, true, 'la fenêtre rattrape');
  // Une seule passe par nuit laissait la journée défaire ce que la nuit faisait :
  // midi n'est plus un refus, c'est une passe COURTE.
  const midi = decisionDeVectorisation({ clePosee: true, maintenant: nuit, heureCourante: 14 });
  assert.equal(midi.lancer, true);
  assert.equal(midi.lancer === true && midi.ampleur, 'jour');
});

test('la nuit rattrape en grand, le jour rattrape court', () => {
  const t = new Date('2026-08-16T01:30:00').getTime();
  const nuit = decisionDeVectorisation({ clePosee: true, maintenant: t, heureCourante: HEURE_VECTORISATION });
  assert.equal(nuit.lancer === true && nuit.ampleur, 'nuit');

  const bornesNuit = BORNES_DE_VECTORISATION.nuit;
  const bornesJour = BORNES_DE_VECTORISATION.jour;
  assert.ok(bornesJour.dureeMs < bornesNuit.dureeMs, 'une passe de jour ne bloque pas la machine trois heures');
  assert.ok(bornesJour.tranches < bornesNuit.tranches);
  assert.equal(bornesNuit.dureeMs, DUREE_MAX_PAR_NUIT_MS);
  assert.equal(bornesNuit.tranches, TRANCHES_MAX_PAR_NUIT);
});

test('sans clé, le rendez-vous ne part pas — et il le DIT', () => {
  const refus = decisionDeVectorisation({ clePosee: false, maintenant: 0, heureCourante: 1 });
  assert.equal(refus.lancer, false);
  assert.match(raisonSansVectorisationDite(refus.lancer === false ? refus.raison : 'deja-passe'), /aucune clé/);
});

test('une passe récente ne se rejoue pas, mais un travail en cours ne la reporte JAMAIS', () => {
  const maintenant = 10 * 60 * 60 * 1000;
  const deja = decisionDeVectorisation({
    clePosee: true,
    dernierPassage: maintenant - 60 * 1000,
    maintenant,
    heureCourante: 1,
  });
  assert.equal(deja.lancer, false);
  assert.equal(deja.lancer === false && deja.raison, 'deja-passe');
  assert.match(raisonSansVectorisationDite('deja-passe'), /6 heures/);

  // Six heures plus tard, elle repart.
  const apres = decisionDeVectorisation({
    clePosee: true,
    dernierPassage: maintenant - PERIODE_VECTORISATION_MS - 1,
    maintenant,
    heureCourante: 1,
  });
  assert.equal(apres.lancer, true);

  // Aucune raison « travail-en-cours » n'existe : vectoriser n'appelle aucun
  // moteur et ne prend la place d'aucun agent.
  assert.equal(heureDeVectorisation(HEURE_VECTORISATION), true);
  assert.equal(heureDeVectorisation((HEURE_VECTORISATION + FENETRE_VECTORISATION_HEURES) % 24), false);
});

/* ------------------------------------------------------------------ */
/* Ce qui entre dans l'index : documents, configuration, code          */
/* ------------------------------------------------------------------ */

test('un Markdown s’indexe où qu’il soit, sauf dans les dépendances', () => {
  assert.equal(estDocumentMarkdown('README.md'), true);
  assert.equal(estDocumentMarkdown('docs/regles/cartes.md'), true);
  assert.equal(estDocumentMarkdown('scripts/formation-content/module-2/lecon-4.md'), true, 'un cours rangé loin');
  assert.equal(
    estDocumentMarkdown('data/documents/un-plan.md'),
    false,
    'le magasin commun des documents du chef appartient à tous les projets, donc à aucun',
  );
  assert.equal(estDocumentMarkdown('node_modules/paquet/README.md'), false);
  assert.equal(estDocumentMarkdown('data/venv/lib/paquet/README.md'), false, 'une dépendance Python');
  assert.equal(estDocumentMarkdown('.worktrees/carte/README.md'), false);
});

test('le journal et la mémoire périmée ne s’indexent JAMAIS', () => {
  assert.equal(estDocumentMarkdown('HISTORIQUE.md'), false);
  assert.equal(estDocumentMarkdown('MEMOIRE.avant-synthese.md'), false);
  assert.equal(estDocumentMarkdown('MEMOIRE.md'), true, 'la mémoire en vigueur, elle, entre');
});

test('les fichiers de montage entrent, les verrous et les secrets non', () => {
  assert.equal(estFichierDeConfig('package.json'), true);
  assert.equal(estFichierDeConfig('scripts/haikodev.service'), true);
  assert.equal(estFichierDeConfig('Dockerfile'), true);
  assert.equal(estFichierDeConfig('docker-compose.prod.yml'), true);
  assert.equal(estFichierDeConfig('.env.example'), true, 'l’exemple documente les variables attendues');
  assert.equal(estFichierDeConfig('package-lock.json'), false, 'un verrou n’apprend rien');
  assert.equal(estFichierDeConfig('.env.production'), false, 'un réglage réel n’est pas de la documentation');
});

test('on retente une surcharge, jamais un refus franc', () => {
  assert.equal(reponseRejouable(429), true);
  assert.equal(reponseRejouable(500), true);
  assert.equal(reponseRejouable(401), false, 'clé invalide : le repli tout de suite');
  assert.equal(reponseRejouable(400), false);
  assert.ok(attenteAvantEssai(2) > attenteAvantEssai(1), 'l’attente double');
});
