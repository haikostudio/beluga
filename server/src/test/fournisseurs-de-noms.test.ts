import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jugerAcces } from '@beluga/shared';

/*
 * LES FOURNISSEURS DE NOMS — cinq pilotes derrière une interface.
 *
 * Aucune requête ne part : chaque pilote reçoit une fausse fonction de requête
 * qui NOTE ce qu'on lui demande et rend la réponse que le test a préparée. Le
 * coffre-fort n'est jamais ouvert non plus : la lecture des secrets reçoit ses
 * sources. Le bac à sable ci-dessous ne sert qu'à charger le module sans
 * approcher les données de la machine.
 */

process.env.BELUGA_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fournisseurs-de-noms-'));

const { SECRETS_DES_FOURNISSEURS, fournisseurRetenu, piloteDeNoms, secretsDuFournisseur } = await import(
  '../fournisseurs-de-noms.js'
);

const ZONE = 'exemple.com';
const IP = '203.0.113.10';
const AUTRE_IP = '198.51.100.7';

interface Demande {
  methode: string;
  url: string;
  corps: any;
  entetes: Record<string, string>;
}
type Rendu = { statut?: number; corps?: unknown };

/** Une fausse requête : note chaque demande, répond ce que `repondre` décide (200 et `{}` par défaut). */
function fausseRequete(repondre: (demande: Demande) => Rendu | undefined) {
  const demandes: Demande[] = [];
  const requete = (async (url: any, init: any = {}) => {
    const entetes: Record<string, string> = {};
    for (const [cle, valeur] of Object.entries(init.headers ?? {})) entetes[cle.toLowerCase()] = String(valeur);
    const demande: Demande = {
      methode: init.method ?? 'GET',
      url: String(url),
      corps: init.body ? JSON.parse(init.body) : undefined,
      entetes,
    };
    demandes.push(demande);
    const { statut = 200, corps = {} } = repondre(demande) ?? {};
    // Une réponse « sans contenu » ne porte pas de corps : la construire avec en lève.
    if (statut === 204) return new Response(null, { status: 204 });
    return new Response(typeof corps === 'string' ? corps : JSON.stringify(corps), { status: statut });
  }) as typeof fetch;
  return { requete, demandes, ecrites: () => demandes.filter((d) => d.methode !== 'GET') };
}

/* ------------------------------------------------------------------ */
/* Le fournisseur retenu                                                */
/* ------------------------------------------------------------------ */

test('réglage vide : Hetzner si un jeton est connu, la règle « tous les noms » sinon', () => {
  assert.equal(fournisseurRetenu('', true), 'hetzner');
  assert.equal(fournisseurRetenu('', false), 'joker');
});

test('une valeur connue est retenue telle quelle, jeton Hetzner ou pas', () => {
  for (const connu of ['hetzner', 'cloudflare', 'infomaniak', 'ovh', 'gandi', 'joker'] as const) {
    assert.equal(fournisseurRetenu(connu, true), connu);
    assert.equal(fournisseurRetenu(connu, false), connu);
  }
});

test('une valeur inconnue suit la même règle que le réglage vide', () => {
  assert.equal(fournisseurRetenu('route53', true), 'hetzner');
  assert.equal(fournisseurRetenu('route53', false), 'joker');
});

/* ------------------------------------------------------------------ */
/* Les secrets                                                          */
/* ------------------------------------------------------------------ */

const tousLesSecrets = Object.values(SECRETS_DES_FOURNISSEURS).flat();

test('chaque secret a SA fiche, que le coffre-fort accepte', () => {
  assert.equal(new Set(tousLesSecrets.map((s) => s.genre)).size, tousLesSecrets.length);
  assert.equal(new Set(tousLesSecrets.map((s) => s.nom)).size, tousLesSecrets.length);
  for (const secret of tousLesSecrets) {
    const juge = jugerAcces({ nom: secret.nom, type: secret.type, champs: { service: secret.service, [secret.champ]: 'valeur-d-essai-0123456789' } });
    assert.equal(juge.ok, true, `${secret.nom} : ${JSON.stringify(juge)}`);
  }
});

test('chaque fiche attendue n’est reconnue que par son propre secret', () => {
  for (const secret of tousLesSecrets) {
    const reconnue = tousLesSecrets.filter((autre) => autre.motif.test(`${secret.service} ${secret.nom}`));
    assert.deepEqual(reconnue.map((r) => r.genre), [secret.genre]);
  }
});

