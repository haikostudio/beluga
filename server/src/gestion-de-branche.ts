/**
 * LA BRANCHE D'UNE CARTE, GÉRÉE À LA MAIN — le démon côté git.
 *
 * Le bouton de branche du fil d'Ariane (`web/src/components/bouton-de-branche.tsx`)
 * liste les branches du dépôt et demande quatre gestes : renommer la branche,
 * en créer une depuis un départ choisi, reprendre une branche existante, et —
 * quand la carte a déjà du travail — choisir de le LAISSER sur l'ancienne
 * branche ou de l'EMPORTER. Les règles pures (ce qui se propose, ce qui se
 * refuse, le nom valable) vivent dans `shared/src/gestion-de-branche.ts`.
 *
 * Trois garde-fous, tous dits à l'écran :
 *  - aucun geste pendant qu'un agent travaille sur la carte, ni pendant une mise
 *    en ligne du projet : on ne change pas la branche sous ses pieds ;
 *  - la branche d'une autre carte dont l'agent travaille ne se reprend pas
 *    (l'une après l'autre) ;
 *  - rien ne se perd : le travail qui traîne dans la copie est ENREGISTRÉ
 *    d'office sur l'ancienne branche avant tout geste, et « emporter » qui
 *    heurte s'annule en laissant tout en place.
 *
 * Tous les gestes passent par la file du dépôt (`sousLaFileDuDepot`), comme
 * l'ouverture et la fermeture des copies de travail.
 */

import fs from 'node:fs';
import {
  Card,
  GIT_SANS_CROCHETS,
  brancheDeLaCarte,
  brancheReglee,
  branchesInterdites,
  branchesProposees,
  depotGithubDeLAdresse,
  departProposable,
  estDossierDeCarte,
  raisonDOccupation,
  validerNomDeBranche,
  type BranchesDeLaCarte,
  type CarteSurLaBranche,
  type GesteDeBranche,
  type ReponseGesteDeBranche,
  type SortDuTravail,
} from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { isRunning } from './runtime.js';
import { publicationEnCours } from './deploy.js';
import { brancheDeDeploiement } from './branche-de-deploiement.js';
import { dossierDeCarte, racinesDesCopiesDuProjet } from './copies-de-cartes.js';
import { branchePrincipale, copieQuiTientLaBranche, git } from './git.js';
import { refermerSansFile, sousLaFileDuDepot } from './dossier-de-carte.js';

const agentActif = (card: Pick<Card, 'agentId'>) => !!card.agentId && isRunning(card.agentId);

/** Ce qui interdit tout geste sur la branche de cette carte maintenant, ou rien. */
function verrouDeLaCarte(card: Card): string | undefined {
  const project = store.getProject(card.projectId);
  if (!project) return 'Projet introuvable.';
  if (agentActif(card)) return "L'agent de cette tâche travaille : sa branche se change quand il aura rendu.";
  if (publicationEnCours(card.projectId)) return 'Une mise en ligne du projet est en cours : la branche se change après elle.';
  if (project.depots?.length) return 'Ce projet a plusieurs dépôts : la branche de ses tâches se gère encore toute seule.';
  if (card.horsTache) return 'Ce travail a été fait hors tâche, directement sur la branche du projet.';
  if (card.column === 'archived') return 'Cette tâche est archivée : sa branche est refermée.';
  return undefined;
}

/** Les AUTRES cartes du projet qui portent chaque branche (archivées exclues). */
function cartesParBranche(card: Card): Map<string, CarteSurLaBranche[]> {
  const parBranche = new Map<string, CarteSurLaBranche[]>();
  for (const c of store.listCards(card.projectId)) {
    if (c.id === card.id || c.column === 'archived') continue;
    const nom = brancheDeLaCarte(c);
    const liste = parBranche.get(nom) ?? [];
    liste.push({ id: c.id, titre: c.title, active: agentActif(c) });
    parBranche.set(nom, liste);
  }
  return parBranche;
}

