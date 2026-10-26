/**
 * LES STYLES DU DIRECTEUR ARTISTIQUE (décision de l'utilisateur du 26/10/2026).
 *
 * Après le type (photo, vidéo ou son), le directeur propose DIX styles, chacun
 * avec son image (`outils/styles-de-realisation/<id>.jpg`, versionnée, jointe
 * une fois par projet et réutilisée par son identifiant). Le style retenu
 * s'écrit sur la carte (`realisation.style`) et DÉCIDE de la fabrication :
 *  - « serveur » : l'agent écrit l'animation (HyperFrames + les bibliothèques
 *    servies en local), le serveur la rend en vidéo ou en image — coût 0 ;
 *  - « generation » : les images et les plans viennent d'un service payant
 *    (kie.ai), après accord sur le prix ;
 *  - « mixte » : des plans générés, habillés ensuite par une composition.
 *
 * Le CATALOGUE DE STYLES gelé du Studio (350 directions de motion design,
 * `outils/catalogue-de-styles/catalogue.json`) reste une source d'inspiration
 * que le directeur consulte (« production » action « catalogue ») — jamais
 * recopié dans un livrable (droits aux auteurs pour prompt-motion, MEM-4527).
 */

export const FABRICATIONS_DE_STYLE = ['serveur', 'generation', 'mixte'] as const;
export type FabricationDeStyle = (typeof FABRICATIONS_DE_STYLE)[number];

export const IDS_STYLES_DE_REALISATION = ['realiste', 'motion', '3d', 'mixte', 'illustration', 'generatif', 'typographie', 'infographie', 'retro', 'demo-ecran'] as const;
export type IdStyleDeRealisation = (typeof IDS_STYLES_DE_REALISATION)[number];

export interface StyleDeRealisation {
  id: IdStyleDeRealisation;
  libelle: string;
  /** Ce qu'on obtient, en mots courants (montré sous le choix). */
  description: string;
  fabrication: FabricationDeStyle;
  /** Le fichier de l'image du choix, dans `outils/styles-de-realisation/`. */
  image: string;
  /** Les bibliothèques de composition conseillées (`BIBLIOTHEQUES_DE_COMPOSITION`). */
  bibliotheques: readonly string[];
  /** Les modes d'emploi à lire avant d'écrire (outil « memoire », geste « chercher »). */
  competences: readonly string[];
}

