import crypto from 'node:crypto';
import {
  DELAI_PARCOURS_MS,
  DELAI_REPONSE_MS,
  RECETTE_APPEL,
  SITES_MAX,
  type ControleSurveillance,
  type EtapeParcours,
  type RecetteSurveillance,
  type SiteSurveille,
  type VerdictSite,
  bascule,
  bornerPeriode,
  dejaSurveille,
  doitVerifier,
  jugerAdresse,
  jugerRecetteSurveillance,
  jugerReponse,
  libelleEtape,
  limiteHistorique,
  recetteDeLigne,
  texteAlerte,
  echecsDeSuiteDuSite,
  ECHECS_AVANT_DEPANNAGE,
  decisionDeCourrielDePanne,
  doitApaiserParCourriel,
  type GenreDeCourriel,
} from '@beluga/shared';
import { getDb } from './db.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { notify } from './notify.js';
import { listerAcces } from './coffre-fort.js';

/**
 * LA SURVEILLANCE DES SITES — les passages, l'historique et le rangement.
 *
 * Les règles qui se décident sans base ni réseau vivent dans
 * `shared/src/surveillance.ts` : ce qui fait une panne, ce qu'une recette doit
 * valoir, la frise des 24 heures. Ici : la table, les appels, les parcours dans
 * un vrai navigateur, l'historique et l'alerte.
 *
 * QUATRE PRINCIPES QUI NE BOUGENT PAS.
 *
 *  1. **UNE ALERTE PAR CHUTE, PAS UNE PAR PASSAGE.** Seule la BASCULE pousse une
 *     notification. Le retour à la normale ne pousse rien.
 *  2. **AUCUN PASSAGE NE PEUT FAIRE TOMBER LE DÉMON.** Un site injoignable est un
 *     RÉSULTAT, pas une exception ; un parcours qui traîne est coupé à
 *     `DELAI_PARCOURS_MS`.
 *  3. **JAMAIS DEUX PASSAGES DU MÊME SITE EN MÊME TEMPS**, et au plus
 *     `PARCOURS_SIMULTANES` navigateurs ouverts à la fois.
 *  4. **LES CONTRÔLES TOURNENT SANS AGENT.** L'agent écrit la recette ; chaque
 *     passage la rejoue seul, sans dépense.
 *  5. **TROIS ÉCHECS D'AFFILÉE OUVRENT UNE CARTE**, et c'est la SEULE dépense
 *     que la surveillance engage d'elle-même (`depannage-site.ts`). Elle
 *     s'arrête au plan : rien n'est corrigé sans l'utilisateur.
 */

interface LigneSite {
  id: string;
  url: string;
  nom: string;
  etat: string;
  code: number | null;
  raison: string | null;
  verifie_le: number;
  depuis: number;
  derniere_panne: number;
  cree_le: number;
  recette: string | null;
  periode_ms: number | null;
  duree_ms: number | null;
  etape_echouee: string | null;
  agent_id: string | null;
  project_id: string | null;
  card_id: string | null;
  projet_rattache: string | null;
  projet_devine: number | null;
  incident_card_id: string | null;
  incident_depuis: number | null;
  incident_lance_le: number | null;
  alerte_courriel_le: number | null;
  alerte_courriel_depuis: number | null;
}

function depuisLigne(ligne: LigneSite): SiteSurveille {
  return {
    id: ligne.id,
    url: ligne.url,
    nom: ligne.nom,
    etat: (ligne.etat as SiteSurveille['etat']) ?? 'inconnu',
    code: ligne.code ?? undefined,
    raison: (ligne.raison as SiteSurveille['raison']) ?? undefined,
    etapeEchouee: ligne.etape_echouee ?? undefined,
    verifieLe: ligne.verifie_le,
    depuis: ligne.depuis,
    dernierePanne: ligne.derniere_panne,
    creeLe: ligne.cree_le,
    // Une ligne reprise d'avant les recettes redevient un simple appel.
    recette: recetteDeLigne(ligne.recette),
    periodeMs: bornerPeriode(ligne.periode_ms),
    dureeMs: ligne.duree_ms ?? undefined,
    agentId: ligne.agent_id ?? undefined,
    projectId: ligne.project_id ?? undefined,
    cardId: ligne.card_id ?? undefined,
    projetRattache: ligne.projet_rattache ?? undefined,
    projetDevine: ligne.projet_devine ? true : undefined,
    incidentCardId: ligne.incident_card_id ?? undefined,
    incidentDepuis: ligne.incident_depuis ?? undefined,
    incidentLanceLe: ligne.incident_lance_le ?? undefined,
    alerteCourrielLe: ligne.alerte_courriel_le ?? undefined,
    alerteCourrielDepuis: ligne.alerte_courriel_depuis ?? undefined,
  };
}

