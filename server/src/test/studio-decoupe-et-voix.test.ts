import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LE MONTAGE DU STUDIO, SUITE (02/11/2026) :
 *
 *  - une vidéo posée plus longue que son fichier reste FIGÉE sur sa dernière image dans l'aperçu,
 *    au lieu de repartir du début à chaque image (scintillement, personnage qui saute) ;
 *  - un TRAJET (« tu pars de là et tu arrives ici ») : relu et borné, partagé par une coupe,
 *    posé sur la chronologie de l'aperçu ET de l'export, ramené dans le repère d'une pièce agrandie.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-decoupe-'));
process.env.BELUGA_DATA = bacASable;

const shared = await import('@beluga/shared');
const { MOTEUR_APERCU_STUDIO, appliquerOperation, compositionVide, lireTrajet, pointDuTrajet, traduireEnPage, trouverSegment } = shared;

let n = 0;
const idNeuf = (p: string) => `${p}-${++n}`;

/* ------------------------------------------------------------------ */

test('UNE VIDÉO PLUS LONGUE QUE SON FICHIER reste figée sur sa dernière image, sans jamais être relancée', () => {
  const moteur = MOTEUR_APERCU_STUDIO as string;
  assert.doesNotThrow(() => new Function(moteur));
  const corps = moteur.slice(moteur.indexOf('function borne(el,x)'), moteur.indexOf('function piloterLecteur(L)'));
  // Un lecteur factice : le fichier dure 4,4 s, le passage 5,5 s à partir de 7,9 s.
  const el: any = {
    duration: 4.4,
    currentTime: 4.4,
    paused: true,
    readyState: 4,
    seeking: false,
    playbackRate: 1,
    muted: false,
    volume: 1,
    lectures: 0,
    sauts: [] as number[],
    addEventListener() {},
    play() {
      this.lectures++;
      this.paused = false;
      // Le vrai comportement d'un lecteur arrivé au bout : play() repart du début.
      if (this.currentTime >= this.duration) this.currentTime = 0;
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
    },
  };
  Object.defineProperty(el, 'currentTime', {
    get() {
      return this._t;
    },
    set(v: number) {
      this._t = v;
      if (this.sauts) this.sauts.push(v);
    },
  });
  el._t = 4.4;
  const passage = { c: el, d: 7.9, f: 13.367, v: 1, ms: 0, fi: 0, fo: 0, vol: 1, muet: false };
  const piloterA = new Function(
    'el',
    'p',
    'instant',
    'performance',
    `var t=instant,lecture=true,muet=false,sons={lectures:0,refus:0,sauts:0,sautsRates:0};function visibilite(){}function lancer(e){sons.lectures++;e.play();}${corps}; el.__sur=true; piloter(el,p,true);`,
  );
  // Image après image, de 12,4 s à 13,3 s : la vidéo n'est jamais relancée et reste sur la fin du fichier.
  for (let instant = 12.4; instant < 13.36; instant += 1 / 60) piloterA(el, passage, instant, { now: () => 0 });
  assert.equal(el.lectures, 0, 'un lecteur arrivé au bout ne doit jamais être relancé');
  assert.ok(el.paused);
  assert.ok(el.currentTime > 4.3, `figée sur la fin (${el.currentTime})`);
  assert.ok(el.sauts.every((x: number) => x > 4.3), `aucun saut vers le début (${el.sauts.join(', ')})`);
  // Avant la fin du fichier, la lecture continue normalement.
  el._t = 2;
  el.paused = true;
  piloterA(el, passage, 9.9, { now: () => 0 });
  assert.equal(el.lectures, 1);
});

