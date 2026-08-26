import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSERVATION_PAR_DEFAUT,
  ECART_MINIMAL_MS,
  PointDeSauvegarde,
  SiteASauvegarder,
  dossierDeSite,
  formaterOctets,
  horodatageDePoint,
  jugerSite,
  nettoyerSite,
  pointsAPurger,
  raisonDestinationRefusee,
  resumeParSite,
  siteEstDu,
  siteVierge,
  sitesDuPassage,
  volumeDuPoint,
} from '@haikodev/shared';

/**
 * LES SNAPSHOTS DES SITES — les règles qui se jugent sans base ni disque.
 *
 * Ce que ces tests verrouillent : une fiche qui ne sauvegarderait rien est
 * refusée, changer de moteur efface les identifiants de l'ancien, un site est dû
 * au bon moment (et rattrapé quand le démon a manqué son heure), le ménage ne
 * jette JAMAIS la dernière sauvegarde réussie, et les volumes se lisent.
 */

function site(partiel: Partial<SiteASauvegarder> = {}): SiteASauvegarder {
  return {
    ...siteVierge(null, 'Site'),
    id: 's1',
    base: { moteur: 'mysql', hote: 'db', port: '3306', nom: 'prod', utilisateur: 'root', motDePasse: 'x' },
    ...partiel,
  };
}

function point(partiel: Partial<PointDeSauvegarde> = {}): PointDeSauvegarde {
  return {
    id: 'p1',
    siteId: 's1',
    debut: 1_000,
    fin: 2_000,
    statut: 'reussi',
    octetsBase: 1_000,
    octetsFichiers: 2_000,
    chemin: '/stock/site/2026',
    detail: '',
    origine: 'automatique',
    ...partiel,
  };
}

test('un site sans base ni fichiers est refusé : il ne sauvegarderait rien', () => {
  const vide = site({ base: siteVierge().base });
  const jugement = jugerSite(vide);
  assert.equal(jugement.ok, false);
  assert.match(jugement.raison ?? '', /ne sauvegarderait rien/);
});

test('une base sans nom ni utilisateur est refusée, et le champ manquant est dit', () => {
  const jugement = jugerSite(site({ base: { ...site().base, nom: '' } }));
  assert.equal(jugement.ok, false);
  assert.match(jugement.raison ?? '', /nom/);
});

test('un site nommé, avec sa base complète, est accepté', () => {
  assert.deepEqual(jugerSite(site()), { ok: true });
});

test('une conservation hors bornes est refusée', () => {
  assert.equal(jugerSite(site({ conservationJours: 0 })).ok, false);
  assert.equal(jugerSite(site({ conservationJours: 4000 })).ok, false);
  assert.equal(jugerSite(site({ conservationJours: CONSERVATION_PAR_DEFAUT })).ok, true);
});

test('repasser à « aucune base » efface le mot de passe de l’ancienne', () => {
  const propre = nettoyerSite(site({ base: { ...site().base, moteur: 'aucune' } }));
  assert.equal(propre.base.motDePasse, '');
  assert.equal(propre.base.nom, '');
});

test('des fichiers locaux ne gardent aucun identifiant distant', () => {
  const propre = nettoyerSite(
    site({
      fichiers: { moyen: 'local', chemin: '/var/www', hote: 'ailleurs', port: '22', utilisateur: 'u', motDePasse: 'p' },
    }),
  );
  assert.equal(propre.fichiers.chemin, '/var/www');
  assert.equal(propre.fichiers.motDePasse, '');
  assert.equal(propre.fichiers.hote, '');
});

test('un site jamais sauvegardé est dû tout de suite', () => {
  assert.equal(siteEstDu(site(), null, 10_000_000), true);
});

test('un site éteint n’est jamais dû', () => {
  assert.equal(siteEstDu(site({ actif: false }), null, 10_000_000), false);
});

