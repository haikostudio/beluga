import { Card } from './models.js';

/**
 * La carte, entre la BASE et le MODÈLE.
 *
 * Historiquement, une carte tenait dans une seule colonne fourre-tout `data`,
 * en JSON : rien ne pouvait être filtré, trié ni compté sans relire et décoder
 * chaque ligne. Les champs STABLES sont désormais de vraies colonnes SQL, les
 * listes VARIABLES (étiquettes, pièces jointes) vivent dans leurs tables filles,
 * et le JSON résiduel ne garde que le vraiment libre : les objets imbriqués qui
 * n'ont pas de forme fixe (chiffrage, consommation, planification, facturation,
 * suivi GitHub).
 *
 * Les deux sens de la traduction vivent ici, sans base ni disque, donc ils se
 * testent seuls (`server/src/test/carte-sql.test.ts`).
 */

/**
 * Les champs qui ont QUITTÉ le JSON : colonne de la table `cards` ou table
 * fille. Écrire une carte les retire du bloc `data` — c'est ce qui garantit
 * qu'il n'existe plus deux versions d'une même valeur.
 */
export const CHAMPS_SORTIS_DU_JSON = [
  'id',
  'projectId',
  'title',
  'description',
  'labels',
  'column',
  'position',
  'origin',
  'attachments',
  'run',
  'analyseDemandee',
  'codeDejaEnregistre',
  'horsTache',
  'excludedFromDeploy',
  'agentId',
  'conversationAgentId',
  'doneAt',
  'archivedAt',
  'lastReadAt',
  'deployedAt',
  'createdAt',
  'updatedAt',
] as const;

/** Une ligne de la table `cards`, telle que SQLite la rend. */
export interface LigneCarte {
  id: string;
  project_id: string;
  column_key: string;
  position: number;
  title: string;
  data: string;
  created_at: number;
  updated_at: number;
  deployed_at?: number | null;
  description?: string | null;
  origin?: string | null;
  agent_id?: string | null;
  conversation_agent_id?: string | null;
  analyse_demandee?: number | null;
  code_deja_enregistre?: number | null;
  hors_tache?: number | null;
  excluded_from_deploy?: number | null;
  done_at?: number | null;
  archived_at?: number | null;
  last_read_at?: number | null;
  run_engine?: string | null;
  run_model?: string | null;
  run_thinking?: string | null;
  run_mode?: string | null;
}

/** Les valeurs à écrire dans les colonnes de `cards`, hors listes filles. */
export interface ColonnesCarte {
  id: string;
  project_id: string;
  column_key: string;
  position: number;
  title: string;
  data: string;
  created_at: number;
  updated_at: number;
  deployed_at: number | null;
  description: string;
  origin: string;
  agent_id: string | null;
  conversation_agent_id: string | null;
  analyse_demandee: number;
  code_deja_enregistre: number;
  hors_tache: number;
  excluded_from_deploy: number;
  done_at: number | null;
  archived_at: number | null;
  last_read_at: number | null;
  run_engine: string;
  run_model: string | null;
  run_thinking: string;
  run_mode: string;
}

/**
 * Ce qui RESTE dans le bloc `data` : tout ce qui n'a pas sa colonne. On ne
 * liste pas ce qu'on garde — on retire ce qui est parti, pour qu'un champ neuf
 * ajouté au modèle continue d'être conservé sans rien casser.
 */
export function resteLibreDeLaCarte(card: Card): Record<string, unknown> {
  const reste: Record<string, unknown> = { ...(card as unknown as Record<string, unknown>) };
  for (const champ of CHAMPS_SORTIS_DU_JSON) delete reste[champ];
  for (const [clef, valeur] of Object.entries(reste)) if (valeur === undefined) delete reste[clef];
  /*
   * LE RÉGLAGE A QUATRE COLONNES, MAIS SIX CHAMPS. Le moteur, le modèle, la
   * réflexion et le mode sont sortis en colonnes ; le NIVEAU (l'ambition
   * retenue pour l'exécution) et le COMPTE imposé n'en ont pas. Sortir `run`
   * en bloc les effaçait à chaque écriture : une carte cadrée « approfondi »
   * repartait au palier par défaut, et un compte choisi à la main était oublié.
   * On garde donc ici les seuls champs SANS colonne, jamais les autres — qui se
   * contrediraient avec elles.
   */
  const sansColonne: Record<string, unknown> = {};
  if (card.run.niveau !== undefined) sansColonne.niveau = card.run.niveau;
  if (card.run.account !== undefined) sansColonne.account = card.run.account;
  if (Object.keys(sansColonne).length) reste.run = sansColonne;
  return reste;
}

