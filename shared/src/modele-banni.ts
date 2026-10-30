/**
 * LES MODÈLES RÉSERVÉS AU CHOIX MANUEL : PROPOSÉS, JAMAIS PRIS D'OFFICE.
 *
 * Fable (claude-fable-5, claude-fable-5-1…) exige des crédits en plus de
 * l'abonnement. Banni partout le 06/10/2026 (des tours s'arrêtaient sur « Fable
 * 5.1 requires usage credits »), il est RÉAUTORISÉ le 30/10/2026 par décision
 * de l'utilisateur, à une condition : il ne part QUE sur un choix explicite.
 *
 * - Il revient dans le catalogue de chaque moteur et dans le menu des modèles :
 *   un Fable choisi à la main (barre d'écriture, réglages) part tel quel.
 * - Le palier « approfondi » ne le prend jamais d'office (`niveau-agent.ts`).
 * - Tout LANCEMENT AUTOMATIQUE — carte née sans geste humain (nuit, démon,
 *   service extérieur, proposition d'agent), agent du démon sans carte — le
 *   remplace par l'Opus le plus récent (`lancementAutomatique`, `modelePermis`).
 *   Dans le doute sur l'origine, le lancement compte comme automatique.
 *
 * La réécriture reste une EXCEPTION VOULUE À DEC-213, désormais bornée aux
 * lancements automatiques.
 *
 * Ne vise que des IDENTIFIANTS ou des NOMS DE MODÈLE. La voix de synthèse
 * « fable » d'OpenAI (liste des voix du Studio) n'est pas un modèle : on ne la
 * passe jamais ici.
 */

/** Les familles réservées au choix manuel, en minuscules, cherchées comme un mot du nom. */
export const FAMILLES_BANNIES = ['fable'] as const;

/** La famille qui remplace un modèle banni. */
export const FAMILLE_DE_REMPLACEMENT = 'opus';

/** Le repli quand aucun catalogue n'est lu : l'alias du CLI Claude vers l'Opus courant. */
export const MODELE_DE_REMPLACEMENT_PAR_DEFAUT = 'opus';

/** Un identifiant (« claude-fable-5-1 ») ou un nom affiché (« Fable 5.1 ») réservé au choix manuel ? */
export function modeleBanni(modele: string | undefined | null): boolean {
  if (!modele) return false;
  const mots = modele.toLowerCase().split(/[^a-z0-9]+/);
  return FAMILLES_BANNIES.some((famille) => mots.includes(famille));
}

/** Un modèle de catalogue banni, par son identifiant OU son nom. */
export function entreeBannie(model: { id: string; label?: string }): boolean {
  return modeleBanni(model.id) || modeleBanni(model.label);
}

/** Le catalogue sans ses modèles réservés : la liste où un palier choisit d'office. */
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

/**
 * Le modèle à lancer : lui-même, sauf un modèle réservé dans un lancement
 * AUTOMATIQUE, qui part à son remplaçant. Sans précision, le lancement compte
 * comme automatique (le défaut prudent : jamais de crédits sans geste humain).
 */
export function modelePermis(
  modele: string | undefined,
  models: { id: string; label?: string }[] = [],
  contexte: { automatique?: boolean } = {},
): string | undefined {
  return modeleBanni(modele) && contexte.automatique !== false ? remplacantDUnBanni(models) : modele;
}

/**
 * CE LANCEMENT EST-IL AUTOMATIQUE ? Oui pour une carte qui n'est pas née d'un
 * geste humain (`origin` autre que « user », ou inconnue) et pour un agent du
 * démon sans carte (analyse, publication). Non pour une carte posée par
 * l'utilisateur, son cadrage, et la conversation d'un agent qu'il a ouverte.
 */
export function lancementAutomatique(ctx: {
  role: string;
  cardId?: string | null;
  carte?: { origin?: string | null } | null;
}): boolean {
  if (ctx.cardId || ctx.carte) return ctx.carte?.origin !== 'user';
  return ctx.role !== 'task';
}
