/**
 * LES GESTES AVANCÉS DU MONTAGE DU STUDIO (retour du Studio, 30/10/2026) — règles
 * pures, testées dans `server/src/test/studio-montage-avance.test.ts` :
 *  - couper un passage PARTOUT (image, son, voix, textes), en recollant la suite :
 *    c'est ce que fait l'effacement de mots dans le texte d'une voix ;
 *  - lire le rythme d'une musique dans son enveloppe d'énergie, puis caler les
 *    changements de plan sur ses temps ;
 *  - les notes posées sur l'image et les jalons de version.
 */
import { pisteVisuelle, recalerSousTitres, type Composition, type Segment, type SegmentVoix } from './studio.js';
import type { MotHorodate } from './voix-de-realisation.js';

const arrondi = (n: number) => Math.round(n * 1000) / 1000;
const DUREE_MIN = 0.05;

/* ------------------------------------------------------------------ */
/* Couper partout                                                       */
/* ------------------------------------------------------------------ */

const aUnMedia = (s: Segment): s is Segment & { debutMedia?: number; vitesse?: number } => s.genre === 'audio' || s.genre === 'video' || s.genre === 'voix';

function vitesseDe(s: Segment): number {
  return aUnMedia(s) && s.vitesse ? s.vitesse : 1;
}

/** Le texte d'une voix réduit aux mots encore joués, pour que la prise suivante ne redise pas ce qui a été coupé. */
function texteDesMots(v: SegmentVoix, de: number, a: number): string {
  return (v.mots ?? [])
    .filter((m: MotHorodate) => m.fin > de + 0.01 && m.debut < a - 0.01)
    .map((m: MotHorodate) => m.texte)
    .join(' ');
}

/**
 * RETIRER [de, a] DE TOUTE LA CRÉATION : ce qui tombe dedans disparaît, ce qui le
 * chevauche est raccourci (un média reprend plus loin dans son fichier, un bloc
 * qui le traverse se scinde en deux pour un média), et tout ce qui suit recule.
 * Le marqueur de durée suit ; les sous-titres automatiques se recalent sur les voix.
 */
export function couperPartout(composition: Composition, de: number, a: number, idNeuf: (prefixe: string) => string): { ok: true; composition: Composition; resume: string } | { ok: false; raison: string } {
  if (!Number.isFinite(de) || !Number.isFinite(a) || a - de < DUREE_MIN) return { ok: false, raison: 'le passage à couper est trop court' };
  const coupe = a - de;
  const c = JSON.parse(JSON.stringify(composition)) as Composition;
  for (const piste of c.pistes) {
    const sortie: Segment[] = [];
    for (const s of piste.segments) {
      /* Les sous-titres automatiques suivent les voix : ils se refont à la fin. */
      if (s.genre === 'sous-titres' && s.auto) {
        sortie.push(s);
        continue;
      }
      const fin = s.debut + s.duree;
      if (fin <= de + 1e-3) {
        sortie.push(s);
      } else if (s.debut >= a - 1e-3) {
        sortie.push({ ...s, debut: arrondi(s.debut - coupe) });
      } else if (s.debut >= de - 1e-3 && fin <= a + 1e-3) {
        /* Tout le bloc est dans le passage : il disparaît. */
      } else if (s.debut < de && fin > a) {
        /* Le passage traverse le bloc. */
        if (aUnMedia(s)) {
          const vitesse = vitesseDe(s);
          const debutMedia = s.debutMedia ?? 0;
          const avant = { ...s, duree: arrondi(de - s.debut) } as Segment;
          const apres = { ...s, id: idNeuf('seg'), debut: arrondi(de), duree: arrondi(fin - a), debutMedia: arrondi(debutMedia + (a - s.debut) * vitesse) } as Segment;
          delete (avant as { fonduSortie?: number }).fonduSortie;
          delete (apres as { fonduEntree?: number }).fonduEntree;
          if (s.genre === 'voix') {
            (avant as SegmentVoix).texte = texteDesMots(s, debutMedia, debutMedia + (de - s.debut) * vitesse) || s.texte;
            (apres as SegmentVoix).texte = texteDesMots(s, debutMedia + (a - s.debut) * vitesse, debutMedia + s.duree * vitesse) || s.texte;
          }
          sortie.push(avant, apres);
        } else {
          sortie.push({ ...s, duree: arrondi(s.duree - coupe) });
        }
      } else if (s.debut < de) {
        /* La fin du bloc tombe dans le passage. */
        const raccourci = { ...s, duree: arrondi(de - s.debut) } as Segment;
        if (s.genre === 'voix') {
          const debutMedia = s.debutMedia ?? 0;
          (raccourci as SegmentVoix).texte = texteDesMots(s, debutMedia, debutMedia + (de - s.debut) * vitesseDe(s)) || s.texte;
        }
        sortie.push(raccourci);
      } else {
        /* Le début du bloc tombe dans le passage. */
        const retire = a - s.debut;
        const reste = { ...s, debut: arrondi(de), duree: arrondi(fin - a) } as Segment;
        if (aUnMedia(s)) (reste as { debutMedia?: number }).debutMedia = arrondi((s.debutMedia ?? 0) + retire * vitesseDe(s));
        if (s.genre === 'voix') {
          const debutMedia = (reste as SegmentVoix).debutMedia ?? 0;
          (reste as SegmentVoix).texte = texteDesMots(s, debutMedia, debutMedia + (fin - a) * vitesseDe(s)) || s.texte;
        }
        sortie.push(reste);
      }
    }
    piste.segments = sortie.sort((x, y) => x.debut - y.debut);
  }
  if (c.dureeVoulue !== undefined) c.dureeVoulue = arrondi(c.dureeVoulue > a ? c.dureeVoulue - coupe : Math.min(c.dureeVoulue, de));
  return { ok: true, composition: recalerSousTitres(c), resume: `passage de ${coupe.toFixed(1)} s coupé partout` };
}