export const STYLES_DE_REALISATION: readonly StyleDeRealisation[] = [
  {
    id: 'realiste',
    libelle: 'Réaliste',
    description: 'Des images et des plans qui ressemblent à de vraies prises de vue : personnes, lieux, produits.',
    fabrication: 'generation',
    image: 'realiste.jpg',
    bibliotheques: [],
    competences: ['generer-medias-gemini'],
  },
  {
    id: 'motion',
    libelle: 'Motion design',
    description: 'Formes, icônes et textes qui s’animent avec rythme, en couleurs franches. Fabriqué sur notre serveur, sans frais.',
    fabrication: 'serveur',
    image: 'motion.jpg',
    bibliotheques: ['gsap'],
    competences: ['hyperframes', 'motion-doctrine', 'mouvement-web-gsap', 'video-animee-hyperframes-assemblyai'],
  },
  {
    id: '3d',
    libelle: '3D',
    description: 'Objets et décors en trois dimensions, éclairés et filmés comme une maquette. Fabriqué sur notre serveur, sans frais.',
    fabrication: 'serveur',
    image: '3d.jpg',
    bibliotheques: ['gsap', 'three', 'rapier'],
    competences: ['hyperframes', 'threejs-fundamentals', 'rapier-collisions-3d-a-pas-fixe', 'gltf-transform-alleger-un-modele-3d'],
  },
  {
    id: 'mixte',
    libelle: 'Mixte : réaliste habillé en motion',
    description: 'Des plans réalistes, puis des titres, des chiffres et des formes animées posés par-dessus.',
    fabrication: 'mixte',
    image: 'mixte.jpg',
    bibliotheques: ['gsap'],
    competences: ['hyperframes', 'captions-overlay', 'motion-doctrine'],
  },
  {
    id: 'illustration',
    libelle: 'Illustration ou dessin animé',
    description: 'Des personnages et des décors dessinés, comme un dessin animé ou un livre illustré.',
    fabrication: 'generation',
    image: 'illustration.jpg',
    bibliotheques: ['gsap'],
    competences: ['generer-medias-gemini', 'hyperframes'],
  },
  {
    id: 'generatif',
    libelle: 'Génératif ou art abstrait',
    description: 'Des motifs, des particules et des couleurs calculés qui évoluent sans fin. Fabriqué sur notre serveur, sans frais.',
    fabrication: 'serveur',
    image: 'generatif.jpg',
    bibliotheques: ['gsap', 'p5', 'ogl'],
    competences: ['hyperframes', 'p5-visuels-generatifs-rendus-en-video', 'ogl-shaders-legers', 'tsparticles-effets-reproductibles'],
  },
  {
    id: 'typographie',
    libelle: 'Typographie animée',
    description: 'Le message porté par les mots eux-mêmes : grandes lettres qui arrivent, se déforment et rythment la voix. Fabriqué sur notre serveur, sans frais.',
    fabrication: 'serveur',
    image: 'typographie.jpg',
    bibliotheques: ['gsap', 'paper'],
    competences: ['hyperframes', 'paper-js-chemins-vectoriels-animes', 'captions-overlay'],
  },
  {
    id: 'infographie',
    libelle: 'Infographie et chiffres',
    description: 'Graphiques, compteurs, cartes et schémas qui se construisent à l’écran. Fabriqué sur notre serveur, sans frais.',
    fabrication: 'serveur',
    image: 'infographie.jpg',
    bibliotheques: ['gsap'],
    competences: ['hyperframes', 'motion-doctrine', 'cut-the-curve'],
  },
  {
    id: 'retro',
    libelle: 'Rétro ou pixel art',
    description: 'Gros pixels, couleurs de jeux vidéo d’autrefois et sons synthétiques. Fabriqué sur notre serveur, sans frais.',
    fabrication: 'serveur',
    image: 'retro.jpg',
    bibliotheques: ['gsap', 'pixi', 'tone'],
    competences: ['hyperframes', 'pixijs', 'tone-js-sons-et-musique-synthetises'],
  },
  {
    id: 'demo-ecran',
    libelle: 'Démonstration d’écran',
    description: 'Les vrais écrans de votre produit, filmés puis animés : zooms, curseur, surbrillances. Fabriqué sur notre serveur, sans frais.',
    fabrication: 'serveur',
    image: 'demo-ecran.jpg',
    bibliotheques: ['gsap'],
    competences: ['hyperframes', 'oversized-cursor', 'obs-studio-capture-et-son-equivalent-sur-serveur', 'app-filmee-dans-un-telephone'],
  },
];

export function styleDeRealisation(id: unknown): StyleDeRealisation | null {
  return STYLES_DE_REALISATION.find((s) => s.id === id) ?? null;
}

/** Le style écrit d'après une réponse de l'utilisateur : son identifiant, ou son libellé (accents et casse ignorés). */
export function styleDeLaReponse(reponse: unknown): StyleDeRealisation | null {
  const brut = String(reponse ?? '').trim();
  if (!brut) return null;
  const direct = styleDeRealisation(brut);
  if (direct) return direct;
  const n = normaliser(brut);
  return STYLES_DE_REALISATION.find((s) => normaliser(s.libelle) === n || n.startsWith(normaliser(s.libelle))) ?? null;
}

/* ------------------------------------------------------------------ */
/* Le catalogue de styles gelé du Studio                                */
/* ------------------------------------------------------------------ */

export interface CategorieDuCatalogue {
  id: string;
  libelle: string;
}