test('la fiche Hetzner garde le nom et le motif que l’assistant range déjà', () => {
  assert.deepEqual(
    { ...SECRETS_DES_FOURNISSEURS.hetzner[0], motif: String(SECRETS_DES_FOURNISSEURS.hetzner[0].motif) },
    { genre: 'dns', nom: 'Hetzner — jeton du nom de domaine', type: 'jeton', service: 'Hetzner', champ: 'jeton', motif: '/hetzner/i', designation: 'le jeton' },
  );
});

const fiche = (nom: string, type: string, champs: Record<string, string>) => ({ nom, type, champs });
const sources = (fichier: string | Error, fiches: ReturnType<typeof fiche>[]) => ({
  fichierHetzner: async () => {
    if (fichier instanceof Error) throw fichier;
    return fichier;
  },
  fiches: () => fiches,
});

test('Hetzner : le fichier du serveur d’abord, le coffre ensuite', async () => {
  const coffre = [fiche('Hetzner — jeton du nom de domaine', 'jeton', { service: 'Hetzner', jeton: ' du-coffre ' })];
  assert.deepEqual(await secretsDuFournisseur('hetzner', sources('du-fichier', coffre)), { valeurs: { dns: 'du-fichier' }, manque: '' });
  assert.deepEqual(await secretsDuFournisseur('hetzner', sources(new Error('pas de fichier'), coffre)), { valeurs: { dns: 'du-coffre' }, manque: '' });
});

test('une fiche se reconnaît à son service OU à son nom, clé d’API comprise', async () => {
  const parService = [fiche('Nom de domaine', 'cle-api', { service: 'Cloudflare', cle: 'cf-cle' })];
  assert.equal((await secretsDuFournisseur('cloudflare', sources('', parService))).valeurs['dns-cloudflare'], 'cf-cle');
  const parNom = [fiche('Jeton gandi', 'jeton', { jeton: 'pat-essai' })];
  assert.equal((await secretsDuFournisseur('gandi', sources('', parNom))).valeurs['dns-gandi'], 'pat-essai');
});

test('un secret absent se DIT, avec l’endroit où le régler', async () => {
  const lus = await secretsDuFournisseur('cloudflare', sources('jeton-hetzner-sans-rapport', []));
  assert.deepEqual(lus.valeurs, {});
  assert.equal(lus.manque, 'le jeton de Cloudflare manque : il se règle dans Réglages, page Installation');
  // Une fiche d'un autre type (un mot de passe du compte) n'est pas un jeton d'API.
  const motDePasse = [fiche('Infomaniak — compte', 'mot-de-passe', { identifiant: 'moi', motDePasse: 'x' })];
  assert.equal(
    (await secretsDuFournisseur('infomaniak', sources('', motDePasse))).manque,
    "le jeton d'Infomaniak manque : il se règle dans Réglages, page Installation",
  );
});

test('un coffre illisible vaut « aucun secret », il ne fait pas tomber la publication', async () => {
  const casse = { fichierHetzner: async () => '', fiches: () => { throw new Error('base fermée'); } };
  assert.match((await secretsDuFournisseur('hetzner', casse)).manque, /^le jeton de Hetzner manque/);
});

test('OVH : trois fiches distinctes, chacune à sa place', async () => {
  const coffre = SECRETS_DES_FOURNISSEURS.ovh.map((s, rang) => fiche(s.nom, s.type, { service: s.service, [s.champ]: `valeur-${rang}` }));
  assert.deepEqual(await secretsDuFournisseur('ovh', sources('', coffre)), {
    valeurs: { 'dns-ovh-application': 'valeur-0', 'dns-ovh-secret': 'valeur-1', 'dns-ovh-consommateur': 'valeur-2' },
    manque: '',
  });
  // Des noms saisis à la main, dans un autre ordre, sont départagés de la même façon.
  const aLaMain = [
    fiche('OVH secret d’application', 'cle-api', { cle: 'le-secret' }),
    fiche('ovh consommateur', 'cle-api', { cle: 'la-conso' }),
    fiche('Clé application OVH', 'cle-api', { cle: 'l-appli' }),
  ];
  assert.deepEqual((await secretsDuFournisseur('ovh', sources('', aLaMain))).valeurs, {
    'dns-ovh-application': 'l-appli',
    'dns-ovh-secret': 'le-secret',
    'dns-ovh-consommateur': 'la-conso',
  });
});