/** Toutes les surveillances : les tombées d'abord, puis par date d'ajout. */
export function listerSites(): SiteSurveille[] {
  const lignes = getDb()
    .prepare('SELECT * FROM sites_surveilles ORDER BY cree_le ASC')
    .all() as LigneSite[];
  const sites = lignes.map(depuisLigne);
  // Ce qui ne va pas se lit en premier : c'est la seule raison d'ouvrir cette
  // fenêtre quand la pastille est allumée.
  return [...sites.filter((s) => s.etat === 'panne'), ...sites.filter((s) => s.etat !== 'panne')];
}

export function lireSurveillance(id: string): SiteSurveille | null {
  const ligne = getDb().prepare('SELECT * FROM sites_surveilles WHERE id = ?').get(id) as LigneSite | undefined;
  return ligne ? depuisLigne(ligne) : null;
}

/** Prévenir les onglets ouverts : la pastille et la liste suivent sans recharger. */
function diffuser(): void {
  bus.emit({ type: 'surveillance', sites: listerSites() });
}

export type AjoutSite = { ok: true; site: SiteSurveille } | { ok: false; raison: string };

/**
 * Ajoute une adresse en simple appel. L'écran ne l'offre plus (l'ajout passe
 * par l'agent) ; la commande reste pour les essais et les reprises.
 */
export function ajouterSite(brutUrl: unknown, brutNom?: unknown, maintenant = Date.now()): AjoutSite {
  const resultat = enregistrerSurveillance({ url: brutUrl, nom: brutNom, recette: RECETTE_APPEL }, maintenant);
  return resultat.ok ? { ok: true, site: resultat.site } : resultat;
}

export type EnregistrementSurveillance =
  | { ok: true; site: SiteSurveille; cree: boolean }
  | { ok: false; raison: string };

/**
 * CRÉE OU MODIFIE UNE SURVEILLANCE. Sans « id », une nouvelle ligne naît ; avec,
 * ce qui n'est pas redit est CONSERVÉ. L'état, sa date et la dernière panne ne
 * sont jamais touchés ici : seul un passage les écrit, et la surveillance est
 * rejouée tout de suite en tâche de fond.
 */
