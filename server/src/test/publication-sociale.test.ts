import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LA PUBLICATION OFFICIELLE SUR LES RÉSEAUX — ce qui ne doit jamais casser.
 *
 *  - un compte déjà publié n'est JAMAIS republié : relancer ne rejoue que les échecs ;
 *  - un contenu programmé ne part qu'à son heure, et seulement s'il vise un compte ;
 *  - un envoi coupé en plein vol devient un échec à vérifier, jamais un second envoi ;
 *  - les jetons vivent au coffre, la table n'en garde que la référence ;
 *  - une connexion dont l'état n'a pas été tiré par Beluga est refusée ;
 *  - une réponse ne part que par le geste de l'utilisateur ; l'agent la propose ;
 *  - un message privé Meta ne se répond plus après 24 heures ;
 *  - l'adresse publique d'un visuel est signée et temporaire.
 *
 * Aucun réseau réel n'est appelé : chaque essai remplace l'adaptateur par un faux.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'publication-sociale-'));
process.env.BELUGA_DATA = bacASable;
process.env.BELUGA_ADRESSE_PUBLIQUE = 'https://beluga.exemple.ch';

const shared = await import('@beluga/shared');
const { Project } = shared;
const store = await import('../store.js');
const marketing = await import('../marketing.js');
const sociale = await import('../publication-sociale.js');
const { remplacerAdaptateur } = await import('../reseaux/index.js');
const { listerAcces } = await import('../coffre-fort.js');
const { getDb } = await import('../db.js');

const projet = store.saveProject(Project.parse({ id: 'projet-rs', name: 'Atelier Test', path: bacASable, createdAt: store.now(), updatedAt: store.now() }));
marketing.assurerEspace(projet.id);

const envois: { reseau: string; texte: string }[] = [];
let refuserLinkedin = false;

function faux(reseau: 'facebook' | 'linkedin') {
  return {
    urlDeConnexion: ({ etat }: { etat: string }) => `https://reseau.exemple/oauth?state=${etat}`,
    echangerCode: async () => [
      { reseau, distantId: `${reseau}-1`, nom: `Page ${reseau}`, jetons: { acces: `jeton-${reseau}-secret`, rafraichissement: reseau === 'linkedin' ? 'renouvellement-secret' : undefined, expireLe: reseau === 'linkedin' ? Date.now() + 3600_000 : undefined }, renouvelable: reseau === 'linkedin' },
    ],
    rafraichir: async () => ({ acces: `jeton-${reseau}-neuf`, expireLe: Date.now() + 7200_000 }),
    publier: async ({ article }: { article: { texte: string } }) => {
      if (reseau === 'linkedin' && refuserLinkedin) throw new Error('quota du jour atteint');
      envois.push({ reseau, texte: article.texte });
      return { distantId: `${reseau}-post-${envois.length}`, url: `https://${reseau}.exemple/p/${envois.length}` };
    },
    lireCommentaires: async () => [{ genre: 'commentaire' as const, distantId: 'c1', fil: 'facebook-post-1', auteur: 'Lina', texte: 'Super !', instant: Date.now(), sortant: false }],
    repondreCommentaire: async () => ({ distantId: 'c1-reponse' }),
    lireMessages: async () => [{ genre: 'message' as const, distantId: 'm1', fil: 'conv-1', auteur: 'Marc', auteurId: 'u-marc', texte: 'Vous êtes ouverts ?', instant: Date.now() - 30 * 3600_000, sortant: false }],
    repondreMessage: async () => ({ distantId: 'm1-reponse' }),
  } as any;
}
remplacerAdaptateur('facebook', faux('facebook'));
remplacerAdaptateur('linkedin', faux('linkedin'));

async function relier(reseau: 'facebook' | 'linkedin') {
  const { url } = sociale.commencerConnexion(projet.id, reseau);
  const etat = new URL(url).searchParams.get('state')!;
  const r = await sociale.terminerConnexion(new URLSearchParams({ state: etat, code: 'code-du-reseau' }));
  assert.ok(r.ok, r.ok ? '' : r.raison);
  return r.ok ? r.comptes[0]! : null!;
}

/* ------------------------------ Règles pures ------------------------------ */

test('le texte suit le réseau : lien ajouté là où il se clique, jamais coupé à la limite', () => {
  const lien = 'https://beluga.exemple.ch/m/l/abc';
  assert.equal(shared.texteDuReseau('linkedin', 'Bonjour', lien), `Bonjour\n\n${lien}`);
  assert.equal(shared.texteDuReseau('instagram', 'Bonjour', lien), 'Bonjour');
  const long = shared.texteDuReseau('x', 'a'.repeat(400), lien);
  assert.ok(long.length <= 280 && long.endsWith(lien), long);
});

