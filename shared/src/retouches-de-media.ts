/**
 * LES RETOUCHES D'UN MÉDIA ET SES INFORMATIONS (agent créatif, 24/10/2026) —
 * règles PURES, sans base ni disque.
 *
 * Chaque média fabriqué porte un menu « … » (`web/src/components/menu-du-media.tsx`) :
 * l'ajouter au suivi ou l'en retirer, le redemander avec une consigne, lire et
 * modifier ses réglages, le télécharger et, pour une IMAGE, trois retouches —
 * d'autres ANGLES de vue, une autre direction de LUMIÈRE, un autre VISAGE.
 * Pour chaque retouche, l'agent fait d'abord choisir le MODÈLE avec son prix,
 * puis le réglage propre à l'opération, puis le nombre d'images (1 à 4) ;
 * rien ne part sans le devis validé d'un clic (MEM-4352).
 *
 * Décisions de l'utilisateur du 24/10/2026 :
 *  - seuls les services DÉJÀ EN PLACE (fal.ai, Higgsfield, OpenRouter) ;
 *    jamais Magnific ;
 *  - la lumière se règle dans un CUBE 3D, personnage au centre (revu le
 *    26/10/2026, capture #8c9bf) : libre avec un modèle qui accepte une
 *    direction décrite, CALÉE sur les directions qu'un modèle à directions
 *    fixes autorise (`directionAimantee`) ;
 *  - l'angle se règle dans le même cube : la caméra tournée à la main se cale
 *    sur l'angle nommé le plus proche (`angleAimante`, capture #129c) ;
 *  - le visage à remplacer se CLIQUE parmi ceux repérés sur l'image, puis se
 *    dit en mots au modèle (`phraseDeVisageCible`, captures #7cc3 et #7a99) ;
 *  - sous chaque média, une ligne d'informations selon son genre ; tout le
 *    détail dans « Réglages ».
 *
 * Vérifié le 24/10/2026 : l'API publique de Higgsfield n'a ni outil
 * « Angles » ni outil de lumière ni échange de visage dédiés (« Angles » n'existe
 * que dans leur application web) ; elle passe par sa retouche d'image
 * (`alibaba/qwen-image-3/edit`, 1 à 3 images de référence), à qui l'on DÉCRIT
 * l'angle, la lumière ou le visage voulu — moins précis, et dit comme tel.
 */

/* ------------------------------------------------------------------ */
/* Les propositions                                                     */
/* ------------------------------------------------------------------ */


/** Le nombre de propositions d'une génération : de 1 à 4, jamais plus (décision du 24/10/2026). */
export const PROPOSITIONS_PAR_GENERATION = 4;

export function nombreDePropositions(brut: unknown, minimum = 1): number {
  const n = Math.round(Number(brut));
  if (!Number.isFinite(n) || n < minimum) return minimum;
  return Math.min(PROPOSITIONS_PAR_GENERATION, n);
}

/**
 * UNE CRÉATION DE MÉDIA PROPOSE TOUJOURS DE 2 À 4 BROUILLONS par génération
 * (décision de l'utilisateur du 26/10/2026) : de quoi départager, jamais un
 * seul résultat à prendre ou à laisser.
 */
export const PROPOSITIONS_MIN_D_UN_MEDIA = 2;

/* ------------------------------------------------------------------ */
/* Les angles de vue                                                    */
/* ------------------------------------------------------------------ */

/**
 * Un angle de vue : la rotation de la caméra autour du sujet (0 = de face,
 * 90 = côté droit, 180 = de dos, 270 = côté gauche, comme les modèles
 * « multiple angles » de fal.ai), sa hauteur (négatif = caméra basse, positif =
 * caméra haute) et le cadrage (0 = très large, 10 = très serré, 5 = inchangé).
 */
export interface AngleDeVue {
  horizontal: number;
  vertical: number;
  zoom: number;
}

export const ANGLES_DE_VUE = [
  'face',
  'trois-quarts-gauche',
  'trois-quarts-droite',
  'profil-gauche',
  'profil-droit',
  'dos',
  'plongee',
  'contre-plongee',
  'gros-plan',
  'plan-large',
] as const;
export type NomDAngle = (typeof ANGLES_DE_VUE)[number];