async function refsDuDepot(racine: string): Promise<{ locales: string[]; distantes: string[] }> {
  const sortie = await git(racine, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes/origin'], 20000);
  const locales: string[] = [];
  const distantes: string[] = [];
  if (!sortie.ok) return { locales, distantes };
  for (const ligne of sortie.out.split('\n').map((l) => l.trim()).filter(Boolean)) {
    if (ligne.startsWith('refs/heads/')) locales.push(ligne.slice('refs/heads/'.length));
    else if (ligne.startsWith('refs/remotes/origin/')) distantes.push(ligne.slice('refs/remotes/origin/'.length));
  }
  return { locales, distantes };
}

async function existe(racine: string, ref: string): Promise<boolean> {
  const r = await git(racine, ['rev-parse', '--verify', '--quiet', ref], 20000);
  return r.ok && !!r.out.trim();
}

async function sommet(racine: string, ref: string): Promise<string | undefined> {
  const r = await git(racine, ['rev-parse', '--verify', '--quiet', ref], 20000);
  return r.ok ? r.out.trim() || undefined : undefined;
}

async function urlGithub(racine: string, branche: string): Promise<string | undefined> {
  const r = await git(racine, ['remote', 'get-url', 'origin'], 10000);
  const depot = r.ok ? depotGithubDeLAdresse(r.out.trim()) : null;
  return depot ? `https://github.com/${depot.proprietaire}/${depot.nom}/tree/${branche}` : undefined;
}

async function lesBranchesDuProjet(card: Card) {
  const project = store.getProject(card.projectId)!;
  const racine = project.path;
  const reglees = project.branchesDePublication;
  const deploiement = await brancheDeDeploiement(racine, reglees);
  const principale = await branchePrincipale(racine);
  const production = brancheReglee(reglees, 'production') ?? principale;
  const interdites = branchesInterdites([principale, deploiement, brancheReglee(reglees, 'dev'), production]);
  return { project, racine, reglees, deploiement, production, interdites };
}

/** CE QUE LE MENU DE BRANCHE MONTRE pour une carte. */
export async function branchesDeLaCarte(cardId: string): Promise<BranchesDeLaCarte> {
  const card = store.getCard(cardId);
  if (!card) throw new Error('carte introuvable');
  const { racine, deploiement, production, interdites } = await lesBranchesDuProjet(card);
  const courante = brancheDeLaCarte(card);
  const { locales, distantes } = await refsDuDepot(racine);
  const parBranche = cartesParBranche(card);

  const departs: string[] = [];
  for (const nom of [deploiement, production, ...locales, ...distantes.map((d) => `origin/${d}`)]) {
    if (!departProposable(nom) || departs.includes(nom) || nom === courante) continue;
    if (nom.startsWith('origin/') && departs.includes(nom.slice('origin/'.length))) continue;
    departs.push(nom);
  }

  return {
    courante,
    existe: locales.includes(courante),
    depart: (card.brancheDeDepart ?? '').trim() || deploiement,
    deploiement,
    production,
    departs,
    branches: branchesProposees({ locales, distantes, courante, interdites, cartesParBranche: parBranche }),
    partagee: parBranche.get(courante) ?? [],
    verrou: verrouDeLaCarte(card),
    urlGithub: distantes.includes(courante) ? await urlGithub(racine, courante) : undefined,
  };
}

/**
 * LES ENREGISTREMENTS PROPRES À LA CARTE sur sa branche : depuis sa base
 * (`github.baseSha`, posée à la création ou à la reprise), sinon depuis la
 * branche de déploiement. Une branche reprise d'une autre carte ne compte donc
 * pas le travail de cette autre carte.
 */
async function enregistrementsPropres(racine: string, card: Card, branche: string, deploiement: string): Promise<string[]> {
  if (!(await existe(racine, branche))) return [];
  const base = card.github?.baseSha && (await existe(racine, card.github.baseSha)) ? card.github.baseSha : deploiement;
  const r = await git(racine, ['rev-list', '--reverse', '--no-merges', `${base}..${branche}`], 30000);
  return r.ok ? r.out.split('\n').map((l) => l.trim()).filter(Boolean) : [];
}

async function copieSale(dossier: string): Promise<boolean> {
  if (!fs.existsSync(dossier)) return false;
  const r = await git(dossier, ['status', '--porcelain'], 60000);
  return r.ok && !!r.out.trim();
}

function enregistrerLaCarte(card: Card, patch: Partial<Card>): Card {
  const saved = store.saveCard(Card.parse({ ...card, ...patch }));
  bus.emit({ type: 'card.upsert', card: saved });
  return saved;
}

function suiviAvecBranche(card: Card, branche: string, baseSha: string | undefined): NonNullable<Card['github']> {
  return {
    ...(card.github ?? { checks: [], commits: [], fichiers: [], activity: [] }),
    branch: branche,
    baseSha,
    fusionnee: undefined,
  } as NonNullable<Card['github']>;
}

/**
 * EMPORTER : rejouer les enregistrements propres à la carte sur la branche
 * d'arrivée, dans la copie de la carte posée dessus. Un heurt annule tout
 * (`cherry-pick --abort`) : la branche d'arrivée revient à son état, le travail
 * reste sur l'ancienne branche, et l'on dit quels fichiers se heurtent.
 */
async function rejouerSur(
  racine: string,
  dossier: string,
  arrivee: string,
  commits: string[],
): Promise<{ ok: true } | { ok: false; raison: string }> {
  const pose = await git(racine, [...GIT_SANS_CROCHETS, 'worktree', 'add', '--quiet', dossier, arrivee], 120000);
  if (!pose.ok) return { ok: false, raison: `la copie de travail n'a pas pu se poser sur « ${arrivee} » (${pose.out.slice(-160)})` };
  if (!commits.length) return { ok: true };
  const rejeu = await git(dossier, [...GIT_SANS_CROCHETS, 'cherry-pick', ...commits], 120000);
  if (rejeu.ok) return { ok: true };
  const heurts = await git(dossier, ['diff', '--name-only', '--diff-filter=U'], 20000);
  await git(dossier, ['cherry-pick', '--abort'], 60000);
  await refermerSansFile(racine, dossier);
  const fichiers = heurts.out.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 5);
  return {
    ok: false,
    raison: `le travail se heurte à celui de « ${arrivee} »${fichiers.length ? ` (${fichiers.join(', ')})` : ''}`,
  };
}

