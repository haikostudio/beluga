import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calerSurLeRythme,
  compositionVide,
  couperPartout,
  jalonAjoute,
  lignesDesNotes,
  lireJalons,
  lireModelesChoisis,
  noteRecue,
  passagesDesMotsEffaces,
  refusDuModeleChoisi,
  rythmeDeLEnveloppe,
  serviceDeLaCarte,
  estAgentDeVolet,
  typeDeLaCapacite,
  LABEL_STUDIO,
  type Composition,
} from '@beluga/shared';

/*
 * LES GESTES AJOUTÉS AU RETOUR DU STUDIO (30/10/2026) : couper partout en recollant,
 * lire et suivre le rythme, le modèle imposé aux devis, les notes et les jalons.
 */

let n = 0;
const idNeuf = (p: string) => `${p}-${++n}`;

function visuelsDe(c: Composition): any[] {
  return c.pistes.filter((p) => p.genre === 'image' || p.genre === 'video').flatMap((p) => p.segments).sort((a, b) => a.debut - b.debut);
}

function montage(): Composition {
  const c = compositionVide('9:16', 12);
  c.pistes.find((p) => p.genre === 'image')!.segments.push({ id: 'p3', genre: 'image', debut: 8, duree: 4, mediaId: 'm3', ajustement: 'couvrir' } as any);
  c.pistes.find((p) => p.genre === 'video')!.segments.push(
    { id: 'p1', genre: 'video', debut: 0, duree: 4, mediaId: 'm1', debutMedia: 0, volume: 0, ajustement: 'couvrir' } as any,
    { id: 'p2', genre: 'video', debut: 4, duree: 4, mediaId: 'm2', debutMedia: 0, volume: 0, ajustement: 'couvrir' } as any,
  );
  const voix = c.pistes.find((p) => p.id === 'voix')!;
  voix.segments.push({
    id: 'v1',
    genre: 'voix',
    debut: 0,
    duree: 6,
    texte: 'un deux trois quatre',
    voixEssai: 'x',
    etat: 'essai',
    volume: 1,
    mediaId: 'mv',
    mots: [
      { texte: 'un', debut: 0, fin: 1 },
      { texte: 'deux', debut: 1, fin: 2 },
      { texte: 'trois', debut: 2, fin: 4 },
      { texte: 'quatre', debut: 4, fin: 6 },
    ],
  } as any);
  return c;
}

test('couper partout : ce qui suit recule, un média qui traverse se scinde et reprend plus loin dans son fichier', () => {
  const r = couperPartout(montage(), 2, 3, idNeuf);
  assert.ok(r.ok);
  if (!r.ok) return;
  const visuels = visuelsDe(r.composition) as any[];
  assert.equal(visuels.length, 4, 'le plan 1 est scindé');
  assert.deepEqual(visuels.map((s) => s.debut), [0, 2, 3, 7]);
  assert.equal(visuels[1].debutMedia, 3, 'la suite reprend après la coupe');
  assert.equal(r.composition.dureeVoulue, 11, 'le marqueur suit');
});

test('couper partout : un bloc entièrement dans le passage disparaît ; un passage trop court est refusé', () => {
  const r = couperPartout(montage(), 4, 8, idNeuf);
  assert.ok(r.ok);
  if (!r.ok) return;
  const ids = visuelsDe(r.composition).map((s) => s.id);
  assert.ok(!ids.includes('p2'));
  assert.equal(couperPartout(montage(), 2, 2.01, idNeuf).ok, false);
});

test('couper au texte : la voix ne garde que ses mots encore dits, sans quoi la prise suivante redirait tout', () => {
  const r = couperPartout(montage(), 1, 2, idNeuf);
  assert.ok(r.ok);
  if (!r.ok) return;
  const voix = r.composition.pistes.find((p) => p.id === 'voix')!.segments as any[];
  assert.deepEqual(voix.map((v) => v.texte), ['un', 'trois quatre']);
  assert.equal(voix[1].debutMedia, 2);
});

test('des mots effacés voisins ne font qu’un seul passage', () => {
  const mots = [
    { texte: 'a', debut: 0, fin: 1 },
    { texte: 'b', debut: 1, fin: 2 },
    { texte: 'c', debut: 2, fin: 3 },
    { texte: 'd', debut: 3, fin: 4 },
  ];
  assert.deepEqual(passagesDesMotsEffaces(mots, new Set([0, 1, 3])), [
    { de: 0, a: 2 },
    { de: 3, a: 4 },
  ]);
});

