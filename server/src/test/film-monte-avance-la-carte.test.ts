import test from 'node:test';
import assert from 'node:assert/strict';
import { etapesDuMedia, etapeCouranteDuMedia, passagesDUnFilmMonte, uneVersionSeLit } from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* LE TRAVAIL FAIT AVANCE LA CARTE (décision du 15/11/2026, #abd87)     */
/* « Vidéo teaser avant lancement » restait « Brief · 1 sur 4 » alors   */
/* que son film était monté : seul un clic faisait avancer les étapes.  */
/* ------------------------------------------------------------------ */

const filmQuiSeLit = { pistes: [{ genre: 'video', masquee: false, segments: [{ duree: 4.2, masque: false }] }] } as never;
const filmVide = { pistes: [{ genre: 'video', masquee: false, segments: [] }] } as never;

test('un film qui se lit pose les passages manquants, une seule fois', () => {
  assert.equal(uneVersionSeLit(filmQuiSeLit), true);
  assert.deepEqual(passagesDUnFilmMonte({}, true, 1000), { esquissesA: 1000, montageA: 1000 });
  assert.deepEqual(passagesDUnFilmMonte({ esquissesA: 500 }, true, 1000), { esquissesA: 500, montageA: 1000 }, 'un passage déjà posé garde son heure');
  assert.equal(passagesDUnFilmMonte({ esquissesA: 500, montageA: 600 }, true, 1000), null, 'déjà au Montage : rien à écrire');
});

test('une carte sans film ne bouge pas', () => {
  assert.equal(uneVersionSeLit(filmVide), false);
  assert.equal(passagesDUnFilmMonte({}, false, 1000), null);
  assert.equal(passagesDUnFilmMonte(null, true, 1000), null, 'une carte sans réalisation n’est pas une carte de média');
});

test('avancée, la carte est au Montage : Brief et Esquisses faits, la barre et le suivi disent la même chose', () => {
  const passages = passagesDUnFilmMonte({}, true, 1000)!;
  const segments = etapesDuMedia({ carte: { column: 'planned', realisation: { medias: ['video'], ...passages } } as never });
  assert.deepEqual(
    segments.map((s) => `${s.etape}:${s.etat}`),
    ['brief:fait', 'esquisses:fait', 'montage:question', 'telechargement:avenir'],
  );
  assert.equal(etapeCouranteDuMedia(segments), 'montage');
});
