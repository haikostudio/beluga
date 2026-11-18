/**
 * LA PLAQUETTE CLIENT — règles pures (carte « Captures d'écran et plaquette client », 05/11/2026).
 *
 * Une plaquette est une suite de BLOCS (couverture, texte, image, galerie, chiffres, appel à l'action), rédigée par
 * l'agent, retouchée par l'utilisateur dans la page « Plaquettes », lue par le client sur un lien privé sans compte, et
 * exportée en PDF. UNE SEULE SOURCE : `htmlDeLaPlaquette` rend la page publique ET le PDF (mode `pdf`) — une
 * modification en ligne se retrouve donc toujours dans le PDF, sans second gabarit à tenir d'accord.
 *
 * L'IDENTITÉ EST CELLE D'UN PROJET DE L'UTILISATEUR (décision de l'utilisateur) : aucune couleur, aucun logo, aucun nom
 * de Haiko n'est écrit ici. La marque arrive toute faite (`MarqueDePlaquette`), choisie au moment de la création.
 *
 * Les libellés de la page PUBLIQUE (« Laisser une remarque », « Télécharger le PDF »…) suivent la langue de la
 * plaquette, pas celle de l'application : ce sont des textes lus par le client final. Ils vivent donc ici, dans les cinq
 * langues, et non dans le dictionnaire de l'interface.
 */

import type { LangueId } from './langues.js';
import { minusculesSansAccents } from './mots.js';

/**
 * LES GENRES DE BLOC. Une VRAIE CHARTE (carte « Aperçu, chat, Agentik et vraie charte », 06/11/2026) s'ordonne ainsi :
 * couverture, `sommaire` (page 2, chaque ligne mène à sa page), une `partie` « Charte graphique » (le `logo` et ses
 * règles, les `couleurs` avec leurs codes, les `typographies`, puis composants, style des images, ton et voix, exemples
 * en galeries et textes), une `partie` de présentation du produit, et les `ressources` à télécharger en dernier.
 * `appel` (« Vos remarques ») n'est plus proposé : les remarques passent par les commentaires ; il reste lisible.
 */
export const GENRES_DE_BLOC_DE_PLAQUETTE = ['couverture', 'sommaire', 'partie', 'texte', 'image', 'galerie', 'chiffres', 'logo', 'couleurs', 'typographies', 'ressources', 'appel', 'annexes'] as const;
export type GenreDeBlocDePlaquette = (typeof GENRES_DE_BLOC_DE_PLAQUETTE)[number];

export interface ChiffreDePlaquette {
  valeur: string;
  libelle: string;
}

export interface BlocDePlaquette {
  id: string;
  genre: GenreDeBlocDePlaquette;
  titre?: string;
  /** Le texte courant ; un saut de ligne double sépare deux paragraphes. */
  texte?: string;
  /** Les images (identifiants de pièces jointes) : une pour `couverture` et `image`, plusieurs pour `galerie`. */
  pieces?: string[];
  legende?: string;
  /** Les chiffres clés du bloc `chiffres`. */
  elements?: ChiffreDePlaquette[];
  /** Le bouton du bloc `appel`. */
  bouton?: string;
  /** Où mène le bouton : `https://…` ou `mailto:…`, rien d'autre. */
  lien?: string;
  /**
   * UNE SECTION MASQUÉE (carte « Refonte du service Charte graphique », décision du cadrage) : absente de la page du
   * client, du PDF et des diapositives ; gardée, grisée, dans l'éditeur — on la rend d'un clic.
   */
  masque?: boolean;
  /**
   * LE CADRE DES IMAGES DU BLOC : `navigateur` (une fenêtre avec sa barre, pour un site), `telephone` (un iPhone, pour
   * un mobile ou une application installée), `aucun` (une photo, un logo). AUCUNE IMAGE N'EST RECADRÉE (décision de
   * l'utilisateur) : le cadre suit la proportion de la capture.
   */
  appareil?: AppareilDeBloc;
  /** Le SEUL recadrage permis : un zoom voulu sur un détail (l'image remplit son cadre et déborde). */
  zoom?: boolean;
  /**
   * LE SITE EN PLEINE HAUTEUR (carte « Sommaire aéré, site en cadre et charte complète ») : une capture entière dans un
   * cadre navigateur (`appareil: 'navigateur'`) qui DÉFILE seule dans la version en ligne — elle monte à l'arrivée,
   * s'arrête au survol, et s'arrête pour de bon dès que le client défile lui-même (barre de défilement visible). Le PDF
   * et les diapositives gardent la capture entière, fixe.
   */
  defilant?: boolean;
  /** Le visuel touche le bord de la page, à gauche ou à droite, pour casser la symétrie. */
  aBord?: 'gauche' | 'droite';
  /** L'adresse écrite dans la barre du cadre navigateur (« exemple.fr/tarifs »), facultative. */
  url?: string;
  /**
   * LE CHOIX DES PAGES (décision de l'utilisateur : « personnaliser les pages qu'on veut afficher au client et qu'on veut
   * générer dans le PDF ») : `horsClient` retire la section de la page du client, `horsPdf` du PDF. Les deux sont
   * indépendants ; `masque` reste « absente partout, grisée dans l'éditeur ».
   */
  horsClient?: boolean;
  horsPdf?: boolean;
}

/** Les deux sorties d'un document : la page du client et le PDF. */
export type SortieDePlaquette = 'client' | 'pdf';

/** Les sections qu'une sortie montre : jamais une masquée, ni une retirée de cette sortie. */
export function blocsDeLaSortie<B extends BlocDePlaquette>(blocs: readonly B[], sortie: SortieDePlaquette): B[] {
  return blocs.filter((b) => !b.masque && !(sortie === 'client' ? b.horsClient : b.horsPdf));
}

export const APPAREILS_DE_BLOC = ['navigateur', 'telephone', 'aucun'] as const;
export type AppareilDeBloc = (typeof APPAREILS_DE_BLOC)[number];

/** Tutoiement ou vouvoiement du document — DEMANDÉ par l'agent qui rédige (décision de l'utilisateur), gardé ici. */
export const ADRESSES_DE_PLAQUETTE = ['vous', 'tu'] as const;
export type AdresseDePlaquette = (typeof ADRESSES_DE_PLAQUETTE)[number];
/**
 * UNE REFONTE DES TEXTES REDEMANDE TU OU VOUS (décision de l'utilisateur, 06/11/2026 : la « remasterisation » d'une
 * charte avait gardé le registre sans le redemander). Rend le nombre de blocs dont le TEXTE change (titre, texte,
 * légende, libellés des éléments, bouton), blocs ajoutés compris. Une retouche d'un seul bloc (une faute, une phrase)
 * ou une modification sans texte (images, ordre, couleur, format) reste en dessous du seuil `SEUIL_DE_REFONTE`.
 */
export function blocsDontLeTexteChange(avant: readonly BlocDePlaquette[], apres: readonly unknown[]): number {
  const texteDe = (b: unknown): string => {
    if (!b || typeof b !== 'object') return '';
    const x = b as Partial<BlocDePlaquette> & { elements?: { libelle?: unknown; valeur?: unknown }[] };
    return JSON.stringify([x.titre ?? '', x.texte ?? '', x.legende ?? '', x.bouton ?? '', (Array.isArray(x.elements) ? x.elements : []).map((e) => String(e?.libelle ?? ''))]);
  };
  const anciens = new Map(avant.map((b) => [b.id, texteDe(b)]));
  let n = 0;
  for (const b of apres) {
    const id = b && typeof b === 'object' ? String((b as { id?: unknown }).id ?? '') : '';
    const texte = texteDe(b);
    if (texte === texteDe({})) continue;
    if (anciens.get(id) !== texte) n++;
  }
  return n;
}

/** À partir de combien de blocs réécrits une modification est une REFONTE des textes (et redemande tu ou vous). */
export const SEUIL_DE_REFONTE = 2;

export function lireLAdresseDePlaquette(brut: unknown): AdresseDePlaquette | null {
  const s = String(brut ?? '').trim().toLowerCase();
  if (['tu', 'tutoiement', 'tutoyer', 'informel'].includes(s)) return 'tu';
  if (['vous', 'vouvoiement', 'vouvoyer', 'formel'].includes(s)) return 'vous';
  return null;
}

export interface MarqueDePlaquette {
  /** Le nom affiché (celui du projet qui donne la marque, ou celui donné par l'utilisateur). */
  nom: string;
  /** Le logo : une pièce jointe image. */
  logo?: string;
  /** La couleur principale (titres, bouton, couverture). */
  couleur: string;
  /** La couleur du texte courant. */
  texte: string;
  /** Le fond des pages. */
  fond: string;
  /** Une famille de polices déjà installée (aucun chargement externe). */
  police?: string;
  /** Une ligne de contact en pied (« contact@exemple.fr · 06… »). */
  contact?: string;
  /**
   * L'AUTEUR du document (le studio qui le réalise), en PETITE signature « Réalisé par … » sur la couverture et sur la
   * dernière page — jamais sa couleur, sa police ni son logo : la marque est celle du projet CIBLÉ (décision de
   * l'utilisateur). Absente, ou égale au nom de la marque : aucune signature.
   */
  signature?: string;
  /**
   * L'ICÔNE DU PROJET SIGNATAIRE (carte « Finitions du lecteur de charte », 06/11/2026) : celle de la colonne de
   * gauche, posée devant « Réalisé par … ». JAMAIS GARDÉE EN BASE : le serveur la pose au rendu (une donnée
   * embarquée `data:image/…`, car la page du client et le PDF n'ont pas de session), `lireLaMarque` l'écarte.
   */
  signatureIcone?: string;
}

/** Une icône embarquée acceptable pour la signature : une image en `data:`, bornée. */
export function iconeDeSignatureValable(brut: unknown): string | undefined {
  if (typeof brut !== 'string' || brut.length > 400_000) return undefined;
  return /^data:image\/(png|jpeg|webp|gif|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/=]+$/.test(brut) ? brut : undefined;
}

/**
 * LES FICHIERS À TÉLÉCHARGER SONT TOUJOURS LA DERNIÈRE PAGE (carte « Finitions du lecteur de charte ») : les sections
 * `ressources` passent en fin de document, dans leur ordre ; le reste garde le sien. Appliqué à la lecture des blocs
 * (création, modification, brouillon) ET au rendu (un document d'avant la règle se range tout seul).
 */
export function ordonnerLesBlocs<B extends BlocDePlaquette>(blocs: readonly B[]): B[] {
  const ressources = blocs.filter((b) => b.genre === 'ressources');
  if (!ressources.length) return [...blocs];
  return [...blocs.filter((b) => b.genre !== 'ressources'), ...ressources];
}

/** Le nom à signer, ou rien quand la marque se signe elle-même. */
export function signatureDeLaMarque(marque: MarqueDePlaquette): string | null {
  const s = marque.signature?.trim();
  if (!s) return null;
  const plat = (x: string) => minusculesSansAccents(x).trim();
  return plat(s) === plat(marque.nom) ? null : s;
}

export const LANGUES_DE_PLAQUETTE = ['fr', 'en', 'es', 'de', 'zh'] as const satisfies readonly LangueId[];

/* ------------------------------------------------------------------ */
/* Lecture et plafonds                                                  */
/* ------------------------------------------------------------------ */

export const PLAFONDS_DE_PLAQUETTE = {
  blocs: 40,
  titre: 160,
  texte: 6000,
  legende: 300,
  pieces: 24,
  chiffres: 8,
  remarque: 2000,
  nomRemarque: 80,
} as const;

const COULEUR = /^#[0-9a-fA-F]{6}$/;
const ID_PIECE = /^[A-Za-z0-9_-]{4,64}$/;

function chaine(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/\r\n?/g, '\n').trim();
  return t ? t.slice(0, max) : undefined;
}

