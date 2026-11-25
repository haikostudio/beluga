/**
 * L'HISTORIQUE D'UN AGENT DE SERVICE — les REPÈRES D'ÉVÉNEMENTS posés entre ses messages (carte « Sécurité : bilan,
 * écran et historique », 25/11/2026, maquette #3dc0).
 *
 * La conversation de l'agent d'un service (Sécurité, Surveillance, Sauvegardes, Marketing, Studio, Agents) montre ses
 * échanges ET ce qui s'est passé dans le service entre eux, même quand personne n'a écrit : un audit, une correction
 * lancée, une panne, une sauvegarde, une étude, un export. Chaque repère est une ligne fine datée, jamais une bulle.
 *
 * Ici : la forme d'un repère et sa mise en mots, la fusion des événements répétitifs (cent contrôles « debout » ne
 * font pas cent lignes), et la mise en texte compacte que l'agent relit par l'outil `historique_du_service`. La
 * lecture des tables vit au démon (`server/src/historique-de-service.ts`).
 */

/** L'icône d'un repère (un nom d'icône de l'interface). */
export type IconeDeRepere = 'audit' | 'correction' | 'panne' | 'retabli' | 'sauvegarde' | 'echec' | 'etude' | 'export' | 'agent';

/** Un événement daté du service, posé entre les messages de son agent. */
export interface RepereDeService {
  /** Unique dans le fil (sert de clé d'affichage). */
  id: string;
  /** Quand c'est arrivé (ms). */
  le: number;
  icone: IconeDeRepere;
  /** La phrase, en mots courants (« Audit de la semaine · 8 points à traiter »). */
  texte: string;
  /** Un repère qui alerte (panne, échec, point grave) : sa phrase prend la teinte importante. */
  alerte?: boolean;
}

/** Le plafond de repères rendus à l'écran ou à l'agent en une fois. */
export const PLAFOND_DES_REPERES = 300;

/** Les repères triés du plus ancien au plus récent, sans doublon d'identifiant, plafonnés aux plus récents. */
export function reperesTries(reperes: readonly RepereDeService[], plafond = PLAFOND_DES_REPERES): RepereDeService[] {
  const vus = new Set<string>();
  const uniques = reperes.filter((r) => Number.isFinite(r.le) && !vus.has(r.id) && (vus.add(r.id), true));
  uniques.sort((a, b) => a.le - b.le || a.id.localeCompare(b.id));
  return uniques.slice(Math.max(0, uniques.length - plafond));
}

/**
 * LES CONTRÔLES D'UN SITE SURVEILLÉ deviennent des TRANSITIONS : seule la panne (le premier contrôle « panne » après un
 * « ok ») et le rétablissement (le premier « ok » après une panne) font un repère. Les contrôles doivent être triés du
 * plus ancien au plus récent.
 */
export function transitionsDeSurveillance(
  controles: readonly { instant: number; etat: string; raison?: string | null }[],
  idDuSite: string,
): RepereDeService[] {
  const sortie: RepereDeService[] = [];
  let avant: 'ok' | 'panne' | null = null;
  for (const c of controles) {
    const etat = c.etat === 'panne' ? 'panne' : 'ok';
    if (etat !== avant && avant !== null) {
      sortie.push(
        etat === 'panne'
          ? { id: `surv:${idDuSite}:${c.instant}`, le: c.instant, icone: 'panne', texte: `Le site est tombé${c.raison ? ` · ${c.raison}` : ''}`, alerte: true }
          : { id: `surv:${idDuSite}:${c.instant}`, le: c.instant, icone: 'retabli', texte: 'Le site répond de nouveau' },
      );
    }
    avant = etat;
  }
  return sortie;
}

/** « 1 point », « 8 points ». */
export function nPoints(n: number): string {
  return `${n} point${n > 1 ? 's' : ''}`;
}

/** La phrase d'un audit de sécurité : son déclencheur, puis ce qui reste à traiter. */
export function phraseDAudit(declencheur: string, aTraiter: number | null, erreur?: string | null): string {
  const quoi =
    declencheur === 'hebdo'
      ? 'Audit de la semaine'
      : declencheur === 'apres-mise-en-ligne'
        ? 'Audit après la mise en ligne'
        : declencheur === 'ajout'
          ? 'Premier audit'
          : declencheur === 'etude'
            ? 'Étude de sécurité'
            : 'Audit à la demande';
  if (aTraiter === null) return `${quoi} · impossible${erreur ? ` (${erreur.slice(0, 80)})` : ''}`;
  return `${quoi} · ${aTraiter ? `${nPoints(aTraiter)} à traiter` : 'rien à traiter'}`;
}

/**
 * L'HISTORIQUE EN TEXTE COMPACT pour l'agent (outil `historique_du_service`) : une ligne datée par message ou par
 * repère, les messages longs coupés. Le plus ancien en premier.
 */
export function historiqueEnTexte(
  elements: readonly ({ genre: 'message'; le: number; role: string; texte: string } | { genre: 'repere'; le: number; texte: string })[],
  plafondParMessage = 600,
): string {
  if (!elements.length) return 'Aucun échange ni événement sur cette période.';
  const date = (le: number) => new Date(le).toISOString().slice(0, 16).replace('T', ' ');
  return elements
    .map((e) => {
      if (e.genre === 'repere') return `[${date(e.le)}] — ${e.texte}`;
      const qui = e.role === 'user' ? 'Utilisateur' : e.role === 'assistant' ? 'Toi (agent)' : 'Système';
      const t = e.texte.replace(/\s+/g, ' ').trim();
      return `[${date(e.le)}] ${qui} : ${t.length > plafondParMessage ? `${t.slice(0, plafondParMessage - 1)}…` : t}`;
    })
    .join('\n');
}

/** Un mot de recherche trouvé dans un texte, sans accent ni casse. */
export function contientLesMots(texte: string, mots: string): boolean {
  const aplatir = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const t = aplatir(texte);
  return aplatir(mots)
    .split(/\s+/)
    .filter(Boolean)
    .every((m) => t.includes(m));
}