export const PARAMETRES_DES_ANGLES: Record<NomDAngle, AngleDeVue & { libelle: string; anglais: string }> = {
  face: { horizontal: 0, vertical: 0, zoom: 5, libelle: 'De face', anglais: 'front view, camera facing the subject at eye level' },
  'trois-quarts-gauche': { horizontal: 315, vertical: 0, zoom: 5, libelle: 'Trois-quarts gauche', anglais: 'three-quarter view from the left' },
  'trois-quarts-droite': { horizontal: 45, vertical: 0, zoom: 5, libelle: 'Trois-quarts droite', anglais: 'three-quarter view from the right' },
  'profil-gauche': { horizontal: 270, vertical: 0, zoom: 5, libelle: 'Profil gauche', anglais: 'left side profile view' },
  'profil-droit': { horizontal: 90, vertical: 0, zoom: 5, libelle: 'Profil droit', anglais: 'right side profile view' },
  dos: { horizontal: 180, vertical: 0, zoom: 5, libelle: 'De dos', anglais: 'view from behind the subject' },
  plongee: { horizontal: 0, vertical: 60, zoom: 5, libelle: 'Plongée', anglais: 'high-angle shot looking down at the subject' },
  'contre-plongee': { horizontal: 0, vertical: -30, zoom: 5, libelle: 'Contre-plongée', anglais: 'low-angle shot looking up at the subject' },
  'gros-plan': { horizontal: 0, vertical: 0, zoom: 9, libelle: 'Gros plan', anglais: 'close-up shot' },
  'plan-large': { horizontal: 0, vertical: 0, zoom: 1, libelle: 'Plan large', anglais: 'wide shot showing the whole scene' },
};

/** Un angle nommé, ou des valeurs données à la main, ramenées dans les bornes d'un modèle. */
export function angleDeVue(brut: unknown, bornes: { verticalMin: number; verticalMax: number } = { verticalMin: -30, verticalMax: 90 }): AngleDeVue | null {
  if (typeof brut === 'string') {
    const nom = ANGLES_DE_VUE.find((a) => a === brut.trim());
    if (!nom) return null;
    const p = PARAMETRES_DES_ANGLES[nom];
    return { horizontal: p.horizontal, vertical: Math.min(bornes.verticalMax, Math.max(bornes.verticalMin, p.vertical)), zoom: p.zoom };
  }
  if (!brut || typeof brut !== 'object') return null;
  const o = brut as Record<string, unknown>;
  const h = Number(o.horizontal);
  const v = Number(o.vertical ?? 0);
  const z = Number(o.zoom ?? 5);
  if (!Number.isFinite(h) || !Number.isFinite(v) || !Number.isFinite(z)) return null;
  return {
    horizontal: (((Math.round(h) % 360) + 360) % 360),
    vertical: Math.min(bornes.verticalMax, Math.max(bornes.verticalMin, Math.round(v))),
    zoom: Math.min(10, Math.max(0, Math.round(z * 10) / 10)),
  };
}

/**
 * L'AIMANT DU CUBE D'ANGLE (26/10/2026) : la caméra tournée à la main se cale
 * sur l'angle nommé le plus proche quand elle passe à moins de `seuil` degrés
 * (rotation et hauteur), le cadrage restant celui choisi. Rend l'angle (calé
 * ou non) et le nom de l'angle reconnu — « gros plan » ou « plan large » de
 * face selon le cadrage.
 */
