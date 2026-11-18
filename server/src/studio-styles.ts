import fs from 'node:fs';
import { CATEGORIES_DU_CATALOGUE, chercherDansLeCatalogue, creditDuStyleDuCatalogue, type StyleDuCatalogue } from '@beluga/shared';
import { apercuDuStyle, stylesDuCatalogue } from './catalogue-de-styles.js';

/**
 * LA BIBLIOTHÈQUE DE STYLES DU STUDIO LIT LE CATALOGUE GELÉ (décision du
 * 26/10/2026, maintenue au retour du Studio le 30/10/2026) : les 350 directions
 * de `outils/catalogue-de-styles/catalogue.json`, sans source à surveiller ni
 * agent de nuit. Une seule vérité, partagée avec le directeur artistique
 * (`catalogue-de-styles.ts`). Les aperçus déjà téléchargés restent servis depuis
 * le disque ; rien ne se télécharge plus.
 */

const aUnApercuAnime = (s: StyleDuCatalogue) => !!s.apercus?.some((f) => f.endsWith('-anime.webp'));

export function lireStyle(id: string): StyleDuCatalogue | null {
  return stylesDuCatalogue().find((s) => s.id === id) ?? null;
}

export function categoriesDeLaBibliotheque() {
  return [...CATEGORIES_DU_CATALOGUE];
}

/** Ce que la galerie montre : ni la consigne entière, ni les adresses d'origine (demandées à l'ouverture, `detailDuStyle`). */
export function stylesPourLaGalerie() {
  return stylesDuCatalogue().map((s) => ({
    id: s.id,
    titre: s.titre,
    phrase: s.phrase,
    motsCles: s.motsCles,
    genre: s.genre,
    categories: s.categories,
    auteur: s.auteur,
    source: s.source,
    apercuAnime: aUnApercuAnime(s),
  }));
}

/** Ce que la fenêtre d'aperçu agrandi ajoute : la consigne (début), les liens, le crédit. */
export function detailDuStyle(id: string) {
  const s = lireStyle(id);
  if (!s) return null;
  return {
    id: s.id,
    consigne: s.consigne.length > 1500 ? `${s.consigne.slice(0, 1500)}…` : s.consigne,
    ...(s.auteurUrl ? { auteurUrl: s.auteurUrl } : {}),
    ...(s.lien ? { lien: s.lien } : {}),
    ...(s.fiche ? { fiche: s.fiche } : {}),
    credit: creditDuStyleDuCatalogue(s),
    sourceNom: s.source,
  };
}

export const creditDuStyle = creditDuStyleDuCatalogue;

/** Chercher des styles pour l'agent : des mots, cinq à huit styles COURTS en retour. */
export function chercherStyles(demande: string, nombre = 6) {
  return chercherDansLeCatalogue(stylesDuCatalogue(), demande, { nombre }).map((s) => ({ id: s.id, titre: s.titre, phrase: s.phrase, genre: s.genre }));
}

/** Une image neutre : un style dont l'aperçu n'est pas sur le disque reste montrable. */
const IMAGE_NEUTRE = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 200"><rect width="160" height="200" fill="#1d2440"/><circle cx="80" cy="92" r="26" fill="none" stroke="#7c86c9" stroke-width="3"/></svg>',
);

/** La vignette d'un style : l'aperçu animé s'il existe et qu'on le veut, sinon l'image fixe, sinon l'image neutre. */
export async function vignetteDuStyle(id: string, anime: boolean): Promise<{ type: string; corps: Buffer | string }> {
  const neutre = { type: 'image/svg+xml', corps: IMAGE_NEUTRE };
  const style = lireStyle(id);
  if (!style) return neutre;
  const fixe = apercuDuStyle(style);
  if (!fixe) return neutre;
  const animee = anime ? fixe.replace(/-fixe\.webp$/, '-anime.webp') : null;
  const chemin = animee && fs.existsSync(animee) ? animee : fixe;
  return { type: 'image/webp', corps: chemin };
}