test('le bilan d’un contenu se lit par compte', () => {
  assert.equal(shared.bilanDePublication([]), 'aucune');
  assert.equal(shared.bilanDePublication([{ etat: 'publie' }, { etat: 'publie' }]), 'publie');
  assert.equal(shared.bilanDePublication([{ etat: 'publie' }, { etat: 'echec' }]), 'partiel');
  assert.equal(shared.bilanDePublication([{ etat: 'echec' }]), 'echec');
  assert.deepEqual(shared.ciblesAEnvoyer([{ etat: 'publie' }, { etat: 'echec' }, { etat: 'en_attente' }, { etat: 'en_cours' }]).map((c) => c.etat), ['echec', 'en_attente']);
});

test('un contenu programmé ne part qu’à son heure, et seulement s’il vise un compte', () => {
  const c = { etape: 'programme', datePrevue: '2026-10-20', heurePrevue: '14:30' };
  const heure = new Date('2026-10-20T14:30:00').getTime();
  assert.equal(shared.contenuAPublier(c, [{ etat: 'en_attente' }], heure - 1000), false);
  assert.equal(shared.contenuAPublier(c, [{ etat: 'en_attente' }], heure + 1000), true);
  assert.equal(shared.contenuAPublier(c, [], heure + 1000), false);
  assert.equal(shared.contenuAPublier({ ...c, etape: 'pret' }, [{ etat: 'en_attente' }], heure + 1000), false);
  // Sans heure : neuf heures.
  assert.equal(shared.instantPrevu('2026-10-20', null), new Date('2026-10-20T09:00:00').getTime());
});

test('un message privé Meta ne se répond plus après 24 heures', () => {
  const maintenant = Date.now();
  assert.equal(shared.raisonReponseRefusee({ reseau: 'facebook', genre: 'message', texte: 'Oui', dernierRecuLe: maintenant - 3600_000, maintenant }), null);
  assert.match(shared.raisonReponseRefusee({ reseau: 'facebook', genre: 'message', texte: 'Oui', dernierRecuLe: maintenant - 25 * 3600_000, maintenant }) ?? '', /24 heures/);
  assert.match(shared.raisonReponseRefusee({ reseau: 'linkedin', genre: 'message', texte: 'Oui' }) ?? '', /messages privés/);
});

test('le système publie depuis « Programmé », « Prêt » ou « En échec », jamais depuis un brouillon', () => {
  assert.equal(shared.transitionPermise({ de: 'pret', vers: 'publie', parQui: 'systeme' }), null);
  assert.equal(shared.transitionPermise({ de: 'echec', vers: 'publie', parQui: 'systeme' }), null);
  assert.ok(shared.transitionPermise({ de: 'brouillon', vers: 'publie', parQui: 'systeme' }));
});

/* ------------------------------ Le démon ------------------------------ */

test('relier exige l’application, puis range les jetons au coffre (une fiche par secret)', async () => {
  assert.throws(() => sociale.commencerConnexion(projet.id, 'facebook'), /Créer/);
  assert.ok(sociale.ecrireApplication({ reseau: 'facebook', clientId: 'app-meta', secret: 'secret-meta-123' }).ok);
  assert.ok(sociale.ecrireApplication({ reseau: 'linkedin', clientId: 'app-li', secret: 'secret-li-456' }).ok);
  assert.equal(sociale.lireApplication('meta').etat, 'en_validation');
  const fb = await relier('facebook');
  assert.equal(fb.etat, 'relie');
  const ligne = getDb().prepare('SELECT * FROM marketing_comptes WHERE id = ?').get(fb.id) as any;
  assert.ok(!JSON.stringify(ligne).includes('jeton-facebook-secret'), 'la table ne garde jamais le jeton');
  assert.ok(listerAcces().some((a) => a.champs.jeton === 'jeton-facebook-secret' && a.projectId === projet.id));
  assert.ok(listerAcces().some((a) => a.champs.cle === 'secret-meta-123' && a.projectId === null));
  await relier('linkedin');
  assert.equal(sociale.listerComptes(projet.id).length, 2);
});

test('une connexion qui ne vient pas de Beluga est refusée', async () => {
  const r = await sociale.terminerConnexion(new URLSearchParams({ state: 'invente', code: 'x' }));
  assert.equal(r.ok, false);
});

