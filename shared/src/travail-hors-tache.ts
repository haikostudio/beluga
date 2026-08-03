/**
 * Le travail de code fait SANS carte.
 *
 * Un agent — le chef d'orchestre le plus souvent — peut enregistrer des
 * modifications alors qu'aucune carte n'existe. Elles n'apparaissaient que
 * comme « changements enregistrés sans carte » dans le bloc de publication, et
 * pouvaient partir en ligne sans avoir jamais eu de fiche : ni titre, ni
 * conversation, ni trace dans l'historique.
 *
 * On leur fabrique donc une carte, posée directement dans « À déployer » — le
 * travail est fait, il n'y a rien à valider.
 *
 * Le dossier est PARTAGÉ : un commit peut venir d'un autre agent, d'une
 * récupération depuis le dépôt, ou de la plomberie de la publication. Les
 * règles ci-dessous trient tout cela, sans base ni disque : elles se testent
 * seules.
 */

export interface CommitObserve {
  sha: string;
  /** La première ligne du message enregistré. */
  titre: string;
  /** La branche sur laquelle il a été posé. */
  branche?: string;
  /** Vrai s'il s'agit d'une fusion (deux parents). */
  fusion?: boolean;
  date?: string;
}

export interface ContexteHorsTache {
  /** Les empreintes déjà rattachées à une carte : jamais deux fois la même. */
  shasCouverts?: string[];
  /** Les branches déjà rattachées à une carte (« tache/… » et compagnie). */
  branchesDeCartes?: string[];
}

/**
 * Une branche de tâche appartient déjà à une carte, même si cette carte est
 * ailleurs dans le tableau : rien à créer.
 */
export function brancheDeTache(branche?: string): boolean {
  return !!branche && /^tache\//.test(branche);
}

/**
 * La plomberie de la publication n'est pas du travail : ces enregistrements
 * sont posés par le publieur lui-même, pas par quelqu'un qui a codé.
 */
const PLOMBERIE = [
  /^Publication\s*:/i,
  /^Travaux en cours enregistrés avant publication/i,
  /^Merge (branch|remote-tracking|pull request)/i,
  /^Revert "Publication/i,
];

export function estPlomberie(titre: string): boolean {
  const propre = titre.trim();
  return PLOMBERIE.some((motif) => motif.test(propre));
}

/**
 * Ce qui, dans ce qu'on vient d'observer, mérite une carte.
 *
 * Un commit est retenu s'il a été posé pendant le tour d'un agent de HaikoDev
 * (c'est l'appelant qui borne la fenêtre), qu'il ne porte pas déjà de carte, et
 * qu'il n'est ni une fusion ni un geste de publication.
 */
export function commitsSansCarte(commits: CommitObserve[], ctx: ContexteHorsTache = {}): CommitObserve[] {
  const couverts = new Set((ctx.shasCouverts ?? []).map((sha) => sha.trim()).filter(Boolean));
  const branches = new Set(ctx.branchesDeCartes ?? []);
  const vus = new Set<string>();

  return commits.filter((commit) => {
    const sha = commit.sha?.trim();
    if (!sha || vus.has(sha)) return false;
    if (couverts.has(sha)) return false;
    if (commit.fusion) return false;
    if (estPlomberie(commit.titre ?? '')) return false;
    if (brancheDeTache(commit.branche) || (commit.branche && branches.has(commit.branche))) return false;
    vus.add(sha);
    return true;
  });
}

/**
 * Le titre de la carte, repris du message enregistré. Plusieurs commits : le
 * premier donne le titre, et le nombre dit le reste — un titre à rallonge se
 * lit moins bien qu'un titre franc suivi d'une liste.
 */
export function titreHorsTache(commits: CommitObserve[]): string {
  const premier = commits[0]?.titre?.trim() || 'Travail enregistré sans carte';
  const titre = premier.length > 90 ? `${premier.slice(0, 88)}…` : premier;
  return commits.length > 1 ? `${titre} (+${commits.length - 1})` : titre;
}

/**
 * Le nom de la branche qui portera ce travail.
 *
 * Une fonctionnalité qui vit sur SA branche se retire d'un geste : il suffit de
 * supprimer sa carte, la branche n'est jamais fusionnée. Le nom reprend le
 * message enregistré pour rester lisible dans `git branch`, et se termine par
 * l'empreinte courte — deux travaux au même titre ne se marchent pas dessus.
 */
export function nomBrancheHorsTache(commits: CommitObserve[]): string {
  const base = (commits[0]?.titre ?? 'travail')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  const empreinte = (commits[commits.length - 1]?.sha ?? '').slice(0, 7) || 'sans-sha';
  return `hors-tache/${base || 'travail'}-${empreinte}`;
}

/** La description de la carte : d'où elle vient, et ce qu'elle embarque. */
export function descriptionHorsTache(commits: CommitObserve[], auteur: string, branche?: string): string {
  const lignes = commits.map((commit) => `- ${commit.titre.trim()} (${commit.sha.slice(0, 7)})`);
  return [
    `Travail enregistré hors tâche par « ${auteur} » : cette carte a été créée automatiquement pour qu'il ne parte jamais en ligne sans fiche.`,
    '',
    ...(branche
      ? [
          `Ce travail vit sur sa propre branche « ${branche} » : supprimer cette carte suffit à l'écarter, il ne partira jamais en ligne.`,
          '',
        ]
      : [
          'ATTENTION : ce travail n’a PAS pu être mis sur sa propre branche (il était déjà envoyé au dépôt, ou le dossier avait bougé). Il est posé sur la branche principale — le retirer demande d’annuler les enregistrements, pas seulement de supprimer la carte.',
          '',
        ]),
    'Enregistrements repris :',
    ...lignes,
  ].join('\n');
}