test('OVH : ce qui manque est nommé, secret par secret', async () => {
  const uneSeule = [fiche('OVH — secret d’application du nom de domaine', 'cle-api', { service: 'OVH', cle: 's' })];
  assert.equal(
    (await secretsDuFournisseur('ovh', sources('', uneSeule))).manque,
    "la clé d'application et la clé de consommateur manquent pour OVH : cela se règle dans Réglages, page Installation",
  );
});

/* ------------------------------------------------------------------ */
/* Hetzner — la logique d'origine, à l'identique                        */
/* ------------------------------------------------------------------ */

const HETZNER = 'https://api.hetzner.cloud/v1/zones';
const zoneHetzner = (delegation = 'valid') => ({
  corps: { zones: [{ id: 42, name: ZONE, assigned_nameservers: { delegation_status: delegation } }] },
});

test('Hetzner : la zone est cherchée par son nom, puis le nom est posté seul', async () => {
  const faux = fausseRequete((d) => (d.url.startsWith(`${HETZNER}?`) ? zoneHetzner() : { statut: 201 }));
  assert.equal(await piloteDeNoms('hetzner', { dns: 'jeton-h' }, faux.requete).creerA(ZONE, 'blog', IP), null);
  assert.deepEqual(faux.demandes.map((d) => `${d.methode} ${d.url}`), [`GET ${HETZNER}?name=exemple.com`, `POST ${HETZNER}/42/rrsets`]);
  assert.deepEqual(faux.demandes[1].corps, { name: 'blog', type: 'A', ttl: 300, records: [{ value: IP }] });
  for (const d of faux.demandes) assert.equal(d.entetes.authorization, 'Bearer jeton-h');
});

test('Hetzner : une délégation « invalid » est refusée AVANT toute écriture', async () => {
  const faux = fausseRequete(() => zoneHetzner('invalid'));
  const pilote = piloteDeNoms('hetzner', { dns: 'jeton-h' }, faux.requete);
  const raison = await pilote.creerA(ZONE, 'blog', IP);
  assert.match(raison ?? '', /ne commande pas encore le domaine \(délégation « invalid »\)/);
  assert.match((await pilote.supprimerA(ZONE, 'blog')) ?? '', /délégation « invalid »/);
  assert.deepEqual(faux.ecrites(), []);
});

test('Hetzner : un conflit est RELU — nom présent = succès, nom absent = refus', async () => {
  const present = fausseRequete((d) =>
    d.url.startsWith(`${HETZNER}?`) ? zoneHetzner() : d.methode === 'POST' ? { statut: 409, corps: { error: { code: 'conflict' } } } : { statut: 200 },
  );
  assert.equal(await piloteDeNoms('hetzner', { dns: 'j' }, present.requete).creerA(ZONE, 'blog', IP), null);
  assert.equal(present.demandes.at(-1)?.url, `${HETZNER}/42/rrsets/blog/A`);

  const absent = fausseRequete((d) =>
    d.url.startsWith(`${HETZNER}?`) ? zoneHetzner() : d.methode === 'POST' ? { statut: 422, corps: 'invalid input' } : { statut: 404 },
  );
  assert.equal(
    await piloteDeNoms('hetzner', { dns: 'j' }, absent.requete).creerA(ZONE, 'blog', IP),
    "le fournisseur a refusé (422) et le nom n'existe pas",
  );
});

test('Hetzner : les refus gardent leurs phrases d’origine', async () => {
  const sourd = fausseRequete(() => ({ statut: 503 }));
  assert.equal(await piloteDeNoms('hetzner', { dns: 'j' }, sourd.requete).creerA(ZONE, 'blog', IP), 'le fournisseur de noms ne répond pas (503)');

  const sansZone = fausseRequete(() => ({ corps: { zones: [] } }));
  assert.equal(await piloteDeNoms('hetzner', { dns: 'j' }, sansZone.requete).creerA(ZONE, 'blog', IP), 'zone exemple.com introuvable chez le fournisseur de noms');

  const interdit = fausseRequete((d) => (d.url.startsWith(`${HETZNER}?`) ? zoneHetzner() : { statut: 403, corps: 'forbidden' }));
  const pilote = piloteDeNoms('hetzner', { dns: 'j' }, interdit.requete);
  assert.equal(await pilote.creerA(ZONE, 'blog', IP), 'le fournisseur a refusé (403)');
  assert.equal(await pilote.supprimerA(ZONE, 'blog'), 'le fournisseur a refusé (403)');
});

