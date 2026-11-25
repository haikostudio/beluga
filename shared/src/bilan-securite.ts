/**
 * LE BILAN D'UNE CORRECTION DE SÉCURITÉ — la liste à cocher du compte rendu (carte « Sécurité : bilan, écran et
 * historique », 25/11/2026, maquette #83c01).
 *
 * L'agent qui corrige une carte liée à des points d'audit rend, dans la partie « Ce qui est fait » de son compte
 * rendu, un bloc clôturé ```bilan-securite``` : un tableau JSON, une ligne par point, avec son statut (fait, à finir,
 * pas fait), sa catégorie, son BUT (ce que la correction devait obtenir) et ce qui a été FAIT, une phrase chacun.
 * L'écran le dessine en liste rangée PAR STATUT (Pas fait → À finir → Fait, décision de l'utilisateur), le texte
 * autour restant du Markdown ordinaire.
 *
 * TROIS GARANTIES, tenues ici sans base ni disque :
 *  - un bloc mal écrit ne casse rien : `lireLeBilan` rend `null` et le texte retombe en Markdown ;
 *  - AUCUN POINT NE DISPARAÎT : `completerLeBilan` ajoute en « pas fait — non traité » chaque point de la carte absent ;
 *  - la consigne de l'agent correcteur n'a qu'UNE source (`consigneDeCorrectionSecurite`).
 *
 * Aucune valeur secrète n'y passe jamais (DEC-501) : les phrases sont coupées et nomment des fichiers, pas des clés.
 */
import type { CategorieSecurite, ConstatSecurite, GraviteSecurite } from './controle-securite.js';

export type StatutDuBilan = 'fait' | 'a-finir' | 'pas-fait';
export const STATUTS_DU_BILAN: readonly StatutDuBilan[] = ['pas-fait', 'a-finir', 'fait'];

/** Une ligne du bilan, telle que l'agent la rend et que l'écran la dessine. */
export interface LigneDuBilan {
  empreinte: string;
  titre: string;
  categorie: string;
  statut: StatutDuBilan;
  /** Ce que la correction devait obtenir, en une phrase. */
  but: string;
  /** Ce qui a réellement été fait, en une phrase. */
  fait: string;
  /** Le point ne se règle que sur le site en ligne : son geste attend la mise en production. */
  production?: boolean;
}

/** Un point qu'une carte de correction emporte (son empreinte, son titre, sa catégorie). */
export interface PointDeLaCarte {
  empreinte: string;
  titre: string;
  categorie: string;
}

/** Le plafond d'une phrase « But » ou « Fait » : très brève mais explicite. */
export const PLAFOND_DE_PHRASE = 220;

/** Le nom affiché d'une catégorie (les catégories inconnues gardent leur mot). */
export const NOM_DE_CATEGORIE: Readonly<Record<CategorieSecurite, string>> = {
  dependances: 'Dépendances',
  cadre: 'Socle du site',
  secrets: 'Secrets',
  acces: 'Accès',
  'injection-sql': 'Injection',
  'injection-shell': 'Injection',
  xss: 'XSS',
  entetes: 'En-têtes',
  robots: 'Robots',
  etude: 'Étude',
};

export function nomDeCategorie(categorie: string): string {
  return (NOM_DE_CATEGORIE as Record<string, string>)[categorie] ?? categorie;
}

/** La catégorie d'une empreinte « categorie:id ». */
export function categorieDeLEmpreinte(empreinte: string): string {
  const i = empreinte.indexOf(':');
  return i > 0 ? empreinte.slice(0, i) : empreinte;
}

/** Une phrase courte : espaces resserrés, coupée proprement au plafond. */
export function phraseCourte(texte: unknown, plafond = PLAFOND_DE_PHRASE): string {
  const s = String(texte ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= plafond) return s;
  const coupe = s.slice(0, plafond - 1);
  const espace = coupe.lastIndexOf(' ');
  return `${(espace > plafond * 0.6 ? coupe.slice(0, espace) : coupe).replace(/[\s,;:.]+$/, '')}…`;
}

function statutLu(brut: unknown): StatutDuBilan | null {
  const s = String(brut ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s_]+/g, '-')
    .trim();
  if (s === 'fait' || s === 'done' || s === 'ok') return 'fait';
  if (s === 'a-finir' || s === 'partiel' || s === 'en-attente' || s === 'a-terminer') return 'a-finir';
  if (s === 'pas-fait' || s === 'non-fait' || s === 'echec' || s === 'pas-traite') return 'pas-fait';
  return null;
}

