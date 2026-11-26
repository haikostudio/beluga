/**
 * LES TRAVAUX DES SERVICES DANS LA COLONNE DE GAUCHE (carte « Agents des services dans la colonne », 25/11/2026,
 * maquette #cdea). Un agent de service (Marketing, Studio…) quitte « En cours » dès la fin de son tour, alors que son
 * travail de fond continue : une étude marketing en chapitres, un export du Studio, un audit SEO + GEO, une sauvegarde.
 * Décisions de l'utilisateur : ces travaux paraissent dans « En cours » et sous leur projet, une ligne chacun (l'icône du
 * projet, la nature du travail et son avancement) ; un clic mène au service. FINI, la ligne reste EN GRAS, avec une
 * coche, jusqu'à ce qu'on ouvre l'écran du service — puis elle disparaît, sur tous les appareils du compte. Un travail
 * TOMBÉ (échec, arrêt, redémarrage du démon) sort de la liste : il ne passe jamais pour fini. Les contrôles éclair de la
 * surveillance n'y entrent pas.
 *
 * Le démon RELÈVE les travaux qui tournent (`server/src/travaux-des-services.ts`) ; ces règles disent ce que devient
 * la liste d'un relevé à l'autre, ce que voit un compte, ce que l'ouverture d'un écran marque « vu », et comment un
 * agent de service qui répond se FOND dans la ligne de son travail (une seule ligne, jamais deux).
 */

export type ServiceDuTravail = 'marketing' | 'studio' | 'referencement' | 'backups';
export type NatureDuTravail = 'etude' | 'pre-diagnostic' | 'video' | 'image' | 'audit' | 'sauvegarde';

export interface TravailDeService {
  /** Stable d'un relevé à l'autre : `<service>:<identifiant de la source>`. */
  id: string;
  service: ServiceDuTravail;
  projectId: string;
  nature: NatureDuTravail;
  /** Ce sur quoi il porte (dossier, création, site), s'il se distingue du projet. */
  objet?: string;
  /** L'écran du service, en fragment d'adresse sans « # » (`marketing/<dossier>`, `studio/<création>`, `backups/<site>`). */
  adresse: string;
  /** L'avancement : un compte (« 3 sur 10 ») ou un pourcentage. Absent : rien de mesurable. */
  faits?: number;
  total?: number;
  pourcent?: number;
  etat: 'en-cours' | 'termine';
  debut: number;
  fin?: number;
  /** Une référence opaque à la source (le passage d'un audit…), pour juger son issue. */
  source?: string;
}

/** Ce que le démon garde : le travail et les comptes qui l'ont vu fini. */
export interface TravailSuivi extends TravailDeService {
  vusPar?: string[];
}

/** Un travail fini et jamais vu ne reste pas plus d'une semaine (filet, comme les cartes déployées non ouvertes). */
export const DUREE_MAX_D_UN_TRAVAIL_FINI = 7 * 24 * 3600_000;

/**
 * LA LISTE SANS LE RÉCURRENT. La colonne ne montre que le ponctuel (décision de l'utilisateur, 25/11/2026) : un
 * travail jugé récurrent (`estRecurrent`, lu à sa source — ex. une sauvegarde de la tournée automatique) sort.
 * `null` quand rien ne sort, pour ne rien réécrire ni diffuser.
 */
export function sansLesTravauxRecurrents(suivis: readonly TravailSuivi[], estRecurrent: (travail: TravailSuivi) => boolean): TravailSuivi[] | null {
  const suite = suivis.filter((t) => !estRecurrent(t));
  return suite.length === suivis.length ? null : suite;
}

/** Ce qu'un travail qui ne tourne plus est devenu, lu à sa source. */
export type IssueDuTravail = 'termine' | 'tombe';

/**
 * LA LISTE APRÈS UN RELEVÉ. `courants` : ce qui tourne en ce moment. Un travail suivi en cours qui n'y est plus est
 * jugé à sa source (`issue`) : fini, il reste (gras) ; tombé, il sort. Un fini reste jusqu'à la semaine passée.
 */
export function suivreLesTravaux(
  suivis: readonly TravailSuivi[],
  courants: readonly TravailDeService[],
  issue: (travail: TravailSuivi) => IssueDuTravail,
  maintenant = Date.now(),
): TravailSuivi[] {
  const ici = new Map(courants.map((t) => [t.id, t]));
  const suite: TravailSuivi[] = [];
  for (const suivi of suivis) {
    if (ici.has(suivi.id)) continue;
    if (suivi.etat === 'termine') {
      if (maintenant - (suivi.fin ?? suivi.debut) < DUREE_MAX_D_UN_TRAVAIL_FINI) suite.push(suivi);
      continue;
    }
    if (issue(suivi) === 'termine') suite.push({ ...suivi, etat: 'termine', fin: maintenant, vusPar: [] });
  }
  /* Le DÉBUT d'un travail est celui du premier relevé qui l'a vu : une source qui ne le date pas ne le rajeunit pas. */
  const avant = new Map(suivis.map((t) => [t.id, t]));
  for (const courant of courants) suite.push({ ...courant, debut: Math.min(courant.debut, avant.get(courant.id)?.debut ?? courant.debut), etat: 'en-cours' });
  return suite.sort((a, b) => (b.fin ?? b.debut) - (a.fin ?? a.debut));
}