test('« Publier maintenant » part sur chaque compte, et ne republie jamais un compte servi', async () => {
  const comptes = sociale.listerComptes(projet.id);
  const c = marketing.creerContenu({ projectId: projet.id, genre: 'post', canal: 'facebook', titre: 'Lancement', texte: 'Le produit sort', origine: 'humain' });
  assert.ok(c.ok);
  const id = c.ok ? c.contenu.id : '';
  assert.ok(sociale.ecrireCibles(id, comptes.map((x) => x.id)).ok);
  assert.deepEqual(marketing.lireContenu(id)!.canaux.sort(), ['facebook', 'linkedin']);
  // Un brouillon ne part pas.
  assert.equal((await sociale.publierContenu(id, 'maintenant')).ok, false);
  marketing.changerEtape(id, 'pret', 'humain');

  refuserLinkedin = true;
  const premier = await sociale.publierContenu(id, 'maintenant');
  assert.ok(premier.ok && premier.bilan === 'partiel');
  assert.equal(marketing.lireContenu(id)!.etape, 'echec');
  assert.match(marketing.lireContenu(id)!.raisonEchec ?? '', /1 sur 2 publiés.*quota/);
  assert.equal(envois.filter((e) => e.reseau === 'facebook').length, 1);
  assert.ok(envois[0]!.texte.includes('/m/l/'), 'le lien de suivi part dans le texte');

  refuserLinkedin = false;
  const second = await sociale.publierContenu(id, 'maintenant');
  assert.ok(second.ok && second.bilan === 'publie');
  assert.equal(envois.filter((e) => e.reseau === 'facebook').length, 1, 'Facebook n’est pas republié');
  assert.equal(envois.filter((e) => e.reseau === 'linkedin').length, 1);
  const fini = marketing.lireContenu(id)!;
  assert.equal(fini.etape, 'publie');
  assert.ok(fini.urlPubliee);
});

test('le minuteur publie un contenu programmé à son heure, et un envoi coupé devient un échec', async () => {
  const [compte] = sociale.listerComptes(projet.id).filter((x) => x.reseau === 'facebook');
  const c = marketing.creerContenu({ projectId: projet.id, genre: 'post', canal: 'facebook', titre: 'Promo', texte: 'Demain', origine: 'humain', datePrevue: '2026-10-20' });
  const id = c.ok ? c.contenu.id : '';
  marketing.modifierContenu(id, { heurePrevue: '10:00' }, 'humain');
  sociale.ecrireCibles(id, [compte!.id]);
  marketing.changerEtape(id, 'pret', 'humain');
  assert.ok(marketing.changerEtape(id, 'programme', 'humain').ok);
  const avant = envois.length;
  assert.equal(await sociale.tourDePublication(new Date('2026-10-20T09:59:00').getTime()), 0);
  assert.equal(envois.length, avant);
  assert.equal(await sociale.tourDePublication(new Date('2026-10-20T10:01:00').getTime()), 1);
  assert.equal(envois.length, avant + 1);
  assert.equal(marketing.lireContenu(id)!.etape, 'publie');

  // Un envoi « en cours » d'avant un redémarrage n'est jamais renvoyé.
  const d = marketing.creerContenu({ projectId: projet.id, genre: 'post', canal: 'facebook', titre: 'Coupé', texte: 'Coupé', origine: 'humain', datePrevue: '2026-10-21' });
  const did = d.ok ? d.contenu.id : '';
  sociale.ecrireCibles(did, [compte!.id]);
  marketing.changerEtape(did, 'pret', 'humain');
  marketing.changerEtape(did, 'programme', 'humain');
  /* L'envoi est tenté une heure AVANT l'instant simulé, jamais d'après
     l'horloge réelle : passé le 22/10/2026, `Date.now()` tombait APRÈS
     l'instant du tour, et l'envoi ne paraissait plus interrompu. */
  const instant = new Date('2026-10-22T10:00:00').getTime();
  getDb().prepare("UPDATE marketing_publications SET etat = 'en_cours', tente_le = ? WHERE contenu_id = ?").run(instant - 3600_000, did);
  const n = envois.length;
  await sociale.tourDePublication(instant);
  assert.equal(envois.length, n);
  assert.equal(sociale.ciblesDuContenu(did)[0]!.etat, 'echec');
  assert.match(sociale.ciblesDuContenu(did)[0]!.raison ?? '', /interrompu/);
});

test('un jeton proche de l’échéance se renouvelle tout seul', async () => {
  const [li] = sociale.listerComptes(projet.id).filter((x) => x.reseau === 'linkedin');
  getDb().prepare('UPDATE marketing_comptes SET expire_le = ? WHERE id = ?').run(Date.now() + 60_000, li!.id);
  await sociale.tourDePublication(Date.now());
  assert.ok(listerAcces().some((a) => a.champs.jeton === 'jeton-linkedin-neuf'));
  assert.ok(sociale.lireCompte(li!.id)!.expireLe! > Date.now() + 3600_000);
});

