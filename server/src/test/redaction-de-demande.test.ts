/**
 * LA RÉDACTION D'UNE TÂCHE NÉE DE LA MESSAGERIE — ce qui se passe quand elle rate.
 *
 * Ce que ces essais verrouillent, bout en bout, sur une VRAIE base et une vraie
 * carte : un échec PASSAGER se rejoue tout seul et finit par aboutir sans
 * personne ; un échec DÉFINITIF s'écrit sur la carte avec sa raison, au lieu de
 * la ligne de journal que personne ne lisait ; le bouton de relance refait la
 * tentative sans rien recréer ; et l'écran sait quoi montrer dans chaque cas.
 *
 * Seuls les deux gestes qui coûtent un jeton sont simulés — ouvrir le cadrage,
 * envoyer la demande. Tout le reste est le vrai code : la base, la carte, la
 * demande, les états, les attentes croissantes de `panne-passagere`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DELAI_DE_REDACTION_MS,
  ESSAIS_MAX,
  MARGE_DE_NOUVEL_ESSAI_MS,
  mentionDeRedaction,
  raisonDeRedaction,
} from '@beluga/shared';


const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'redaction-demande-'));
process.env.BELUGA_DATA = bacASable;

const { Card, Project } = await import('@beluga/shared');
const store = await import('../store.js');
const espace = await import('../espace-client.js');
const { redigerLaTache, relancerLaRedaction } = await import('../redaction-de-demande.js');

const PROJET = 'projet-redaction';
const AUTEUR = { id: 'client-1', nom: 'Camille', role: 'client' as const };

store.saveProject(
  Project.parse({
    id: PROJET,
    name: 'Projet de rédaction',
    path: bacASable,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }),
);

/** Une demande de client, et la carte qui en naît — comme à la conversion. */
function poserUneDemande(titre: string) {
  const demande = espace.creerDemande(AUTEUR, { projectId: PROJET, titre, description: 'Le texte du client.' });
  const carte = store.saveCard(
    Card.parse({
      id: store.newId(),
      projectId: PROJET,
      title: titre,
      description: 'Le texte du client.',
      column: 'planned',
      position: 1,
      run: { engine: 'claude', thinking: 'none' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  espace.lierACarte(demande.id, carte.id);
  return { demande, carte };
}

/** Un faux cadrage : il rate, ou il rédige — c'est le scénario qui décide. */
function outilsQui(scenario: (essai: number) => 'panne-passagere' | 'panne-definitive' | 'rend-un-titre') {
  let essai = 0;
  const vus: string[] = [];
  return {
    essais: () => essai,
    promptsRecus: vus,
    outils: {
      ouvrirLeCadrage: async (carteId: string) => ({ id: `cadrage-${carteId}` }),
      sendPrompt: (async (agentId: string, texte: string) => {
        essai += 1;
        vus.push(texte);
        const issue = scenario(essai);
        if (issue === 'panne-passagere') {
          // Le moteur écrit sa bannière et s'arrête : exactement ce que
          // `motifDePannePassagere` sait reconnaître.
          throw new Error('API Error: 500 Internal server error');
        }
        if (issue === 'panne-definitive') throw new Error('API Error: 401 unauthorized');
        // Le tour a rédigé : il a remplacé le titre de la carte.
        const carteId = agentId.replace('cadrage-', '');
        const carte = store.getCard(carteId)!;
        store.saveCard({ ...carte, title: 'Titre réécrit par l’agent', titreProvisoire: false });
      }) as never,
    },
  };
}

/* ---------------- Un échec passager se rejoue tout seul ---------------- */

test('une panne passagère est rejouée seule, et la carte finit rédigée', async () => {
  const { demande, carte } = poserUneDemande('Le bouton ne répond plus');
  // La première tentative tombe sur une 500 ; la seconde rédige.
  const faux = outilsQui((essai) => (essai === 1 ? 'panne-passagere' : 'rend-un-titre'));
  await redigerLaTache({ carteId: carte.id, demandeId: demande.id }, 0, faux.outils);

  const enAttente = store.getCard(carte.id)!.redaction!;
  assert.equal(enAttente.etat, 'en-attente');
  assert.equal(enAttente.essais, 1);
  assert.ok(enAttente.prochainEssaiA && enAttente.prochainEssaiA > Date.now());
  // Tant que l'essai est à venir, l'écran dit « en attente » et n'offre PAS de
  // bouton : il n'y a rien à relancer, ça repart tout seul.
  const attente = mentionDeRedaction(enAttente, Date.now())!;
  assert.equal(attente.etat, 'en-attente');
  assert.equal(attente.relancable, false);

  // Le nouvel essai arrive à son heure ; on ne l'attend pas vraiment.
  await redigerLaTache({ carteId: carte.id, demandeId: demande.id }, 1, faux.outils);
  const apres = store.getCard(carte.id)!;
  assert.equal(apres.redaction!.etat, 'faite');
  assert.equal(apres.title, 'Titre réécrit par l’agent');
  // Plus rien ne s'affiche : le cours normal des choses ne s'annonce pas.
  assert.equal(mentionDeRedaction(apres.redaction, Date.now()), null);
});

test('une panne passagère qui dure finit par abandonner, essais épuisés', async () => {
  const { demande, carte } = poserUneDemande('Le PDF sort vide');
  const faux = outilsQui(() => 'panne-passagere');
  await redigerLaTache({ carteId: carte.id, demandeId: demande.id }, ESSAIS_MAX, faux.outils);
  const redaction = store.getCard(carte.id)!.redaction!;
  assert.equal(redaction.etat, 'echouee');
  assert.match(redaction.raison!, /erreur 500/);
  assert.equal(mentionDeRedaction(redaction, Date.now())!.relancable, true);
});

/* ---------------- Un échec définitif se lit sur la tâche ---------------- */

test('un échec définitif s’écrit sur la carte, avec sa raison', async () => {
  const { demande, carte } = poserUneDemande('Ajouter un export Excel');
  const faux = outilsQui(() => 'panne-definitive');
  await redigerLaTache({ carteId: carte.id, demandeId: demande.id }, 0, faux.outils);
  const apres = store.getCard(carte.id)!;
  assert.equal(apres.redaction!.etat, 'echouee');
  assert.ok(apres.redaction!.raison);
  // La carte reste UTILISABLE : elle garde le titre et le texte du client.
  assert.equal(apres.title, 'Ajouter un export Excel');
  assert.equal(faux.essais(), 1, 'un échec définitif ne se rejoue pas');
  const mention = mentionDeRedaction(apres.redaction, Date.now())!;
  assert.equal(mention.etat, 'echouee');
  assert.equal(mention.relancable, true);
});

test('un tour qui part mais ne rend AUCUN titre compte pour un échec', async () => {
  const { demande, carte } = poserUneDemande('Revoir la page de connexion');
  // Le tour se termine « bien » — il n'écrit simplement rien.
  const muet = {
    ouvrirLeCadrage: async (carteId: string) => ({ id: `cadrage-${carteId}` }),
    sendPrompt: (async () => undefined) as never,
  };
  await redigerLaTache({ carteId: carte.id, demandeId: demande.id }, 0, muet);
  const redaction = store.getCard(carte.id)!.redaction!;
  assert.equal(redaction.etat, 'echouee');
  assert.match(redaction.raison!, /sans écrire de titre/);
});

test('aucun agent de cadrage disponible est un échec DIT, plus un journal muet', async () => {
  const { demande, carte } = poserUneDemande('Corriger la facture de mars');
  await redigerLaTache({ carteId: carte.id, demandeId: demande.id }, 0, {
    ouvrirLeCadrage: async () => null,
    sendPrompt: (async () => undefined) as never,
  });
  const redaction = store.getCard(carte.id)!.redaction!;
  assert.equal(redaction.etat, 'echouee');
  assert.match(redaction.raison!, /agent de cadrage/);
});

/* ---------------- Le bouton de relance aboutit ---------------- */

test('la relance refait la tentative, sans rien recréer, et aboutit', async () => {
  const { demande, carte } = poserUneDemande('Le total se trompe d’un centime');
  await redigerLaTache({ carteId: carte.id, demandeId: demande.id }, 0, outilsQui(() => 'panne-definitive').outils);
  assert.equal(store.getCard(carte.id)!.redaction!.etat, 'echouee');

  const cartesAvant = store.listCards(PROJET).length;
  await relancerLaRedaction(carte.id, outilsQui(() => 'rend-un-titre').outils);

  const apres = store.getCard(carte.id)!;
  assert.equal(apres.redaction!.etat, 'faite');
  assert.equal(apres.title, 'Titre réécrit par l’agent');
  assert.equal(store.listCards(PROJET).length, cartesAvant, 'aucune carte n’est recréée');
  // La demande reste liée à LA MÊME carte.
  assert.equal(espace.laDemande(demande.id)!.carteId, carte.id);
});

test('la relance d’une carte qui ne vient pas de la messagerie est refusée, en le disant', async () => {
  const carte = store.saveCard(
    Card.parse({
      id: store.newId(),
      projectId: PROJET,
      title: 'Carte écrite à la main',
      column: 'planned',
      position: 2,
      run: { engine: 'claude', thinking: 'none' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  await assert.rejects(() => relancerLaRedaction(carte.id), /messagerie/);
});

/* ---------------- Les garde-fous de temps ---------------- */

test('un essai promis que plus personne ne fera bascule en échec relançable', () => {
  const vieille = { etat: 'en-attente' as const, essais: 2, a: 0, prochainEssaiA: 1_000 };
  const juste = mentionDeRedaction(vieille, 1_000 + MARGE_DE_NOUVEL_ESSAI_MS - 1)!;
  assert.equal(juste.etat, 'en-attente');
  const trop = mentionDeRedaction(vieille, 1_000 + MARGE_DE_NOUVEL_ESSAI_MS + 1)!;
  assert.equal(trop.etat, 'echouee');
  assert.equal(trop.relancable, true);
});

test('un tour de rédaction resté en l’air finit par se dire, au lieu de tourner sans fin', () => {
  const enCours = { etat: 'en-cours' as const, essais: 0, a: 0 };
  assert.equal(mentionDeRedaction(enCours, DELAI_DE_REDACTION_MS - 1), null);
  assert.equal(mentionDeRedaction(enCours, DELAI_DE_REDACTION_MS + 1)!.etat, 'echouee');
});

test('une raison trop longue est coupée, une raison absente est quand même une phrase', () => {
  assert.match(raisonDeRedaction(undefined), /sans cause identifiée/);
  assert.equal(raisonDeRedaction('  deux   espaces  '), 'deux espaces');
  assert.ok(raisonDeRedaction('x'.repeat(500)).length <= 240);
});
