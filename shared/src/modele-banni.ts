/**
 * LES MODÈLES BANNIS : JAMAIS PROPOSÉS, JAMAIS LANCÉS.
 *
 * Fable (claude-fable-5, claude-fable-5-1…) est banni par décision de
 * l'utilisateur (06/10/2026, carte « Bannir Fable, Studio sans tiroirs ») : il
 * exige des crédits en plus de l'abonnement, et des dizaines de tours se sont
 * arrêtés sur « Fable 5.1 requires usage credits ». La famille sort donc du
 * catalogue de chaque moteur, tout réglage qui la nomme encore passe à l'Opus
 * le plus récent, et l'adaptateur Claude refuse de la poser sur la ligne de
 * commande.
 *
 * C'EST UNE EXCEPTION VOULUE À DEC-213 (« un modèle choisi n'est jamais
 * réécrit ») : la réécriture vers Opus est demandée, pas subie.
 *
 * Ne vise que des IDENTIFIANTS ou des NOMS DE MODÈLE. La voix de synthèse
 * « fable » d'OpenAI (liste des voix du Studio) n'est pas un modèle : on ne la
 * passe jamais ici.
 */

/** Les familles bannies, en minuscules, cherchées comme un mot du nom. */
export const FAMILLES_BANNIES = ['fable'] as const;

/** La famille qui remplace un modèle banni. */
export const FAMILLE_DE_REMPLACEMENT = 'opus';

/** Le repli quand aucun catalogue n'est lu : l'alias du CLI Claude vers l'Opus courant. */
export const MODELE_DE_REMPLACEMENT_PAR_DEFAUT = 'opus';

/** Un identifiant (« claude-fable-5-1 ») ou un nom affiché (« Fable 5.1 ») banni ? */
export function modeleBanni(modele: string | undefined | null): boolean {
  if (!modele) return false;
  const mots = modele.toLowerCase().split(/[^a-z0-9]+/);
  return FAMILLES_BANNIES.some((famille) => mots.includes(famille));
}

/** Un modèle de catalogue banni, par son identifiant OU son nom. */
export function entreeBannie(model: { id: string; label?: string }): boolean {
  return modeleBanni(model.id) || modeleBanni(model.label);
}

/** Le catalogue sans ses modèles bannis. */
export function sansModelesBannis<M extends { id: string; label?: string }>(models: M[]): M[] {
  return models.filter((model) => !entreeBannie(model));
}

/**
 * Le modèle qui part à la place d'un modèle banni : l'Opus le plus récent du
 * catalogue (liste triée du plus récent au plus ancien, ou non triée : on
 * prend alors la version la plus haute), sinon l'alias « opus » du CLI.
 */
export function remplacantDUnBanni(models: { id: string; label?: string }[] = []): string {
  const opus = models.filter(
    (m) => !entreeBannie(m) && `${m.id} ${m.label ?? ''}`.toLowerCase().includes(FAMILLE_DE_REMPLACEMENT),
  );
  if (!opus.length) return MODELE_DE_REMPLACEMENT_PAR_DEFAUT;
  const version = (m: { id: string; label?: string }) => {
    const match = `${m.label ?? ''} ${m.id}`.match(/(\d+)(?:[.\-_](\d+))?/);
    return match ? Number(match[1]) * 1000 + Number(match[2] ?? 0) : 0;
  };
  return opus.reduce((meilleur, m) => (version(m) > version(meilleur) ? m : meilleur)).id;
}

/** Le modèle à lancer : lui-même s'il est permis, son remplaçant sinon. */
export function modelePermis(modele: string | undefined, models: { id: string; label?: string }[] = []): string | undefined {
  return modeleBanni(modele) ? remplacantDUnBanni(models) : modele;
}