/** Les bornes à couper pour une suite de mots effacés : les mots voisins sont réunis en un seul passage. */
export function passagesDesMotsEffaces(mots: readonly MotHorodate[], effaces: ReadonlySet<number>): { de: number; a: number }[] {
  const passages: { de: number; a: number }[] = [];
  let ouvert: { de: number; a: number } | null = null;
  mots.forEach((m, i) => {
    if (effaces.has(i)) {
      if (ouvert) ouvert.a = m.fin;
      else ouvert = { de: m.debut, a: m.fin };
    } else if (ouvert) {
      passages.push(ouvert);
      ouvert = null;
    }
  });
  if (ouvert) passages.push(ouvert);
  return passages;
}

/* ------------------------------------------------------------------ */
/* Le rythme                                                            */
/* ------------------------------------------------------------------ */

export interface RythmeDuSon {
  /** Battements par minute, ou 0 si aucune pulsation nette ne ressort. */
  bpm: number;
  /** Les temps, en secondes du fichier. */
  temps: number[];
}

/**
 * LE RYTHME D'UN SON, lu dans son ENVELOPPE D'ÉNERGIE (une valeur par fenêtre,
 * `parSeconde` fenêtres par seconde) : la montée d'énergie donne les attaques, sa
 * meilleure périodicité entre 60 et 180 BPM le tempo, et la grille se cale sur
 * l'attaque la plus forte. Sans pulsation nette, rien n'est inventé : `bpm` vaut 0.
 */
export function rythmeDeLEnveloppe(enveloppe: readonly number[], parSeconde: number): RythmeDuSon {
  if (enveloppe.length < parSeconde * 2) return { bpm: 0, temps: [] };
  const attaques = enveloppe.map((v, i) => (i ? Math.max(0, v - enveloppe[i - 1]!) : 0));
  const moyenne = attaques.reduce((x, y) => x + y, 0) / attaques.length;
  if (moyenne <= 0) return { bpm: 0, temps: [] };
  /* DES ATTAQUES FRANCHES, RÉPÉTÉES : une note tenue ou une voix n'en a que quelques-unes, et sa périodicité n'est que du bruit. */
  const crete = Math.max(...enveloppe);
  const franches = attaques.filter((a) => a > crete * 0.15).length;
  if (franches < Math.max(4, Math.floor(attaques.length / parSeconde / 2))) return { bpm: 0, temps: [] };
  const min = Math.max(1, Math.floor((parSeconde * 60) / 180));
  const max = Math.min(attaques.length - 1, Math.ceil((parSeconde * 60) / 60));
  let meilleur = 0;
  let periode = 0;
  let total = 0;
  let essais = 0;
  for (let p = min; p <= max; p++) {
    let somme = 0;
    for (let i = p; i < attaques.length; i++) somme += attaques[i]! * attaques[i - p]!;
    somme /= attaques.length - p;
    total += somme;
    essais++;
    if (somme > meilleur) {
      meilleur = somme;
      periode = p;
    }
  }
  /* LA PULSATION DOIT RESSORTIR : un son continu ou une voix n'a pas de temps à proposer. */
  if (!periode || !essais || meilleur < (total / essais) * 1.25) return { bpm: 0, temps: [] };
  let depart = 0;
  let forceDepart = -1;
  for (let d = 0; d < periode; d++) {
    let force = 0;
    for (let i = d; i < attaques.length; i += periode) force += attaques[i]!;
    if (force > forceDepart) {
      forceDepart = force;
      depart = d;
    }
  }
  const temps: number[] = [];
  for (let i = depart; i < enveloppe.length; i += periode) temps.push(arrondi(i / parSeconde));
  return { bpm: Math.round((60 * parSeconde) / periode), temps };
}

/** Le temps le plus proche de cet instant, ou l'instant lui-même si rien n'est assez près. */
export function tempsLePlusProche(temps: readonly number[], instant: number, ecartMax = Infinity): number {
  let meilleur = instant;
  let ecart = ecartMax;
  for (const t of temps) {
    const e = Math.abs(t - instant);
    if (e < ecart) {
      ecart = e;
      meilleur = t;
    }
  }
  return meilleur;
}