/** UN GESTE SUR LA BRANCHE D'UNE CARTE. */
export async function agirSurLaBranche(cmd: {
  cardId: string;
  geste: GesteDeBranche;
  nom: string;
  depart?: string;
  travail?: SortDuTravail;
}): Promise<ReponseGesteDeBranche> {
  const card = store.getCard(cmd.cardId);
  if (!card) return { ok: false, message: 'Carte introuvable.' };
  const verrou = verrouDeLaCarte(card);
  if (verrou) return { ok: false, message: verrou };
  const { racine, deploiement, interdites } = await lesBranchesDuProjet(card);
  const ancienne = brancheDeLaCarte(card);

  if (cmd.geste === 'renommer') return renommer(card, racine, ancienne, cmd.nom, interdites);

  /* CRÉER ou REPRENDRE : la carte change de branche. */
  let arrivee: string;
  let depart: string | undefined;
  if (cmd.geste === 'creer') {
    const verdict = validerNomDeBranche(cmd.nom, interdites);
    if (!verdict.ok) return { ok: false, message: verdict.raison };
    arrivee = verdict.nom;
    if ((await existe(racine, arrivee)) || (await existe(racine, `origin/${arrivee}`))) {
      return { ok: false, message: `Une branche « ${arrivee} » existe déjà : reprenez-la plutôt.` };
    }
    depart = (cmd.depart ?? '').trim() || deploiement;
    if (!(await existe(racine, depart))) return { ok: false, message: `Le départ « ${depart} » n'existe pas dans le dépôt.` };
  } else {
    arrivee = (cmd.nom ?? '').trim().replace(/^origin\//, '');
    if (!arrivee || interdites.has(arrivee) || arrivee.startsWith('archive/')) {
      return { ok: false, message: 'Cette branche ne peut pas servir de branche de travail.' };
    }
    if (arrivee === ancienne) return { ok: true, branche: arrivee, message: 'La tâche est déjà sur cette branche.' };
    const occupee = raisonDOccupation(cartesParBranche(card).get(arrivee) ?? []);
    if (occupee) return { ok: false, message: occupee };
    if (!(await existe(racine, arrivee)) && !(await existe(racine, `origin/${arrivee}`))) {
      return { ok: false, message: `La branche « ${arrivee} » n'existe pas dans le dépôt.` };
    }
  }

  const dossier = dossierDeCarte(racine, card.title, card.id);
  const propres = await enregistrementsPropres(racine, card, ancienne, deploiement);
  const aDuTravail = propres.length > 0 || (await copieSale(dossier));
  if (aDuTravail && !cmd.travail) return { ok: false, question: 'travail' };
  const sort: SortDuTravail = aDuTravail ? cmd.travail! : 'laisser';
  const partagee = (cartesParBranche(card).get(ancienne) ?? []).length > 0;

  return sousLaFileDuDepot(racine, async (): Promise<ReponseGesteDeBranche> => {
    /* 1. Rien ne se perd : la copie de la carte se referme, son travail
          enregistré d'office sur l'ANCIENNE branche. */
    const fermeture = await refermerSansFile(racine, dossier);
    if (!fermeture.retire) {
      return { ok: false, message: `La copie de travail de la tâche n'a pas pu se refermer (${fermeture.raison}) : rien n'a changé.` };
    }
    /* Le travail tout juste enregistré compte parmi ce qu'on emporte. */
    const aEmporter = sort === 'emporter' ? await enregistrementsPropres(racine, card, ancienne, deploiement) : [];

    /* 2. La branche d'arrivée existe localement. */
    if (cmd.geste === 'reprendre') {
      if (!(await existe(racine, arrivee))) {
        const suivi = await git(racine, ['branch', '--track', arrivee, `origin/${arrivee}`], 30000);
        if (!suivi.ok) return { ok: false, message: `La branche distante « ${arrivee} » n'a pas pu être rapatriée : ${suivi.out.slice(-160)}` };
      }
      /* Une copie d'une AUTRE carte (inactive) la tient encore : on la referme,
         travail enregistré. Le dossier principal ou un dossier ouvert à la
         main ne se touchent pas. */
      const detentrice = await copieQuiTientLaBranche(racine, arrivee);
      if (detentrice) {
        if (!estDossierDeCarte(racine, detentrice, racinesDesCopiesDuProjet(racine))) {
          return { ok: false, message: `« ${arrivee} » est ouverte dans un dossier qui n'est pas celui d'une tâche (${detentrice}).` };
        }
        const liberee = await refermerSansFile(racine, detentrice);
        if (!liberee.retire) return { ok: false, message: `La copie qui tient « ${arrivee} » n'a pas pu se refermer (${liberee.raison}).` };
      }
    } else if (sort === 'emporter') {
      const cree = await git(racine, ['branch', arrivee, depart!], 30000);
      if (!cree.ok) return { ok: false, message: `La branche « ${arrivee} » n'a pas pu être créée : ${cree.out.slice(-160)}` };
    }

    /* 3. La base de la carte sur sa nouvelle branche : ce qui est AVANT
          n'appartient pas à la carte. Une branche à créer plus tard (laisser)
          la recevra à son ouverture. */
    const base = (await existe(racine, arrivee)) ? await sommet(racine, arrivee) : undefined;

    /* 4. Emporter : rejouer le travail propre à la carte. */
    if (sort === 'emporter') {
      const rejeu = await rejouerSur(racine, dossier, arrivee, aEmporter);
      if (!rejeu.ok) {
        if (cmd.geste === 'creer') await git(racine, ['branch', '-D', arrivee], 30000);
        return {
          ok: false,
          message: `Rien n'a bougé : ${rejeu.raison}. Le travail reste sur « ${ancienne} » ; choisissez « Laisser » puis demandez à l'agent de le reprendre.`,
        };
      }
      await refermerSansFile(racine, dossier);
    } else if (!aDuTravail && !partagee && (await existe(racine, ancienne))) {
      /* Laisser une branche VIDE derrière soi ne sert à rien : `-d` refuse
         d'elle-même ce qui porterait encore un enregistrement. */
      await git(racine, ['branch', '-d', ancienne], 30000);
    }

    const fraiche = store.getCard(card.id) ?? card;
    enregistrerLaCarte(fraiche, {
      brancheChoisie: arrivee,
      brancheDeDepart: cmd.geste === 'creer' ? depart : undefined,
      github: suiviAvecBranche(fraiche, arrivee, base),
      codeDejaEnregistre: sort === 'emporter' ? fraiche.codeDejaEnregistre : false,
    });
    log.info(`branche de « ${card.title} » : ${ancienne} → ${arrivee} (${cmd.geste}, travail ${sort})`);
    const quoi = cmd.geste === 'creer' ? 'Nouvelle branche' : 'Branche reprise';
    const travail = aDuTravail ? (sort === 'emporter' ? ', travail emporté' : `, travail laissé sur « ${ancienne} »`) : '';
    return { ok: true, branche: arrivee, message: `${quoi} : « ${arrivee} »${travail}.` };
  });
}

/**
 * RENOMMER : la branche locale, sa copie distante si elle a déjà été poussée,
 * et toutes les cartes qui la portent.
 */
async function renommer(
  card: Card,
  racine: string,
  ancienne: string,
  saisie: string,
  interdites: Set<string>,
): Promise<ReponseGesteDeBranche> {
  const verdict = validerNomDeBranche(saisie, interdites);
  if (!verdict.ok) return { ok: false, message: verdict.raison };
  const nouveau = verdict.nom;
  if (nouveau === ancienne) return { ok: true, branche: nouveau, message: 'Le nom est inchangé.' };
  if ((await existe(racine, nouveau)) || (await existe(racine, `origin/${nouveau}`))) {
    return { ok: false, message: `Une branche « ${nouveau} » existe déjà.` };
  }
  const occupee = raisonDOccupation(cartesParBranche(card).get(ancienne) ?? []);
  if (occupee) return { ok: false, message: occupee };

  return sousLaFileDuDepot(racine, async (): Promise<ReponseGesteDeBranche> => {
    let distant = '';
    if (await existe(racine, ancienne)) {
      const r = await git(racine, ['branch', '-m', ancienne, nouveau], 30000);
      if (!r.ok) return { ok: false, message: `git a refusé le renommage : ${r.out.slice(-160)}` };
      if (await existe(racine, `origin/${ancienne}`)) {
        const pousse = await git(racine, ['push', '-u', 'origin', nouveau], 120000);
        const retire = pousse.ok ? await git(racine, ['push', 'origin', '--delete', ancienne], 120000) : pousse;
        distant = pousse.ok && retire.ok ? ' (GitHub aussi)' : ' (GitHub garde l’ancien nom : la mise à jour distante a échoué)';
      }
    }
    for (const c of store.listCards(card.projectId)) {
      if (c.column === 'archived' || brancheDeLaCarte(c) !== ancienne) continue;
      enregistrerLaCarte(c, {
        brancheChoisie: nouveau,
        ...(c.github ? { github: { ...c.github, branch: nouveau } } : {}),
      });
    }
    log.info(`branche renommée : ${ancienne} → ${nouveau}${distant}`);
    return { ok: true, branche: nouveau, message: `Branche renommée : « ${nouveau} »${distant}.` };
  });
}