test('UN TRAJET : relu et borné, refusé sur un son ou un dessin, retiré par une valeur vide', () => {
  assert.equal(lireTrajet(undefined), undefined);
  assert.equal(lireTrajet({ arrivee: { x: 0, y: 0 } }), undefined, 'un trajet immobile n’existe pas');
  assert.deepEqual(lireTrajet({ arrivee: { x: 120.4, y: -99999 } }), { arrivee: { x: 120, y: -20000 } });
  assert.deepEqual(lireTrajet({ depart: { x: 10, y: 0 }, arrivee: { x: 30, y: 40 } }), { depart: { x: 10, y: 0 }, arrivee: { x: 30, y: 40 } });
  assert.deepEqual(pointDuTrajet({ depart: { x: 10, y: 0 }, arrivee: { x: 30, y: 40 } }, 0.5), { x: 20, y: 20 });
  const video = { id: 'v', genre: 'video', debut: 0, duree: 4, mediaId: 'm', debutMedia: 0, volume: 0, ajustement: 'contenir' };
  let c = (appliquerOperation(compositionVide(), { op: 'inserer', pisteId: 'videos', segment: video }, idNeuf) as any).composition;
  const r = appliquerOperation(c, { op: 'proprietes', segmentId: 'v', valeurs: { trajet: { arrivee: { x: 300, y: -200 } } } }, idNeuf);
  assert.ok(r.ok, (r as any).raison);
  c = (r as any).composition;
  assert.deepEqual((trouverSegment(c, 'v')!.segment as any).trajet, { arrivee: { x: 300, y: -200 } });
  // Un son n'a pas de trajet.
  const son = { id: 's', genre: 'audio', debut: 0, duree: 2, mediaId: 'm', debutMedia: 0, volume: 1 };
  const c2 = (appliquerOperation(c, { op: 'inserer', pisteId: 'son', segment: son }, idNeuf) as any).composition;
  assert.equal(appliquerOperation(c2, { op: 'proprietes', segmentId: 's', valeurs: { trajet: { arrivee: { x: 1, y: 1 } } } }, idNeuf).ok, false);
  // « Retirer le trajet » : une valeur vide.
  const sans = (appliquerOperation(c, { op: 'proprietes', segmentId: 'v', valeurs: { trajet: null } }, idNeuf) as any).composition;
  assert.equal((trouverSegment(sans, 'v')!.segment as any).trajet, undefined);
});

test('UNE COUPE PARTAGE LE TRAJET : le premier morceau va jusqu’au point de coupe, le second en repart', () => {
  const video = { id: 'v', genre: 'video', debut: 2, duree: 4, mediaId: 'm', debutMedia: 0, volume: 0, ajustement: 'contenir', trajet: { arrivee: { x: 400, y: 0 } } };
  const c = (appliquerOperation(compositionVide(), { op: 'inserer', pisteId: 'videos', segment: video }, idNeuf) as any).composition;
  const r = appliquerOperation(c, { op: 'scinder', segmentId: 'v', a: 5 }, idNeuf);
  assert.ok(r.ok, (r as any).raison);
  const segs = (r as any).composition.pistes.flatMap((p: any) => p.segments).filter((s: any) => s.genre === 'video');
  assert.equal(segs.length, 2);
  assert.deepEqual(segs[0].trajet, { arrivee: { x: 300, y: 0 } });
  assert.deepEqual(segs[1].trajet, { depart: { x: 300, y: 0 }, arrivee: { x: 400, y: 0 } });
});

test('LE TRAJET SE JOUE À L’APERÇU ET À L’EXPORT, ramené dans le repère d’une pièce agrandie et tournée', () => {
  const video = { id: 'v', genre: 'video', debut: 1, duree: 3, mediaId: 'm', debutMedia: 0, volume: 0, ajustement: 'contenir', trajet: { arrivee: { x: 100, y: 0 } }, retouches: { video: { echelle: 0.5, rotation: 90 } } };
  const c = (appliquerOperation(compositionVide(), { op: 'inserer', pisteId: 'videos', segment: video }, idNeuf) as any).composition;
  for (const mode of ['apercu', 'rendu'] as const) {
    const page = traduireEnPage(c, { format: '9:16', medias: { m: { url: 'm.webm', genre: 'video' } }, gsap: 'g.js', polices: 'p/', mode });
    const donnees = JSON.parse(/<script id="studio-donnees" type="application\/json">([\s\S]*?)<\/script>/.exec(page)![1]!);
    assert.deepEqual(donnees.segments.find((s: any) => s.id === 'v').trajet, { arrivee: { x: 100, y: 0 } }, mode);
    assert.match(page, /tl\.fromTo\(el,\{x:p0\.x,y:p0\.y\},\{x:p1\.x,y:p1\.y,duration:s\.duree,ease:'power1\.inOut',immediateRender:false\},s\.debut\)/);
  }
  // La conversion de repère, rejouée telle qu'écrite dans la page : 100 px vers la droite à l'écran, sur une pièce
  // tournée d'un quart de tour et réduite de moitié, c'est 200 px vers le HAUT de son propre repère.
  const page = traduireEnPage(c, { format: '9:16', medias: { m: { url: 'm.webm', genre: 'video' } }, gsap: 'g.js', polices: 'p/', mode: 'rendu' });
  const ligne = /var repere=function\(p\)\{[^\n]*\};/.exec(page)![0];
  const repere = new Function('ech', 'ang', `${ligne}; return repere;`)(0.5, (-90 * Math.PI) / 180) as (p: { x: number; y: number }) => { x: number; y: number };
  const r = repere({ x: 100, y: 0 });
  assert.ok(Math.abs(r.x) < 1e-6 && Math.abs(r.y + 200) < 1e-6, JSON.stringify(r));
});