export function angleAimante(a: AngleDeVue, seuil = 12): AngleDeVue & { nom: NomDAngle | null } {
  const ecart = (x: number, y: number) => {
    const d = Math.abs((((x - y) % 360) + 540) % 360 - 180);
    return d;
  };
  let meilleur: NomDAngle | null = null;
  let distance = Infinity;
  for (const nom of ANGLES_DE_VUE) {
    if (nom === 'gros-plan' || nom === 'plan-large') continue;
    const p = PARAMETRES_DES_ANGLES[nom];
    const d = Math.hypot(ecart(a.horizontal, p.horizontal), a.vertical - p.vertical);
    if (d < distance) {
      distance = d;
      meilleur = nom;
    }
  }
  if (!meilleur || distance > seuil) return { ...a, nom: null };
  const p = PARAMETRES_DES_ANGLES[meilleur];
  const nom: NomDAngle = meilleur === 'face' && a.zoom >= 8 ? 'gros-plan' : meilleur === 'face' && a.zoom <= 2 ? 'plan-large' : meilleur;
  return { horizontal: p.horizontal, vertical: p.vertical, zoom: a.zoom, nom };
}

/** L'angle DÉCRIT en anglais, pour un modèle qui ne prend que des mots. */
export function phraseDAngle(a: AngleDeVue): string {
  const h = a.horizontal;
  const cote =
    h === 0 ? 'front view' : h === 180 ? 'view from behind' : h < 180 ? `camera rotated ${h}° to the subject's right` : `camera rotated ${360 - h}° to the subject's left`;
  const hauteur = a.vertical > 10 ? `, high angle looking down (${a.vertical}°)` : a.vertical < -10 ? `, low angle looking up (${-a.vertical}°)` : ', eye level';
  const cadre = a.zoom >= 8 ? ', close-up' : a.zoom <= 2 ? ', wide shot' : '';
  return `Show the same subject and scene from a different camera angle: ${cote}${hauteur}${cadre}. Keep the identity, clothing, lighting and style identical.`;
}

/* ------------------------------------------------------------------ */
/* Le visage à remplacer                                                */
/* ------------------------------------------------------------------ */

/** Un visage repéré sur une image, en fractions (0 à 1) de sa largeur et de sa hauteur. */
export interface BoiteDeVisage {
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
}

/** Une boîte ramenée dans l'image ; `null` si elle n'en est pas une. */
export function boiteDeVisage(brut: unknown): BoiteDeVisage | null {
  if (!brut || typeof brut !== 'object') return null;
  const o = brut as Record<string, unknown>;
  const [x, y, l, h] = [o.x, o.y, o.largeur, o.hauteur].map(Number);
  if (![x, y, l, h].every((n) => Number.isFinite(n)) || l! <= 0 || h! <= 0) return null;
  const borne = (n: number) => Math.min(1, Math.max(0, n));
  const net = (n: number) => Math.round(n * 10_000) / 10_000;
  return { x: net(borne(x!)), y: net(borne(y!)), largeur: net(Math.min(1 - borne(x!), l!)), hauteur: net(Math.min(1 - borne(y!), h!)) };
}

const RANGS_ANGLAIS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];

/**
 * LE VISAGE CHOISI SUR L'IMAGE, DIT AU MODÈLE (26/10/2026) : l'utilisateur
 * clique un des visages repérés ; le modèle, lui, ne prend que des mots. Seul
 * visage : « the person ». Sinon son rang de gauche à droite, sa place dans
 * l'image et la position de son visage en pour cent — de quoi le désigner
 * sans ambiguïté.
 */
export function phraseDeVisageCible(choisi: BoiteDeVisage, tous: readonly BoiteDeVisage[] = [choisi]): string {
  const centre = (b: BoiteDeVisage) => b.x + b.largeur / 2;
  const cx = centre(choisi);
  const cy = choisi.y + choisi.hauteur / 2;
  const ou = `face centred about ${Math.round(cx * 100)}% from the left and ${Math.round(cy * 100)}% from the top of the image`;
  const autres = tous.filter((b) => Math.abs(centre(b) - cx) > 1e-6 || Math.abs(b.y - choisi.y) > 1e-6);
  if (!autres.length) return `the person (${ou})`;
  const tries = [...autres, choisi].sort((a, b) => centre(a) - centre(b));
  const rang = tries.indexOf(choisi);
  const place = cx < 0.36 ? 'on the left' : cx > 0.64 ? 'on the right' : 'in the middle';
  const rangAnglais = RANGS_ANGLAIS[rang] ?? `number ${rang + 1}`;
  return `the ${rangAnglais} person from the left, ${place} of the image (${ou}), among ${tries.length} people`;
}

