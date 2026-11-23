import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { demandeAfficheeDeProposition, demandeDeCadrageDeProposition } from '@beluga/shared';

/**
 * UNE CARTE ACCEPTÉE DEPUIS UNE PROPOSITION DU CHAT SUIT LE PARCOURS ENTIER :
 * son point « Demande » porte le texte rédigé par l'agent du chat, et son
 * cadrage part de lui-même jusqu'à la compréhension — sans que l'acceptation
 * attende le moteur. Les règles pures se jugent seules ; le branchement se lit
 * dans la source, comme pour le dépannage automatique.
 */

const CARTE = {
  title: 'Page Statistiques',
  description: 'Renommer la page « Tableau de bord » en « Statistiques ».',
  briefing: "L'utilisateur veut que la page s'appelle Statistiques, sans bouton de retour dans l'entête.",
};

test('la demande de cadrage porte le titre, la description et la synthèse de l’agent du chat', () => {
  const demande = demandeDeCadrageDeProposition(CARTE);
  assert.ok(demande.includes(CARTE.title));
  assert.ok(demande.includes(CARTE.description));
  assert.ok(demande.includes(CARTE.briefing));
  assert.match(demande, /rendre_comprehension/);
  assert.match(demande, /TRAVAIL À CADRER/);
});

test('la demande de cadrage s’arrête à la compréhension et ne produit jamais de plan', () => {
  const demande = demandeDeCadrageDeProposition(CARTE);
  assert.match(demande, /ARRÊTE-TOI LÀ/);
  assert.doesNotMatch(demande, /appelle « rendre_plan »/i);
});

test('une proposition sans synthèse ni description donne quand même une demande lisible', () => {
  const demande = demandeDeCadrageDeProposition({ title: 'Seul titre' });
  assert.ok(demande.includes('Seul titre'));
  assert.doesNotMatch(demande, /undefined/);
});

test('le point « Demande » montre la synthèse entière, résumée par la description', () => {
  assert.deepEqual(demandeAfficheeDeProposition(CARTE), { texte: CARTE.briefing, resume: CARTE.description });
  // Sans synthèse, la description tient lieu de texte ; sans rien, le titre.
  assert.deepEqual(demandeAfficheeDeProposition({ title: 'T', description: 'D' }), { texte: 'D', resume: 'D' });
  assert.deepEqual(demandeAfficheeDeProposition({ title: 'T' }), { texte: 'T' });
});

const source = (fichier: string) => readFileSync(new URL(`../../src/${fichier}`, import.meta.url), 'utf8');

test('l’acceptation lance le cadrage SANS l’attendre (la commande rend la main aussitôt)', () => {
  const ws = source('ws.ts');
  const decide = ws.slice(ws.indexOf("case 'proposal.decide'"), ws.indexOf("case 'proposal.config'"));
  assert.match(decide, /void lancerLeCadrageDeLaProposition\(card\.id\)/);
  assert.doesNotMatch(decide, /await lancerLeCadrageDeLaProposition/);
});

test('le cadrage de la proposition écrit le jalon « Demande » et part en silence, par sendPrompt', () => {
  const cadrage = source('cadrage.ts');
  const corps = cadrage.slice(cadrage.indexOf('export async function lancerLeCadrageDeLaProposition'));
  const fin = corps.indexOf('\n}\n');
  const fonction = corps.slice(0, fin);
  assert.match(fonction, /libelle: 'Demande'/);
  assert.match(fonction, /resumeDemande/);
  assert.match(fonction, /void sendPrompt\(cadrage\.id, demandeDeCadrageDeProposition\(card\), \{ template: 'none', silent: true \}\)/);
  // Une carte qui a déjà un agent n'en reçoit pas un second cadrage.
  assert.match(fonction, /store\.getLastAgentByCard\(cardId\)/);
});
