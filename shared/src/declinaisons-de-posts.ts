import { sansAccents } from './classeurs.js';
/**
 * LES DÉCLINAISONS D'UN MÊME POST (carte « Fiche publication et médias regroupés », 04/11/2026) : un chef qui prépare
 * une campagne sur Instagram ET TikTok écrit deux publications pour un même post — « Avant-première 1 — Dîner dans une
 * bulle » et « TikTok Avant-première 1 — Dîner dans une bulle », même campagne, même jour. La médiathèque les montre
 * en UNE vignette, avec le logo de chaque réseau touché.
 *
 * LE LIEN EST EXPLICITE (`marketing_contenus.declinaison_de` → la publication d'origine), jamais deviné à l'affichage.
 * Il NE RÉUTILISE PAS `variante_de` : celle-là désigne la version B d'un test A/B, sur le même réseau.
 *
 * Cette règle pose le lien manquant, pour les publications d'avant (rattrapage) comme pour celles que le chef écrit
 * ensuite (rejouée à chaque lecture des médias, idempotente) :
 *   - même projet, même campagne, même jour prévu, même titre une fois retiré le nom du réseau (casse, accents,
 *     apostrophes et espaces neutralisés) ;
 *   - des RÉSEAUX DIFFÉRENTS : deux publications du même réseau ne sont jamais des déclinaisons l'une de l'autre ;
 *   - la plus ancienne est l'origine, les autres pointent vers ELLE (jamais une chaîne) ;
 *   - un lien déjà posé n'est jamais défait ni déplacé.
 */

export interface PostDeclinable {
  id: string;
  projet: string;
  canal: string;
  campagneId: string | null;
  datePrevue: string | null;
  titre: string;
  creeLe: number;
  declinaisonDe: string | null;
}

/** Les noms de réseau qu'un titre peut porter en tête ou en queue (« TikTok Avant-première 1 », « … (Instagram) »). */
const NOMS_DE_RESEAUX = ['instagram', 'insta', 'tiktok', 'tik tok', 'facebook', 'linkedin', 'youtube', 'threads', 'pinterest', 'reddit', 'twitter', 'x'];


/** Le titre d'un post sans son réseau, réduit à ses lettres et chiffres : la clé commune de ses déclinaisons. */
export function titreSansReseau(titre: string): string {
  let s = sansAccents(titre.toLowerCase())
    .replace(/[’‘`´]/g, "'")
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const reseau = NOMS_DE_RESEAUX.map((n) => n.replace(/ /g, '\\s*')).join('|');
  const tete = new RegExp(`^(?:${reseau})\\b[\\s:·|/-]*`, 'i');
  const queue = new RegExp(`[\\s:·|/(-]*\\b(?:${reseau})\\)?\\s*$`, 'i');
  for (let i = 0; i < 2; i += 1) s = s.replace(tete, '').replace(queue, '').trim();
  return s.replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * LES LIENS À POSER : `{ id, declinaisonDe }` pour chaque publication qui est la déclinaison d'une autre et ne le dit
 * pas encore. Rien à poser la seconde fois.
 */
export function declinaisonsAPoser(posts: readonly PostDeclinable[]): { id: string; declinaisonDe: string }[] {
  const parId = new Map(posts.map((p) => [p.id, p]));
  /* La famille réelle de chacun (un lien vers une publication disparue ne compte pas). */
  const famille = (p: PostDeclinable) => (p.declinaisonDe && parId.has(p.declinaisonDe) ? p.declinaisonDe : p.id);
  const groupes = new Map<string, PostDeclinable[]>();
  for (const p of posts) {
    if (!p.campagneId || !p.datePrevue) continue;
    const titre = titreSansReseau(p.titre);
    if (!titre) continue;
    const cle = `${p.projet}\n${p.campagneId}\n${p.datePrevue}\n${titre}`;
    groupes.set(cle, [...(groupes.get(cle) ?? []), p]);
  }
  const aPoser: { id: string; declinaisonDe: string }[] = [];
  for (const groupe of groupes.values()) {
    if (groupe.length < 2) continue;
    const tries = [...groupe].sort((a, b) => a.creeLe - b.creeLe || a.id.localeCompare(b.id));
    /* L'origine : celle qu'une autre désigne déjà, sinon la plus ancienne qui n'est la déclinaison de personne. */
    const designee = tries.map((p) => p.declinaisonDe).find((d): d is string => !!d && groupe.some((g) => g.id === d));
    const origine = (designee && groupe.find((g) => g.id === designee)) || tries.find((p) => famille(p) === p.id);
    if (!origine) continue;
    /* Les réseaux déjà présents dans la famille : un second post du même réseau reste seul. */
    const reseaux = new Set(posts.filter((p) => famille(p) === origine.id).map((p) => p.canal));
    for (const p of tries) {
      if (p === origine || famille(p) !== p.id) continue;
      if (posts.some((q) => q.declinaisonDe === p.id && parId.has(q.id))) continue; /* déjà l'origine d'une autre famille */
      if (reseaux.has(p.canal)) continue;
      reseaux.add(p.canal);
      aPoser.push({ id: p.id, declinaisonDe: origine.id });
    }
  }
  return aPoser;
}

/* ------------------------------------------------------------------ */
/* Les vignettes de la médiathèque, déclinaisons réunies                */
/* ------------------------------------------------------------------ */