/*
 * L'ÉTIQUETTE D'UN STYLE DANS LE CHAMP D'ÉCRITURE (31/10/2026, carte « Studio : conversation et options alignées ») :
 * choisir un style de la bibliothèque y pose une PIÈCE JOINTE — sa vignette, nommée « Style <titre> », sans
 * identifiant court pour que la pastille dise le nom. Elle se lit, s'efface d'un bloc et survit au brouillon comme
 * toute pièce jointe ; l'utilisateur écrit avant ou après, puis envoie. Le lien pièce → style se garde en base
 * (`studio.style-piece.<pièce>`) : la consigne du directeur le lui redit à chaque tour (`stylesJointsDeLaCreation`).
 */
const CLE_STYLE_DE_PIECE = (attachmentId: string) => `studio.style-piece.${attachmentId}`;
const CLE_STYLES_DE_LA_CREATION = (creationId: string) => `studio.styles-joints.${creationId}`;

export async function joindreUnStyle(creationId: string, styleId: string): Promise<{ attachment: import('@beluga/shared').Attachment }> {
  const { lireCreation } = await import('./studio.js');
  const { joindreUnFichier } = await import('./joindre-fichier.js');
  const { getMeta, setMeta } = await import('./db.js');
  const creation = lireCreation(creationId);
  if (!creation) throw new Error('création introuvable');
  const style = lireStyle(styleId);
  if (!style) throw new Error('style introuvable');
  const fichier = apercuDuStyle(style);
  if (!fichier) throw new Error('ce style n’a pas d’aperçu sur ce serveur : il ne peut pas se joindre');
  /* UN NOM COURT : la pastille du champ doit tenir sur une ligne (un tag trop long se coupe et laisse voir son texte).
     L'extension reste : c'est elle qui fait lire le fichier comme une image par l'outil de lecture du directeur. */
  const titre = style.titre.length > 18 ? `${style.titre.slice(0, 17).trimEnd()}…` : style.titre;
  const r = await joindreUnFichier({ projectId: creation.projectId, fichier, nom: `Style ${titre}.webp`, sansAlias: true });
  if (!r.ok) throw new Error(r.refus);
  setMeta(CLE_STYLE_DE_PIECE(r.attachment.id), style.id);
  let joints: string[] = [];
  try {
    joints = JSON.parse(getMeta(CLE_STYLES_DE_LA_CREATION(creationId)) ?? '[]') as string[];
  } catch {
    /* liste illisible : on repart d'une liste vide */
  }
  if (!joints.includes(r.attachment.id)) setMeta(CLE_STYLES_DE_LA_CREATION(creationId), JSON.stringify([...joints, r.attachment.id].slice(-30)));
  return { attachment: r.attachment };
}

/** Les styles joints dans le champ d'une création : la ligne que le directeur lit à chaque tour, ou rien. */
export function stylesJointsDeLaCreation(creationId: string, lireMeta: (cle: string) => string | null | undefined): string {
  let joints: string[] = [];
  try {
    joints = JSON.parse(lireMeta(CLE_STYLES_DE_LA_CREATION(creationId)) ?? '[]') as string[];
  } catch {
    return '';
  }
  const lignes = joints
    .map((piece) => {
      const id = lireMeta(CLE_STYLE_DE_PIECE(piece));
      const style = id ? lireStyle(id) : null;
      return style ? `« Style ${style.titre} » = [style:${style.id}]` : '';
    })
    .filter(Boolean);
  return lignes.length
    ? `STYLES DE LA BIBLIOTHÈQUE JOINTS PAR L’UTILISATEUR (une pièce jointe « Style … » dans son message) : ${lignes.join(' ; ')}. Lis la direction entière avec l’outil « studio », action « styles » et « styleId », puis adapte la création à ce style — ne le recopie jamais tel quel.`
    : '';
}