test('Hetzner : la suppression vise le seul « A » du nom, et un nom déjà parti n’est pas une panne', async () => {
  const faux = fausseRequete((d) => (d.url.startsWith(`${HETZNER}?`) ? zoneHetzner() : { statut: 404 }));
  assert.equal(await piloteDeNoms('hetzner', { dns: 'jeton-h' }, faux.requete).supprimerA(ZONE, 'blog'), null);
  const retrait = faux.demandes.at(-1)!;
  assert.equal(`${retrait.methode} ${retrait.url}`, `DELETE ${HETZNER}/42/rrsets/blog/A`);
  assert.equal(retrait.entetes.authorization, 'Bearer jeton-h');
});

/* ------------------------------------------------------------------ */
/* Cloudflare                                                           */
/* ------------------------------------------------------------------ */

const CLOUDFLARE = 'https://api.cloudflare.com/client/v4';
const LISTE_CF = `${CLOUDFLARE}/zones/zid/dns_records?type=A&name=blog.exemple.com`;

/** Cloudflare simulé : la zone « zid », et sous le nom les enregistrements donnés. */
function cloudflare(enregistrements: Array<{ id: string; content: string }>, ecriture: Rendu = { corps: { success: true, result: { id: 'neuf' } } }) {
  return fausseRequete((d) => {
    if (d.url === `${CLOUDFLARE}/zones?name=exemple.com`) return { corps: { success: true, result: [{ id: 'zid', name: ZONE }] } };
    if (d.methode === 'GET') return { corps: { success: true, result: enregistrements.map((e) => ({ ...e, type: 'A', name: 'blog.exemple.com' })) } };
    return ecriture;
  });
}

test('Cloudflare : la zone, la lecture du nom, puis la création sans relais', async () => {
  const faux = cloudflare([]);
  assert.equal(await piloteDeNoms('cloudflare', { 'dns-cloudflare': 'jeton-cf' }, faux.requete).creerA(ZONE, 'blog', IP), null);
  assert.deepEqual(faux.demandes.map((d) => `${d.methode} ${d.url}`), [
    `GET ${CLOUDFLARE}/zones?name=exemple.com`,
    `GET ${LISTE_CF}`,
    `POST ${CLOUDFLARE}/zones/zid/dns_records`,
  ]);
  assert.deepEqual(faux.demandes[2].corps, { type: 'A', name: 'blog.exemple.com', content: IP, ttl: 300, proxied: false });
  for (const d of faux.demandes) assert.equal(d.entetes.authorization, 'Bearer jeton-cf');
});

test('Cloudflare : un nom déjà posé sur la même adresse est un succès, sans rien écrire', async () => {
  const faux = cloudflare([{ id: 'r1', content: IP }]);
  const pilote = piloteDeNoms('cloudflare', { 'dns-cloudflare': 'j' }, faux.requete);
  assert.equal(await pilote.creerA(ZONE, 'blog', IP), null);
  assert.deepEqual(faux.ecrites(), []);
  assert.equal(await pilote.existeA(ZONE, 'blog'), true);
});

test('Cloudflare : un nom qui mène AILLEURS n’est ni doublé ni remplacé', async () => {
  const faux = cloudflare([{ id: 'r1', content: AUTRE_IP }]);
  const raison = await piloteDeNoms('cloudflare', { 'dns-cloudflare': 'j' }, faux.requete).creerA(ZONE, 'blog', IP);
  assert.match(raison ?? '', /blog\.exemple\.com existe déjà chez Cloudflare et mène à 198\.51\.100\.7/);
  assert.deepEqual(faux.ecrites(), []);
});

test('Cloudflare : un refus est rendu avec ce que le fournisseur en dit', async () => {
  const jetonFaux = fausseRequete(() => ({ statut: 403, corps: { success: false, errors: [{ code: 10000, message: 'Authentication error' }] } }));
  assert.equal(
    await piloteDeNoms('cloudflare', { 'dns-cloudflare': 'j' }, jetonFaux.requete).creerA(ZONE, 'blog', IP),
    'Cloudflare a refusé (403) : Authentication error',
  );
  const ecritureRefusee = cloudflare([], { statut: 400, corps: { success: false, errors: [{ code: 9005, message: 'Content for A record must be a valid IPv4 address.' }] } });
  assert.equal(
    await piloteDeNoms('cloudflare', { 'dns-cloudflare': 'j' }, ecritureRefusee.requete).creerA(ZONE, 'blog', IP),
    'Cloudflare a refusé (400) : Content for A record must be a valid IPv4 address.',
  );
  const sansZone = fausseRequete(() => ({ corps: { success: true, result: [] } }));
  assert.match((await piloteDeNoms('cloudflare', { 'dns-cloudflare': 'j' }, sansZone.requete).creerA(ZONE, 'blog', IP)) ?? '', /zone exemple\.com introuvable chez Cloudflare/);
});