/** La carte découpée en colonnes, prête pour l'écriture. */
export function colonnesDeLaCarte(card: Card): ColonnesCarte {
  return {
    id: card.id,
    project_id: card.projectId,
    column_key: card.column,
    position: card.position,
    title: card.title,
    data: JSON.stringify(resteLibreDeLaCarte(card)),
    created_at: card.createdAt,
    updated_at: card.updatedAt,
    deployed_at: card.deployedAt ?? null,
    description: card.description,
    origin: card.origin,
    agent_id: card.agentId ?? null,
    conversation_agent_id: card.conversationAgentId ?? null,
    analyse_demandee: card.analyseDemandee ? 1 : 0,
    code_deja_enregistre: card.codeDejaEnregistre ? 1 : 0,
    hors_tache: card.horsTache ? 1 : 0,
    excluded_from_deploy: card.excludedFromDeploy ? 1 : 0,
    done_at: card.doneAt ?? null,
    archived_at: card.archivedAt ?? null,
    last_read_at: card.lastReadAt ?? null,
    run_engine: card.run.engine,
    run_model: card.run.model ?? null,
    run_thinking: card.run.thinking,
    run_mode: card.run.mode,
  };
}

function resteDeLaLigne(data: string | null | undefined): Record<string, unknown> {
  if (!data) return {};
  try {
    const lu = JSON.parse(data);
    return lu && typeof lu === 'object' ? (lu as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * La carte reconstituée depuis sa ligne, ses étiquettes et ses pièces jointes.
 *
 * Une colonne VIDE (NULL) n'écrase jamais le JSON : une ligne écrite par un
 * outil extérieur — un script de vérification qui pose une carte d'essai avec
 * son seul bloc `data` — se relit donc entière. C'est la colonne qui fait foi
 * dès qu'elle est renseignée.
 */
export function carteDepuisLigne(
  ligne: LigneCarte,
  listes: { labels?: string[]; attachments?: string[] } = {},
): Card {
  const reste = resteDeLaLigne(ligne.data);
  const texte = (colonne: string | null | undefined, clef: string) => colonne ?? reste[clef];
  const nombre = (colonne: number | null | undefined, clef: string) => colonne ?? reste[clef];
  const drapeau = (colonne: number | null | undefined, clef: string) =>
    colonne == null ? reste[clef] : colonne !== 0;
  const run = (reste.run ?? {}) as Record<string, unknown>;
  const labels = listes.labels?.length ? listes.labels : reste.labels;
  const attachments = listes.attachments?.length ? listes.attachments : reste.attachments;

  return Card.parse({
    ...reste,
    id: ligne.id,
    projectId: ligne.project_id,
    column: ligne.column_key,
    position: ligne.position,
    title: ligne.title,
    createdAt: ligne.created_at,
    updatedAt: ligne.updated_at,
    description: texte(ligne.description, 'description'),
    origin: texte(ligne.origin, 'origin'),
    labels: labels ?? [],
    attachments: attachments ?? [],
    /*
     * QUATRE COLONNES, MAIS LE RÉGLAGE EN COMPTE SIX. Le moteur, le modèle, la
     * réflexion et le mode ont chacun leur colonne ; le NIVEAU (l'ambition
     * retenue pour l'exécution) et le COMPTE imposé n'en ont pas et vivent dans
     * le bloc `data`. Les recopier d'abord est ce qui les garde : sans ce
     * `...run`, une carte relue perdait le palier écrit sur elle, et repartait
     * au palier par défaut.
     */
    run: {
      ...run,
      engine: ligne.run_engine ?? run.engine,
      model: ligne.run_model ?? run.model,
      thinking: ligne.run_thinking ?? run.thinking,
      mode: ligne.run_mode ?? run.mode,
    },
    analyseDemandee: drapeau(ligne.analyse_demandee, 'analyseDemandee'),
    codeDejaEnregistre: drapeau(ligne.code_deja_enregistre, 'codeDejaEnregistre'),
    horsTache: drapeau(ligne.hors_tache, 'horsTache'),
    excludedFromDeploy: drapeau(ligne.excluded_from_deploy, 'excludedFromDeploy'),
    agentId: texte(ligne.agent_id, 'agentId'),
    conversationAgentId: texte(ligne.conversation_agent_id, 'conversationAgentId'),
    doneAt: nombre(ligne.done_at, 'doneAt'),
    deployedAt: nombre(ligne.deployed_at, 'deployedAt'),
    archivedAt: nombre(ligne.archived_at, 'archivedAt'),
    lastReadAt: nombre(ligne.last_read_at, 'lastReadAt'),
  });
}