/** Les catégories du catalogue gelé (l'ordre de l'ancien écran ; un id ne se renomme jamais). */
export const CATEGORIES_DU_CATALOGUE: readonly CategorieDuCatalogue[] = [
  { id: 'lancement', libelle: 'Lancement de produit' },
  { id: 'bande-demo', libelle: 'Bande démo' },
  { id: 'explication', libelle: 'Explication' },
  { id: 'typographie', libelle: 'Typographie animée' },
  { id: '3d', libelle: '3D' },
  { id: 'interface', libelle: 'Interface d’application' },
  { id: 'site-web', libelle: 'Site web présenté' },
  { id: 'logo', libelle: 'Logo et marque' },
  { id: 'musique', libelle: 'Clip et musique' },
  { id: 'recit', libelle: 'Histoire racontée' },
  { id: 'donnees', libelle: 'Données et chiffres' },
  { id: 'chronologie', libelle: 'Frise et chronologie' },
  { id: 'vertical', libelle: 'Format vertical' },
  { id: 'personnage', libelle: 'Personnages' },
  { id: 'dessin', libelle: 'Dessin à la main' },
  { id: 'matiere', libelle: 'Papier et matière' },
  { id: 'retro', libelle: 'Rétro' },
  { id: 'neon', libelle: 'Néon et lumière' },
  { id: 'abstrait', libelle: 'Abstrait et génératif' },
  { id: 'plan-continu', libelle: 'Plan continu' },
  { id: 'cinema', libelle: 'Ambiance cinéma' },
  { id: 'minimaliste', libelle: 'Épuré' },
  { id: 'humour', libelle: 'Humour et décalé' },
  { id: 'competence', libelle: 'Compétence d’agent' },
];

/** Une entrée du catalogue gelé (`outils/catalogue-de-styles/catalogue.json`). */
export interface StyleDuCatalogue {
  id: string;
  titre: string;
  phrase: string;
  motsCles: string[];
  genre: string;
  categories: string[];
  consigne: string;
  auteur: string;
  source: string;
  auteurUrl?: string;
  lien?: string;
  fiche?: string;
  apercus?: string[];
}

function normaliser(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * CHERCHER DANS LE CATALOGUE : les mots de la demande notés dans le titre, les
 * mots-clés et les catégories (3 points) puis dans la phrase et le début de la
 * consigne (1 point) ; une catégorie filtre d'abord. À égalité, les vraies
 * directions (longue consigne) passent devant.
 */
export function chercherDansLeCatalogue(styles: readonly StyleDuCatalogue[], demande: string, options: { categorie?: string; nombre?: number } = {}): StyleDuCatalogue[] {
  const mots = normaliser(demande)
    .split(' ')
    .filter((m) => m.length > 2);
  const libelles = new Map(CATEGORIES_DU_CATALOGUE.map((c) => [c.id, c.libelle]));
  const candidats = options.categorie ? styles.filter((s) => s.categories.includes(options.categorie!)) : styles;
  const notes = candidats.map((s, rang) => {
    const tete = normaliser(`${s.titre} ${s.motsCles.join(' ')} ${s.categories.map((c) => libelles.get(c) ?? c).join(' ')}`);
    const corps = normaliser(`${s.phrase} ${s.consigne.slice(0, 1500)}`);
    let note = 0;
    for (const m of mots) {
      if (tete.includes(m)) note += 3;
      else if (corps.includes(m)) note += 1;
    }
    return { s, note: note + (s.consigne.length >= 400 ? 0.3 : 0) - rang / 10_000 };
  });
  return notes
    .filter((n) => !mots.length || n.note >= 1)
    .sort((a, b) => b.note - a.note)
    .slice(0, Math.max(1, Math.min(12, options.nombre ?? 6)))
    .map(({ s }) => s);
}

/** Le crédit d'un style du catalogue, à citer quand on s'en inspire. */
export function creditDuStyleDuCatalogue(s: Pick<StyleDuCatalogue, 'source' | 'auteur' | 'fiche' | 'lien'>): string {
  if (s.source === 'awesome-opus5-5-videos') return `licence MIT, collection awesome-opus5-5-videos${s.auteur ? `, ${s.auteur}` : ''}`;
  return `${s.auteur || 'auteur inconnu'}${s.fiche || s.lien ? ` (${s.fiche ?? s.lien})` : ''} — droits à l’auteur : s’en inspirer, ne jamais le recopier`;
}