test('les messages se relèvent sans doublon ; l’agent propose, l’utilisateur envoie', async () => {
  const [fb] = sociale.listerComptes(projet.id).filter((x) => x.reseau === 'facebook');
  assert.equal(await sociale.releverCompte(fb!.id), 2);
  assert.equal(await sociale.releverCompte(fb!.id), 0, 'une seconde relève n’ajoute rien');
  assert.equal(sociale.compterMessagesNonLus(projet.id), 2);
  const commentaire = sociale.listerMessages(projet.id).find((m) => m.genre === 'commentaire')!;
  assert.ok(commentaire.contenuId, 'le commentaire est rattaché au contenu publié');
  assert.ok(sociale.proposerReponse(commentaire.id, 'Merci Lina !', projet.id).ok);
  assert.equal(sociale.listerMessages(projet.id).find((m) => m.id === commentaire.id)!.brouillon, 'Merci Lina !');
  const r = await sociale.repondre(commentaire.id, 'Merci Lina !');
  assert.ok(r.ok);
  assert.equal(sociale.compterMessagesNonLus(projet.id), 1);
  // Le message privé a 30 heures : Meta refuserait, on le dit avant.
  const prive = sociale.listerMessages(projet.id).find((m) => m.genre === 'message')!;
  const refus = await sociale.repondre(prive.id, 'Oui !');
  assert.ok(!refus.ok && /24 heures/.test(refus.raison));
});

test('l’adresse publique d’un visuel est signée et temporaire', () => {
  const url = sociale.urlMediaPublique('piece-inconnue', Date.now());
  const route = new URL(url).pathname;
  assert.equal(sociale.mediaDeLAdressePublique(route), null, 'pièce inconnue : rien');
  assert.equal(sociale.mediaDeLAdressePublique(route.replace(/[^/]+$/, 'falsifiee')), null);
  assert.equal(sociale.mediaDeLAdressePublique(route, Date.now() + 7 * 3600_000), null, 'échue');
});

/* LE RELEVÉ D'AUDIENCE : une fois par jour, et un réseau qui refuse ne met jamais le compte en panne. */
test('le relevé d’audience écrit une fois par jour et nourrit la vue d’ensemble', async () => {
  const { listerComptes, releverAudience, vueDAudienceDuProjet, vueDAudienceDesProjets } = await import('../publication-sociale.js');
  const compte = listerComptes(projet.id).find((c) => c.reseau === 'facebook')!;
  assert.ok(compte, 'le compte Facebook de l’essai est relié');
  let lectures = 0;
  const base = faux('facebook');
  remplacerAdaptateur('facebook', {
    ...base,
    lireStatistiques: async () => {
      lectures += 1;
      return { abonnes: 321, publications: [{ distantId: 'pub-chiffree', vues: 55, commentaires: 3, reactions: 7 }] };
    },
  });
  const midi = new Date('2026-10-31T12:00:00').getTime();
  assert.equal(await releverAudience(compte.id, midi), true);
  assert.equal(await releverAudience(compte.id, midi + 600_000), false, 'pas deux relevés le même jour');
  assert.equal(lectures, 1);
  const vue = vueDAudienceDuProjet(projet.id, 30, midi);
  assert.equal(vue.bilan.abonnes, 321);
  assert.equal(vue.bilan.vues, 55);
  const tuile = vue.reseaux.find((r) => r.compteId === compte.id)!;
  assert.equal(tuile.ouvert, true);
  assert.equal(tuile.releve, true);
  const accueil = vueDAudienceDesProjets([{ projectId: projet.id, nom: projet.name }], 30, midi);
  assert.equal(accueil.bilan.vues, 55);
  assert.equal(accueil.projets?.[0]?.bilan.abonnes, 321);
  /* Un refus du réseau : aucun relevé, et le compte reste relié. */
  remplacerAdaptateur('facebook', {
    ...base,
    lireStatistiques: async () => {
      throw new Error('droit « read_insights » absent');
    },
  });
  assert.equal(await releverAudience(compte.id, midi + 86_400_000), false);
  assert.equal(listerComptes(projet.id).find((c) => c.id === compte.id)?.etat, 'relie');
  /* Un réseau sans chiffres ne prétend pas en avoir. */
  const linkedin = vueDAudienceDuProjet(projet.id, 30, midi).reseaux.find((r) => r.reseau === 'linkedin');
  if (linkedin) assert.equal(linkedin.ouvert, false);
  remplacerAdaptateur('facebook', base);
});

test('retirer un compte archive ses jetons et garde ses publications passées', () => {
  const [fb] = sociale.listerComptes(projet.id).filter((x) => x.reseau === 'facebook');
  assert.ok(sociale.retirerCompte(fb!.id, projet.id).ok);
  assert.ok(!listerAcces().some((a) => a.champs.jeton === 'jeton-facebook-secret'));
  assert.ok((getDb().prepare("SELECT COUNT(*) AS n FROM marketing_publications WHERE compte_id = ? AND etat = 'publie'").get(fb!.id) as { n: number }).n > 0);
});