export function enregistrerSurveillance(
  entree: {
    id?: string;
    url?: unknown;
    nom?: unknown;
    recette?: unknown;
    periodeMs?: unknown;
    agentId?: string;
    projectId?: string;
    cardId?: string;
  },
  maintenant = Date.now(),
): EnregistrementSurveillance {
  const ancienne = entree.id ? lireSurveillance(entree.id) : null;
  if (entree.id && !ancienne) return { ok: false, raison: `Aucune surveillance ne porte l'identifiant « ${entree.id} ».` };

  const juge = jugerAdresse(entree.url ?? ancienne?.url, entree.nom ?? ancienne?.nom);
  if (!juge.ok) return { ok: false, raison: juge.raison };

  let recette: RecetteSurveillance = ancienne?.recette ?? RECETTE_APPEL;
  if (entree.recette !== undefined) {
    const avis = jugerRecetteSurveillance(entree.recette);
    if (!avis.ok) return { ok: false, raison: `Recette refusée : ${avis.raison}.` };
    recette = avis.recette;
  }
  const periodeMs = bornerPeriode(entree.periodeMs ?? ancienne?.periodeMs);

  const existants = listerSites();
  if (!ancienne && existants.length >= SITES_MAX)
    return { ok: false, raison: `Pas plus de ${SITES_MAX} surveillances.` };
  if (dejaSurveille(existants, juge.url, ancienne?.id)) return { ok: false, raison: 'Cette adresse est déjà surveillée.' };

  const db = getDb();
  let id: string;
  if (ancienne) {
    id = ancienne.id;
    db.prepare(
      `UPDATE sites_surveilles SET url = ?, nom = ?, recette = ?, periode_ms = ?,
         agent_id = COALESCE(?, agent_id), project_id = COALESCE(?, project_id), card_id = COALESCE(?, card_id)
       WHERE id = ?`,
    ).run(juge.url, juge.nom, JSON.stringify(recette), periodeMs, entree.agentId ?? null, entree.projectId ?? null, entree.cardId ?? null, id);
    log.info(`surveillance : « ${juge.nom} » modifiée`);
  } else {
    id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO sites_surveilles (id, url, nom, etat, verifie_le, depuis, derniere_panne, cree_le, recette, periode_ms, agent_id, project_id, card_id)
       VALUES (?, ?, ?, 'inconnu', 0, ?, 0, ?, ?, ?, ?, ?, ?)`,
    ).run(id, juge.url, juge.nom, maintenant, maintenant, JSON.stringify(recette), periodeMs, entree.agentId ?? null, entree.projectId ?? null, entree.cardId ?? null);
    log.info(`surveillance : « ${juge.nom} » ajoutée (${juge.url})`);
  }
  diffuser();
  // Ajouter ou modifier puis attendre le passage suivant serait une fenêtre qui ne dit rien.
  void verifierSites([id]);
  return { ok: true, site: lireSurveillance(id)!, cree: !ancienne };
}

/** Retient la conversation d'agent qui travaille sur cette surveillance, dès son départ. */
export function marquerAssistantSurveillance(id: string, depart: { agentId: string; projectId: string; cardId: string }): void {
  getDb()
    .prepare('UPDATE sites_surveilles SET agent_id = ?, project_id = ?, card_id = ? WHERE id = ?')
    .run(depart.agentId, depart.projectId, depart.cardId, id);
  diffuser();
}

/* ------------------------------------------------------------------ */
/* Le projet du site, et sa panne en cours                              */
/* ------------------------------------------------------------------ */

/**
 * LE PROJET CHOISI À LA MAIN SUR LA FICHE DU SITE — le dépôt qui SERT ce site,
 * jamais l'endroit où vit la conversation de l'agent de configuration
 * (`project_id`). `null` remet la fiche « à deviner d'après l'adresse » : le
 * rattachement automatique reprend alors la main au passage suivant.
 */
export function rattacherLeProjetDuSite(siteId: string, projectId: string | null): void {
  const res = getDb()
    .prepare('UPDATE sites_surveilles SET projet_rattache = ?, projet_devine = 0 WHERE id = ?')
    .run(projectId, siteId);
  if (!res.changes) throw new Error('surveillance introuvable');
  diffuser();
}

/** Écrit le projet DEVINÉ d'après l'adresse (`depannage-site.ts`). */
export function ecrireProjetDevine(siteId: string, projectId: string | null): void {
  getDb()
    .prepare('UPDATE sites_surveilles SET projet_rattache = ?, projet_devine = ? WHERE id = ?')
    .run(projectId, projectId ? 1 : 0, siteId);
  diffuser();
}

/**
 * NOTE LE DÉPANNAGE EN COURS. La date de lancement est posée AVANT le tour de
 * l'agent : un tour qui tombe ne relance pas une carte à chaque contrôle, et
 * l'écart minimal de six heures se tient sur cette date.
 */
export function marquerIncidentDuSite(siteId: string, cardId: string | null, maintenant = Date.now()): void {
  getDb()
    .prepare(
      `UPDATE sites_surveilles
          SET incident_card_id = ?, incident_depuis = COALESCE(incident_depuis, ?), incident_lance_le = ?
        WHERE id = ?`,
    )
    .run(cardId, maintenant, maintenant, siteId);
  diffuser();
}

/**
 * REFERME L'INCIDENT : le site répond de nouveau, la panne est terminée. La
 * date du dernier lancement n'est PAS effacée — c'est elle qui tient l'écart
 * minimal de six heures pour un site qui clignote.
 */
export function refermerIncidentDuSite(siteId: string): void {
  getDb()
    .prepare('UPDATE sites_surveilles SET incident_card_id = NULL, incident_depuis = NULL WHERE id = ?')
    .run(siteId);
}

/**
 * NOTE LE COURRIEL D'ALERTE, AVANT DE L'ENVOYER. Comme `incident_lance_le` : un
 * envoi que Resend refuse ne doit pas repartir au contrôle suivant, et le rappel
 * de six heures se compte sur cette date. `alerte_courriel_depuis` garde le
 * DÉBUT de la panne annoncée — le premier courriel le pose, les rappels le
 * laissent tel quel.
 */
export function marquerAlerteCourrielDuSite(siteId: string, panneDepuis: number, maintenant = Date.now()): void {
  getDb()
    .prepare(
      `UPDATE sites_surveilles
          SET alerte_courriel_le = ?, alerte_courriel_depuis = COALESCE(alerte_courriel_depuis, ?)
        WHERE id = ?`,
    )
    .run(maintenant, panneDepuis || maintenant, siteId);
}

/**
 * OUBLIE LE COURRIEL D'ALERTE : le site répond de nouveau. Les deux dates
 * partent ENSEMBLE et TOUT DE SUITE — avant même que le mot d'apaisement soit
 * écrit — pour qu'une tournée suivante ne l'écrive pas une seconde fois.
 */
export function refermerAlerteCourrielDuSite(siteId: string): void {
  getDb()
    .prepare('UPDATE sites_surveilles SET alerte_courriel_le = NULL, alerte_courriel_depuis = NULL WHERE id = ?')
    .run(siteId);
}

/** Retire une surveillance et son historique. La pastille se recalcule aussitôt. */
export function supprimerSite(id: string): { ok: boolean; raison?: string } {
  const db = getDb();
  const res = db.prepare('DELETE FROM sites_surveilles WHERE id = ?').run(id);
  if (!res.changes) return { ok: false, raison: 'Adresse introuvable.' };
  db.prepare('DELETE FROM controles_surveillance WHERE site_id = ?').run(id);
  diffuser();
  return { ok: true };
}

interface LigneControle {
  site_id: string;
  instant: number;
  etat: string;
  raison: string | null;
  code: number | null;
  duree_ms: number;
  etape: string | null;
  detail: string | null;
}

/** Les passages d'une surveillance sur les dernières 24 heures, du plus ancien au plus récent. */
export function listerControles(siteId: string, maintenant = Date.now()): ControleSurveillance[] {
  const lignes = getDb()
    .prepare('SELECT * FROM controles_surveillance WHERE site_id = ? AND instant >= ? ORDER BY instant ASC')
    .all(siteId, limiteHistorique(maintenant)) as LigneControle[];
  return lignes.map((l) => ({
    siteId: l.site_id,
    instant: l.instant,
    etat: l.etat === 'ok' ? 'ok' : 'panne',
    raison: (l.raison as ControleSurveillance['raison']) ?? undefined,
    code: l.code ?? undefined,
    dureeMs: l.duree_ms,
    etape: l.etape ?? undefined,
    detail: l.detail ?? undefined,
  }));
}

/** Efface ce qui dépasse 24 heures : la base ne grossit pas avec le temps. */
export function purgerHistorique(maintenant = Date.now()): number {
  return getDb().prepare('DELETE FROM controles_surveillance WHERE instant < ?').run(limiteHistorique(maintenant)).changes;
}

/* ------------------------------------------------------------------ */
/* Jouer une recette                                                    */
/* ------------------------------------------------------------------ */

/** On lit au plus le premier mégaoctet, largement de quoi trancher. Rien n'est gardé. */
const TAILLE_LUE_MAX = 1_000_000;

async function appeler(url: string, motAttendu?: string): Promise<VerdictSite> {
  const controle = new AbortController();
  const minuteur = setTimeout(() => controle.abort(), DELAI_REPONSE_MS);
  try {
    const reponse = await fetch(url, {
      redirect: 'follow',
      signal: controle.signal,
      headers: { 'user-agent': 'Beluga Build-surveillance/1.0', accept: '*/*' },
    });
    let taille = 0;
    let motTrouve: boolean | undefined;
    try {
      const contenu = (await reponse.text()).slice(0, TAILLE_LUE_MAX);
      taille = contenu.trim().length;
      if (motAttendu) motTrouve = contenu.toLowerCase().includes(motAttendu.toLowerCase());
    } catch {
      // Un corps illisible sur une réponse correcte ne fait pas une panne : le
      // serveur a répondu, c'est ce qu'on mesure.
      taille = reponse.ok ? 1 : 0;
    }
    const verdict = jugerReponse({ statut: reponse.status, taille, motTrouve });
    return verdict.raison === 'contenu' ? { ...verdict, detail: `« ${motAttendu} » absent de la page` } : verdict;
  } catch (err) {
    const abandon = (err as { name?: string })?.name === 'AbortError';
    return jugerReponse(abandon ? { delaiDepasse: true } : { erreur: String(err).slice(0, 200) });
  } finally {
    clearTimeout(minuteur);
  }
}

/*
 * LE NAVIGATEUR DES PARCOURS : un seul Chrome du système, partagé, ouvert à la
 * première demande et refermé après deux minutes sans parcours. Chaque passage
 * a son CONTEXTE, jeté aussitôt : aucun cookie ne survit d'un passage à
 * l'autre, une session ouverte hier ne masque pas une connexion cassée.
 */
const PARCOURS_SIMULTANES = 3;
const REPOS_NAVIGATEUR_MS = 2 * 60_000;
type Navigateur = import('playwright').Browser;
let navigateur: Promise<Navigateur> | null = null;
let parcoursEnVol = 0;
let minuteurRepos: NodeJS.Timeout | null = null;
const fileDAttente: Array<() => void> = [];

async function prendreUnePlace(): Promise<void> {
  if (parcoursEnVol < PARCOURS_SIMULTANES) {
    parcoursEnVol++;
    return;
  }
  await new Promise<void>((resolve) => fileDAttente.push(resolve));
  parcoursEnVol++;
}

function rendreLaPlace(): void {
  parcoursEnVol--;
  const suivant = fileDAttente.shift();
  if (suivant) return suivant();
  if (parcoursEnVol === 0) {
    if (minuteurRepos) clearTimeout(minuteurRepos);
    minuteurRepos = setTimeout(() => void fermerNavigateur(), REPOS_NAVIGATEUR_MS);
    minuteurRepos.unref?.();
  }
}

async function ouvrirNavigateur(): Promise<Navigateur> {
  if (minuteurRepos) {
    clearTimeout(minuteurRepos);
    minuteurRepos = null;
  }
  if (navigateur) {
    const actuel = await navigateur.catch(() => null);
    if (actuel?.isConnected()) return actuel;
  }
  navigateur = import('playwright').then(({ chromium }) => chromium.launch({ channel: 'chrome', headless: true }));
  navigateur.catch(() => (navigateur = null));
  return navigateur;
}

export async function fermerNavigateur(): Promise<void> {
  const actuel = navigateur;
  navigateur = null;
  if (actuel) await actuel.then((n) => n.close()).catch(() => undefined);
}

function valeurDuCoffre(reference: { id: string; champ: string }): string | undefined {
  const fiche = listerAcces().find((a) => a.id === reference.id);
  return fiche?.champs?.[reference.champ] || undefined;
}

const court = (err: unknown) => String((err as Error)?.message ?? err).split('\n')[0].slice(0, 200);

async function jouerParcours(etapes: EtapeParcours[]): Promise<VerdictSite> {
  await prendreUnePlace();
  let contexte: import('playwright').BrowserContext | null = null;
  let coupe = false;
  const minuteur = setTimeout(() => {
    coupe = true;
    void contexte?.close().catch(() => undefined);
  }, DELAI_PARCOURS_MS);
  let code: number | undefined;
  let libelle = '';
  try {
    const nav = await ouvrirNavigateur();
    contexte = await nav.newContext({ userAgent: 'Beluga Build-surveillance/1.0' });
    const page = await contexte.newPage();
    page.setDefaultTimeout(DELAI_REPONSE_MS);
    for (let i = 0; i < etapes.length; i++) {
      const etape = etapes[i];
      libelle = libelleEtape(etape, i);
      switch (etape.action) {
        case 'aller': {
          const reponse = await page.goto(etape.url, { waitUntil: 'domcontentloaded' });
          code = reponse?.status();
          if (code && code >= 400)
            return { etat: 'panne', raison: code >= 500 ? 'serveur' : 'client', code, etape: libelle };
          break;
        }
        case 'remplir': {
          const valeur = etape.acces ? valeurDuCoffre(etape.acces) : (etape.valeur ?? '');
          if (valeur === undefined)
            return {
              etat: 'panne',
              raison: 'parcours',
              code,
              etape: libelle,
              detail: `fiche « ${etape.acces?.id} » ou champ « ${etape.acces?.champ} » introuvable au coffre-fort`,
            };
          await page.fill(etape.selecteur, valeur);
          break;
        }
        case 'cliquer':
          await page.click(etape.selecteur);
          break;
        case 'attendre':
          if (etape.selecteur) await page.waitForSelector(etape.selecteur, { state: 'visible' });
          else await page.waitForTimeout(etape.ms ?? 0);
          break;
        case 'verifierTexte':
          try {
            await page.getByText(etape.texte).first().waitFor({ state: 'visible' });
          } catch {
            return { etat: 'panne', raison: 'contenu', code, etape: libelle, detail: `« ${etape.texte} » absent de la page` };
          }
          break;
        case 'verifierSelecteur':
          try {
            await page.waitForSelector(etape.selecteur, { state: 'visible' });
          } catch {
            return { etat: 'panne', raison: 'contenu', code, etape: libelle, detail: `${etape.selecteur} absent de la page` };
          }
          break;
      }
    }
    return { etat: 'ok', code };
  } catch (err) {
    if (coupe) return { etat: 'panne', raison: 'delai', code, etape: libelle || undefined };
    const message = court(err);
    // Rien n'est revenu de la toute première page : le site est injoignable, pas le parcours.
    if (!code && /net::ERR_|ECONNREFUSED|ENOTFOUND/.test(message))
      return { etat: 'panne', raison: 'injoignable', etape: libelle || undefined, detail: message };
    return { etat: 'panne', raison: 'parcours', code, etape: libelle || undefined, detail: message };
  } finally {
    clearTimeout(minuteur);
    await contexte?.close().catch(() => undefined);
    rendreLaPlace();
  }
}

/** Joue une recette UNE fois, sans rien écrire : le passage automatique comme l'essai de l'agent. */
export async function jouerRecette(
  url: string,
  recette: RecetteSurveillance,
): Promise<VerdictSite & { dureeMs: number }> {
  const debut = Date.now();
  let verdict: VerdictSite;
  try {
    verdict = recette.type === 'parcours' ? await jouerParcours(recette.etapes) : await appeler(url, recette.motAttendu);
  } catch (err) {
    verdict = { etat: 'panne', raison: 'parcours', detail: court(err) };
  }
  return { ...verdict, dureeMs: Date.now() - debut };
}

/* ------------------------------------------------------------------ */
/* Les tournées                                                         */
/* ------------------------------------------------------------------ */

/** Les surveillances en plein passage : jamais deux passages du même site à la fois. */
const enCours = new Map<string, Promise<unknown>>();

/**
 * Une tournée. Sans liste d'identifiants, elle prend les sites DUS à leur
 * rythme et SAUTE ceux déjà en passage. Avec, elle joue ceux-là quoi qu'il
 * arrive (bouton « Vérifier maintenant », ajout, modification) : un passage en
 * vol est d'abord ATTENDU, puis rejoué — il a pu partir avec l'ancien accès.
 */
export async function verifierSites(ids?: string[], maintenant = Date.now()): Promise<SiteSurveille[]> {
  if (ids?.length) {
    await Promise.all(ids.map((id) => enCours.get(id)?.catch(() => undefined)));
  }
  const tous = listerSites();
  const cibles = (ids?.length ? tous.filter((site) => ids.includes(site.id)) : tous.filter((site) => doitVerifier(site, maintenant))).filter(
    (site) => !enCours.has(site.id),
  );
  if (!cibles.length) return [];
  let finir!: () => void;
  const tournee = new Promise<void>((resolve) => (finir = resolve));
  for (const site of cibles) enCours.set(site.id, tournee);

  const db = getDb();
  const tombes: SiteSurveille[] = [];
  const retablis: SiteSurveille[] = [];
  /** Les sites qui ont atteint le seuil : traités HORS de la boucle parallèle. */
  const aDepanner: string[] = [];
  /** Les courriels à écrire, et ceux à apaiser : de même, hors de la boucle. */
  const aEcrire: { siteId: string; echecs: number; genre: GenreDeCourriel }[] = [];
  const aApaiser: { site: SiteSurveille; panneDepuis?: number }[] = [];

  try {
    await Promise.all(
      cibles.map(async (site) => {
        const verdict = await jouerRecette(site.url, site.recette ?? RECETTE_APPEL);
        const instant = Date.now();
        // Relu : la surveillance a pu être supprimée pendant un long parcours.
        const actuelle = lireSurveillance(site.id);
        if (!actuelle) return;
        const change = bascule(actuelle.etat, verdict.etat);
        const depuis = change ? instant : actuelle.depuis || instant;
        const dernierePanne = verdict.etat === 'panne' ? instant : actuelle.dernierePanne;
        db.prepare(
          'UPDATE sites_surveilles SET etat = ?, code = ?, raison = ?, etape_echouee = ?, duree_ms = ?, verifie_le = ?, depuis = ?, derniere_panne = ? WHERE id = ?',
        ).run(
          verdict.etat,
          verdict.code ?? null,
          verdict.raison ?? null,
          verdict.etat === 'panne' ? (verdict.etape ?? null) : null,
          verdict.dureeMs,
          instant,
          depuis,
          dernierePanne,
          site.id,
        );
        db.prepare(
          'INSERT INTO controles_surveillance (site_id, instant, etat, raison, code, duree_ms, etape, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          site.id,
          instant,
          verdict.etat,
          verdict.raison ?? null,
          verdict.code ?? null,
          verdict.dureeMs,
          verdict.etape ?? null,
          verdict.detail ? verdict.detail.slice(0, 300) : null,
        );
        const apres: SiteSurveille = {
          ...actuelle,
          etat: verdict.etat,
          code: verdict.code,
          raison: verdict.raison,
          etapeEchouee: verdict.etat === 'panne' ? verdict.etape : undefined,
          verifieLe: instant,
          depuis,
          dernierePanne,
        };
        if (change === 'tombe') tombes.push(apres);
        if (change === 'retabli') retablis.push(apres);
        /*
         * LE COMPTEUR D'ÉCHECS D'AFFILÉE, lu sur l'historique qu'on vient
         * d'écrire. Un seul contrôle réussi le remet à zéro et REFERME
         * l'incident : la panne est terminée, une prochaine chute en ouvrira
         * une autre — l'écart minimal de six heures restant tenu par
         * `incident_lance_le`, qu'on ne touche pas ici.
         */
        if (verdict.etat === 'ok') {
          if (actuelle.incidentCardId) refermerIncidentDuSite(site.id);
          /*
           * LE MOT D'APAISEMENT NE PART QU'À QUI A REÇU LA MAUVAISE NOUVELLE.
           * Les dates sont effacées TOUT DE SUITE, avant l'écriture du mot : une
           * tournée suivante ne peut donc pas l'envoyer une seconde fois.
           */
          if (doitApaiserParCourriel(actuelle)) {
            const panneDepuis = actuelle.alerteCourrielDepuis;
            refermerAlerteCourrielDuSite(site.id);
            aApaiser.push({ site: apres, panneDepuis });
          }
          return;
        }
        const echecs = echecsDeSuiteDuSite(listerControles(site.id, instant));
        if (echecs >= ECHECS_AVANT_DEPANNAGE) aDepanner.push(site.id);
        const courriel = decisionDeCourrielDePanne(actuelle, echecs, instant);
        if (courriel.ecrire) aEcrire.push({ siteId: site.id, echecs, genre: courriel.genre });
      }),
    );
  } finally {
    for (const site of cibles) enCours.delete(site.id);
    finir();
  }
  purgerHistorique();

  for (const site of tombes) {
    const texte = texteAlerte(site);
    log.warn(`surveillance : ${site.nom} est tombé (${texte.corps})`);
    notify({
      motif: 'site-indisponible',
      title: texte.titre,
      body: texte.corps,
      // Une seule alerte par site : deux chutes du même site à quelques
      // secondes d'intervalle ne font qu'un événement.
      reference: `site:${site.id}`,
      element: site.nom,
    });
  }
  /*
   * TROIS ÉCHECS D'AFFILÉE : LA CARTE DE PANNE, HORS DE LA BOUCLE PARALLÈLE.
   *
   * Comme l'alerte de chute : le passage écrit son résultat, et seule la
   * tournée refermée engage quelque chose. L'import est fait ici et pas en tête
   * de fichier — le module du dépannage tire tout le moteur, qu'un simple
   * contrôle n'a aucune raison de charger.
   */
  for (const siteId of aDepanner) {
    try {
      const { ouvrirLeDepannage, devinerLeProjetDuSite } = await import('./depannage-site.js');
      const fraiche = lireSurveillance(siteId);
      // Le projet se devine juste avant d'ouvrir la carte : un site déjà
      // surveillé avant ce mécanisme reçoit ainsi le sien sans attendre.
      if (fraiche) devinerLeProjetDuSite(fraiche);
      await ouvrirLeDepannage(siteId);
    } catch (err: any) {
      log.warn(`surveillance : dépannage impossible pour ${siteId}`, err?.message ?? err);
    }
  }

  /*
   * LE COURRIEL : TROIS ÉCHECS D'AFFILÉE, UN SEUL PAR PANNE, UN RAPPEL TOUTES
   * LES SIX HEURES. Hors de la boucle parallèle, comme l'alerte de chute et le
   * dépannage, et l'import est DYNAMIQUE : le module d'envoi tire le moteur de
   * courriels, qu'un simple contrôle n'a aucune raison de charger.
   */
  for (const envoi of aEcrire) {
    try {
      const { envoyerCourrielDePanneDuSite } = await import('./alerte-courriel-site.js');
      await envoyerCourrielDePanneDuSite(envoi);
    } catch (err: any) {
      log.warn(`surveillance : courriel de panne impossible pour ${envoi.siteId}`, err?.message ?? err);
    }
  }
  for (const retour of aApaiser) {
    try {
      const { envoyerCourrielDeRetourDuSite } = await import('./alerte-courriel-site.js');
      await envoyerCourrielDeRetourDuSite(retour);
    } catch (err: any) {
      log.warn(`surveillance : courriel de retour impossible pour ${retour.site.id}`, err?.message ?? err);
    }
  }

  for (const site of retablis) {
    /*
     * Un retour à la normale ne pousse RIEN et n'affiche aucun message passager
     * (TROIS GENRES ALERTENT, pas un de plus : une confirmation se tait). Il se
     * lit là où on le cherche — la pastille du menu qui s'éteint, et le bandeau
     * d'apaisement en tête de la fenêtre.
     */
    log.info(`surveillance : ${site.nom} répond de nouveau`);
  }

  diffuser();
  return listerSites();
}

/**
 * LE MINUTEUR. Il bat chaque minute — le plancher du rythme — et ne joue que les
 * surveillances DUES à leur propre rythme : une surveillance réglée à cinq
 * minutes est rejouée cinq minutes après son dernier passage, sans minuteur par
 * site. Une tournée qui déborde ne bloque pas la suivante : les sites encore en
 * passage sont simplement sautés. La première part vingt secondes après le
 * démarrage.
 */
const BATTEMENT_MS = 60_000;

export function demarrerSurveillance(): NodeJS.Timeout {
  const tour = () => {
    verifierSites().catch((err) => log.warn('surveillance : tournée impossible', err));
  };
  /*
   * LES SITES DÉJÀ SURVEILLÉS REÇOIVENT LEUR PROJET, UNE FOIS. Sans ce
   * rattrapage, un site inscrit avant le dépannage automatique ouvrirait sa
   * première carte de panne chez Beluga Build faute de mieux.
   */
  setTimeout(() => {
    void import('./depannage-site.js')
      .then(({ rattraperLesProjetsDesSites }) => {
        const rattaches = rattraperLesProjetsDesSites(listerSites());
        if (rattaches) log.info(`surveillance : ${rattaches} site(s) rattaché(s) à leur projet d’après leur adresse`);
      })
      .catch((err) => log.warn('surveillance : rattachement des projets impossible', err));
  }, 15_000).unref?.();
  setTimeout(tour, 20_000).unref?.();
  const minuteur = setInterval(tour, BATTEMENT_MS);
  minuteur.unref?.();
  return minuteur;
}