/* ------------------------------------------------------------------ */
/* La direction de la lumière                                           */
/* ------------------------------------------------------------------ */

/**
 * Une direction de lumière, vue de la CAMÉRA : `azimut` en degrés (0 = la
 * lumière vient de face, de derrière la caméra ; 90 = de la droite de l'image ;
 * -90 = de la gauche ; 180 = de derrière le sujet, en contre-jour) ;
 * `elevation` de -90 (par en dessous) à 90 (au-dessus).
 */
export interface DirectionDeLumiere {
  azimut: number;
  elevation: number;
}

/** Une direction PERMISE par un modèle à directions fixes : son nom chez le service et sa place sur la sphère. */
export interface DirectionPermise extends DirectionDeLumiere {
  /** La valeur envoyée au service (« Left », « side »…). */
  valeur: string;
  libelle: string;
}

/** Les directions fixes des modèles de lumière de fal.ai (schémas lus le 24/10/2026). */
export const DIRECTIONS_ICLIGHT: readonly DirectionPermise[] = [
  { valeur: 'Left', libelle: 'Gauche', azimut: -90, elevation: 0 },
  { valeur: 'Right', libelle: 'Droite', azimut: 90, elevation: 0 },
  { valeur: 'Top', libelle: 'Haut', azimut: 0, elevation: 75 },
  { valeur: 'Bottom', libelle: 'Bas', azimut: 0, elevation: -75 },
];

export const DIRECTIONS_FIBO: readonly DirectionPermise[] = [
  { valeur: 'front', libelle: 'Face', azimut: 0, elevation: 0 },
  { valeur: 'side', libelle: 'Côté droit', azimut: 90, elevation: 0 },
  { valeur: 'side', libelle: 'Côté gauche', azimut: -90, elevation: 0 },
  { valeur: 'top-down', libelle: 'Haut', azimut: 0, elevation: 75 },
  { valeur: 'bottom', libelle: 'Bas', azimut: 0, elevation: -75 },
];

/** Ce que la sphère permet : tout (`libre`), ou seulement des directions fixes. */
export type DirectionsDuModele = 'libre' | readonly DirectionPermise[];

/** Ramène une direction dans ses bornes (azimut de -180 à 180, élévation de -90 à 90). */
export function directionBornee(d: { azimut: unknown; elevation: unknown }): DirectionDeLumiere | null {
  const a = Number(d.azimut);
  const e = Number(d.elevation);
  if (!Number.isFinite(a) || !Number.isFinite(e)) return null;
  let az = ((((Math.round(a) + 180) % 360) + 360) % 360) - 180;
  if (az === -180) az = 180;
  return { azimut: az, elevation: Math.min(90, Math.max(-90, Math.round(e))) };
}

/** L'angle (en degrés) entre deux directions sur la sphère. */
export function ecartAngulaire(a: DirectionDeLumiere, b: DirectionDeLumiere): number {
  const r = Math.PI / 180;
  const v = (d: DirectionDeLumiere) => [Math.cos(d.elevation * r) * Math.sin(d.azimut * r), Math.sin(d.elevation * r), Math.cos(d.elevation * r) * Math.cos(d.azimut * r)];
  const [x1, y1, z1] = v(a);
  const [x2, y2, z2] = v(b);
  const c = Math.min(1, Math.max(-1, x1! * x2! + y1! * y2! + z1! * z2!));
  return Math.acos(c) / r;
}

/**
 * LA SPHÈRE BLOQUÉE : la direction permise la plus proche du point choisi.
 * En mode libre, la direction reste celle qu'on a posée.
 */
export function directionAimantee(d: DirectionDeLumiere, permises: DirectionsDuModele): DirectionDeLumiere & { valeur?: string; libelle?: string } {
  if (permises === 'libre' || !permises.length) return d;
  let meilleure = permises[0]!;
  for (const p of permises) if (ecartAngulaire(d, p) < ecartAngulaire(d, meilleure)) meilleure = p;
  return { ...meilleure };
}

