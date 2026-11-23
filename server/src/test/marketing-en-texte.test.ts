/*
 * CARTE « Mémoire, bulles, publication et marketing » (19/11/2026) : l'agent marketing cherche TOUT lui-même (prix
 * compris), puis échange EN TEXTE dans la conversation — plus de questions à éléments interactifs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { consigneDeLAgentMarketing2, questionEnTexteEnAttente } from '@beluga/shared';

const consigne = consigneDeLAgentMarketing2({
  dossier: { sujet: { nom: 'Essai', url: 'https://exemple.ch' }, type: 'tpe', precisions: [] } as any,
  etat: 'nouveau',
  documents: [],
  rapport: null,
});

test('la consigne fait chercher l’agent et parler en texte, sans éléments interactifs', () => {
  assert.match(consigne, /C'EST TOI QUI CHERCHES/);
  assert.match(consigne, /prix du marché/);
  assert.match(consigne, /EN TEXTE/);
  assert.doesNotMatch(consigne, /« composant »/);
  assert.doesNotMatch(consigne, /LES ÉLÉMENTS/);
  // Les blocs à prix restent au clic.
  assert.match(consigne, /« devis »/);
  assert.match(consigne, /« chapitres »/);
  assert.match(consigne, /« suivi »/);
  // Une recherche bornée.
  assert.match(consigne, /une trentaine de pages au plus/);
});

test('une question posée en texte laisse le client « en attente de votre réponse »', () => {
  const fil = [
    { role: 'user', content: 'Bonjour' },
    { role: 'assistant', content: 'Voici ce que j’ai trouvé… Qu’est-ce qui est faux ou à préciser ?' },
  ];
  assert.equal(questionEnTexteEnAttente(fil, false), true);
  assert.equal(questionEnTexteEnAttente(fil, true), false, 'au travail : pas encore une attente');
  assert.equal(questionEnTexteEnAttente([...fil, { role: 'user', content: 'Le prix est trop bas.' }], false), false);
  assert.equal(questionEnTexteEnAttente([{ role: 'assistant', content: 'J’ai rempli le dossier.' }], false), false);
  assert.equal(questionEnTexteEnAttente([{ role: 'assistant', content: 'Quel budget mensuel visez-vous ?**' }], false), true);
});