test('Cloudflare : la suppression retire chaque enregistrement du nom par son identifiant', async () => {
  const faux = cloudflare([{ id: 'r1', content: IP }]);
  assert.equal(await piloteDeNoms('cloudflare', { 'dns-cloudflare': 'jeton-cf' }, faux.requete).supprimerA(ZONE, 'blog'), null);
  const retraits = faux.ecrites();
  assert.deepEqual(retraits.map((d) => `${d.methode} ${d.url}`), [`DELETE ${CLOUDFLARE}/zones/zid/dns_records/r1`]);
  assert.equal(retraits[0].entetes.authorization, 'Bearer jeton-cf');

  const vide = cloudflare([]);
  const pilote = piloteDeNoms('cloudflare', { 'dns-cloudflare': 'j' }, vide.requete);
  assert.equal(await pilote.supprimerA(ZONE, 'blog'), null);
  assert.equal(await pilote.existeA(ZONE, 'blog'), false);
  assert.deepEqual(vide.ecrites(), []);
});

/* ------------------------------------------------------------------ */
/* Infomaniak                                                           */
/* ------------------------------------------------------------------ */

const INFOMANIAK = 'https://api.infomaniak.com/2/zones/exemple.com/records';

/** Infomaniak simulé : la zone entière est rendue, d'autres noms compris. */
function infomaniak(duNom: Array<{ id: number; target: string }>, ecriture: Rendu = { corps: { result: 'success', data: { id: 99 } } }) {
  return fausseRequete((d) => {
    if (d.methode !== 'GET') return ecriture;
    return {
      corps: {
        result: 'success',
        data: [
          { id: 1, type: 'A', source: 'www', target: AUTRE_IP },
          { id: 2, type: 'TXT', source: 'blog', target: '"v=spf1 -all"' },
          ...duNom.map((e) => ({ ...e, type: 'A', source: 'blog' })),
        ],
      },
    };
  });
}

test('Infomaniak : la zone est lue, puis le nom relatif est posté', async () => {
  const faux = infomaniak([]);
  assert.equal(await piloteDeNoms('infomaniak', { 'dns-infomaniak': 'jeton-ik' }, faux.requete).creerA(ZONE, 'blog', IP), null);
  assert.deepEqual(faux.demandes.map((d) => `${d.methode} ${d.url}`), [`GET ${INFOMANIAK}`, `POST ${INFOMANIAK}`]);
  assert.deepEqual(faux.demandes[1].corps, { source: 'blog', type: 'A', target: IP, ttl: 300 });
  for (const d of faux.demandes) assert.equal(d.entetes.authorization, 'Bearer jeton-ik');
});

test('Infomaniak : un nom déjà posé sur la même adresse est un succès, un autre type ne compte pas', async () => {
  const faux = infomaniak([{ id: 7, target: IP }]);
  const pilote = piloteDeNoms('infomaniak', { 'dns-infomaniak': 'j' }, faux.requete);
  assert.equal(await pilote.creerA(ZONE, 'blog', IP), null);
  assert.deepEqual(faux.ecrites(), []);
  assert.equal(await pilote.existeA(ZONE, 'blog'), true);
  // Le TXT « blog » de la zone simulée n'est pas un « A ».
  assert.equal(await piloteDeNoms('infomaniak', { 'dns-infomaniak': 'j' }, infomaniak([]).requete).existeA(ZONE, 'blog'), false);
});