/** Ce que voit un compte : ce qui tourne, et ce qui est fini sans qu'il l'ait vu — sans la liste des comptes. */
export function travauxDuCompte(suivis: readonly TravailSuivi[], compteId: string, projets?: ReadonlySet<string> | null): TravailDeService[] {
  return suivis
    .filter((t) => (t.etat === 'en-cours' || !(t.vusPar ?? []).includes(compteId)) && (!projets || projets.has(t.projectId)))
    .map(({ vusPar: _vus, ...travail }) => travail);
}

/** Marque vus par ce compte les travaux FINIS nommés ; rend `null` quand rien ne change. */
export function marquerLesTravauxVus(suivis: readonly TravailSuivi[], ids: readonly string[], compteId: string): TravailSuivi[] | null {
  let change = false;
  const suite = suivis.map((t) => {
    if (t.etat !== 'termine' || !ids.includes(t.id) || (t.vusPar ?? []).includes(compteId)) return t;
    change = true;
    return { ...t, vusPar: [...(t.vusPar ?? []), compteId] };
  });
  return change ? suite : null;
}

/** Un fragment d'adresse sans « # » ni portée (`?projet=…`), sans « / » final. */
function sansDecor(fragment: string): string {
  return fragment.replace(/^#/, '').split('?')[0]!.replace(/\/+$/, '');
}

/** L'écran ouvert (`fragment`) est-il celui de ce travail, ou l'une de ses pages ? */
export function ecranDuTravail(travail: Pick<TravailDeService, 'adresse'>, fragment: string): boolean {
  const ici = sansDecor(fragment);
  const sien = sansDecor(travail.adresse);
  if (!sien) return false;
  return ici === sien || ici.startsWith(`${sien}/`) || ici.endsWith(`/${sien}`) || ici.includes(`/${sien}/`);
}

/** Les travaux FINIS que l'ouverture de cet écran marque vus. */
export function travauxVusALEcran(travaux: readonly TravailDeService[], fragment: string): string[] {
  return travaux.filter((t) => t.etat === 'termine' && ecranDuTravail(t, fragment)).map((t) => t.id);
}

/** L'avancement lisible : « 3 sur 10 », « 42 % », ou rien. */
export function avancementDuTravail(travail: Pick<TravailDeService, 'faits' | 'total' | 'pourcent' | 'etat'>): { faits: number; total: number } | { pourcent: number } | null {
  if (travail.etat !== 'en-cours') return null;
  if (typeof travail.total === 'number' && travail.total > 0 && typeof travail.faits === 'number') return { faits: Math.min(travail.faits, travail.total), total: travail.total };
  if (typeof travail.pourcent === 'number' && Number.isFinite(travail.pourcent)) return { pourcent: Math.max(0, Math.min(100, Math.round(travail.pourcent))) };
  return null;
}

/** Un agent de service sans carte, tel que la colonne le connaît. */
export interface AgentDuService {
  id: string;
  projectId: string;
  title?: string;
  attendReponse?: boolean;
  startedAt?: number;
  service: { id: string; adresse: string };
}

/** Une ligne de la colonne : un travail (agent qui répond éventuellement fondu dedans), ou un agent de service seul. */
export type LigneDeService =
  | { genre: 'travail'; id: string; travail: TravailDeService; agent: AgentDuService | null }
  | { genre: 'agent'; id: string; agent: AgentDuService; adresse: string };

/**
 * LES LIGNES DES SERVICES. Un agent qui répond et le travail de fond du MÊME écran ne font qu'UNE ligne (celle du
 * travail, qui dit son avancement ; l'agent y apporte sa question en attente). Un agent sans travail garde sa ligne.
 * Le plus récent en tête ; un travail fini (gras) après ce qui tourne.
 */
export function lignesDesServices(
  agents: readonly AgentDuService[],
  travaux: readonly TravailDeService[],
  adresseDeLAgent: (agent: AgentDuService) => string,
): LigneDeService[] {
  const pris = new Set<string>();
  const lignes: (LigneDeService & { quand: number; fini: boolean })[] = [];
  for (const travail of travaux) {
    const agent =
      travail.etat === 'en-cours'
        ? agents.find((a) => !pris.has(a.id) && a.projectId === travail.projectId && ecranDuTravail(travail, adresseDeLAgent(a))) ?? null
        : null;
    if (agent) pris.add(agent.id);
    lignes.push({ genre: 'travail', id: travail.id, travail, agent, quand: travail.fin ?? travail.debut, fini: travail.etat === 'termine' });
  }
  for (const agent of agents) {
    if (pris.has(agent.id)) continue;
    lignes.push({ genre: 'agent', id: `agent:${agent.id}`, agent, adresse: adresseDeLAgent(agent), quand: agent.startedAt ?? 0, fini: false });
  }
  return lignes
    .sort((a, b) => Number(a.fini) - Number(b.fini) || b.quand - a.quand)
    .map(({ quand: _q, fini: _f, ...ligne }) => ligne as LigneDeService);
}

/** La signature d'une liste : deux relevés identiques ne repartent pas vers les écrans. */
export function signatureDesTravaux(suivis: readonly TravailSuivi[]): string {
  return suivis.map((t) => `${t.id}|${t.etat}|${t.faits ?? ''}/${t.total ?? ''}|${t.pourcent ?? ''}|${(t.vusPar ?? []).join(',')}|${t.objet ?? ''}`).join(';');
}