/** Le contenu JSON du premier bloc ```bilan-securite``` d'un texte, ou `null`. */
export function blocDuBilan(texte: string): string | null {
  const m = /```[ \t]*bilan-securite[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/.exec(texte ?? '');
  return m ? m[1]! : null;
}

/**
 * LIRE LE BILAN — tolérant. Accepte le texte entier d'un compte rendu (on y cherche le bloc) ou le seul contenu du
 * bloc. Rend `null` dès que le JSON est illisible ou vide : l'écran retombe alors sur le Markdown ordinaire, jamais
 * sur un cadre vide. Une ligne sans empreinte ni titre est écartée ; un statut inconnu se lit « à finir ».
 */
export function lireLeBilan(texte: string): LigneDuBilan[] | null {
  const brut = blocDuBilan(texte) ?? (texte?.trim().startsWith('[') ? texte : null);
  if (!brut) return null;
  let donnees: unknown;
  try {
    donnees = JSON.parse(brut);
  } catch {
    return null;
  }
  if (!Array.isArray(donnees)) return null;
  const lignes: LigneDuBilan[] = [];
  const vues = new Set<string>();
  for (const d of donnees) {
    if (!d || typeof d !== 'object') continue;
    const o = d as Record<string, unknown>;
    const empreinte = String(o.empreinte ?? '').trim();
    const titre = phraseCourte(o.titre, 140);
    if (!empreinte && !titre) continue;
    const cle = empreinte || titre;
    if (vues.has(cle)) continue;
    vues.add(cle);
    lignes.push({
      empreinte,
      titre: titre || empreinte,
      categorie: String(o.categorie ?? '').trim() || (empreinte ? categorieDeLEmpreinte(empreinte) : ''),
      statut: statutLu(o.statut) ?? 'a-finir',
      but: phraseCourte(o.but),
      fait: phraseCourte(o.fait),
      ...(o.production === true ? { production: true } : {}),
    });
  }
  return lignes.length ? lignes : null;
}

/** Les empreintes de la carte que le bilan ne couvre pas. */
export function empreintesOubliees(lignes: readonly Pick<LigneDuBilan, 'empreinte'>[] | null, points: readonly Pick<PointDeLaCarte, 'empreinte'>[]): string[] {
  const couvertes = new Set((lignes ?? []).map((l) => l.empreinte));
  return points.map((p) => p.empreinte).filter((e) => !couvertes.has(e));
}

/** La phrase d'un point que l'agent n'a pas traité. */
export const NON_TRAITE = 'Non traité par l’agent.';

/**
 * AUCUN POINT DÉTECTÉ NE DISPARAÎT : chaque point de la carte absent du bilan s'y ajoute en « pas fait — non traité ».
 * Les lignes de l'agent gardent leur ordre ; les titres et catégories manquants se reprennent du point.
 */
export function completerLeBilan(lignes: readonly LigneDuBilan[] | null, points: readonly PointDeLaCarte[]): LigneDuBilan[] {
  const parEmpreinte = new Map(points.map((p) => [p.empreinte, p]));
  const sortie: LigneDuBilan[] = (lignes ?? []).map((l) => {
    const p = parEmpreinte.get(l.empreinte);
    return p ? { ...l, titre: l.titre || p.titre, categorie: l.categorie || p.categorie } : l;
  });
  for (const e of empreintesOubliees(lignes, points)) {
    const p = parEmpreinte.get(e)!;
    sortie.push({ empreinte: e, titre: phraseCourte(p.titre, 140), categorie: p.categorie, statut: 'pas-fait', but: '', fait: NON_TRAITE });
  }
  return sortie;
}

export interface BilanRange {
  groupes: { statut: StatutDuBilan; lignes: LigneDuBilan[] }[];
  compte: Record<StatutDuBilan, number> & { total: number };
}

/** Le bilan rangé par statut, dans l'ordre Pas fait → À finir → Fait, avec ses compteurs. Les groupes vides sautent. */
export function rangerLeBilan(lignes: readonly LigneDuBilan[]): BilanRange {
  const compte = { fait: 0, 'a-finir': 0, 'pas-fait': 0, total: lignes.length };
  for (const l of lignes) compte[l.statut]++;
  const groupes = STATUTS_DU_BILAN.map((statut) => ({ statut, lignes: lignes.filter((l) => l.statut === statut) })).filter((g) => g.lignes.length);
  return { groupes, compte };
}

/** Le bloc à poser dans le compte rendu, prêt à coller. */
export function blocDuBilanEnTexte(lignes: readonly LigneDuBilan[]): string {
  return ['```bilan-securite', JSON.stringify(lignes, null, 1), '```'].join('\n');
}

/** Les points d'une carte, tirés des constats du rapport (empreinte, titre, catégorie). */
export function pointsDesConstats(constats: readonly Pick<ConstatSecurite, 'categorie' | 'id' | 'titre'>[]): PointDeLaCarte[] {
  return constats.map((c) => ({ empreinte: `${c.categorie}:${c.id}`, titre: c.titre.replace(/\s+/g, ' ').trim(), categorie: c.categorie }));
}

/* ------------------------------------------------------------------ */
/* La consigne de l'agent correcteur                                   */
/* ------------------------------------------------------------------ */

/**
 * LA CONSIGNE « ALLER AU BOUT » — une seule source, reprise par la description de la carte groupée, par la demande de
 * chaque tour de tâche d'une carte liée à des points, et par la consigne de l'agent de sécurité qui rédige la carte.
 */
export function consigneDeCorrectionSecurite(points: readonly Pick<PointDeLaCarte, 'empreinte' | 'titre'>[]): string {
  const liste = points.map((p) => `- [${p.empreinte}] ${p.titre}`).join('\n');
  return [
    `CORRECTION DE SÉCURITÉ — VA JUSQU'AU BOUT. Cette carte emporte ${points.length} point(s) d'audit : tu les traites TOUS, sans exception et sans « fait en grande partie ».`,
    liste,
    '- Une faille sans correctif chez son éditeur : essaie D’ABORD un contournement — forcer une version saine (overrides / resolutions), remplacer la brique, ou poser une protection autour (filtre, en-tête, garde). Tu n’écris « pas fait » qu’après un vrai essai, avec sa raison en une phrase.',
    '- Ce qui ne se règle QUE sur le site en ligne (serveur de production, hébergeur) : tu n’y touches JAMAIS. Tu le prépares entièrement (fichier de configuration, commande prête, vérifiée à blanc) et tu le déclares avec l’outil « geste_de_production » ; la mise en production lancée par l’utilisateur l’appliquera. Le point est alors « a-finir » avec `"production": true`.',
    '- AVANT TA RÉPONSE FINALE, appelle l’outil « bilan_securite » avec une ligne par point (empreinte, titre, categorie, statut fait | a-finir | pas-fait, but, fait — une phrase brève mais explicite chacun). Il te rend le bloc ```bilan-securite``` à recopier TEL QUEL dans la partie « Ce qui est fait » de ton compte rendu.',
    '- Jamais la valeur d’une clé, d’un mot de passe ou d’un jeton : nomme seulement le fichier.',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* La note de sécurité                                                 */
/* ------------------------------------------------------------------ */

/** Ce que coûte à la note chaque point restant, selon sa gravité (décision du cadrage, 25/11/2026). */
export const POIDS_DES_GRAVITES: Readonly<Record<GraviteSecurite, number>> = { critique: 25, elevee: 12, moyenne: 6, faible: 2 };

/**
 * LA NOTE DE SÉCURITÉ SUR 100 : on part de 100 et chaque point encore présent retire selon sa gravité (critique 25,
 * élevée 12, moyenne 6, faible 2), sans descendre sous 0. Un point « en correction » compte tant qu'il n'est pas corrigé.
 */
export function noteDeSecurite(compte: Readonly<Record<GraviteSecurite, number>>): number {
  const retrait = (Object.keys(POIDS_DES_GRAVITES) as GraviteSecurite[]).reduce((s, g) => s + POIDS_DES_GRAVITES[g] * Math.max(0, compte[g] ?? 0), 0);
  return Math.max(0, 100 - retrait);
}

/** La phrase de la note : ≥ 85 bonne, ≥ 70 correcte, ≥ 40 moyenne, sinon faible. */
export function phraseDeLaNoteDeSecurite(note: number | null): string {
  if (note === null) return 'Pas encore notée';
  if (note >= 85) return 'Bonne protection';
  if (note >= 70) return 'Protection correcte';
  if (note >= 40) return 'Protection moyenne';
  return 'Protection faible';
}

/** La note se dit en alerte sous 40 (la teinte importante de l'écran). */
export function noteEnAlerte(note: number | null): boolean {
  return note !== null && note < 40;
}

export interface AvancementDesCorrections {
  corriges: number;
  enCorrection: number;
  aTraiter: number;
  total: number;
  /** De 0 à 100, ou `null` sans aucun point suivi. */
  pourcent: number | null;
}

/** L'avancement des corrections : la part des points suivis déjà corrigés. */
export function avancementDesCorrections(points: readonly { etat: 'a-traiter' | 'en-correction' | 'corrige' }[]): AvancementDesCorrections {
  const a = { corriges: 0, enCorrection: 0, aTraiter: 0 };
  for (const p of points) {
    if (p.etat === 'corrige') a.corriges++;
    else if (p.etat === 'en-correction') a.enCorrection++;
    else a.aTraiter++;
  }
  const total = a.corriges + a.enCorrection + a.aTraiter;
  return { ...a, total, pourcent: total ? Math.round((100 * a.corriges) / total) : null };
}