/** Une direction est-elle acceptée par ce modèle ? (le démon le vérifie, jamais l'écran seul) */
export function directionPermise(d: DirectionDeLumiere, permises: DirectionsDuModele): boolean {
  if (permises === 'libre') return true;
  return permises.some((p) => p.azimut === d.azimut && p.elevation === d.elevation);
}

/** La lumière DÉCRITE en anglais, pour un modèle qui ne prend que des mots. */
export function phraseDeLumiere(d: DirectionDeLumiere): string {
  const a = d.azimut;
  const cote =
    Math.abs(a) <= 15
      ? 'from the front (behind the camera)'
      : Math.abs(a) >= 165
        ? 'from behind the subject (backlight, rim light)'
        : `from the ${a > 0 ? 'right' : 'left'} side of the frame${Math.abs(a) > 100 ? ', slightly behind the subject' : Math.abs(a) < 75 ? ', slightly in front of the subject' : ''}`;
  const hauteur = d.elevation > 60 ? 'from directly above' : d.elevation > 15 ? `from above (${d.elevation}° elevation)` : d.elevation < -15 ? `from below (${-d.elevation}° under the subject)` : 'at eye level';
  return `Relight the image: the key light comes ${cote}, ${hauteur} (azimuth ${a}°, elevation ${d.elevation}°). Keep the subject, composition and style unchanged; only the lighting and shadows change accordingly.`;
}

/** Le libellé court d'une direction, pour la réponse et les réglages. */
export function libelleDeDirection(d: DirectionDeLumiere): string {
  return `azimut ${d.azimut}°, élévation ${d.elevation}°`;
}

/* ------------------------------------------------------------------ */
/* Les informations d'un média                                          */
/* ------------------------------------------------------------------ */

/** Ce qu'on sait d'un fichier fabriqué, mesuré une fois rangé (ffprobe). */
export interface MesureDeMedia {
  largeur?: number;
  hauteur?: number;
  /** En secondes. */
  duree?: number;
  /** En kilobits par seconde. */
  debit?: number;
  /** Images par seconde. */
  ips?: number;
}

/** La lecture de `ffprobe -show_streams -show_format -of json` : ce qui manque est omis, jamais deviné. */
export function lireMesureFfprobe(json: any): MesureDeMedia {
  const flux: any[] = Array.isArray(json?.streams) ? json.streams : [];
  const image = flux.find((f) => f?.codec_type === 'video');
  const son = flux.find((f) => f?.codec_type === 'audio');
  const largeur = Number(image?.width);
  const hauteur = Number(image?.height);
  const duree = Number(json?.format?.duration ?? image?.duration ?? son?.duration);
  const debit = Number(json?.format?.bit_rate ?? son?.bit_rate);
  let ips: number | undefined;
  const brut = String(image?.avg_frame_rate ?? image?.r_frame_rate ?? '');
  const m = /^(\d+)\/(\d+)$/.exec(brut);
  if (m && Number(m[2]) > 0) ips = Math.round((Number(m[1]) / Number(m[2])) * 100) / 100;
  /* Une image fixe passe par le décodeur vidéo : sa « durée » et ses images par seconde ne veulent rien dire. */
  const fixe = !!image && !son && (!Number.isFinite(duree) || duree < 0.05 || (json?.format?.format_name ?? '').match(/png|jpeg|jpg|webp|image2/));
  return {
    ...(largeur > 0 && hauteur > 0 ? { largeur, hauteur } : {}),
    ...(!fixe && Number.isFinite(duree) && duree > 0 ? { duree: Math.round(duree * 100) / 100 } : {}),
    ...(!fixe && Number.isFinite(debit) && debit > 0 ? { debit: Math.round(debit / 1000) } : {}),
    ...(!fixe && ips && ips > 0 && ips < 1000 ? { ips } : {}),
  };
}