test('Infomaniak : un refus est rendu en clair, et un nom qui mène ailleurs est laissé', async () => {
  const refuse = infomaniak([], { statut: 422, corps: { result: 'error', error: { code: 'validation_failed', description: 'The target is invalid' } } });
  assert.equal(
    await piloteDeNoms('infomaniak', { 'dns-infomaniak': 'j' }, refuse.requete).creerA(ZONE, 'blog', IP),
    'Infomaniak a refusé (422) : The target is invalid',
  );
  const sansZone = fausseRequete(() => ({ statut: 404, corps: { result: 'error', error: { code: 'object_not_found' } } }));
  assert.match((await piloteDeNoms('infomaniak', { 'dns-infomaniak': 'j' }, sansZone.requete).creerA(ZONE, 'blog', IP)) ?? '', /zone exemple\.com introuvable chez Infomaniak/);
  const ailleurs = infomaniak([{ id: 7, target: AUTRE_IP }]);
  assert.match((await piloteDeNoms('infomaniak', { 'dns-infomaniak': 'j' }, ailleurs.requete).creerA(ZONE, 'blog', IP)) ?? '', /existe déjà chez Infomaniak et mène à 198\.51\.100\.7/);
  assert.deepEqual(ailleurs.ecrites(), []);
});

test('Infomaniak : la suppression ne retire que le « A » du nom, par son identifiant', async () => {
  const faux = infomaniak([{ id: 7, target: IP }]);
  assert.equal(await piloteDeNoms('infomaniak', { 'dns-infomaniak': 'jeton-ik' }, faux.requete).supprimerA(ZONE, 'blog'), null);
  const retraits = faux.ecrites();
  assert.deepEqual(retraits.map((d) => `${d.methode} ${d.url}`), [`DELETE ${INFOMANIAK}/7`]);
  assert.equal(retraits[0].entetes.authorization, 'Bearer jeton-ik');
});

/* ------------------------------------------------------------------ */
/* OVH                                                                  */
/* ------------------------------------------------------------------ */

const OVH = 'https://eu.api.ovh.com/1.0';
const SECRETS_OVH = { 'dns-ovh-application': 'cle-appli', 'dns-ovh-secret': 'secret-appli', 'dns-ovh-consommateur': 'cle-conso' };
/** Une heure d'OVH très loin de celle de cette machine : la signature doit s'en servir quand même. */
const HEURE_OVH = 1_700_000_000;

/** OVH simulé : son heure, les identifiants posés sous le nom, la cible de chacun. */
function ovh(cibles: Record<number, string>, ecriture: (d: Demande) => Rendu | undefined = () => undefined) {
  return fausseRequete((d) => {
    if (d.url === `${OVH}/auth/time`) return { corps: String(HEURE_OVH) };
    if (d.methode !== 'GET') return ecriture(d);
    if (d.url.includes('/record?')) return { corps: Object.keys(cibles).map(Number) };
    const id = Number(d.url.split('/').pop());
    return { corps: { id, fieldType: 'A', subDomain: 'blog', target: cibles[id] } };
  });
}

/** La signature qu'OVH attend, recalculée ici à partir de la demande telle qu'elle est partie. */
function signatureAttendue(d: Demande): string {
  const corps = d.corps === undefined ? '' : JSON.stringify(d.corps);
  const clair = ['secret-appli', 'cle-conso', d.methode, d.url, corps, d.entetes['x-ovh-timestamp']].join('+');
  return `$1$${crypto.createHash('sha1').update(clair).digest('hex')}`;
}

test('OVH : lecture, création, puis rechargement de la zone', async () => {
  const faux = ovh({});
  assert.equal(await piloteDeNoms('ovh', SECRETS_OVH, faux.requete).creerA(ZONE, 'blog', IP), null);
  assert.deepEqual(faux.demandes.map((d) => `${d.methode} ${d.url}`), [
    `GET ${OVH}/auth/time`,
    `GET ${OVH}/domain/zone/exemple.com/record?fieldType=A&subDomain=blog`,
    `POST ${OVH}/domain/zone/exemple.com/record`,
    `POST ${OVH}/domain/zone/exemple.com/refresh`,
  ]);
  assert.deepEqual(faux.demandes[2].corps, { fieldType: 'A', subDomain: 'blog', target: IP, ttl: 300 });
  assert.equal(faux.demandes[3].corps, undefined);
});