test('le rythme : une pulsation régulière donne son tempo ; un son continu ne donne rien', () => {
  const parSeconde = 100;
  const pulse = Array.from({ length: parSeconde * 10 }, (_, i) => (i % 50 === 0 ? 1 : 0.01));
  const r = rythmeDeLEnveloppe(pulse, parSeconde);
  assert.ok(r.bpm === 120 || r.bpm === 60, `tempo lu : ${r.bpm}`);
  assert.ok(r.temps.length >= 10);
  assert.deepEqual(rythmeDeLEnveloppe(Array.from({ length: 1000 }, () => 0.5), parSeconde), { bpm: 0, temps: [] });
  const tenue = Array.from({ length: 1000 }, (_, i) => (i < 3 ? i / 3 : 0.5 + Math.sin(i * 12.9898) * 0.002));
  assert.equal(rythmeDeLEnveloppe(tenue, parSeconde).bpm, 0, 'une note tenue n’a pas de temps');
});

test('caler sur le rythme : les changements de plan tombent sur les temps, sans trou ni plan vide', () => {
  const temps = Array.from({ length: 30 }, (_, i) => i * 0.5 + 0.2);
  const r = calerSurLeRythme(montage(), temps);
  assert.ok(r.ok);
  if (!r.ok) return;
  const plans = visuelsDe(r.composition);
  for (let i = 0; i < plans.length; i++) {
    assert.ok(plans[i]!.duree > 0);
    assert.ok(temps.includes(plans[i]!.debut), `plan ${i} sur un temps`);
    if (i) assert.equal(Math.round((plans[i - 1]!.debut + plans[i - 1]!.duree) * 1000), Math.round(plans[i]!.debut * 1000));
  }
  assert.equal(calerSurLeRythme(montage(), []).ok, false);
});

test('le modèle retenu s’impose au devis de son type, jamais à une retouche', () => {
  const choisis = lireModelesChoisis(JSON.stringify({ video: 'kling-3.0/video', intrus: 'x' }));
  assert.deepEqual(choisis, { video: 'kling-3.0/video' });
  assert.equal(typeDeLaCapacite('animation'), 'video');
  assert.equal(refusDuModeleChoisi(choisis, 'animation', 'kling-3.0/video'), null);
  assert.match(refusDuModeleChoisi(choisis, 'video', 'wan/2-7') ?? '', /kling-3\.0\/video/);
  assert.equal(refusDuModeleChoisi(choisis, 'retouche', 'autre'), null);
  assert.equal(refusDuModeleChoisi(choisis, 'image', 'autre'), null, 'aucun choix pour ce type');
});

test('une note : un texte requis, un endroit borné au cadre ; une note traitée ne part plus à l’agent', () => {
  assert.equal(noteRecue({ texte: '  ' }).ok, false);
  const lue = noteRecue({ texte: 'trop bas', x: 140, y: -3, instant: 2 });
  assert.ok(lue.ok);
  if (lue.ok) assert.deepEqual([lue.note.x, lue.note.y], [100, 0]);
  const notes = [
    { id: 'a', creationId: 'c', instant: 1, x: 10, y: 20, texte: 'ouverte', creeLe: 1 },
    { id: 'b', creationId: 'c', instant: 1, x: 10, y: 20, texte: 'traitée', creeLe: 1, traiteeLe: 2 },
  ];
  assert.equal(lignesDesNotes(notes).length, 1);
  assert.match(lignesDesNotes(notes)[0]!, /10 % de la largeur/);
  // Posée depuis la ligne de temps : un instant, sans endroit sur l'image.
  const instant = lignesDesNotes([{ id: 'c', creationId: 'c', instant: 3, x: 0, y: 0, texte: 'plus vite', creeLe: 1 }]);
  assert.match(instant[0]!, /à 3\.0 s, sur toute l’image/);
});

test('un jalon nomme une version sans écraser celui qu’elle porte, et reste borné', () => {
  const j = jalonAjoute(lireJalons('{"3":"Premier"}'), 3, 'Second');
  assert.equal(j[3], 'Premier');
  let k: Record<number, string> = {};
  for (let i = 1; i <= 210; i++) k = jalonAjoute(k, i, `v${i}`);
  assert.equal(Object.keys(k).length, 200);
  assert.equal(k[1], undefined);
  assert.equal(lireJalons('illisible') && Object.keys(lireJalons('illisible')).length, 0);
});

test('la carte d’une création mène au Studio ; son directeur n’est pas un agent de volet', () => {
  const carte = { labels: [LABEL_STUDIO] };
  const directeur = { role: 'cadrage' };
  assert.equal(serviceDeLaCarte(directeur, carte), 'studio');
  assert.equal(estAgentDeVolet(directeur, carte), false, 'il suit le parcours d’une carte caméra, pas celui d’un volet');
  assert.equal(serviceDeLaCarte({ role: 'cadrage' }, { labels: [] }), null);
});