/** Un lien de bouton acceptable : https ou mailto, jamais javascript: ni data:. */
export function lienDeBoutonValable(lien: unknown): string | undefined {
  if (typeof lien !== 'string') return undefined;
  const l = lien.trim();
  if (/^https:\/\/[^\s<>"']+$/i.test(l) || /^mailto:[^\s<>"']+$/i.test(l)) return l.slice(0, 500);
  return undefined;
}

export type LectureDeBlocs = { ok: true; blocs: BlocDePlaquette[] } | { ok: false; raison: string };

/**
 * Les blocs tels qu'ils sont gardés : genre connu, textes bornés, images réduites à des identifiants plausibles,
 * lien de bouton filtré. `nouvelId` donne l'identifiant d'un bloc qui n'en a pas.
 */
export function lireLesBlocs(brut: unknown, nouvelId: () => string, options: { souple?: boolean } = {}): LectureDeBlocs {
  if (!Array.isArray(brut)) return { ok: false, raison: 'Les blocs doivent être une liste.' };
  if (brut.length === 0) return { ok: false, raison: 'Une plaquette a au moins un bloc.' };
  if (brut.length > PLAFONDS_DE_PLAQUETTE.blocs) return { ok: false, raison: `${PLAFONDS_DE_PLAQUETTE.blocs} blocs au plus.` };
  const blocs: BlocDePlaquette[] = [];
  const vus = new Set<string>();
  for (const [i, b] of brut.entries()) {
    const o = (b ?? {}) as Record<string, unknown>;
    const genre = o.genre as GenreDeBlocDePlaquette;
    if (!GENRES_DE_BLOC_DE_PLAQUETTE.includes(genre)) {
      return { ok: false, raison: `Bloc ${i + 1} : genre inconnu (« ${String(o.genre)} »). Genres : ${GENRES_DE_BLOC_DE_PLAQUETTE.join(', ')}.` };
    }
    let id = typeof o.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(o.id) ? o.id : nouvelId();
    while (vus.has(id)) id = nouvelId();
    vus.add(id);
    const pieces = Array.isArray(o.pieces)
      ? o.pieces.filter((p): p is string => typeof p === 'string' && ID_PIECE.test(p)).slice(0, PLAFONDS_DE_PLAQUETTE.pieces)
      : undefined;
    const elements = Array.isArray(o.elements)
      ? o.elements
          .map((e) => {
            const x = (e ?? {}) as Record<string, unknown>;
            const valeur = chaine(x.valeur, 40);
            const libelle = chaine(x.libelle, 120);
            return valeur && libelle ? { valeur, libelle } : null;
          })
          .filter((e): e is ChiffreDePlaquette => !!e)
          .slice(0, PLAFONDS_DE_PLAQUETTE.chiffres)
      : undefined;
    const bloc: BlocDePlaquette = { id, genre };
    const titre = chaine(o.titre, PLAFONDS_DE_PLAQUETTE.titre);
    const texte = chaine(o.texte, PLAFONDS_DE_PLAQUETTE.texte);
    const legende = chaine(o.legende, PLAFONDS_DE_PLAQUETTE.legende);
    const bouton = chaine(o.bouton, 60);
    const lien = lienDeBoutonValable(o.lien);
    if (titre) bloc.titre = titre;
    if (texte) bloc.texte = texte;
    if (legende) bloc.legende = legende;
    if (pieces?.length) bloc.pieces = pieces;
    if (elements?.length) bloc.elements = elements;
    if (bouton) bloc.bouton = bouton;
    if (lien) bloc.lien = lien;
    if (o.masque === true) bloc.masque = true;
    if (o.horsClient === true) bloc.horsClient = true;
    if (o.horsPdf === true) bloc.horsPdf = true;
    if ((APPAREILS_DE_BLOC as readonly string[]).includes(String(o.appareil))) bloc.appareil = o.appareil as AppareilDeBloc;
    if (o.zoom === true) bloc.zoom = true;
    if (o.defilant === true && bloc.appareil === 'navigateur') bloc.defilant = true;
    if (o.aBord === 'gauche' || o.aBord === 'droite') bloc.aBord = o.aBord;
    const url = chaine(o.url, 120);
    if (url) bloc.url = url.replace(/^https?:\/\//i, '').replace(/[<>"']/g, '');
    /* L'éditeur (`souple`) garde une section qu'on vide pour la réécrire : elle ne s'affiche simplement pas. */
    if (!options.souple && genre !== 'sommaire' && !titre && !texte && !pieces?.length && !elements?.length) {
      return { ok: false, raison: `Bloc ${i + 1} (${genre}) : vide — il lui faut au moins un titre, un texte, une image ou des chiffres.` };
    }
    blocs.push(bloc);
  }
  return { ok: true, blocs: ordonnerLesBlocs(blocs) };
}

export type LectureDeMarque = { ok: true; marque: MarqueDePlaquette } | { ok: false; raison: string };

export function lireLaMarque(brut: unknown): LectureDeMarque {
  const o = (brut ?? {}) as Record<string, unknown>;
  const nom = chaine(o.nom, 80);
  if (!nom) return { ok: false, raison: 'La marque a un nom.' };
  const couleur = typeof o.couleur === 'string' && COULEUR.test(o.couleur) ? o.couleur.toLowerCase() : null;
  if (!couleur) return { ok: false, raison: 'La couleur principale de la marque est une teinte « #rrggbb ».' };
  const texte = typeof o.texte === 'string' && COULEUR.test(o.texte) ? o.texte.toLowerCase() : '#1f2328';
  const fond = typeof o.fond === 'string' && COULEUR.test(o.fond) ? o.fond.toLowerCase() : '#ffffff';
  const marque: MarqueDePlaquette = { nom, couleur, texte, fond };
  if (typeof o.logo === 'string' && ID_PIECE.test(o.logo)) marque.logo = o.logo;
  const police = typeof o.police === 'string' ? o.police.replace(/[^A-Za-z0-9 \-]/g, '').trim().slice(0, 60) : '';
  if (police) marque.police = police;
  const contact = chaine(o.contact, 200);
  if (contact) marque.contact = contact;
  const signature = chaine(o.signature, 80);
  if (signature) marque.signature = signature;
  return { ok: true, marque };
}

/* ------------------------------------------------------------------ */
/* Les formats du document                                              */
/* ------------------------------------------------------------------ */

/**
 * LES TROIS FORMATS D'UNE PLAQUETTE (carte « Refonte de l'espace Plaquettes », 05/11/2026, décision de l'utilisateur :
 * « seul des PDF dans les différents formats », aucun PowerPoint). Le format se DEMANDE à l'utilisateur quand il ne
 * l'a pas dit ; une plaquette d'avant cette carte est en A4 portrait.
 */
export const FORMATS_DE_PLAQUETTE = ['a4-portrait', 'a4-paysage', 'diapositives'] as const;
export type FormatDePlaquette = (typeof FORMATS_DE_PLAQUETTE)[number];
export const FORMAT_DE_PLAQUETTE_PAR_DEFAUT: FormatDePlaquette = 'a4-portrait';

/** La page de chaque format : en millimètres pour l'impression, en pixels CSS (96 ppp) pour la vignette et l'aperçu. */
export const PAGES_DE_PLAQUETTE: Record<FormatDePlaquette, { largeurMm: number; hauteurMm: number; largeurPx: number; hauteurPx: number }> = {
  'a4-portrait': { largeurMm: 210, hauteurMm: 297, largeurPx: 794, hauteurPx: 1123 },
  'a4-paysage': { largeurMm: 297, hauteurMm: 210, largeurPx: 1123, hauteurPx: 794 },
  /* 16:9, la taille d'une diapositive de présentation (13,333 × 7,5 pouces). */
  diapositives: { largeurMm: 338.67, hauteurMm: 190.5, largeurPx: 1280, hauteurPx: 720 },
};

/** Le format désigné par l'agent ou l'écran, avec les façons courantes de le dire ; `null` s'il n'est pas reconnu. */
export function lireLeFormatDePlaquette(brut: unknown): FormatDePlaquette | null {
  const s = String(brut ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s_:]+/g, '-');
  if ((FORMATS_DE_PLAQUETTE as readonly string[]).includes(s)) return s as FormatDePlaquette;
  if (['a4', 'portrait', 'a4portrait', 'a4-vertical', 'vertical'].includes(s)) return 'a4-portrait';
  if (['paysage', 'a4paysage', 'a4-landscape', 'landscape', 'a4-horizontal', 'horizontal'].includes(s)) return 'a4-paysage';
  if (['diapositive', 'diapos', 'diapo', 'slides', 'slide', 'presentation', '16-9', 'deck'].includes(s)) return 'diapositives';
  return null;
}

/** Le format gardé en base, relu sans jamais casser : inconnu = A4 portrait. */
export function formatDeLaPlaquette(brut: unknown): FormatDePlaquette {
  return lireLeFormatDePlaquette(brut) ?? FORMAT_DE_PLAQUETTE_PAR_DEFAUT;
}

/** Une diapositive : un bloc (ou la suite d'un bloc trop long), avec son rang. */
export interface DiapositiveDePlaquette {
  bloc: BlocDePlaquette;
  /** Vrai pour la deuxième diapositive (et les suivantes) d'un même bloc. */
  suite: boolean;
}

/** Ce qu'une diapositive tient sans déborder (mesuré sur le gabarit 16:9). */
export const TENUE_D_UNE_DIAPOSITIVE = { texte: 900, texteAvecImage: 520, images: 3, chiffres: 8 } as const;

function morceauxDeTexte(texte: string, max: number): string[] {
  const paras = texte.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const morceaux: string[] = [];
  let courant = '';
  const pousser = () => {
    if (courant) morceaux.push(courant);
    courant = '';
  };
  for (const p of paras) {
    /* Un paragraphe plus long qu'une diapositive se coupe à la phrase. */
    const phrases = p.length > max ? (p.match(/[^.!?…]+[.!?…]*\s*/g) ?? [p]) : [p];
    let para = '';
    for (const ph of phrases) {
      if (para && para.length + ph.length > max) {
        pousser();
        morceaux.push(para.trim());
        para = '';
      }
      para += ph;
    }
    para = para.trim();
    if (courant && courant.length + para.length + 2 > max) pousser();
    courant = courant ? `${courant}\n\n${para}` : para;
  }
  pousser();
  return morceaux.length ? morceaux : [''];
}

/** Le sommaire en diapositives : sept lignes au plus par feuille, réparties à parts égales (7 + 7 + 6 pour vingt lignes). */
export const LIGNES_PAR_DIAPO_DU_SOMMAIRE = 7;

/** Les tranches [début, fin[ des lignes d'un sommaire en diapositives : jamais une feuille à une seule ligne. */
export function repartitionDuSommaire(total: number): [number, number][] {
  const nombre = Math.max(1, Math.ceil(total / LIGNES_PAR_DIAPO_DU_SOMMAIRE));
  const base = Math.floor(total / nombre);
  const reste = total % nombre;
  const morceaux: [number, number][] = [];
  let debut = 0;
  for (let i = 0; i < nombre; i++) {
    const taille = base + (i < reste ? 1 : 0);
    morceaux.push([debut, debut + taille]);
    debut += taille;
  }
  return morceaux;
}

/** Les deux supports que TOUTE charte graphique porte d'office (décision de l'utilisateur). */
export const TITRE_DES_SUPPORTS_DE_CHARTE = 'Cartes de visite et papier à lettres';

/**
 * UNE CHARTE GRAPHIQUE porte toujours ses cartes de visite et son papier à lettres : quand une charte (couleurs, polices
 * ou logo) n'a pas encore cette partie, elle est ajoutée MASQUÉE, avant les ressources — grisée dans l'éditeur, absente
 * du client et du PDF tant qu'elle n'est pas remplie et rendue visible. Une charte qui l'a déjà n'est pas touchée.
 */
export function avecLesSupportsDeCharte(blocs: readonly BlocDePlaquette[], nouvelId: () => string): BlocDePlaquette[] {
  const estUneCharte = blocs.some((b) => b.genre === 'couleurs' || b.genre === 'typographies' || b.genre === 'logo');
  const dejaLa = blocs.some((b) => b.genre === 'partie' && (b.titre ?? '').trim().toLowerCase() === TITRE_DES_SUPPORTS_DE_CHARTE.toLowerCase());
  if (!estUneCharte || dejaLa) return [...blocs];
  const partie: BlocDePlaquette = { id: nouvelId(), genre: 'partie', titre: TITRE_DES_SUPPORTS_DE_CHARTE, masque: true };
  const texte: BlocDePlaquette = {
    id: nouvelId(),
    genre: 'texte',
    titre: TITRE_DES_SUPPORTS_DE_CHARTE,
    texte: 'À compléter : la carte de visite et le papier à lettres du projet, aux couleurs et au logo de la charte.',
    masque: true,
  };
  const sortie = [...blocs];
  const i = sortie.findIndex((b) => b.genre === 'ressources' || b.genre === 'annexes' || b.genre === 'appel');
  sortie.splice(i < 0 ? sortie.length : i, 0, partie, texte);
  return sortie;
}

/**
 * EN DIAPOSITIVES, UN BLOC = UNE DIAPOSITIVE — sauf s'il n'y tient pas : un texte long se coupe en plusieurs (à la
 * phrase, jamais au milieu d'un mot), une galerie de plus de trois images aussi, et le texte trop long d'un bloc
 * image part sur une diapositive de texte qui le suit. Rien ne déborde ni ne disparaît.
 */
export function decouperEnDiapositives(blocs: readonly BlocDePlaquette[]): DiapositiveDePlaquette[] {
  const sortie: DiapositiveDePlaquette[] = [];
  for (const b of blocs) {
    if (b.masque) continue;
    if (b.genre === 'texte' && (b.texte?.length ?? 0) > TENUE_D_UNE_DIAPOSITIVE.texte) {
      morceauxDeTexte(b.texte!, TENUE_D_UNE_DIAPOSITIVE.texte).forEach((texte, i) => sortie.push({ bloc: { ...b, texte }, suite: i > 0 }));
    } else if (b.genre === 'galerie' && (b.pieces?.length ?? 0) > TENUE_D_UNE_DIAPOSITIVE.images) {
      const pieces = b.pieces!;
      for (let i = 0; i < pieces.length; i += TENUE_D_UNE_DIAPOSITIVE.images) {
        const part: BlocDePlaquette = { ...b, pieces: pieces.slice(i, i + TENUE_D_UNE_DIAPOSITIVE.images) };
        if (i > 0) delete part.texte;
        sortie.push({ bloc: part, suite: i > 0 });
      }
    } else if (b.genre === 'image' && (b.texte?.length ?? 0) > TENUE_D_UNE_DIAPOSITIVE.texteAvecImage) {
      const [premier, ...reste] = morceauxDeTexte(b.texte!, TENUE_D_UNE_DIAPOSITIVE.texteAvecImage);
      sortie.push({ bloc: { ...b, texte: premier }, suite: false });
      const suiteDuTexte = reste.join('\n\n');
      if (suiteDuTexte)
        morceauxDeTexte(suiteDuTexte, TENUE_D_UNE_DIAPOSITIVE.texte).forEach((texte) => sortie.push({ bloc: { id: b.id, genre: 'texte', ...(b.titre ? { titre: b.titre } : {}), texte }, suite: true }));
    } else if (b.genre === 'chiffres' && (b.elements?.length ?? 0) > TENUE_D_UNE_DIAPOSITIVE.chiffres) {
      const els = b.elements!;
      for (let i = 0; i < els.length; i += TENUE_D_UNE_DIAPOSITIVE.chiffres) sortie.push({ bloc: { ...b, elements: els.slice(i, i + TENUE_D_UNE_DIAPOSITIVE.chiffres) }, suite: i > 0 });
    } else {
      sortie.push({ bloc: b, suite: false });
    }
  }
  return sortie;
}

/**
 * Toutes les images citées par une plaquette (logo compris). `visibles` : seulement celles que le client voit — une
 * section masquée ne sert pas ses images sur le lien public.
 */
export function piecesDeLaPlaquette(blocs: readonly BlocDePlaquette[], marque: MarqueDePlaquette, options: { visibles?: boolean } = {}): string[] {
  const ids = new Set<string>();
  if (marque.logo) ids.add(marque.logo);
  for (const b of options.visibles ? blocsDeLaSortie(blocs, 'client') : blocs) for (const p of b.pieces ?? []) ids.add(p);
  return [...ids];
}

/* ------------------------------------------------------------------ */
/* Commentaires et ouvertures                                           */
/* ------------------------------------------------------------------ */

export type LectureDeCommentaire = { ok: true; texte: string; nom?: string } | { ok: false; raison: string };

/**
 * UN MESSAGE D'UN FIL DE COMMENTAIRES (carte « Refonte du service Charte graphique ») : texte brut borné, prénom
 * facultatif. Le HTML n'est jamais interprété — ni ici, ni à l'affichage (texte posé par `textContent`).
 */
export function lireUnCommentaire(brut: unknown): LectureDeCommentaire {
  const o = (brut ?? {}) as Record<string, unknown>;
  const texte = typeof o.texte === 'string' ? o.texte.replace(/\r\n?/g, '\n').trim() : '';
  if (!texte) return { ok: false, raison: 'vide' };
  if (texte.length > PLAFONDS_DE_PLAQUETTE.remarque) return { ok: false, raison: 'trop-long' };
  const nom = chaine(o.nom, PLAFONDS_DE_PLAQUETTE.nomRemarque);
  return { ok: true, texte, ...(nom ? { nom } : {}) };
}

/**
 * L'ENDROIT D'UN COMMENTAIRE : la page (1…), la hauteur dans la page (0 en haut, 1 en bas) et la section sous le
 * pointeur. La section fait foi quand le document a bougé depuis (`ancrerUnFil`) ; la page la remplace quand la
 * section a disparu — un commentaire n'est jamais perdu.
 */
export interface AncreDeCommentaire {
  page: number;
  y: number;
  bloc?: string;
}

export function lireUneAncre(brut: unknown, blocs: readonly BlocDePlaquette[]): AncreDeCommentaire {
  const o = (brut ?? {}) as Record<string, unknown>;
  const page = Math.min(500, Math.max(1, Math.round(Number(o.page) || 1)));
  const y = Math.min(1, Math.max(0, Number(o.y) || 0));
  const bloc = typeof o.bloc === 'string' && blocs.some((b) => b.id === o.bloc) ? o.bloc : undefined;
  return { page, y: Math.round(y * 10000) / 10000, ...(bloc ? { bloc } : {}) };
}

/** Le jour d'une ouverture, dans le fuseau du métier (Europe/Paris), « AAAA-MM-JJ ». */
export function jourDOuverture(instant: number, fuseau = 'Europe/Paris'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
}

/** Le plafond de commentaires (fils et réponses) par lien et par visiteur sur une heure : au-delà, refus poli. */
export const REMARQUES_PAR_HEURE = 10;

/* ------------------------------------------------------------------ */
/* Le document — une seule source pour l'éditeur, le client et le PDF  */
/* ------------------------------------------------------------------ */

function echapperHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export interface OptionsDeRendu {
  /**
   * `pdf` : la page HTML que Chrome pagine puis imprime ; `document` : le même document, posé dans l'éditeur de
   * Beluga ou dans la page du client (`css` + `corps`, paginés par `paginerLeDocument` dans le navigateur).
   */
  mode: 'pdf' | 'document';
  /** L'adresse d'une image à partir de son identifiant (chemin public, ou donnée embarquée pour le PDF). */
  image: (id: string) => string | null;
  langue?: string;
  /**
   * L'ÉDITEUR : les sections masquées restent (grisées), chaque champ porte ses repères (`data-champ`) et un champ
   * vide garde sa place, avec le texte d'invite donné.
   */
  edition?: { masquee: string; titre: string; texte: string; horsClient?: string; horsPdf?: string; horsLesDeux?: string };
  /** La sortie rendue (hors éditeur) : la page du client ou le PDF — chacune retire ses propres sections. Absente : les deux règles. */
  sortie?: SortieDePlaquette;
  /** Le nom et le type d'une pièce, pour la liste des ressources (absent : le type seul). */
  infoDePiece?: (id: string) => { nom: string; mime?: string } | null;
  /** L'adresse qui TÉLÉCHARGE une ressource (absent : la ressource se montre sans lien). */
  telechargement?: (id: string) => string | null;
}

/** Les mots du document lui-même (sommaire, parties, ressources), dans sa langue. */
const MOTS_DU_DOCUMENT: Record<string, { sommaire: string; partie: string; ressources: string; telecharger: string; surFond: string; surCouleur: string; surSombre: string; protection: string; realisePar: string }> = {
  fr: { sommaire: 'Sommaire', partie: 'Partie', ressources: 'Ressources', telecharger: 'Télécharger', surFond: 'Sur fond clair', surCouleur: 'Sur la couleur', surSombre: 'Sur fond sombre', protection: 'Zone de protection', realisePar: 'Réalisé par {nom}' },
  en: { sommaire: 'Contents', partie: 'Part', ressources: 'Resources', telecharger: 'Download', surFond: 'On light', surCouleur: 'On colour', surSombre: 'On dark', protection: 'Clear space', realisePar: 'Made by {nom}' },
  es: { sommaire: 'Índice', partie: 'Parte', ressources: 'Recursos', telecharger: 'Descargar', surFond: 'Sobre claro', surCouleur: 'Sobre el color', surSombre: 'Sobre oscuro', protection: 'Zona de protección', realisePar: 'Realizado por {nom}' },
  de: { sommaire: 'Inhalt', partie: 'Teil', ressources: 'Ressourcen', telecharger: 'Herunterladen', surFond: 'Auf Hell', surCouleur: 'Auf der Farbe', surSombre: 'Auf Dunkel', protection: 'Schutzzone', realisePar: 'Erstellt von {nom}' },
  zh: { sommaire: '目录', partie: '部分', ressources: '资源', telecharger: '下载', surFond: '浅色背景', surCouleur: '品牌色背景', surSombre: '深色背景', protection: '保护区', realisePar: '由 {nom} 制作' },
};

/** Les trois écritures d'une couleur : HEX, RGB, CMJN (approché, sans profil d'impression). */
export function codesDeCouleur(hex: string): { hex: string; rgb: string; cmjn: string } | null {
  if (!COULEUR.test(hex)) return null;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const k = 1 - Math.max(r, g, b) / 255;
  const c = k >= 1 ? 0 : (1 - r / 255 - k) / (1 - k);
  const m = k >= 1 ? 0 : (1 - g / 255 - k) / (1 - k);
  const j = k >= 1 ? 0 : (1 - b / 255 - k) / (1 - k);
  const pc = (x: number) => Math.round(x * 100);
  return { hex: hex.toUpperCase(), rgb: `${r} ${g} ${b}`, cmjn: `${pc(c)} ${pc(m)} ${pc(j)} ${pc(k)}` };
}

export interface PlaquetteARendre {
  titre: string;
  blocs: readonly BlocDePlaquette[];
  marque: MarqueDePlaquette;
  /** Absent : A4 portrait (plaquettes d'avant les formats). */
  format?: string;
  /** La date portée sur la couverture (mois et année) ; absente : aucune date. */
  modifieLe?: number;
  adresse?: string;
}

function couleurLisibleSur(fond: string): string {
  const n = parseInt(fond.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#111111' : '#ffffff';
}

/** La date de couverture (« novembre 2026 »), dans la langue de la plaquette. */
function moisDeLaPlaquette(instant: number, langue: string): string {
  try {
    return new Intl.DateTimeFormat(langue, { month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }).format(new Date(instant));
  } catch {
    return '';
  }
}

/** Les marges des feuilles qui coulent (en millimètres) : l'en-tête et le pied courants vivent dedans. */
export function margesDuFormat(format: FormatDePlaquette): { haut: number; cote: number; bas: number } {
  if (format === 'diapositives') return { haut: 16, cote: 20, bas: 18 };
  if (format === 'a4-paysage') return { haut: 20, cote: 20, bas: 20 };
  return { haut: 24, cote: 20, bas: 24 };
}

export interface DocumentRendu {
  /** La feuille de style, entièrement rangée sous `.pages` : elle ne touche rien d'autre dans la page qui l'accueille. */
  css: string;
  /** `<div class="pages"><div class="source">…</div></div>` — les sections, prêtes à être paginées. */
  corps: string;
  format: FormatDePlaquette;
}

/**
 * LE DOCUMENT PROFESSIONNEL (cartes « Refonte de l'espace Plaquettes » puis « Refonte du service Charte graphique ») :
 * une couverture bord à bord, des sections numérotées sous un filet de la couleur de la marque, des chiffres clés en
 * encadrés, un appel à l'action en aplat, un en-tête et un pied courants (marque, titre, contact, « page / total »).
 *
 * DES FEUILLES AU FORMAT EXACT, PARTOUT : le HTML rendu ici n'est qu'une SOURCE — une couverture et des diapositives
 * déjà à leur taille (`.fixe`), des sections qui coulent. `paginerLeDocument` (navigateur) les range en feuilles : le
 * même découpage pour l'éditeur, la page du client ET le PDF (Chrome pagine puis imprime une feuille par page). Le
 * commentaire posé « page 3 » chez le client est donc page 3 du PDF.
 *
 * AUCUNE IMAGE RECADRÉE (décision de l'utilisateur) : chaque capture est montrée entière dans son cadre (navigateur
 * ou téléphone), réduite s'il le faut ; seul `zoom` remplit un cadre. Les captures pleine hauteur vont dans le bloc
 * `annexes`, en bas du document, tranchées sur autant de pages qu'il faut. Aucune forme décorative (MEM-6049).
 */
export function documentDeLaPlaquette(plaquette: PlaquetteARendre, options: OptionsDeRendu): DocumentRendu {
  const { marque } = plaquette;
  const format = formatDeLaPlaquette(plaquette.format);
  const page = PAGES_DE_PLAQUETTE[format];
  const diapos = format === 'diapositives';
  const paysage = format === 'a4-paysage';
  const edition = options.edition;
  const langue = options.langue ?? 'fr';
  const sur = couleurLisibleSur(marque.couleur);
  const police = marque.police ? `'${marque.police}', ` : '';
  const C = marque.couleur;
  const T = marque.texte;
  const F = marque.fond;
  /* L'ENCRE DES ÉTIQUETTES D'ÉDITION (« Pas dans le PDF ») sur une page claire : la couleur de la marque quand elle se lit
     sur le fond (foncée sur fond clair), sinon le texte de la marque — jamais du blanc sur une page blanche. */
  const encreHors = sur === '#ffffff' && couleurLisibleSur(F) === '#111111' ? C : T;
  const logo = marque.logo ? options.image(marque.logo) : null;
  const date = plaquette.modifieLe ? moisDeLaPlaquette(plaquette.modifieLe, langue) : '';
  const ordonnes = ordonnerLesBlocs(plaquette.blocs);
  const blocs = edition ? ordonnes : options.sortie ? blocsDeLaSortie(ordonnes, options.sortie) : ordonnes.filter((b) => !b.masque);
  const mots = MOTS_DU_DOCUMENT[langue] ?? MOTS_DU_DOCUMENT.fr!;
  const W = page.largeurMm;
  const H = page.hauteurMm;
  const M = margesDuFormat(format);

  /* Un champ modifiable sur place : ses repères, et son invite quand il est vide (éditeur seulement). */
  const champ = (b: BlocDePlaquette, nom: string, extra = '', invite?: string) =>
    edition ? ` data-champ="${nom}" data-bloc-du-champ="${echapperHtml(b.id)}"${extra}${invite ? ` data-vide="${echapperHtml(invite)}"` : ''}` : '';
  /* La tête de la couverture porte le logo de la MARQUE (le projet ciblé) ; l'auteur ne signe qu'en petit, en bas. */
  const logoDeCouverture = logo
    ? `<img class="logo" src="${echapperHtml(logo)}" alt="${echapperHtml(marque.nom)}">`
    : `<div class="nom-marque">${echapperHtml(marque.nom)}</div>`;
  const auteur = signatureDeLaMarque(marque);
  const realisePar = auteur ? mots.realisePar.replace('{nom}', auteur) : '';
  /* L'icône du projet signataire, devant son nom (couverture ici, dernière feuille par `paginerLeDocument`). */
  const iconeAuteur = auteur ? iconeDeSignatureValable(marque.signatureIcone) : undefined;
  const signatureHtml = realisePar
    ? `<span class="signature-auteur">${iconeAuteur ? `<img class="icone-auteur" src="${echapperHtml(iconeAuteur)}" alt="">` : ''}${echapperHtml(realisePar)}</span>`
    : '';

  /* Les sections numérotées : tout bloc titré qui n'est ni la couverture, ni le sommaire, ni une partie, ni l'appel final (les masquées non comptées). */
  let rang = 0;
  let rangPartie = 0;
  const numeros = new Map<string, string>();
  const parties = new Map<string, number>();
  for (const b of blocs) {
    if (b.masque) continue;
    if (b.genre === 'partie') parties.set(b.id, ++rangPartie);
    else if (b.titre && b.genre !== 'couverture' && b.genre !== 'appel' && b.genre !== 'sommaire' && !numeros.has(b.id)) numeros.set(b.id, String(++rang).padStart(2, '0'));
  }

  /** Les paragraphes d'un texte : un saut de ligne simple reste un saut de ligne (`pre-line`), jamais du HTML. */
  const corps = (b: BlocDePlaquette, texte: string | undefined, chapo = false, modifiable = true) => {
    const ps = (texte ?? '').split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
    if (!ps.length) return edition && modifiable ? `<p${champ(b, 'texte', ' data-para="0"', edition.texte)}></p>` : '';
    return ps.map((p, i) => `<p${chapo && i === 0 && ps.length > 1 ? ' class="chapo"' : ''}${modifiable ? champ(b, 'texte', ` data-para="${i}"`) : ''}>${echapperHtml(p)}</p>`).join('');
  };
  /*
   * UN ÉLÉMENT RETOUCHABLE (éditeur seulement) : une image, une couleur, un fichier, un chiffre, un bouton. L'éditeur
   * pose sur lui SA barre (cadre, remplacer, retirer…), repérée par la section et le rang dans la section.
   */
  const elt = (b: BlocDePlaquette, genre: 'image' | 'couleur' | 'ressource' | 'chiffre' | 'bouton', index?: number) =>
    edition ? ` data-element="${genre}" data-element-bloc="${echapperHtml(b.id)}"${index !== undefined ? ` data-element-index="${index}"` : ''}` : '';
  const titre = (b: BlocDePlaquette, balise: 'h1' | 'h2', modifiable = true) =>
    b.titre || (edition && modifiable) ? `<${balise}${modifiable ? champ(b, 'titre', '', edition?.titre) : ''}>${echapperHtml(b.titre ?? '')}</${balise}>` : '';
  const entete = (b: BlocDePlaquette, suite = false) => {
    const t = titre(b, 'h2', !suite);
    return t ? `<header class="entete">${numeros.get(b.id) ? `<span class="numero">${numeros.get(b.id)}</span>` : ''}${t}</header>` : '';
  };
  const bouton = (b: BlocDePlaquette) =>
    b.bouton && (b.lien || edition)
      ? `<a class="bouton"${b.lien ? ` href="${echapperHtml(b.lien)}"` : ''}${champ(b, 'bouton')}${elt(b, 'bouton')}>${echapperHtml(b.bouton)}</a>${b.lien ? `<div class="adresse">${echapperHtml(b.lien.replace(/^mailto:/, ''))}</div>` : ''}`
      : '';
  const chiffres = (b: BlocDePlaquette) => {
    const els = b.elements ?? [];
    /* Jamais une case seule sur sa rangée : quatre en ligne au plus, puis deux rangées égales. */
    const parRangee = Math.min(4, els.length <= 4 ? Math.max(els.length, 1) : Math.ceil(els.length / 2));
    return `<div class="rangee" style="grid-template-columns:repeat(${parRangee},1fr)">${els
      .map((e, i) => `<div class="chiffre"${elt(b, 'chiffre', i)}><strong${champ(b, 'valeur', ` data-index="${i}"`)}>${echapperHtml(e.valeur)}</strong><span${champ(b, 'libelle', ` data-index="${i}"`)}>${echapperHtml(e.libelle)}</span></div>`)
      .join('')}</div>`;
  };
  const legende = (b: BlocDePlaquette, balise: 'figcaption' | 'p') =>
    b.legende || (edition && (b.pieces?.length ?? 0) > 0)
      ? `<${balise} class="legende"${champ(b, 'legende', '', edition ? '…' : undefined)}>${echapperHtml(b.legende ?? '')}</${balise}>`
      : '';

  /**
   * LE CADRE D'UNE IMAGE : navigateur (barre, trois points, adresse), téléphone (coque, îlot), nu, ou zoom (le seul
   * cas où l'image remplit son cadre). L'image vit dans `.vue` : c'est elle qu'on tranche pour une annexe.
   */
  const cadre = (b: BlocDePlaquette, id: string, alt = '', index?: number) => {
    const src = options.image(id);
    if (!src) return '';
    const image = `<img src="${echapperHtml(src)}" alt="${echapperHtml(alt)}">`;
    const e = index !== undefined ? elt(b, 'image', index) : '';
    if (b.zoom) return `<div class="cadre cadre-zoom"${e}><div class="vue">${image}</div></div>`;
    switch (b.appareil) {
      case 'navigateur': {
        /* Le défilement n'existe que dans la version en ligne : le PDF (mode pdf) garde la capture entière, fixe. */
        const defile = b.defilant === true && options.mode === 'document' && options.sortie !== 'pdf';
        return `<div class="cadre cadre-navigateur${defile ? ' defile' : ''}"${e}><div class="barre"><i></i><i></i><i></i>${b.url ? `<span class="url">${echapperHtml(b.url)}</span>` : '<span class="url"></span>'}</div><div class="vue${defile ? ' defile' : ''}">${image}</div></div>`;
      }
      case 'telephone':
        return `<div class="cadre cadre-telephone"${e}><div class="vue"><span class="ilot"></span>${image}</div></div>`;
      default:
        return `<div class="cadre cadre-nu"${e}><div class="vue">${image}</div></div>`;
    }
  };
  const bord = (b: BlocDePlaquette) => (b.aBord ? ` a-bord-${b.aBord}` : '');

  /* UNE PARTIE : une feuille entière à la couleur de la marque, son rang et son titre (« Partie 1 — Charte graphique »). */
  const partie = (b: BlocDePlaquette, attr: string, classe: string) =>
    `<section class="feuille fixe partie${classe}" ${attr}><div class="panneau"><span class="rang-partie">${echapperHtml(mots.partie)} ${parties.get(b.id) ?? ''}</span>${titre(b, 'h1')}${b.texte || edition ? `<div class="accroche">${corps(b, b.texte)}</div>` : ''}</div><div class="bas"><span>${echapperHtml(marque.nom)}</span><span>${echapperHtml(plaquette.titre)}</span></div></section>`;

  const couverture = (b: BlocDePlaquette, attr: string, classe: string) => {
    const piece = b.pieces?.[0];
    const visuel = piece ? `<div class="visuel${b.zoom ? ' plein' : ''}">${cadre(b, piece, b.titre ?? '', 0)}</div>` : '';
    return `<section class="feuille fixe couverture${piece ? ' avec-visuel' : ''}${classe}" ${attr}>${visuel}<div class="panneau"><div class="haut">${logoDeCouverture}</div><div class="milieu">${titre(b, 'h1')}${b.texte || edition ? `<div class="accroche">${corps(b, b.texte)}</div>` : ''}</div><div class="bas"><span>${echapperHtml(marque.nom)}</span>${marque.contact ? `<span>${echapperHtml(marque.contact)}</span>` : ''}${date ? `<span>${echapperHtml(date)}</span>` : ''}${signatureHtml}</div></div></section>`;
  };

  /* LE SOMMAIRE : chaque partie et chaque section numérotée qui suit, un lien vers elle, sa page remplie par la mise en pages. */
  const lignesDuSommaire = (b: BlocDePlaquette): string[] =>
    blocs
      .slice(blocs.indexOf(b) + 1)
      .filter((x) => !x.masque && (parties.has(x.id) || numeros.has(x.id)))
      .map((x) =>
        parties.has(x.id)
          ? `<a class="ligne-sommaire chapitre" href="#bloc-${echapperHtml(x.id)}"><span class="n">${echapperHtml(mots.partie)} ${parties.get(x.id)}</span><span class="t">${echapperHtml(x.titre ?? '')}</span><span class="p" data-page-de="${echapperHtml(x.id)}"></span></a>`
          : `<a class="ligne-sommaire" href="#bloc-${echapperHtml(x.id)}"><span class="n">${numeros.get(x.id)}</span><span class="t">${echapperHtml(x.titre ?? '')}</span><span class="p" data-page-de="${echapperHtml(x.id)}"></span></a>`,
      );
  /* Une feuille du sommaire : son titre (éditable sur la première seulement) et son repère « 2/3 » quand il y en a plusieurs. */
  const sommaireEn = (b: BlocDePlaquette, lignes: string[], rang: number, classe = ''): string =>
    /* Le titre ne paraît que sur la première feuille : les suivantes commencent par la liste, sans repère « n/m ». */
    `${rang <= 1 ? `<header class="entete"><h2${champ(b, 'titre', '', edition?.titre)}>${echapperHtml(b.titre || mots.sommaire)}</h2></header>` : ''}<nav class="liste-sommaire${classe}">${lignes.join('')}</nav>`;

  /* Le contenu d'un bloc, commun aux deux familles de gabarits. */
  const contenu = (b: BlocDePlaquette, suite: boolean): string => {
    switch (b.genre) {
      case 'texte':
        return `${entete(b, suite)}<div class="corps">${corps(b, b.texte, !suite)}</div>`;
      case 'image':
        /* En A4 portrait : le titre, l'image entière, puis le texte, qui peut couler sur la page suivante. */
        if (!paysage && !diapos)
          return `${entete(b, suite)}${b.pieces?.[0] ? `<figure class="illustration${bord(b)}">${cadre(b, b.pieces[0], b.legende ?? b.titre ?? '', 0)}${legende(b, 'figcaption')}</figure>` : ''}<div class="corps">${corps(b, b.texte)}</div>`;
        return `<div class="duo${b.aBord === 'droite' ? ' inverse' : ''}">${b.pieces?.[0] ? `<figure class="illustration${bord(b)}">${cadre(b, b.pieces[0], b.legende ?? b.titre ?? '', 0)}${legende(b, 'figcaption')}</figure>` : ''}<div class="cote">${entete(b, suite)}<div class="corps">${corps(b, b.texte)}</div></div></div>`;
      case 'galerie':
        return `${entete(b, suite)}${b.texte || (edition && !suite) ? `<div class="corps court">${corps(b, b.texte, false, !suite)}</div>` : ''}<div class="grille n${Math.min(b.pieces?.length ?? 0, 3)}${b.appareil === 'telephone' ? ' telephones' : ''}">${(b.pieces ?? []).map((p, i) => `<figure class="vignette">${cadre(b, p, '', i)}</figure>`).join('')}</div>${legende(b, 'p')}`;
      case 'chiffres':
        return `${entete(b, suite)}${chiffres(b)}${b.texte || edition ? `<div class="corps court">${corps(b, b.texte)}</div>` : ''}`;
      case 'appel':
        return `<div class="appel-contenu">${titre(b, 'h2')}${corps(b, b.texte)}${bouton(b)}</div>`;
      case 'sommaire': {
        /* LE SOMMAIRE (A4 et paysage) : une feuille qui coule, sur deux colonnes au-delà de vingt-deux lignes. */
        const lignes = lignesDuSommaire(b);
        return sommaireEn(b, lignes, 1, lignes.length > 22 ? ' deux' : '');
      }
      case 'logo': {
        /* LE LOGO ET SES RÈGLES : sur fond clair, sur la couleur, sur fond sombre, puis sa zone de protection ; les règles en texte. */
        /* `pieces[0]` : la version pour fond clair ; `pieces[1]` : la version pour fond sombre ou coloré (sinon la même). */
        /* Le repli est le logo de la MARQUE — le projet ciblé —, jamais celui de l'auteur ; sans logo : le nom de la marque. */
        const idClair = b.pieces?.[0] ?? marque.logo;
        const idSombre = b.pieces?.[1] ?? idClair;
        const img = (id: string | undefined) => {
          const src = id ? options.image(id) : null;
          return src ? `<img src="${echapperHtml(src)}" alt="${echapperHtml(marque.nom)}">` : `<span class="nom-marque">${echapperHtml(marque.nom)}</span>`;
        };
        const tuile = (classe: string, legende: string, id: string | undefined, style = '', index?: number) => `<figure class="tuile-logo ${classe}"${style}${index !== undefined ? elt(b, 'image', index) : ''}><div class="fond-logo">${img(id)}</div><figcaption>${echapperHtml(legende)}</figcaption></figure>`;
        return `${entete(b, suite)}<div class="logos">${tuile('clair', mots.surFond, idClair, ` style="--fond-logo:${F}"`, b.pieces?.[0] ? 0 : undefined)}${tuile('couleur', mots.surCouleur, idSombre, ` style="--fond-logo:${C}"`)}${tuile('sombre', mots.surSombre, idSombre, ' style="--fond-logo:#121316"', b.pieces?.[1] ? 1 : undefined)}${tuile('protection', mots.protection, idClair, ` style="--fond-logo:${F}"`)}</div>${b.elements?.length ? chiffres(b) : ''}${b.texte || edition ? `<div class="corps court">${corps(b, b.texte)}</div>` : ''}`;
      }
      case 'couleurs': {
        /* LES COULEURS : un aplat par couleur, son rôle, et ses trois codes (HEX, RGB, CMJN). */
        const tuiles = (b.elements ?? [])
          .map((e, i) => {
            const codes = codesDeCouleur(e.valeur.trim().toLowerCase());
            const [nom, ...role] = e.libelle.split(/\s+[—–-]\s+/);
            return `<div class="tuile-couleur"${elt(b, 'couleur', i)}><div class="aplat" style="background:${codes ? codes.hex : 'transparent'}"></div><div class="infos"><strong${champ(b, 'libelle', ` data-index="${i}"`)}>${echapperHtml(nom ?? '')}</strong>${role.length ? `<span class="role">${echapperHtml(role.join(' — '))}</span>` : ''}${codes ? `<dl><dt>HEX</dt><dd${champ(b, 'valeur', ` data-index="${i}"`)}>${codes.hex}</dd><dt>RGB</dt><dd>${codes.rgb}</dd><dt>CMJN</dt><dd>${codes.cmjn}</dd></dl>` : `<span${champ(b, 'valeur', ` data-index="${i}"`)}>${echapperHtml(e.valeur)}</span>`}</div></div>`;
          })
          .join('');
        return `${entete(b, suite)}${b.texte || (edition && !suite) ? `<div class="corps court">${corps(b, b.texte)}</div>` : ''}<div class="nuancier n${Math.min(4, Math.max(1, b.elements?.length ?? 1))}">${tuiles}</div>`;
      }
      case 'typographies': {
        /* LES POLICES : un spécimen par police (« Aa », l'alphabet), son nom et son usage. */
        const tuiles = (b.elements ?? [])
          .map((e, i) => {
            const famille = e.valeur.replace(/[^A-Za-z0-9 \-]/g, '').trim();
            const style = ` style="font-family:'${famille}',${police}Inter,'Helvetica Neue',Arial,sans-serif"`;
            return `<div class="tuile-police"><div class="aa"${style}>Aa</div><div class="infos"><strong${champ(b, 'valeur', ` data-index="${i}"`)}>${echapperHtml(e.valeur)}</strong><span class="role"${champ(b, 'libelle', ` data-index="${i}"`)}>${echapperHtml(e.libelle)}</span><p class="alphabet"${style}>ABCDEFGHIJKLMNOPQRSTUVWXYZ<br>abcdefghijklmnopqrstuvwxyz 0123456789</p></div></div>`;
          })
          .join('');
        return `${entete(b, suite)}${b.texte || (edition && !suite) ? `<div class="corps court">${corps(b, b.texte)}</div>` : ''}<div class="polices">${tuiles}</div>`;
      }
      case 'ressources': {
        /* LES RESSOURCES : chaque fichier en vignette, son nom et son type ; un lien qui le télécharge quand la sortie en a un. */
        const tuiles = (b.pieces ?? [])
          .map((id, i) => {
            const info = options.infoDePiece?.(id) ?? null;
            const nom = info?.nom ?? '';
            const ext = (/\.([A-Za-z0-9]{1,5})$/.exec(nom)?.[1] ?? info?.mime?.split('/')[1] ?? '').toUpperCase().slice(0, 5);
            const src = !info?.mime || info.mime.startsWith('image/') ? options.image(id) : null;
            const lien = options.telechargement?.(id) ?? null;
            const apercu = src ? `<img src="${echapperHtml(src)}" alt="">` : `<span class="type-seul">${echapperHtml(ext || '—')}</span>`;
            const corpsTuile = `<div class="vignette-ressource">${apercu}${ext ? `<span class="badge">${echapperHtml(ext)}</span>` : ''}</div><span class="nom-ressource">${echapperHtml(nom)}</span>${lien ? `<span class="telecharger">${echapperHtml(mots.telecharger)}</span>` : ''}`;
            /* Dans l'éditeur, une ressource ne se télécharge pas au clic : elle porte sa barre (retirer). */
            if (edition) return `<div class="ressource"${elt(b, 'ressource', i)}>${corpsTuile}</div>`;
            return lien ? `<a class="ressource" href="${echapperHtml(lien)}" download>${corpsTuile}</a>` : `<div class="ressource">${corpsTuile}</div>`;
          })
          .join('');
        return `${entete(b, suite)}${b.texte || (edition && !suite) ? `<div class="corps court">${corps(b, b.texte)}</div>` : ''}<div class="ressources-liste">${tuiles}</div>`;
      }
      case 'annexes':
        return `${entete(b, suite)}${b.texte || edition ? `<div class="corps court">${corps(b, b.texte)}</div>` : ''}<div class="annexes-liste">${(b.pieces ?? [])
          .map((p, i) => `<figure class="annexe tranchable${b.appareil === 'telephone' ? ' annexe-telephone' : ''}">${cadre({ ...b, zoom: false }, p, '', i)}</figure>`)
          .join('')}</div>`;
      default:
        return '';
    }
  };
  const masquee = (b: BlocDePlaquette) => {
    if (!edition) return '';
    if (b.masque) return ` masque" data-masquee="${echapperHtml(edition.masquee)}`;
    /* Une section retirée d'une sortie le dit d'une étiquette, sans être grisée (elle reste dans l'autre). */
    const hors = b.horsClient && b.horsPdf ? edition.horsLesDeux : b.horsClient ? edition.horsClient : b.horsPdf ? edition.horsPdf : '';
    return hors ? ` hors" data-hors="${echapperHtml(hors)}` : '';
  };
  /* Les sections qui ne se coupent jamais d'une page à l'autre. */
  const insecable = (b: BlocDePlaquette) => (b.genre === 'appel' || b.genre === 'chiffres' || b.genre === 'logo' || (b.genre === 'image' && paysage) ? ' insecable' : '');

  let sources: string;
  if (diapos) {
    const liste = decouperEnDiapositives(edition ? blocs.map((b) => (b.masque ? { ...b, masque: false } : b)) : blocs);
    sources = liste
      .map(({ bloc: b, suite }) => {
        const vraiBloc = blocs.find((x) => x.id === b.id);
        const attr = `data-bloc="${echapperHtml(b.id)}"${suite ? '' : ` id="bloc-${echapperHtml(b.id)}"`}`;
        const gris = vraiBloc ? masquee(vraiBloc) : '';
        if (b.genre === 'couverture') return couverture(b, attr, ` diapo${gris}`);
        if (b.genre === 'partie') return partie(b, attr, ` diapo${gris}`);
        if (b.genre === 'sommaire') {
          /* LE SOMMAIRE EN DIAPOSITIVES : réparti sur plusieurs feuilles aérées (titre sur la première seulement, sans repère « n/m »), jamais une feuille à une seule ligne. */
          const lignes = lignesDuSommaire(b);
          const morceaux = repartitionDuSommaire(lignes.length);
          const pied = `<footer class="pied-diapo"><span class="marque-pied">${echapperHtml(marque.nom)}</span><span>${echapperHtml(plaquette.titre)}</span><span class="num" data-num></span></footer>`;
          return morceaux
            .map(([debut, fin], i) => `<section class="feuille fixe diapo sommaire${gris}" ${i === 0 ? attr : `data-bloc="${echapperHtml(b.id)}"`}><div class="contenu">${sommaireEn(b, lignes.slice(debut, fin), i + 1)}</div>${pied}</section>`)
            .join('');
        }
        /* Les annexes coulent : leurs captures pleine hauteur se tranchent sur autant de diapositives qu'il faut. */
        if (b.genre === 'annexes' || b.genre === 'ressources') return `<section class="section ${b.genre} saut-avant${gris}" ${attr}>${contenu(b, suite)}</section>`;
        const dense = (b.texte?.length ?? 0) > (b.genre === 'image' ? 320 : 560) ? ' dense' : '';
        const pied = `<footer class="pied-diapo"><span class="marque-pied">${echapperHtml(marque.nom)}</span><span>${echapperHtml(plaquette.titre)}</span><span class="num" data-num></span></footer>`;
        return `<section class="feuille fixe diapo ${b.genre}${dense}${gris}" ${attr}><div class="contenu">${contenu(b, suite)}</div>${b.genre === 'appel' ? '' : pied}</section>`;
      })
      .join('');
  } else {
    sources = blocs
      .map((b) => {
        const attr = `data-bloc="${echapperHtml(b.id)}" id="bloc-${echapperHtml(b.id)}"`;
        if (b.genre === 'couverture') return couverture(b, attr, masquee(b));
        if (b.genre === 'partie') return partie(b, attr, masquee(b));
        /*
         * UNE SECTION = UNE PAGE (décision de l'utilisateur, carte « Finitions du lecteur de charte ») : chaque section
         * commence une feuille ; une section longue continue sur les suivantes. Le sommaire garde sa page à lui.
         */
        const saut = b.genre === 'sommaire' ? ' saut-avant saut-apres' : ' saut-avant';
        return `<section class="section ${b.genre}${insecable(b)}${saut}${masquee(b)}" ${attr}>${contenu(b, false)}</section>`;
      })
      .join('');
  }

  /* Les hauteurs d'image qui tiennent dans une feuille (sans jamais rogner : la capture rétrécit). */
  const zoneH = H - M.haut - M.bas;
  const hImage = diapos ? H - 40 : paysage ? zoneH - 30 : 150;
  const hTelephone = diapos ? H - 44 : paysage ? zoneH - 40 : 125;
  const hGalerie = diapos ? H - 80 : paysage ? 105 : 95;
  const hCouverture = diapos || paysage ? H - 30 : H * 0.56 - 26;

  const css = `
  .pages{--hmax:${hImage}mm;--hmax-tel:${hTelephone}mm;font-family:${police}Inter,'Helvetica Neue',Arial,sans-serif}
  .pages .source{display:none}
  .pages *{box-sizing:border-box}
  .feuille{position:relative;width:${W}mm;height:${H}mm;overflow:hidden;background:${F};color:${T};font-family:${police}Inter,'Helvetica Neue',Arial,sans-serif;font-size:10.5pt;line-height:1.6;text-align:left;font-feature-settings:"kern","liga","tnum";-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .feuille h1,.feuille h2{font-weight:700;letter-spacing:-.015em;margin:0}
  .feuille p{margin:0 0 3.2mm;white-space:pre-line}
  .feuille img{display:block;max-width:100%}
  .feuille a{color:inherit}
  .feuille figure{margin:0}

  /* Les feuilles qui coulent : l'en-tête et le pied courants dans les marges. */
  .flux{padding:${M.haut}mm ${M.cote}mm ${M.bas}mm;display:flex;flex-direction:column}
  .flux .zone{flex:1;min-height:0;display:flow-root}
  .flux .tete,.flux .pied{position:absolute;left:${M.cote}mm;right:${M.cote}mm;display:flex;justify-content:space-between;gap:8mm;font-size:7.5pt;line-height:1.3;color:${T}99}
  .flux .tete{top:0;height:${M.haut}mm;align-items:flex-end;padding-bottom:${diapos ? 4 : 5}mm}
  .flux .pied{bottom:0;height:${M.bas}mm;align-items:flex-start;padding-top:${diapos ? 4 : 5}mm}
  .tete-marque{font-weight:700;font-size:7pt;letter-spacing:.16em;text-transform:uppercase;color:${C};white-space:nowrap}
  .tete-titre{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .num{font-variant-numeric:tabular-nums;white-space:nowrap}
  /* La signature de l'auteur : petite, discrète, jamais à sa couleur à lui. */
  .signature-auteur{display:inline-flex;align-items:center;gap:1.5mm;white-space:nowrap;font-size:.92em;opacity:.75;letter-spacing:.03em;text-transform:none;font-weight:400}
  .feuille img.icone-auteur{display:block;flex:none;width:1.35em;height:1.35em;max-width:none;border-radius:.28em;object-fit:contain}
  .couverture .bas .signature-auteur{margin-left:auto}
  .signature-seule{position:absolute;right:${M.cote}mm;bottom:${diapos ? 8 : 6}mm;font-size:7.5pt;color:inherit}

  /* La couverture : bord à bord, une feuille entière. */
  .couverture{background:${C};color:${sur};display:flex;${paysage || diapos ? 'flex-direction:row-reverse' : 'flex-direction:column'}}
  .couverture .visuel{position:relative;flex:0 0 ${paysage || diapos ? '54%' : '56%'};min-width:0;min-height:0;overflow:hidden;display:flex;align-items:center;justify-content:center;padding:13mm;--hmax:${hCouverture}mm;--hmax-tel:${hCouverture}mm}
  .couverture .visuel.plein{padding:0}
  .couverture .visuel.plein .cadre,.couverture .visuel.plein .vue{position:absolute;inset:0;border-radius:0;aspect-ratio:auto}
  .couverture .panneau{position:relative;flex:1;display:flex;flex-direction:column;justify-content:space-between;padding:${diapos ? '16mm 18mm 12mm' : paysage ? '18mm 18mm 14mm' : '14mm 20mm 14mm'};min-width:0}
  .couverture:not(.avec-visuel) .panneau{padding:${diapos ? '18mm 22mm 14mm' : '22mm 22mm 18mm'}}
  .couverture .milieu{margin:auto 0 0}
  .couverture h1{font-size:${diapos ? '40pt' : '34pt'};line-height:1.06;max-width:${paysage || diapos ? '100%' : '160mm'}}
  .couverture:not(.avec-visuel) h1{font-size:${diapos ? '50pt' : '46pt'};max-width:${diapos ? '240mm' : '170mm'}}
  .couverture .accroche{margin-top:6mm;font-size:${diapos ? '15pt' : '13pt'};line-height:1.45;opacity:.92;max-width:150mm}
  .couverture .bas{display:flex;flex-wrap:wrap;gap:2mm 8mm;margin-top:10mm;padding-top:4mm;border-top:.3mm solid ${sur}40;font-size:8.5pt;letter-spacing:.04em;opacity:.85}
  .couverture .bas span:first-child{font-weight:700;letter-spacing:.14em;text-transform:uppercase}
  img.logo{max-height:${diapos ? '16mm' : '14mm'};max-width:60mm;width:auto;object-fit:contain}
  .nom-marque{font-weight:800;letter-spacing:.2em;text-transform:uppercase;font-size:10pt}

  /* Les cadres : la capture ENTIÈRE, réduite s'il le faut, jamais rognée (sauf le zoom voulu). */
  .cadre{max-width:100%;width:fit-content;margin:0 auto}
  .cadre .vue{position:relative;overflow:hidden}
  .cadre img{max-width:100%;width:auto;height:auto;max-height:var(--hmax)}
  .cadre-nu .vue{border-radius:2.4mm}
  .cadre-navigateur{border-radius:2.4mm;overflow:hidden;background:#ffffff;box-shadow:0 .8mm 4mm ${T}2b,0 0 0 .25mm ${T}1c}
  .cadre-navigateur .barre{height:6.2mm;display:flex;align-items:center;gap:1.3mm;padding:0 3mm;background:#efeff2}
  .cadre-navigateur .barre i{flex:0 0 auto;width:1.7mm;height:1.7mm;border-radius:50%;background:#c8c8ce}
  /* Le site en pleine hauteur : le cadre prend la largeur, sa vue a une hauteur fixe et une barre de défilement visible. */
  .cadre-navigateur.defile{width:100%}
  .cadre-navigateur.defile .vue{max-height:${diapos || paysage ? 118 : 180}mm;overflow-y:auto;scrollbar-width:thin;scrollbar-color:${T}59 transparent}
  .cadre-navigateur.defile img{width:100%;height:auto;max-height:none}
  .cadre-navigateur .url{margin-left:2.5mm;flex:1;min-width:0;height:3.8mm;border-radius:99mm;background:#ffffff;font-size:6pt;line-height:3.8mm;color:#77777d;padding:0 2.5mm;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  .cadre-telephone{padding:2.3mm;border-radius:9mm;background:#121316;box-shadow:0 1mm 5mm ${T}38}
  .cadre-telephone .vue{border-radius:7mm;background:#ffffff}
  .cadre-telephone img{max-height:var(--hmax-tel)}
  .cadre-telephone .ilot{position:absolute;z-index:1;top:2.4mm;left:50%;transform:translateX(-50%);width:24%;height:5.6mm;border-radius:99mm;background:#121316}
  .cadre-zoom{width:100%;border-radius:2.4mm;overflow:hidden}
  .cadre-zoom .vue{aspect-ratio:16/10}
  .cadre-zoom img{width:100%;height:100%;max-height:none;object-fit:cover}
  .a-bord-gauche{margin-left:-${M.cote}mm}
  .a-bord-droite{margin-right:-${M.cote}mm}
  .a-bord-gauche .cadre{margin-left:0}
  .a-bord-droite .cadre{margin-right:0}
  .a-bord-gauche .cadre,.a-bord-gauche .vue{border-top-left-radius:0;border-bottom-left-radius:0}
  .a-bord-droite .cadre,.a-bord-droite .vue{border-top-right-radius:0;border-bottom-right-radius:0}

  /* Les sections. */
  .entete{margin:0 0 6mm}
  .entete .numero{display:block;width:14mm;padding-top:2.5mm;border-top:.9mm solid ${C};font-size:8pt;font-weight:700;letter-spacing:.16em;color:${C};margin-bottom:3mm}
  .entete h2{font-size:${diapos ? '28pt' : '21pt'};line-height:1.14;color:${T}}
  .chapo{font-size:${diapos ? '15pt' : '12.5pt'};line-height:1.5;color:${T}}
  .legende{font-size:8.5pt;color:${T}a6;margin-top:2.5mm}
  .rangee{display:grid;gap:4mm;margin:0 0 5mm}
  .chiffre{padding:${diapos ? '7mm 6mm' : '6mm 5mm'};border-radius:2.4mm;background:${C}12;border-top:.9mm solid ${C}}
  .chiffre strong{display:block;font-size:${diapos ? '32pt' : '25pt'};line-height:1.05;color:${C};letter-spacing:-.02em;margin-bottom:2mm}
  .chiffre span{display:block;font-size:${diapos ? '11pt' : '9pt'};line-height:1.4;color:${T}cc}
  .appel h2{color:${sur};font-size:${diapos ? '36pt' : '24pt'};line-height:1.1;margin-bottom:5mm}
  .bouton{display:inline-block;margin-top:4mm;padding:3.2mm 8mm;border-radius:99mm;background:${sur};color:${C};font-weight:700;text-decoration:none;font-size:${diapos ? '13pt' : '10.5pt'}}
  .adresse{margin-top:2.5mm;font-size:8.5pt;opacity:.8}
  .grille{display:grid;gap:6mm;align-items:start;--hmax:${hGalerie}mm;--hmax-tel:${hGalerie}mm}
  .grille.n1{--hmax:${hImage}mm;--hmax-tel:${hTelephone}mm}
  .annexes-liste{display:flex;flex-direction:column;gap:8mm}
  .annexe .cadre{width:100%}
  .annexe .cadre img{width:100%;max-height:none}
  .annexe.annexe-telephone .cadre{width:${diapos ? 80 : 78}mm}
  .tranche-suite .barre{display:none}
  .tranche-suite .ilot{display:none}

  /* LA PARTIE : une feuille à la couleur de la marque, le rang au-dessus du titre. */
  .partie{background:${C};color:${sur};display:flex;flex-direction:column;justify-content:space-between;padding:${diapos ? '18mm 22mm 12mm' : '24mm 22mm 16mm'}}
  .partie .panneau{margin:auto 0}
  .partie .rang-partie{display:block;font-size:9pt;font-weight:700;letter-spacing:.2em;text-transform:uppercase;opacity:.6;margin-bottom:6mm}
  .partie h1{font-size:${diapos ? '46pt' : '40pt'};line-height:1.05;max-width:${paysage || diapos ? '230mm' : '160mm'}}
  .partie .accroche{margin-top:6mm;font-size:${diapos ? '15pt' : '13pt'};line-height:1.45;opacity:.9;max-width:150mm}
  .partie .bas{display:flex;justify-content:space-between;gap:8mm;padding-top:4mm;border-top:.3mm solid ${sur}40;font-size:8pt;letter-spacing:.04em;opacity:.8}
  .partie .bas span:first-child{font-weight:700;letter-spacing:.14em;text-transform:uppercase}

  /* LE SOMMAIRE : une ligne par partie et par section, des points de conduite, la page à droite. */
  .liste-sommaire{display:flex;flex-direction:column;gap:${diapos ? '2.2mm' : '1.2mm'};max-width:${paysage || diapos ? '200mm' : '158mm'}}
  .liste-sommaire.deux{display:block;columns:2;column-gap:12mm;max-width:none}
  .liste-sommaire.deux .ligne-sommaire{break-inside:avoid}
  .ligne-sommaire{display:flex;align-items:baseline;gap:4mm;padding:1.6mm 0;text-decoration:none;color:${T};font-size:${diapos ? '13pt' : '11pt'}}
  .ligne-sommaire .n{flex:0 0 ${diapos ? '14mm' : '11mm'};font-size:.78em;font-weight:700;letter-spacing:.12em;color:${C};font-variant-numeric:tabular-nums}
  .ligne-sommaire .t{flex:0 1 auto;min-width:0}
  .ligne-sommaire .p{flex:1 0 12mm;text-align:right;font-variant-numeric:tabular-nums;color:${T}a6;background:radial-gradient(circle,${T}40 .25mm,transparent .3mm) 0 78%/2.2mm 2.2mm repeat-x}
  .ligne-sommaire .p:empty{background:none}
  .ligne-sommaire.chapitre{margin-top:3.5mm;font-weight:700;font-size:${diapos ? '14pt' : '12pt'}}
  /* « PARTIE N » EN SURTITRE (carte du 06/11/2026) : au-dessus du titre de la partie, plus petit et plus clair ; le titre
     et son numéro de page restent sur la même ligne. */
  .ligne-sommaire.chapitre{flex-wrap:wrap;row-gap:.8mm}
  .ligne-sommaire.chapitre .n{flex:0 0 100%;margin:0;font-size:.62em;letter-spacing:.18em;text-transform:uppercase;opacity:.6}
  .ligne-sommaire.chapitre:first-child{margin-top:0}

  /* LE LOGO : quatre tuiles égales, le logo centré, sa légende dessous. */
  .logos{display:grid;grid-template-columns:repeat(${paysage || diapos ? 4 : 2},1fr);gap:5mm;margin:0 0 6mm}
  .tuile-logo .fond-logo{height:${diapos ? '46mm' : paysage ? '42mm' : '38mm'};border-radius:2.4mm;background:var(--fond-logo);display:flex;align-items:center;justify-content:center;padding:8mm;box-shadow:inset 0 0 0 .25mm ${T}1f}
  .tuile-logo img{max-height:100%;max-width:100%;width:auto;object-fit:contain}
  .tuile-logo.sombre .nom-marque{color:#ffffff}
  .tuile-logo.couleur .nom-marque{color:${sur}}
  .tuile-logo.protection .fond-logo{padding:0}
  .tuile-logo.protection .fond-logo img,.tuile-logo.protection .fond-logo .nom-marque{max-height:46%;max-width:56%;outline:.35mm dashed ${C};outline-offset:4mm}
  .tuile-logo figcaption{font-size:8pt;color:${T}a6;margin-top:2mm}

  /* LES COULEURS : un aplat, le nom, le rôle, puis les trois codes. */
  .nuancier{display:grid;grid-template-columns:repeat(${paysage || diapos ? 4 : 2},1fr);gap:5mm}
  .nuancier.n1{grid-template-columns:repeat(${paysage || diapos ? 3 : 2},1fr)}
  .nuancier.n3{grid-template-columns:repeat(3,1fr)}
  .tuile-couleur{border-radius:2.4mm;overflow:hidden;box-shadow:0 0 0 .25mm ${T}1f;break-inside:avoid}
  .tuile-couleur .aplat{height:${diapos ? '30mm' : '26mm'}}
  .tuile-couleur .infos{padding:3.5mm 4mm 4mm;display:flex;flex-direction:column;gap:1mm}
  .tuile-couleur strong{font-size:10.5pt}
  .tuile-couleur .role{font-size:8.5pt;color:${T}b3;line-height:1.35}
  .tuile-couleur dl{display:grid;grid-template-columns:auto 1fr;gap:.6mm 3mm;margin:2mm 0 0;font-size:8pt;font-variant-numeric:tabular-nums}
  .tuile-couleur dt{font-weight:700;letter-spacing:.08em;color:${T}8c}
  .tuile-couleur dd{margin:0;font-family:ui-monospace,'SF Mono',Menlo,monospace}

  /* LES POLICES : « Aa » en grand, le nom, l'usage, l'alphabet. */
  .polices{display:flex;flex-direction:column;gap:6mm}
  .tuile-police{display:grid;grid-template-columns:${diapos ? '52mm' : '38mm'} 1fr;gap:7mm;align-items:start;padding-top:5mm;border-top:.3mm solid ${T}26;break-inside:avoid}
  .tuile-police .aa{font-size:${diapos ? '64pt' : '52pt'};line-height:.95;color:${C}}
  .tuile-police .infos{display:flex;flex-direction:column;gap:1mm;min-width:0}
  .tuile-police strong{font-size:12pt}
  .tuile-police .role{font-size:9pt;color:${T}b3}
  .tuile-police .alphabet{margin:2mm 0 0;font-size:10pt;line-height:1.5;color:${T}cc;word-break:break-all}

  /* LES RESSOURCES : une vignette, le type en badge, le nom, « Télécharger ». */
  .ressources-liste{display:grid;grid-template-columns:repeat(${paysage || diapos ? 4 : 3},1fr);gap:5mm}
  .ressource{display:flex;flex-direction:column;gap:1.6mm;text-decoration:none;color:${T};break-inside:avoid;min-width:0}
  .vignette-ressource{position:relative;height:${diapos ? '40mm' : '34mm'};border-radius:2.4mm;background:${T}0d;display:flex;align-items:center;justify-content:center;padding:4mm;overflow:hidden}
  .vignette-ressource img{max-height:100%;max-width:100%;width:auto;object-fit:contain}
  .vignette-ressource .type-seul{font-size:14pt;font-weight:700;letter-spacing:.08em;color:${T}8c}
  .vignette-ressource .badge{position:absolute;right:2mm;bottom:2mm;padding:.4mm 1.6mm;border-radius:1mm;background:${T};color:${F};font-size:6.5pt;font-weight:700;letter-spacing:.06em}
  .nom-ressource{font-size:8.5pt;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ressource .telecharger{font-size:8pt;font-weight:700;color:${C}}

  ${
    diapos
      ? `
  /* DIAPOSITIVES : une feuille fixe par bloc. */
  .diapo .contenu{position:absolute;inset:16mm 20mm 22mm;display:flex;flex-direction:column;justify-content:center;min-height:0}
  .diapo .pied-diapo{position:absolute;left:20mm;right:20mm;bottom:8mm;display:flex;gap:8mm;align-items:center;font-size:8pt;color:${T}8c;letter-spacing:.03em}
  .diapo .pied-diapo span:nth-child(2){flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .diapo .pied-diapo .marque-pied{font-weight:700;color:${C};text-transform:uppercase;letter-spacing:.16em}
  .diapo.texte .contenu{display:grid;grid-template-columns:.85fr 1.35fr;gap:16mm;align-items:center}
  .diapo.texte .entete{margin:0}
  .diapo .corps{font-size:13pt;line-height:1.55}
  .diapo.dense .corps{font-size:11pt}
  .diapo.dense .chapo{font-size:12.5pt}
  .diapo .duo{display:grid;grid-template-columns:1.25fr 1fr;gap:14mm;align-items:center;min-height:0}
  .diapo .duo.inverse .illustration{order:2}
  .diapo .duo.inverse{grid-template-columns:1fr 1.25fr}
  .diapo .illustration{min-width:0}
  .diapo .a-bord-gauche{margin-left:-20mm}
  .diapo .a-bord-droite{margin-right:-20mm}
  .diapo.galerie .contenu,.diapo.chiffres .contenu,.diapo.sommaire .contenu,.diapo.couleurs .contenu,.diapo.typographies .contenu,.diapo.logo .contenu{justify-content:flex-start}
  .diapo.sommaire .entete,.diapo.couleurs .entete,.diapo.typographies .entete,.diapo.logo .entete{margin-bottom:5mm}
  .diapo .polices{gap:4mm}
  .diapo .grille{grid-template-columns:repeat(3,1fr);gap:8mm}
  .diapo .grille.n1{grid-template-columns:1fr}
  .diapo .grille.n2{grid-template-columns:repeat(2,1fr)}
  .diapo .corps.court{font-size:12pt;margin-bottom:5mm;max-width:230mm}
  .diapo.chiffres .rangee{margin-top:4mm}
  .diapo.appel{background:${C};color:${sur}}
  .diapo.appel .contenu{inset:0;padding:0 40mm;align-items:flex-start}
  .diapo.appel .corps,.diapo.appel p{font-size:15pt;max-width:220mm}
  .section.annexes{margin:0}`
      : `
  /* A4 : les sections coulent de feuille en feuille. */
  .section{margin:0 0 13mm}
  .corps{max-width:${paysage ? 'none' : '158mm'}}
  ${paysage ? '.section.texte{display:grid;grid-template-columns:.8fr 1.6fr;gap:12mm;align-items:start}.section.texte.suite .corps{grid-column:2}' : ''}
  .duo{display:${paysage ? 'grid' : 'block'};grid-template-columns:1.2fr 1fr;gap:12mm;align-items:start}
  .duo.inverse{grid-template-columns:1fr 1.2fr}
  .duo.inverse .illustration{order:2}
  .illustration{margin:0 0 6mm}
  .grille{grid-template-columns:repeat(${paysage ? 3 : 2},1fr);margin-top:2mm}
  .grille.n1{grid-template-columns:1fr}
  .grille.telephones{grid-template-columns:repeat(${paysage ? 4 : 3},1fr)}
  .corps.court{margin-bottom:5mm}
  .section.appel{background:${C};color:${sur};border-radius:3mm;padding:${paysage ? '14mm 18mm' : '16mm 16mm'};margin-top:10mm}`
  }

  ${
    edition
      ? `
  /* L'ÉDITEUR : chaque texte se corrige sur place ; une section masquée reste là, grisée. */
  [data-champ]{outline:none;border-radius:1mm;transition:box-shadow .12s;cursor:text}
  [data-champ]:hover{box-shadow:0 0 0 .5mm ${C}40}
  [data-champ]:focus{box-shadow:0 0 0 .6mm ${C}}
  [data-champ]:empty::before{content:attr(data-vide);opacity:.38}
  .masque{opacity:.38;position:relative}
  .masque::before{content:attr(data-masquee);position:absolute;z-index:2;top:0;right:0;padding:.6mm 2.4mm;border-radius:99mm;background:${T};color:${F};font-size:7pt;line-height:1.5;font-weight:600;letter-spacing:.04em}
  .feuille.fixe.masque{position:relative}
  .feuille.fixe.masque::before{top:6mm;right:6mm}
  .hors{position:relative}
  /* L'étiquette se pose AU-DESSUS du bord de la section, dans la marge : elle ne recouvre plus ni un titre ni un numéro de page. */
  .hors::before{content:attr(data-hors);position:absolute;z-index:2;top:0;right:0;transform:translateY(-100%);padding:.6mm 2.4mm;border-radius:99mm;background:${encreHors}1f;color:${encreHors};font-size:7pt;line-height:1.5;font-weight:600;letter-spacing:.04em}
  /* Seules les feuilles PEINTES en couleur de marque (couverture, partie, appel final) prennent la variante claire :
   * une feuille fixe à fond clair (sommaire en diapositives, diapo ordinaire) garde l'étiquette de \`.hors\`, à l'encre de la marque. */
  .feuille.fixe.hors::before{top:6mm;right:6mm;transform:none}
  .couverture.hors::before,.partie.hors::before,.diapo.appel.hors::before{background:${sur}33;color:${sur}}
  /* Un élément retouchable se signale au survol ; en LECTURE (bouton « Éditer » éteint), rien ne se modifie. */
  .pages:not(.lecture) [data-element]{cursor:default}
  .pages:not(.lecture) [data-element]:hover,.pages:not(.lecture) [data-element].element-vise{outline:.5mm solid ${C}80;outline-offset:.8mm}
  .pages.lecture [data-champ]{cursor:auto}
  .pages.lecture [data-champ]:hover,.pages.lecture [data-champ]:focus{box-shadow:none}
  .pages.lecture [data-champ]:empty::before{content:none}`
      : ''
  }`;

  const corpsHtml = `<div class="pages${edition ? ' edition' : ''}" data-format="${format}" data-marque="${echapperHtml(marque.nom.toUpperCase())}" data-titre="${echapperHtml(plaquette.titre)}" data-contact="${echapperHtml(marque.contact ?? '')}" data-signature="${echapperHtml(realisePar)}"${iconeAuteur ? ` data-signature-icone="${echapperHtml(iconeAuteur)}"` : ''}><div class="source">${sources}</div></div>`;
  return { css, corps: corpsHtml, format };
}

/**
 * LE HTML ENTIER À IMPRIMER (mode `pdf`) : le document sur un fond neutre, une feuille par page. Chrome le pagine
 * (`paginerLeDocument`, joué par le démon dans le navigateur du serveur) puis l'imprime, marges nulles. Ni script,
 * ni formulaire, ni commentaire : le PDF ne porte que le document.
 */
export function htmlDeLaPlaquette(plaquette: PlaquetteARendre, options: OptionsDeRendu): string {
  const d = documentDeLaPlaquette(plaquette, options);
  const page = PAGES_DE_PLAQUETTE[d.format];
  const langue = options.langue ?? 'fr';
  return `<!doctype html><html lang="${echapperHtml(langue)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${echapperHtml(plaquette.titre)}</title><style>@page{size:${page.largeurMm}mm ${page.hauteurMm}mm;margin:0}html,body{margin:0;padding:0;background:#ffffff}${d.css}.feuille{break-after:page}.feuille:last-child{break-after:auto}</style></head><body>${d.corps}</body></html>`;
}
/* ------------------------------------------------------------------ */
/* Les maquettes                                                        */
/* ------------------------------------------------------------------ */

export const STYLES_DE_MAQUETTE = ['appareils', 'planche', 'scene-ia', 'combine'] as const;

export const FORMATS_DE_MAQUETTE: Record<string, { largeur: number; hauteur: number; libelle: string }> = {
  a4: { largeur: 1240, hauteur: 1754, libelle: 'A4 portrait' },
  'a4-paysage': { largeur: 1754, hauteur: 1240, libelle: 'A4 paysage' },
  carre: { largeur: 1080, hauteur: 1080, libelle: 'Carré (réseaux)' },
  story: { largeur: 1080, hauteur: 1920, libelle: 'Story 9:16' },
  paysage: { largeur: 1920, hauteur: 1080, libelle: 'Paysage 16:9' },
};

/** Un format nommé, ou « LARGEURxHAUTEUR » libre (entre 320 et 4000 px). */
export function lireLeFormat(brut: unknown): { largeur: number; hauteur: number; nom: string } | null {
  const s = String(brut ?? '').trim().toLowerCase();
  const nomme = FORMATS_DE_MAQUETTE[s];
  if (nomme) return { largeur: nomme.largeur, hauteur: nomme.hauteur, nom: s };
  const libre = /^(\d{3,4})x(\d{3,4})$/.exec(s);
  if (!libre) return null;
  const largeur = Number(libre[1]);
  const hauteur = Number(libre[2]);
  if (largeur < 320 || hauteur < 320 || largeur > 4000 || hauteur > 4000) return null;
  return { largeur, hauteur, nom: s };
}

export interface ImageDeMaquette {
  src: string;
  /** `ordinateur` ou `telephone` : le cadre dessiné autour. */
  appareil: 'ordinateur' | 'telephone';
}

/**
 * LA MAQUETTE GRATUITE, dessinée en HTML/CSS puis photographiée par Chrome : cadres d'appareils (`appareils`) ou
 * planche d'extraits (`planche`). La scène IA (`scene-ia`, payante) ne passe PAS par ici : elle part au Studio, avec son
 * prix et le clic de l'utilisateur. `combine` = les cadres d'appareils ici, la scène IA à part.
 */
export function htmlDeMaquette(opts: {
  style: 'appareils' | 'planche';
  largeur: number;
  hauteur: number;
  images: readonly ImageDeMaquette[];
  titre?: string;
  sousTitre?: string;
  couleur: string;
  fond: string;
  texte: string;
  police?: string;
}): string {
  const { largeur: W, hauteur: H } = opts;
  const u = Math.min(W, H) / 100;
  const police = opts.police ? `'${opts.police}', ` : '';
  const titre = opts.titre ? `<h1>${echapperHtml(opts.titre)}</h1>` : '';
  const sous = opts.sousTitre ? `<p>${echapperHtml(opts.sousTitre)}</p>` : '';
  const ordis = opts.images.filter((i) => i.appareil === 'ordinateur');
  const phones = opts.images.filter((i) => i.appareil === 'telephone');
  const cadreOrdi = (i: ImageDeMaquette) =>
    `<div class="ordi"><div class="barre-ordi"><i></i><i></i><i></i></div><div class="ecran-ordi"><img src="${echapperHtml(i.src)}"></div></div>`;
  const cadrePhone = (i: ImageDeMaquette) => `<div class="phone"><div class="ecran-phone"><img src="${echapperHtml(i.src)}"></div></div>`;
  let scene = '';
  if (opts.style === 'appareils') {
    scene = `<div class="scene">${ordis.slice(0, 2).map(cadreOrdi).join('')}${phones.slice(0, 2).map(cadrePhone).join('')}</div>`;
  } else {
    scene = `<div class="planche">${opts.images
      .slice(0, 6)
      .map((i) => `<div class="extrait ${i.appareil}"><img src="${echapperHtml(i.src)}"></div>`)
      .join('')}</div>`;
  }
  const paysage = W >= H;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden}
  body{background:radial-gradient(120% 90% at 50% 0%,${opts.couleur}2e 0%,${opts.fond} 60%);color:${opts.texte};font-family:${police}Inter,'Helvetica Neue',Arial,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${4 * u}px;padding:${6 * u}px}
  h1{margin:0;font-size:${7 * u}px;line-height:1.05;text-align:center;letter-spacing:-.01em}
  p{margin:0;font-size:${3 * u}px;opacity:.75;text-align:center}
  img{display:block;width:100%;height:100%;object-fit:cover;object-position:top}
  .scene{position:relative;display:flex;align-items:flex-end;justify-content:center;gap:${3 * u}px;flex:1;width:100%;min-height:0}
  .ordi{flex:0 1 ${paysage ? 62 : 86}%;max-height:100%;aspect-ratio:16/10.6;background:#16181d;border-radius:${1.6 * u}px;padding:${1.2 * u}px;padding-top:0;box-shadow:0 ${3 * u}px ${8 * u}px #0004;display:flex;flex-direction:column}
  .barre-ordi{height:${3 * u}px;display:flex;gap:${0.8 * u}px;align-items:center}.barre-ordi i{width:${1 * u}px;height:${1 * u}px;border-radius:50%;background:#ffffff40}
  .ecran-ordi{flex:1;overflow:hidden;border-radius:${0.6 * u}px;background:#fff}
  .phone{flex:0 0 auto;height:${paysage ? 78 : 58}%;aspect-ratio:9/19.5;background:#0d0e11;border-radius:${6 * u}px;padding:${1.4 * u}px;box-shadow:0 ${3 * u}px ${8 * u}px #0005;${ordis.length ? `margin-left:-${8 * u}px;` : ''}position:relative;z-index:2}
  .ecran-phone{width:100%;height:100%;overflow:hidden;border-radius:${4.8 * u}px;background:#fff}
  .planche{flex:1;width:100%;min-height:0;display:grid;grid-template-columns:repeat(${paysage ? 3 : 2},1fr);gap:${2.4 * u}px}
  .extrait{overflow:hidden;border-radius:${2 * u}px;box-shadow:0 ${1.5 * u}px ${5 * u}px #0003;background:#fff}
  </style></head><body>${titre}${sous}${scene}</body></html>`;
}
