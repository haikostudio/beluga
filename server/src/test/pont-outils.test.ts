import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PONT_ABSENT,
  PONT_LISTE_VIDE,
  PONT_SANS_LISTE,
  PONT_INTROUVABLE,
  etatDuPont,
  noteDePontEnEchec,
  serveursTiers,
  tourARejouerFauteDOutils,
  issueDuPontMort,
  phraseDeRejeuDuPont,
  raisonDePontMortDefinitif,
  ESSAIS_DE_PONT_MAX,
} from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* Le pont a-t-il servi ?                                              */
/* ------------------------------------------------------------------ */

test('aucune trace du pont : la panne se dit en toutes lettres', () => {
  const etat = etatDuPont(null);
  assert.equal(etat.ok, false);
  assert.equal(etat.ok === false && etat.raison, PONT_ABSENT);
  assert.ok(PONT_ABSENT.includes('mémoire'), 'la raison doit dire ce qui a manqué');
});

test('un pont noté « pas démarré » vaut une absence', () => {
  const etat = etatDuPont({ demarre: false, outils: 12 });
  assert.equal(etat.ok, false);
  assert.equal(etat.ok === false && etat.raison, PONT_ABSENT);
});

test('pont démarré mais liste jamais demandée : le tour le dit', () => {
  const etat = etatDuPont({ demarre: true, outils: null });
  assert.equal(etat.ok, false);
  assert.equal(etat.ok === false && etat.raison, PONT_SANS_LISTE);
});

test('liste vide : le tour le dit, au lieu de continuer en inventant', () => {
  const etat = etatDuPont({ demarre: true, outils: 0 });
  assert.equal(etat.ok, false);
  assert.equal(etat.ok === false && etat.raison, PONT_LISTE_VIDE);
});

/*
 * LA SEULE CAUSE QU'AUCUN REJEU NE RÉPARERA : le programme du pont manque sur
 * le disque. La nommer évite trois rejeux silencieux pour rien.
 */
test('pont introuvable sur le disque : la cause passe devant toutes les autres', () => {
  const etat = etatDuPont({ demarre: true, outils: 12 }, false);
  assert.equal(etat.ok, false);
  assert.equal(etat.ok === false && etat.raison, PONT_INTROUVABLE);
});

test('pont présent sur le disque : on juge le passage, comme avant', () => {
  assert.equal(etatDuPont({ demarre: true, outils: 12 }, true).ok, true);
});

test('pont démarré avec des outils : rien à signaler', () => {
  assert.deepEqual(etatDuPont({ demarre: true, outils: 9 }), { ok: true });
});

/*
 * LA RÉPONSE ELLE-MÊME DOIT LE DIRE, pas seulement l'étape repliée : un moteur
 * privé d'outils peut écrire « refusé » ou « aucune carte créée » de son propre
 * chef — cette phrase inventée ne doit jamais rester la seule chose lue.
 */