test('OVH : chaque requête est signée, à l’heure d’OVH et non à celle de la machine', async () => {
  const faux = ovh({});
  await piloteDeNoms('ovh', SECRETS_OVH, faux.requete).creerA(ZONE, 'blog', IP);
  const signees = faux.demandes.slice(1);
  assert.equal(signees.length, 3);
  for (const d of signees) {
    assert.equal(d.entetes['x-ovh-application'], 'cle-appli');
    assert.equal(d.entetes['x-ovh-consumer'], 'cle-conso');
    const instant = Number(d.entetes['x-ovh-timestamp']);
    assert.ok(instant >= HEURE_OVH && instant <= HEURE_OVH + 5, `heure signée : ${instant}`);
    assert.equal(d.entetes['x-ovh-signature'], signatureAttendue(d));
    // Le secret d'application signe, il ne voyage jamais.
    assert.equal(JSON.stringify(d).includes('secret-appli'), false);
  }
  // Le clair écrit EN TOUTES LETTRES, pour ne pas juger la signature avec la même faute des deux côtés.
  const sha1 = (clair: string) => crypto.createHash('sha1').update(clair).digest('hex');
  const [, creation, rechargement] = signees;
  assert.equal(
    creation.entetes['x-ovh-signature'],
    '$1$' +
      sha1(
        'secret-appli+cle-conso+POST+https://eu.api.ovh.com/1.0/domain/zone/exemple.com/record+' +
          '{"fieldType":"A","subDomain":"blog","target":"203.0.113.10","ttl":300}+' +
          creation.entetes['x-ovh-timestamp'],
      ),
  );
  // Sans corps, sa place reste vide entre deux « + ».
  assert.equal(
    rechargement.entetes['x-ovh-signature'],
    '$1$' + sha1(`secret-appli+cle-conso+POST+https://eu.api.ovh.com/1.0/domain/zone/exemple.com/refresh++${rechargement.entetes['x-ovh-timestamp']}`),
  );
});

test('OVH : un nom déjà posé sur la même adresse est un succès — et la zone est tout de même rechargée', async () => {
  const faux = ovh({ 501: IP });
  const pilote = piloteDeNoms('ovh', SECRETS_OVH, faux.requete);
  assert.equal(await pilote.creerA(ZONE, 'blog', IP), null);
  assert.deepEqual(faux.ecrites().map((d) => `${d.methode} ${d.url}`), [`POST ${OVH}/domain/zone/exemple.com/refresh`]);
  assert.equal(await pilote.existeA(ZONE, 'blog'), true);
});