const RATIOS_CONNUS: [number, string][] = [
  [16 / 9, '16:9'],
  [9 / 16, '9:16'],
  [1, '1:1'],
  [4 / 5, '4:5'],
  [5 / 4, '5:4'],
  [4 / 3, '4:3'],
  [3 / 4, '3:4'],
  [3 / 2, '3:2'],
  [2 / 3, '2:3'],
  [21 / 9, '21:9'],
];

/** Le cadrage lisible d'après la taille réelle (« 16:9 »), le plus proche des formats courants. */
export function ratioLisible(largeur: number, hauteur: number): string | null {
  if (!(largeur > 0 && hauteur > 0)) return null;
  const r = largeur / hauteur;
  const [, nom] = RATIOS_CONNUS.reduce((a, b) => (Math.abs(b[0] - r) < Math.abs(a[0] - r) ? b : a));
  return nom;
}

/** Un élément de la ligne d'informations : un genre et sa valeur, formatée par l'écran. */
export type InformationDeMedia =
  | { genre: 'format'; valeur: string }
  | { genre: 'dimensions'; largeur: number; hauteur: number }
  | { genre: 'duree'; secondes: number }
  | { genre: 'ips'; valeur: number }
  | { genre: 'debit'; kbps: number }
  | { genre: 'poids'; octets: number };

/**
 * LA LIGNE D'INFORMATIONS SOUS UN MÉDIA, selon son genre : une image dit son
 * format, ses dimensions et son poids ; une vidéo son format, ses dimensions,
 * sa durée, ses images par seconde et son débit ; un son sa durée et son débit.
 * N'y figure que ce qui est CONNU (mesuré ou demandé), jamais une estimation.
 */
export function informationsDuMedia(m: { genre: 'image' | 'video' | 'son'; format?: string | null; mesure?: MesureDeMedia | null; taille?: number | null }): InformationDeMedia[] {
  const mesure = m.mesure ?? {};
  const infos: InformationDeMedia[] = [];
  if (m.genre !== 'son') {
    const format = mesure.largeur && mesure.hauteur ? ratioLisible(mesure.largeur, mesure.hauteur) : m.format ?? null;
    if (format) infos.push({ genre: 'format', valeur: format });
    if (mesure.largeur && mesure.hauteur) infos.push({ genre: 'dimensions', largeur: mesure.largeur, hauteur: mesure.hauteur });
  }
  if (m.genre !== 'image' && mesure.duree) infos.push({ genre: 'duree', secondes: mesure.duree });
  if (m.genre === 'video' && mesure.ips) infos.push({ genre: 'ips', valeur: mesure.ips });
  if (m.genre !== 'image' && mesure.debit) infos.push({ genre: 'debit', kbps: mesure.debit });
  if (m.genre === 'image' && m.taille && m.taille > 0) infos.push({ genre: 'poids', octets: m.taille });
  return infos;
}

/* ------------------------------------------------------------------ */
/* La question de la sphère                                             */
/* ------------------------------------------------------------------ */

/** Ce que la bulle d'une question de lumière porte : la sphère, ses directions, l'image et le modèle choisi. */
export interface SphereDeLaQuestion {
  /** « libre », ou les directions permises (la sphère s'y aimante). */
  directions: 'libre' | { azimut: number; elevation: number; libelle: string }[];
  /** La pièce jointe de l'image à rééclairer, montrée à côté de la sphère. */
  image?: string;
  /** Le modèle choisi, rappelé sous la sphère. */
  modele: string;
}

/** La réponse que la sphère envoie : lisible par l'utilisateur ET relue par l'agent. */
export function reponseDeLumiere(d: DirectionDeLumiere): string {
  return `Lumière : azimut ${d.azimut}°, élévation ${d.elevation}°`;
}

/** Relit une réponse de la sphère (`reponseDeLumiere`) ; `null` si ce n'en est pas une. */
export function lireReponseDeLumiere(reponse: string | undefined): DirectionDeLumiere | null {
  const m = /azimut\s*(-?\d+)\s*°?\s*,\s*élévation\s*(-?\d+)/i.exec(reponse ?? '');
  return m ? directionBornee({ azimut: m[1], elevation: m[2] }) : null;
}
