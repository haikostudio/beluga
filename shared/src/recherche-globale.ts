/**
 * LA RECHERCHE AU CLAVIER ÉLARGIE (carte « Lecteur de charte : commentaires et barre », décision de l'utilisateur : « on
 * supprime la loupe en haut à droite, puisqu'on a ⌘F ») — règles pures.
 *
 * La loupe du haut a quitté cinq pages (Charte graphique, Statistiques, Coffre-fort, Studio, Mémoire) : ⌘F trouve donc
 * ce qu'elles montrent. Le démon lit chaque source par SA PROPRE commande de liste, avec les mêmes portes que la page
 * (`recherche.globale` dans `ws.ts`) ; ici, on ne fait que trier ce qu'il a lu. Rien d'un SECRET ne sort : d'une fiche
 * du coffre, seuls son nom, son type et son dossier — jamais une valeur, jamais une note.
 */

export type GenreDeRechercheGlobale = 'charte' | 'coffre' | 'studio' | 'memoire' | 'site';

export interface ResultatDeRechercheGlobale {
  genre: GenreDeRechercheGlobale;
  id: string;
  titre: string;
  /** Ce qui le situe : le projet, le dossier, le type, l'adresse. */
  detail: string;
  /** Le projet de l'élément, quand il en a un (ouvrir la charte sur le bon document). */
  projectId?: string | null;
  /** La portée d'une unité de mémoire. */
  portee?: string;
}

/** Ce que le démon a lu, source par source (une source fermée au compte est absente). */
export interface SourcesDeRechercheGlobale {
  chartes?: readonly { id: string; titre: string; projectId?: string | null; projet?: string; marque?: string; description?: string }[];
  coffre?: readonly { id: string; nom: string; type?: string; dossierChemin?: string | null; projectId?: string | null }[];
  studio?: readonly { id: string; titre: string; projet?: string; projectId?: string }[];
  memoire?: readonly { id: string; titre: string; titreHumain?: string; portee?: string }[];
  sites?: readonly { id: string; nom: string; adresse?: string | null }[];
}

/** Le plafond par genre : la fenêtre reste lisible, chaque genre a sa place. */
export const RESULTATS_PAR_GENRE = 6;

export const sansAccentsDeRecherche = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * LES RÉSULTATS, GENRE PAR GENRE : un élément correspond quand TOUS les mots cherchés se trouvent dans son nom ou ce qui
 * le situe (sans accents ni majuscules). Ceux dont le NOM commence par la recherche passent en tête. Deux lettres au
 * moins, sinon rien.
 */
export function trierLaRechercheGlobale(sources: SourcesDeRechercheGlobale, texte: string, parGenre = RESULTATS_PAR_GENRE): ResultatDeRechercheGlobale[] {
  const q = sansAccentsDeRecherche(texte.trim());
  if (q.length < 2) return [];
  const mots = q.split(/\s+/).filter(Boolean);
  const garder = (liste: ResultatDeRechercheGlobale[], fouille: (r: ResultatDeRechercheGlobale) => string) =>
    liste
      .map((r) => {
        const titre = sansAccentsDeRecherche(r.titre);
        const tout = `${titre} ${sansAccentsDeRecherche(fouille(r))}`;
        if (!mots.every((m) => tout.includes(m))) return null;
        return { r, rang: titre.startsWith(q) ? 0 : titre.includes(q) ? 1 : 2 };
      })
      .filter((x): x is { r: ResultatDeRechercheGlobale; rang: number } => !!x)
      .sort((a, b) => a.rang - b.rang)
      .slice(0, parGenre)
      .map((x) => x.r);
  const resultats: ResultatDeRechercheGlobale[] = [];
  resultats.push(
    ...garder(
      (sources.chartes ?? []).map((p) => ({ genre: 'charte' as const, id: p.id, titre: p.titre, detail: p.projet ?? '', projectId: p.projectId ?? null })),
      (r) => `${r.detail} ${(sources.chartes ?? []).find((p) => p.id === r.id)?.marque ?? ''}`,
    ),
  );
  resultats.push(
    ...garder(
      (sources.coffre ?? []).map((f) => ({
        genre: 'coffre' as const,
        id: f.id,
        titre: f.nom,
        detail: [f.dossierChemin, f.type].filter(Boolean).join(' · '),
        projectId: f.projectId ?? null,
      })),
      (r) => r.detail,
    ),
  );
  resultats.push(
    ...garder(
      (sources.studio ?? []).map((c) => ({ genre: 'studio' as const, id: c.id, titre: c.titre, detail: c.projet ?? '', projectId: c.projectId ?? null })),
      (r) => r.detail,
    ),
  );
  resultats.push(
    ...garder(
      (sources.memoire ?? []).map((u) => ({ genre: 'memoire' as const, id: u.id, titre: u.titreHumain || u.titre, detail: u.id, ...(u.portee ? { portee: u.portee } : {}) })),
      (r) => `${r.detail} ${(sources.memoire ?? []).find((u) => u.id === r.id)?.titre ?? ''}`,
    ),
  );
  resultats.push(
    ...garder(
      (sources.sites ?? []).map((s) => ({ genre: 'site' as const, id: s.id, titre: s.nom, detail: s.adresse ?? '' })),
      (r) => r.detail,
    ),
  );
  return resultats;
}
