import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EtatDuPoint,
  composerLePoint,
  enLettres,
  heureParlee,
  momentParle,
  pourLOreille,
  raisonParlee,
} from '../digest.js';

/* ------------------------------------------------------------------ */
/* Le point du jour, écrit pour l'oreille (PLAN §22)                   */
/* ------------------------------------------------------------------ */

const CALME: EtatDuPoint = {
  maintenant: new Date(2026, 7, 3, 14, 32).getTime(),
  questions: [],
  bloquees: [],
  aClore: [],
  propositions: [],
  aPublier: [],
  aValider: [],
  enCours: [],
  publiees: [],
};

const etat = (patch: Partial<EtatDuPoint>): EtatDuPoint => ({ ...CALME, ...patch });

test('les nombres se disent en toutes lettres, y compris les pièges du français', () => {
  assert.equal(enLettres(0), 'zéro');
  assert.equal(enLettres(1, true), 'une');
  assert.equal(enLettres(17), 'dix-sept');
  assert.equal(enLettres(21), 'vingt et un');
  assert.equal(enLettres(21, true), 'vingt et une');
  assert.equal(enLettres(71), 'soixante et onze');
  assert.equal(enLettres(80), 'quatre-vingts');
  assert.equal(enLettres(82), 'quatre-vingt-deux');
  assert.equal(enLettres(91), 'quatre-vingt-onze');
  assert.equal(enLettres(100), 'cent');
  assert.equal(enLettres(200), 'deux cents');
  assert.equal(enLettres(342), 'trois cent quarante-deux');
});

test('l\'heure se dit comme on la dit, jamais « quatorze deux points trente-deux »', () => {
  assert.equal(heureParlee(new Date(2026, 7, 3, 14, 32)), 'quatorze heures trente-deux');
  assert.equal(heureParlee(new Date(2026, 7, 3, 15, 0)), 'quinze heures');
  assert.equal(heureParlee(new Date(2026, 7, 3, 1, 5)), 'une heure cinq');
  assert.equal(heureParlee(new Date(2026, 7, 3, 12, 0)), 'midi');
  assert.equal(heureParlee(new Date(2026, 7, 3, 0, 0)), 'minuit');
});

test('un moment se raconte, il ne se date pas', () => {
  const maintenant = new Date(2026, 7, 3, 14, 0).getTime();
  assert.equal(momentParle(new Date(2026, 7, 2, 20, 0).getTime(), maintenant), 'hier soir');
  assert.equal(momentParle(new Date(2026, 7, 3, 9, 0).getTime(), maintenant), 'ce matin');
  assert.equal(momentParle(new Date(2026, 6, 31, 10, 0).getTime(), maintenant), 'il y a trois jours');
});

test('un titre perd son jargon avant d\'être prononcé', () => {
  const dit = pourLOreille('Corriger `web/src/app.tsx` sur la branche tache/abc123def456 — étape 2');
  assert.doesNotMatch(dit, /`|\//, 'ni balise ni chemin de fichier');
  assert.doesNotMatch(dit, /\d/, 'plus aucun chiffre à articuler');
  assert.match(dit, /Corriger/);
  assert.equal(pourLOreille('Point de 14:32'), 'Point de quatorze heures trente-deux');
});

test('une raison d\'attente se dit en cause, pas en mode d\'emploi', () => {
  assert.match(raisonParlee('Quota épuisé — reprise à 14:32 03/08'), /réserve du moteur/);
  assert.match(
    raisonParlee('Tâche lourde : elle attend les heures creuses (à partir de 22 h). Bouton « Dès que possible » pour forcer.'),
    /attend la nuit/,
  );
  assert.doesNotMatch(
    raisonParlee('Tâche lourde : elle attend les heures creuses (à partir de 22 h). Bouton « Dès que possible » pour forcer.'),
    /Bouton/,
  );
});

test('quand il n\'y a rien, on le dit en une phrase — pas en liste de zéros', () => {
  const texte = composerLePoint(CALME);
  assert.equal(texte, 'Il est quatorze heures trente-deux. Voici votre point. Rien de neuf depuis hier. Tout est calme.');
  assert.doesNotMatch(texte, /aucune|zéro/i);
});

test('ce qui attend une décision passe AVANT les compteurs', () => {
  const texte = composerLePoint(
    etat({
      questions: [{ projet: 'Aikomail', titre: 'Faut-il garder les anciens messages ?', detail: 'Faut-il garder les anciens messages ?' }],
      publiees: [{ projet: 'Aikomail', titre: 'Nouvelle page', quand: new Date(2026, 7, 2, 20, 0).getTime() }],
      aValider: [{ projet: 'Aikomail', titre: 'Autre chose' }],
    }),
  );
  const question = texte.indexOf('question');
  const compteur = texte.indexOf('feu vert');
  assert.ok(question > 0 && compteur > question, 'la question doit être dite en premier');
  assert.match(texte, /attend votre réponse/);
});

test('un point complet ne contient ni chiffre, ni deux-points d\'horaire, ni identifiant', () => {
  const texte = composerLePoint(
    etat({
      questions: [{ projet: 'HaikoDev', titre: 'Quelle voix préférez-vous ?', detail: 'Quelle voix préférez-vous ?' }],
      bloquees: [
        { projet: 'Aikomail', titre: 'Refonte du tri', detail: raisonParlee('Quota épuisé — reprise à 14:32') },
        { projet: 'Eloya', titre: 'Import des contacts', detail: '' },
      ],
      propositions: [{ projet: 'HaikoDev', titre: 'Ranger les réglages' }],
      aPublier: [{ projet: 'HaikoDev', titre: 'Barre du haut épurée' }],
      aValider: [
        { projet: 'HaikoDev', titre: 'A' },
        { projet: 'HaikoDev', titre: 'B' },
        { projet: 'HaikoDev', titre: 'C' },
      ],
      enCours: [{ projet: 'HaikoDev', titre: 'Point vocal plus limpide' }],
      publiees: [{ projet: 'Eloya', titre: 'Page tarifs', quand: new Date(2026, 7, 2, 21, 0).getTime() }],
      quota: { compte: 'Christophe', pourcent: 82 },
    }),
  );
  assert.doesNotMatch(texte, /\d/, 'aucun chiffre ne doit rester à l\'écrit');
  assert.match(texte, /Trois tâches attendent votre feu vert/);
  // Chaque phrase commence par une majuscule : elle suit un point.
  for (const p of texte.split(/(?<=[.?!])\s+/)) assert.match(p, /^[A-ZÀ-Þ]/, `phrase sans majuscule : ${p}`);
  assert.doesNotMatch(texte, /\?\./, 'pas de point collé derrière un point d\'interrogation');
  assert.match(texte, /quatre-vingt-deux pour cent/);
  assert.match(texte, /hier soir/);
  // Des phrases courtes : aucune ne dépasse la longueur d'un souffle.
  for (const phrase of texte.split(/(?<=\.)\s+/)) {
    assert.ok(phrase.length <= 150, `phrase trop longue à dire : ${phrase}`);
  }
});

test('les rubriques vides restent muettes', () => {
  const texte = composerLePoint(etat({ enCours: [{ projet: 'HaikoDev', titre: 'Une tâche' }] }));
  assert.match(texte, /travaille en ce moment/);
  assert.doesNotMatch(texte, /feu vert|proposée|en ligne|question/);
});