test('un site pris il y a une heure n’est pas dû ; il l’est après vingt heures', () => {
  const maintenant = 100 * ECART_MINIMAL_MS;
  assert.equal(siteEstDu(site(), point({ debut: maintenant - 3600_000 }), maintenant), false);
  assert.equal(siteEstDu(site(), point({ debut: maintenant - ECART_MINIMAL_MS }), maintenant), true);
});

test('le passage ne retient que les sites dus', () => {
  const maintenant = 100 * ECART_MINIMAL_MS;
  const a = site({ id: 'a' });
  const b = site({ id: 'b' });
  const derniers = new Map([['a', point({ siteId: 'a', debut: maintenant - 1000 })]]);
  assert.deepEqual(
    sitesDuPassage([a, b], derniers, maintenant).map((s) => s.id),
    ['b'],
  );
});

test('le ménage jette ce qui dépasse la conservation, mais garde la dernière réussie', () => {
  const maintenant = 400 * 24 * 3600 * 1000;
  const vieux = point({ id: 'vieux', debut: maintenant - 300 * 24 * 3600 * 1000 });
  const rate = point({ id: 'rate', statut: 'echec', debut: maintenant - 200 * 24 * 3600 * 1000 });
  const purges = pointsAPurger([vieux, rate], 14, maintenant).map((p) => p.id);
  // Le seul point réussi restant est épargné, même très vieux ; l'échec s'en va.
  assert.deepEqual(purges, ['rate']);
});

test('le ménage jette bien les points trop vieux quand un récent existe', () => {
  const maintenant = 400 * 24 * 3600 * 1000;
  const vieux = point({ id: 'vieux', debut: maintenant - 300 * 24 * 3600 * 1000 });
  const recent = point({ id: 'recent', debut: maintenant - 1000 });
  assert.deepEqual(
    pointsAPurger([vieux, recent], 14, maintenant).map((p) => p.id),
    ['vieux'],
  );
});

test('le volume d’un point additionne la base et les fichiers', () => {
  assert.equal(volumeDuPoint(point({ octetsBase: 10, octetsFichiers: 5 })), 15);
});

test('le résumé range les sites du plus récemment sauvegardé au plus ancien', () => {
  const a = site({ id: 'a', nom: 'A' });
  const b = site({ id: 'b', nom: 'B' });
  const resumes = resumeParSite(
    [a, b],
    [point({ id: '1', siteId: 'a', debut: 10 }), point({ id: '2', siteId: 'b', debut: 20 })],
  );
  assert.deepEqual(resumes.map((r) => r.site.id), ['b', 'a']);
  assert.equal(resumes[0].octets, 3_000);
  assert.equal(resumes[0].reussis, 1);
});

test('un volume se lit en unités, avec la virgule française', () => {
  assert.equal(formaterOctets(512), '512 o');
  assert.equal(formaterOctets(1536), '1,5 Ko');
  assert.equal(formaterOctets(3 * 1024 * 1024 * 1024), '3 Go');
});

test('le dossier d’un site est un chemin sûr, et deux homonymes ne se mélangent pas', () => {
  const un = dossierDeSite(site({ id: 'aaaaaaaa11', nom: 'Café Déjà Vu !' }));
  const deux = dossierDeSite(site({ id: 'bbbbbbbb22', nom: 'Café Déjà Vu !' }));
  assert.match(un, /^cafe-deja-vu-aaaaaaaa$/);
  assert.notEqual(un, deux);
});

test('l’horodatage d’un point est triable', () => {
  const a = horodatageDePoint(new Date(2026, 0, 2, 3, 4, 5).getTime());
  const b = horodatageDePoint(new Date(2026, 0, 2, 3, 4, 6).getTime());
  assert.equal(a, '2026-01-02-030405');
  assert.ok(a < b);
});

test('une destination absente ou relative est refusée, en disant pourquoi', () => {
  assert.match(raisonDestinationRefusee('') ?? '', /réglé/);
  assert.match(raisonDestinationRefusee('stockage') ?? '', /absolu/);
  assert.equal(raisonDestinationRefusee('/mnt/stockage'), null);
});
