/**
 * UNE FOURNÉE D'EXEMPLES = UN SEUL CHOIX, ET UNE MAQUETTE PART DE L'ÉCRAN RÉEL (carte « Extension, rapport SEO-GEO et
 * menus », 21/11/2026) : la garde des zones mélangées, le relevé demandé par une piste, les icônes réelles.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { avecLesIconesReelles, refusDeFourneeMelangee, releveLu } from '@beluga/shared';

test('une fournée qui mélange plusieurs zones est refusée, une série du même endroit passe', () => {
  assert.equal(refusDeFourneeMelangee([{ titre: 'A', zone: 'Volet SEO-GEO' }, { titre: 'B', zone: 'volet seo geo' }]), null);
  assert.equal(refusDeFourneeMelangee([{ titre: 'A' }, { titre: 'B' }]), null, 'sans zone déclarée : rien à juger');
  const refus = refusDeFourneeMelangee([
    { titre: 'A', zone: 'Volet SEO-GEO' },
    { titre: 'B', zone: 'Fenêtre de Beluga Connect' },
    { titre: 'C', zone: 'Aide aux Réglages' },
  ]);
  assert.ok(refus);
  assert.match(refus!, /3 endroits différents/);
  assert.match(refus!, /UN PAR UN/);
});

test('le relevé de l’écran réel : adresse interne seulement, bornes et retouches', () => {
  const r = releveLu({ adresse: '#marketing2/d1', selecteur: '[data-m2-volet-dossier]', remplacer: [{ selecteur: '[data-m2-accordeon]', html: '<p>x</p>' }] });
  assert.ok(!('refus' in r));
  if ('refus' in r) return;
  assert.equal(r.adresse, 'marketing2/d1');
  assert.equal(r.attendre, '[data-m2-volet-dossier]');
  assert.equal(r.largeur, 1440);
  assert.equal(r.theme, 'sombre');
  assert.equal(r.remplacer.length, 1);
  assert.ok('refus' in releveLu({ adresse: 'https://exemple.ch' }));
  assert.ok('refus' in releveLu({ adresse: '' }));
  assert.ok('refus' in releveLu({ adresse: 'x', selecteur: '<script>' }));
  assert.ok('refus' in releveLu({ adresse: 'x', remplacer: Array.from({ length: 13 }, () => ({ selecteur: 'a', html: '' })) }));
});

test('une icône posée par son nom devient la vraie icône', () => {
  const html = '<button><svg data-lucide="search" class="h-4 w-4"></svg> Chercher</button><svg data-lucide="inconnue"></svg>';
  const rendu = avecLesIconesReelles(html, (nom) => (nom === 'search' ? [['circle', { cx: 11, cy: 11, r: 8, key: 'a' }], ['path', { d: 'm21 21-4.3-4.3', key: 'b' }]] : null));
  assert.match(rendu, /<svg data-lucide="search" class="h-4 w-4" xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24"[^>]*><circle cx="11" cy="11" r="8"\/><path d="m21 21-4\.3-4\.3"\/><\/svg>/);
  assert.match(rendu, /<svg data-lucide="inconnue"><\/svg>/);
});