/**
 * CALER LES PLANS SUR LE RYTHME : chaque changement de plan (piste de visuels) va
 * sur le temps le plus proche, et les plans restent bout à bout. Un plan ne
 * descend jamais à zéro : il garde au moins un temps. Le son et la voix ne bougent pas.
 */
export function calerSurLeRythme(composition: Composition, temps: readonly number[]): { ok: true; composition: Composition; resume: string } | { ok: false; raison: string } {
  if (temps.length < 2) return { ok: false, raison: 'aucun rythme n’est connu pour cette création' };
  const c = JSON.parse(JSON.stringify(composition)) as Composition;
  let cales = 0;
  for (const piste of c.pistes) {
    if (!pisteVisuelle(piste.genre)) continue;
    const plans = piste.segments.filter((s) => s.genre !== 'texte').sort((a, b) => a.debut - b.debut);
    let curseur = plans[0] ? tempsLePlusProche(temps, plans[0].debut) : 0;
    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i]!;
      const finVoulue = plan.debut + plan.duree;
      let fin = tempsLePlusProche(temps, finVoulue);
      if (fin <= curseur + DUREE_MIN) fin = temps.find((t) => t > curseur + DUREE_MIN) ?? finVoulue;
      plan.debut = arrondi(curseur);
      plan.duree = arrondi(Math.max(DUREE_MIN, fin - curseur));
      curseur = fin;
      cales++;
    }
    piste.segments.sort((a, b) => a.debut - b.debut);
  }
  if (!cales) return { ok: false, raison: 'aucun plan à caler' };
  return { ok: true, composition: c, resume: `${cales} plan(s) calé(s) sur le rythme` };
}

/* ------------------------------------------------------------------ */
/* Les notes posées sur l'image                                         */
/* ------------------------------------------------------------------ */

export interface NoteDuStudio {
  id: string;
  creationId: string;
  /** L'instant de la composition, en secondes. */
  instant: number;
  /** L'endroit visé, en % du cadre. */
  x: number;
  y: number;
  segmentId?: string;
  texte: string;
  traiteeLe?: number;
  creeLe: number;
}

export function noteRecue(recu: { instant?: unknown; x?: unknown; y?: unknown; texte?: unknown; segmentId?: unknown }): { ok: true; note: Pick<NoteDuStudio, 'instant' | 'x' | 'y' | 'texte' | 'segmentId'> } | { ok: false; raison: string } {
  const texte = String(recu.texte ?? '').trim().slice(0, 1000);
  if (!texte) return { ok: false, raison: 'la note est vide' };
  const borne = (v: unknown) => Math.max(0, Math.min(100, Number(v) || 0));
  return {
    ok: true,
    note: {
      instant: Math.max(0, Number(recu.instant) || 0),
      x: arrondi(borne(recu.x)),
      y: arrondi(borne(recu.y)),
      texte,
      ...(typeof recu.segmentId === 'string' && recu.segmentId ? { segmentId: recu.segmentId } : {}),
    },
  };
}

/**
 * UNE NOTE POSÉE DEPUIS LA LIGNE DE TEMPS (refonte du 31/10/2026) n'a pas d'endroit sur l'image : elle vise un
 * instant. Elle s'enregistre à (0, 0), et l'agent la lit « sur toute l'image ». Les notes d'avant, posées d'un clic
 * sur l'image, gardent leur endroit.
 */
export function noteSansEndroit(n: Pick<NoteDuStudio, 'x' | 'y'>): boolean {
  return n.x === 0 && n.y === 0;
}

/** Ce que l'agent lit des notes encore ouvertes. */
export function lignesDesNotes(notes: readonly NoteDuStudio[]): string[] {
  return notes
    .filter((n) => !n.traiteeLe)
    .map(
      (n) =>
        `- note ${n.id} à ${n.instant.toFixed(1)} s, ${noteSansEndroit(n) ? 'sur toute l’image' : `à ${Math.round(n.x)} % de la largeur et ${Math.round(n.y)} % de la hauteur`}${n.segmentId ? `, segment ${n.segmentId}` : ''} : « ${n.texte} »`,
    );
}

/* ------------------------------------------------------------------ */
/* Les jalons de version                                                */
/* ------------------------------------------------------------------ */

export function cleDesJalons(creationId: string): string {
  return `studio.jalons.${creationId}`;
}

/** Les jalons gardés : le numéro de version et son nom lisible. */
export function lireJalons(brut: string | null | undefined): Record<number, string> {
  if (!brut) return {};
  try {
    const lu = JSON.parse(brut) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(lu).filter(([k, v]) => Number.isInteger(Number(k)) && typeof v === 'string')) as Record<number, string>;
  } catch {
    return {};
  }
}

/** Le nom d'un jalon ajouté à une version, sans écraser celui qu'elle porte déjà ; au plus 200 jalons. */
export function jalonAjoute(jalons: Record<number, string>, numero: number, nom: string): Record<number, string> {
  if (jalons[numero]) return jalons;
  const suite = { ...jalons, [numero]: nom.slice(0, 80) };
  const numeros = Object.keys(suite).map(Number).sort((a, b) => a - b);
  for (const n of numeros.slice(0, Math.max(0, numeros.length - 200))) delete suite[n];
  return suite;
}