test('OVH : un refus est rendu en clair, et un nom qui mène ailleurs est laissé', async () => {
  const interdit = fausseRequete((d) =>
    d.url.endsWith('/auth/time') ? { corps: String(HEURE_OVH) } : { statut: 403, corps: { message: 'This call has not been granted' } },
  );
  assert.equal(await piloteDeNoms('ovh', SECRETS_OVH, interdit.requete).creerA(ZONE, 'blog', IP), 'OVH a refusé (403) : This call has not been granted');

  const ecritureRefusee = ovh({}, (d) => (d.url.endsWith('/record') ? { statut: 400, corps: { message: 'Invalid target' } } : undefined));
  assert.equal(await piloteDeNoms('ovh', SECRETS_OVH, ecritureRefusee.requete).creerA(ZONE, 'blog', IP), 'OVH a refusé (400) : Invalid target');

  const sansRechargement = ovh({}, (d) => (d.url.endsWith('/refresh') ? { statut: 500, corps: { message: 'Internal' } } : undefined));
  assert.match((await piloteDeNoms('ovh', SECRETS_OVH, sansRechargement.requete).creerA(ZONE, 'blog', IP)) ?? '', /n'a pas pu être rechargée \(500\)/);

  const ailleurs = ovh({ 501: AUTRE_IP });
  assert.match((await piloteDeNoms('ovh', SECRETS_OVH, ailleurs.requete).creerA(ZONE, 'blog', IP)) ?? '', /existe déjà chez OVH et mène à 198\.51\.100\.7/);
  assert.deepEqual(ailleurs.ecrites(), []);
});

test('OVH : la suppression retire chaque identifiant, puis recharge la zone', async () => {
  const faux = ovh({ 501: IP, 502: IP });
  assert.equal(await piloteDeNoms('ovh', SECRETS_OVH, faux.requete).supprimerA(ZONE, 'blog'), null);
  assert.deepEqual(faux.ecrites().map((d) => `${d.methode} ${d.url}`), [
    `DELETE ${OVH}/domain/zone/exemple.com/record/501`,
    `DELETE ${OVH}/domain/zone/exemple.com/record/502`,
    `POST ${OVH}/domain/zone/exemple.com/refresh`,
  ]);
  for (const d of faux.ecrites()) assert.equal(d.entetes['x-ovh-signature'], signatureAttendue(d));

  // Rien sous ce nom : rien à retirer, rien à recharger.
  const vide = ovh({});
  assert.equal(await piloteDeNoms('ovh', SECRETS_OVH, vide.requete).supprimerA(ZONE, 'blog'), null);
  assert.deepEqual(vide.ecrites(), []);
});

/* ------------------------------------------------------------------ */
/* Gandi                                                                */
/* ------------------------------------------------------------------ */

const GANDI = 'https://api.gandi.net/v5/livedns/domains/exemple.com/records/blog/A';

/** Gandi simulé : les adresses du nom, ou `null` quand il n'existe pas. */
function gandi(valeurs: string[] | null, ecriture: Rendu = { statut: 201, corps: { message: 'DNS Record Created' } }) {
  return fausseRequete((d) => {
    if (d.methode !== 'GET') return ecriture;
    return valeurs === null
      ? { statut: 404, corps: { code: 404, message: "Can't find the DNS record blog/A in the zone", object: 'dns-record', cause: 'Not Found' } }
      : { corps: { rrset_name: 'blog', rrset_type: 'A', rrset_ttl: 300, rrset_values: valeurs } };
  });
}

test('Gandi : le nom est lu, puis posé à sa propre adresse', async () => {
  const faux = gandi(null);
  assert.equal(await piloteDeNoms('gandi', { 'dns-gandi': 'pat-essai' }, faux.requete).creerA(ZONE, 'blog', IP), null);
  assert.deepEqual(faux.demandes.map((d) => `${d.methode} ${d.url}`), [`GET ${GANDI}`, `PUT ${GANDI}`]);
  assert.deepEqual(faux.demandes[1].corps, { rrset_values: [IP], rrset_ttl: 300 });
  for (const d of faux.demandes) assert.equal(d.entetes.authorization, 'Bearer pat-essai');
});

test('Gandi : un nom déjà posé sur la même adresse est un succès, sans rien écrire', async () => {
  const faux = gandi([IP]);
  const pilote = piloteDeNoms('gandi', { 'dns-gandi': 'j' }, faux.requete);
  assert.equal(await pilote.creerA(ZONE, 'blog', IP), null);
  assert.deepEqual(faux.ecrites(), []);
  assert.equal(await pilote.existeA(ZONE, 'blog'), true);
  assert.equal(await piloteDeNoms('gandi', { 'dns-gandi': 'j' }, gandi(null).requete).existeA(ZONE, 'blog'), false);
});

test('Gandi : un nom qui mène ailleurs n’est PAS remplacé, bien que l’écriture le permette', async () => {
  const faux = gandi([AUTRE_IP]);
  assert.match((await piloteDeNoms('gandi', { 'dns-gandi': 'j' }, faux.requete).creerA(ZONE, 'blog', IP)) ?? '', /existe déjà chez Gandi et mène à 198\.51\.100\.7/);
  assert.deepEqual(faux.ecrites(), []);
});

test('Gandi : un refus est rendu avec ce que le fournisseur en dit', async () => {
  const jetonFaux = fausseRequete(() => ({ statut: 403, corps: { code: 403, message: 'Access was denied to this resource.', object: 'HTTPForbidden', cause: 'Forbidden' } }));
  const pilote = piloteDeNoms('gandi', { 'dns-gandi': 'j' }, jetonFaux.requete);
  assert.equal(await pilote.creerA(ZONE, 'blog', IP), 'Gandi a refusé (403) : Access was denied to this resource.');
  assert.equal(await pilote.supprimerA(ZONE, 'blog'), 'Gandi a refusé (403) : Access was denied to this resource.');
  await assert.rejects(() => pilote.existeA(ZONE, 'blog'), /Gandi a refusé \(403\)/);
});

test('Gandi : la suppression vise le seul « A » du nom, et un nom déjà parti n’est pas une panne', async () => {
  const faux = gandi([IP], { statut: 204 });
  assert.equal(await piloteDeNoms('gandi', { 'dns-gandi': 'pat-essai' }, faux.requete).supprimerA(ZONE, 'blog'), null);
  assert.deepEqual(faux.demandes.map((d) => `${d.methode} ${d.url}`), [`DELETE ${GANDI}`]);
  assert.equal(faux.demandes[0].entetes.authorization, 'Bearer pat-essai');
  const parti = fausseRequete(() => ({ statut: 404, corps: { code: 404, message: 'Not Found' } }));
  assert.equal(await piloteDeNoms('gandi', { 'dns-gandi': 'j' }, parti.requete).supprimerA(ZONE, 'blog'), null);
});