test('la note ajoutée à la réponse dit le fait, pas une supposition du moteur', () => {
  const note = noteDePontEnEchec(PONT_ABSENT);
  assert.match(note, /pont d'outils n'a pas démarré/);
  assert.match(note, /refus.*n'en est pas un/s);
  assert.ok(note.startsWith('\n\n> [!WARNING]\n'), 'un encadré, pas un texte noyé dans le reste');
});

/* ------------------------------------------------------------------ */
/* Les serveurs d'outils étrangers                                     */
/* ------------------------------------------------------------------ */

const CONFIG = `model = "gpt-5.5"

[mcp_servers.memoire]
url = "https://memoire.example.com/mcp"
approval_mode = "never"

[mcp_servers.memoire.tools.chercher_memoire]
approval_mode = "approve"

# [mcp_servers.eteint]
# url = "https://exemple"

mcp_servers.rapide = { command = "node", args = ["pont.mjs"] }

[mcp_servers.beluga]
command = "node"
`;

test('les serveurs étrangers sont repérés, une seule fois chacun', () => {
  const noms = serveursTiers(CONFIG);
  assert.deepEqual(noms.sort(), ['memoire', 'rapide']);
});

test('le serveur du projet ne s\'éteint jamais lui-même', () => {
  assert.ok(!serveursTiers(CONFIG).includes('beluga'));
});

test('une ligne mise de côté ne branche rien', () => {
  assert.ok(!serveursTiers(CONFIG).includes('eteint'));
});

test('sans serveur étranger, la liste est vide', () => {
  assert.deepEqual(serveursTiers('model = "gpt-5.5"\n[features]\nmemories = true\n'), []);
});


/* ------------------------------------------------------------------ */
/* Un tour privé d'outils qui tombe se REJOUE                          */
/* ------------------------------------------------------------------ */

/*
 * Dire la panne ne suffisait pas : la carte d'un agent qui n'avait jamais reçu
 * ses outils restait figée en « En cours », sans agent au travail, jusqu'à une
 * reprise à la main. Relevé le 08.09.2026 sur deux cartes voisines, arrêtées
 * l'une à 3/6, l'autre à 1/6, pendant que le serveur ne pouvait plus lancer de
 * processus.
 */

const TOUR = { pontOk: false, moteurMuet: false, echec: true };

test('pont mort-né et tour tombé : la carte doit être rejouée', () => {
  assert.equal(tourARejouerFauteDOutils(TOUR), true);
});

test('le pont a servi : rien à rejouer, c’est un échec ordinaire de la tâche', () => {
  assert.equal(tourARejouerFauteDOutils({ ...TOUR, pontOk: true }), false);
});

test('un moteur JAMAIS JOINT garde sa propre route', () => {
  // Sa cause est plus précise que « le pont a manqué » — et elle est déjà dite.
  assert.equal(tourARejouerFauteDOutils({ ...TOUR, moteurMuet: true }), false);
});

/*
 * CE QUI DÉCIDE N'EST PLUS « LE TOUR EST-IL TOMBÉ ? » MAIS « UN OUTIL A-T-IL
 * RÉPONDU ? ». Privé de son pont, le moteur écrit quand même un compte rendu —
 * il ne sait pas qu'il lui manque quelque chose — et cette réponse refermait la
 * carte sur un travail fait à l'aveugle.
 */
test('un rapport RENDU sans le moindre outil se rejoue quand même', () => {
  assert.equal(tourARejouerFauteDOutils({ ...TOUR, echec: false }), true);
});

test('un seul appel d’outil abouti suffit : le tour garde son sort ordinaire', () => {
  assert.equal(tourARejouerFauteDOutils({ ...TOUR, outilAbouti: true }), false);
  assert.equal(tourARejouerFauteDOutils({ ...TOUR, echec: false, outilAbouti: true }), false);
});

test('un arrêt demandé à la main l’emporte sur tout', () => {
  assert.equal(tourARejouerFauteDOutils({ ...TOUR, arretDemande: true }), false);
});

test('une relève de compte ou une panne du fournisseur passe devant', () => {
  assert.equal(tourARejouerFauteDOutils({ ...TOUR, autreRoute: true }), false);
});


/* ------------------------------------------------------------------ */
/* Combien de rejeux silencieux, et quand on demande                   */
/* ------------------------------------------------------------------ */

test('les premiers essais se rejouent en silence, avec un délai croissant', () => {
  const un = issueDuPontMort(0);
  const deux = issueDuPontMort(1);
  const trois = issueDuPontMort(2);
  assert.equal(un.rejouer, true);
  assert.equal(un.rejouer && un.essai, 1);
  assert.equal(deux.rejouer && deux.essai, 2);
  assert.equal(trois.rejouer && trois.essai, 3);
  assert.ok(un.rejouer && deux.rejouer && trois.rejouer);
  assert.ok(un.rejouer && deux.rejouer && un.delaiMs < deux.delaiMs);
  assert.ok(deux.rejouer && trois.rejouer && deux.delaiMs < trois.delaiMs);
});

test('au-delà du plafond, on ne rejoue plus : on demande', () => {
  const issue = issueDuPontMort(ESSAIS_DE_PONT_MAX);
  assert.equal(issue.rejouer, false);
  assert.equal(issue.rejouer === false && issue.essais, ESSAIS_DE_PONT_MAX);
});

test('un compteur absent ou farfelu vaut un premier essai', () => {
  assert.equal(issueDuPontMort().rejouer, true);
  assert.equal(issueDuPontMort(-4).rejouer, true);
});

test('les deux phrases disent le nombre d’essais, pas « une erreur »', () => {
  assert.match(phraseDeRejeuDuPont(2), /essai 2 sur 3/);
  assert.match(raisonDePontMortDefinitif(3), /3 essais/);
  assert.match(raisonDePontMortDefinitif(3), /Relancer, ignorer ou arrêter/);
});
