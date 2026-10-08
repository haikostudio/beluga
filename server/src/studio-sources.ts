/**
 * LES SOURCES DE LA BIBLIOTHÈQUE DE STYLES — d'où viennent les styles, et
 * comment les nouveaux arrivent.
 *
 *  1. AJOUT : l'utilisateur donne une adresse dans le volet « Sources ». Un
 *     agent de volet (carte étiquetée `bibliotheque`, palier standard) lit le
 *     site, écrit une RECETTE DÉCLARATIVE (`shared/src/studio-sources.ts`),
 *     l'essaie (`bibliotheque_source_essai`) et l'enregistre
 *     (`bibliotheque_source_recette`) : la source passe « à valider » avec le
 *     résumé de l'analyse. Rien n'est récupéré avant la validation.
 *  2. VALIDATION : le démon rejoue la recette SEUL, range chaque entrée
 *     nouvelle en « à rédiger » (invisible), puis un agent écrit par lots les
 *     textes français et les catégories (`bibliotheque_styles_ecrire`) : les
 *     styles paraissent avec la marque « Nouveau ».
 *  3. CHAQUE NUIT (1 h – 6 h) : même passage pour chaque source active, SANS
 *     agent tant que rien n'est nouveau (MEM-2723). Une source qui change de
 *     structure passe « en erreur » avec une raison lisible : ses styles
 *     RESTENT. Une source retirée n'est plus contrôlée, ses styles restent.
 *
 *  4. UN ANNUAIRE (sujet GitHub, liste « awesome ») ne publie rien lui-même :
 *     l'agent ouvre ses liens et PROPOSE chaque site exploitable comme une
 *     source neuve « à valider » (`proposerSourceDepuisAnnuaire`, vingt au
 *     plus, jamais une adresse déjà suivie) ; l'annuaire passe « annuaire ».
 *  5. UNE VÉRIFICATION ANTI-ROBOT : la source passe « vérification » (ses
 *     styles restent), l'utilisateur la passe dans un vrai navigateur
 *     (`studio-navigateur.ts`) et la source se lit ensuite PAR LUI ; la nuit
 *     réessaie avec ce navigateur, et la cloche prévient une fois par jour si
 *     la vérification est à refaire (`prevenirDesVerifications`).
 *
 * Dédoublonnage (repris des anciens scripts d'import) : même publication
 * x.com/…/status/<n>, ou consigne identique, déjà dans la bibliothèque.
 */
import crypto from 'node:crypto';
import {
  JOURS_NOUVEAU,
  LABEL_BIBLIOTHEQUE,
  TAILLE_LOT_REDACTION,
  categoriesDuStyle,
  clePublication,
  demandeDAnalyseDeSource,
  demandeDeRedactionDesStyles,
  entreeDeLObjet,
  entreeGardee,
  extraire,
  idDeCategorieNeuve,
  idDeStyleNeuf,
  jugerAdresseSource,
  jugerPropositionDeSource,
  RAISON_ANTI_ROBOT,
  baseDIdDeSource,
  dansLesHeuresDeSilence,
  nomDeDepartDeSource,
  objetsDeLaListe,
  raisonDePageRefusee,
  reglagesDuNiveau,
  sourceDeLAdresse,
  valeurDuChamp,
  type EntreeDeSource,
  type RecetteDeSource,
} from '@beluga/shared';
import * as store from './store.js';
import { getDb } from './db.js';
import { log } from './logger.js';
import { appelExterieur, catalogueDesStyles, catalogueModifie, categoriesDeLaBibliotheque, lireSource, type SourceDeStyles } from './studio-styles.js';

/* ------------------------------------------------------------------ */
/* Lire une source selon sa recette                                    */
/* ------------------------------------------------------------------ */

const TAILLE_MAX_PAGE = 8_000_000;

async function lirePageDuDemon(url: string): Promise<{ ok: true; texte: string } | { ok: false; raison: string }> {
  let r: Response;
  try {
    r = await appelExterieur(url, 30_000);
  } catch (err: any) {
    return { ok: false, raison: `le site ne répond pas (${err?.message ?? err})` };
  }
  const texte = (await r.text().catch(() => '')).slice(0, TAILLE_MAX_PAGE);
  const refus = raisonDePageRefusee(r.status, texte);
  return refus ? { ok: false, raison: refus } : { ok: true, texte };
}

export interface LectureDeSource {
  /** Les entrées gardées (filtre « garder » passé), fiches lues pour celles qui en avaient besoin. */
  entrees: EntreeDeSource[];
  /** Combien d'objets la liste donnait. */
  total: number;
  avertissements: string[];
}

/**
 * JOUER UNE RECETTE : la liste (et ses pages), puis la fiche des seules entrées
 * qui en ont besoin (`fichePour`) — la nuit, celles qu'on ne connaît pas encore.
 */
export async function lireLaSource(
  recette: RecetteDeSource,
  options: {
    fichePour?: (e: EntreeDeSource) => boolean;
    maxFiches?: number;
    /** Qui lit les pages : le démon (par défaut), ou le navigateur où la vérification anti-robot a été passée. */
    lecteur?: (url: string) => Promise<{ ok: true; texte: string } | { ok: false; raison: string }>;
  } = {},
): Promise<{ ok: true; lecture: LectureDeSource } | { ok: false; raison: string }> {
  const lirePage = options.lecteur ?? lirePageDuDemon;
  const premiere = await lirePage(recette.liste.url);
  if (!premiere.ok) return premiere;
  const lus = objetsDeLaListe(premiere.texte, recette.liste);
  if (!lus.ok) return { ok: false, raison: lus.raison };
  const objets = new Map<string, unknown>();
  const entrees = new Map<string, EntreeDeSource>();
  const verser = (liste: unknown[]) => {
    let neufs = 0;
    for (const o of liste) {
      const e = entreeDeLObjet(o, recette.champs);
      if (!e || entrees.has(e.idOrigine)) continue;
      entrees.set(e.idOrigine, e);
      objets.set(e.idOrigine, o);
      neufs++;
    }
    return neufs;
  };
  verser(lus.valeur);
  if (recette.liste.pages) {
    for (let n = 2; n <= recette.liste.pages.jusqua; n++) {
      const page = await lirePage(recette.liste.pages.gabarit.replace('{n}', String(n)));
      if (!page.ok) break;
      const suite = objetsDeLaListe(page.texte, recette.liste);
      if (!suite.ok || !verser(suite.valeur)) break;
    }
  }
  if (!entrees.size) return { ok: false, raison: 'la liste ne rend aucun exemple : la page a peut-être changé de structure' };

  const avertissements: string[] = [];
  const aLire = [...entrees.values()].filter((e) => options.fichePour?.(e) ?? true);
  if (recette.fiche) {
    const max = options.maxFiches ?? 400;
    if (aLire.length > max) avertissements.push(`${aLire.length - max} fiches non lues ce passage (plafond ${max}) : elles le seront au suivant`);
    const lot = aLire.slice(0, max);
    let rates = 0;
    for (let i = 0; i < lot.length; i += 6) {
      await Promise.all(
        lot.slice(i, i + 6).map(async (e) => {
          const url = valeurDuChamp(objets.get(e.idOrigine), recette.fiche!.url);
          const page = url && jugerAdresseSource(url).ok ? await lirePage(url) : null;
          if (!page?.ok) {
            rates++;
            return;
          }
          for (const cle of ['consigne', 'lien', 'auteur', 'affiche', 'video'] as const) {
            const ex = recette.fiche![cle];
            if (ex && !e[cle]) {
              const v = extraire(page.texte, ex);
              if (v) e[cle] = v;
            }
          }
        }),
      );
    }
    if (rates) avertissements.push(`${rates} fiche(s) illisible(s)`);
    // Une entrée dont la fiche n'a pas été lue ne peut pas être jugée : elle attend le passage suivant.
    for (const e of aLire.slice(max)) entrees.delete(e.idOrigine);
  }
  const gardees = aLire.filter((e) => entrees.has(e.idOrigine) && !!e.consigne && entreeGardee(e, objets.get(e.idOrigine), recette.garder));
  return { ok: true, lecture: { entrees: gardees, total: entrees.size, avertissements } };
}

/** Ce que l'essai montre à l'agent : le compte et trois exemples, en clair. */
export function phraseDeLEssai(lecture: LectureDeSource, lues: number): string {
  const exemples = lecture.entrees.slice(0, 3).map((e) =>
    [
      `- id « ${e.idOrigine} »${e.titre ? ` — « ${e.titre} »` : ''}${e.auteur ? `, par ${e.auteur}` : ''}`,
      `  consigne (${(e.consigne ?? '').length} signes) : ${(e.consigne ?? '—').slice(0, 220).replace(/\s+/g, ' ')}`,
      `  aperçu : ${[e.affiche && `image ${e.affiche}`, e.video && `vidéo ${e.video}`, e.anime && `animée ${e.anime}`].filter(Boolean).join(' · ') || 'AUCUN'}${e.lien ? `\n  publication : ${e.lien}` : ''}`,
    ].join('\n'),
  );
  return [
    `${lecture.total} entrée(s) dans la liste ; ${lues} lue(s) en entier pour l'essai, dont ${lecture.entrees.length} gardée(s) (avec une consigne${lecture.entrees.length ? '' : ' — AUCUNE : corrige « consigne » ou « garder »'}).`,
    ...lecture.avertissements.map((a) => `Attention : ${a}.`),
    ...(exemples.length ? ['Exemples :', ...exemples] : []),
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Lignes                                                              */
/* ------------------------------------------------------------------ */

function majSource(id: string, champs: Record<string, unknown>): void {
  const cles = Object.keys(champs);
  getDb()
    .prepare(`UPDATE studio_sources_styles SET ${cles.map((c) => `${c} = ?`).join(', ')}, maj_le = ? WHERE id = ?`)
    .run(...cles.map((c) => champs[c] as any), Date.now(), id);
  catalogueModifie();
}

/** Les sources pour le volet : chacune avec son nombre de styles montrés et en attente de texte. */
export function sourcesPourLeVolet() {
  const comptes = getDb().prepare(`SELECT source_id, etat, COUNT(*) AS n FROM studio_styles GROUP BY source_id, etat`).all() as { source_id: string; etat: string; n: number }[];
  return catalogueDesStyles().sources.map(({ recette: _r, ...s }) => ({
    ...s,
    nbElements: comptes.find((c) => c.source_id === s.id && c.etat === 'visible')?.n ?? 0,
    nbARediger: comptes.find((c) => c.source_id === s.id && c.etat === 'a_rediger')?.n ?? 0,
  }));
}

function idDeSource(adresse: string): string {
  const base = baseDIdDeSource(adresse);
  const pris = new Set(catalogueDesStyles().sources.map((s) => s.id));
  if (!pris.has(base)) return base;
  return `${base}-${crypto.randomBytes(2).toString('hex')}`;
}

/**
 * UNE SOURCE NAÎT : la ligne « en analyse », puis l'agent part. Le doublon se juge
 * sur l'ADRESSE COMPLÈTE (`sourceDeLAdresse`), jamais sur le seul site : deux
 * dépôts GitHub sont deux sources. La même adresse retirée est réactivée.
 */
export async function ajouterSource(brut: unknown): Promise<SourceDeStyles> {
  const avis = jugerAdresseSource(brut);
  if (!avis.ok) throw new Error(`Adresse refusée : ${avis.raison}`);
  const deja = sourceDeLAdresse(avis.valeur, catalogueDesStyles().sources);
  if (deja && deja.etat !== 'retiree') throw new Error(`Cette adresse est déjà dans les sources (« ${deja.nom} »).`);
  const maintenant = Date.now();
  const id = deja?.id ?? idDeSource(avis.valeur);
  if (deja) majSource(id, { adresse: avis.valeur, etat: 'analyse', erreur: null });
  else {
    getDb()
      .prepare(`INSERT INTO studio_sources_styles (id, adresse, nom, licence, etat, cree_le, maj_le) VALUES (?, ?, ?, '', 'analyse', ?, ?)`)
      .run(id, avis.valeur, nomDeDepartDeSource(avis.valeur), maintenant, maintenant);
    catalogueModifie();
  }
  await lancerAnalyse(id);
  return lireSource(id)!;
}

/** Le projet où vivent les cartes de l'agent : Beluga Build lui-même. */
function projetDesAgents() {
  const projets = store.listProjects();
  const projet = projets.find((p) => p.isSelf) ?? projets[0];
  if (!projet) throw new Error('Aucun projet ouvert : la conversation de l’agent n’a nulle part où vivre.');
  return projet;
}

/** Un agent de cette source travaille-t-il encore ? (sa carte est en « En cours ») */
function agentDeLaSourceAuTravail(source: SourceDeStyles): boolean {
  if (!source.cardId) return false;
  return store.getCard(source.cardId)?.column === 'running';
}

async function demarrerAgent(source: SourceDeStyles, titre: string, description: string, demande: string, motif: string): Promise<void> {
  const projet = projetDesAgents();
  // Chargés à l'appel : le moteur et les cartes ne servent qu'ici.
  const { catalogueMoteurs } = await import('./catalogue-moteurs.js');
  const { ouvrirCarteDAgent, direLaPanneSurLaCarte } = await import('./carte-d-agent-demon.js');
  const { sendPrompt } = await import('./runtime.js');
  const catalogue = await catalogueMoteurs();
  const claude = catalogue.find((moteur) => moteur.id === 'claude');
  const reglages = claude ? reglagesDuNiveau(claude, 'standard') : { model: undefined, thinking: 'none' };
  const { card, agentId } = ouvrirCarteDAgent({
    projectId: projet.id,
    titre,
    description,
    labels: [LABEL_BIBLIOTHEQUE],
    role: 'task',
    run: { engine: 'claude', model: reglages.model, thinking: reglages.thinking as any },
  });
  majSource(source.id, { agent_id: agentId, card_id: card.id, project_id: projet.id });
  void sendPrompt(agentId, demande, { template: 'none', silent: true, motif: 'bibliotheque-styles' }).catch((err) => {
    log.error(`bibliothèque : le tour de l’agent (${motif}) a échoué`, err);
    direLaPanneSurLaCarte(card.id, agentId, err?.message ?? String(err));
  });
}

/** L'ANALYSE (ou la ré-analyse) d'une source : l'agent lit le site et écrit sa recette. */
export async function lancerAnalyse(id: string): Promise<void> {
  const source = lireSource(id);
  if (!source) throw new Error('source introuvable');
  if (agentDeLaSourceAuTravail(source)) throw new Error('Un agent travaille déjà sur cette source.');
  majSource(id, { etat: 'analyse', erreur: null });
  await demarrerAgent(
    source,
    `Bibliothèque : analyser « ${source.nom} »`,
    `L’agent de la bibliothèque du Studio lit ${source.adresse} et écrit la recette qui en récupère les exemples. La source attendra ensuite la validation dans le volet « Sources ».`,
    demandeDAnalyseDeSource(source),
    'analyse-source-styles',
  );
}

/** L'agent a vu sa recette marcher : elle est gardée, la source attend la validation. */
export async function enregistrerRecette(
  id: string,
  entree: { nom?: unknown; licence?: unknown; resume?: unknown; recette: RecetteDeSource },
): Promise<{ ok: true; texte: string } | { ok: false; texte: string }> {
  const source = lireSource(id);
  if (!source) return { ok: false, texte: `Aucune source « ${id} ».` };
  let lues = 0;
  const lecture = await lireLaSource(entree.recette, { fichePour: () => lues++ < 5, maxFiches: 5 });
  if (!lecture.ok) return { ok: false, texte: `Recette NON enregistrée : ${lecture.raison}. Corrige-la et rejoue « bibliotheque_source_essai ».` };
  if (!lecture.lecture.entrees.length)
    return { ok: false, texte: `Recette NON enregistrée : aucun exemple gardé avec sa consigne.\n${phraseDeLEssai(lecture.lecture, Math.min(lues, 5))}` };
  const nom = String(entree.nom ?? '').trim().slice(0, 60) || source.nom;
  majSource(id, {
    nom,
    licence: String(entree.licence ?? '').trim().slice(0, 300),
    resume: String(entree.resume ?? '').trim().slice(0, 1200),
    recette: JSON.stringify(entree.recette),
    nb_trouves: lecture.lecture.total,
    derniere_analyse: Date.now(),
    // Une source déjà validée garde son état : la recette réparée sert dès la nuit suivante.
    etat: dejaValidee(source.etat) ? 'active' : 'a_valider',
    erreur: null,
  });
  return {
    ok: true,
    texte: `Recette enregistrée pour « ${nom} » : ${lecture.lecture.total} exemples dans la liste. ${dejaValidee(source.etat) ? 'La source était déjà validée : elle reprend dès le prochain passage.' : 'La source attend maintenant la validation de l’utilisateur dans le volet « Sources ».'}`,
  };
}

/** Une source que l'utilisateur a déjà validée (récupérée au moins une fois). */
const dejaValidee = (etat: string) => etat === 'active' || etat === 'erreur' || etat === 'verification';

/** L'agent n'a pas pu lire le site : la source passe en erreur, avec sa raison. */
export function marquerAnalyseImpossible(id: string, raison: string): void {
  majSource(id, { etat: 'erreur', erreur: raison.slice(0, 400), derniere_analyse: Date.now() });
}

/** L'agent a exploré un annuaire : il ne publie rien lui-même, ses sites ont été proposés. Un état final, pas une erreur. */
export function marquerAnnuaire(id: string, resume: string): void {
  const proposees = catalogueDesStyles().sources.filter((s) => s.trouveeDans === id).length;
  majSource(id, {
    etat: 'annuaire',
    erreur: null,
    resume: resume.trim().slice(0, 1200) || `${proposees} source(s) proposée(s) depuis cet annuaire.`,
    nb_trouves: proposees,
    derniere_analyse: Date.now(),
  });
}

/**
 * UN SITE TROUVÉ DANS UN ANNUAIRE DEVIENT UNE SOURCE « À VALIDER » : l'adresse est jugée (jamais une source déjà
 * suivie, vingt au plus par annuaire), la recette REJOUÉE pour de vrai, et l'utilisateur décide comme pour toute
 * source. Rien n'est récupéré avant sa validation.
 */
export async function proposerSourceDepuisAnnuaire(
  annuaireId: string,
  entree: { adresse?: unknown; nom?: unknown; licence?: unknown; resume?: unknown; recette: RecetteDeSource },
): Promise<{ ok: boolean; texte: string }> {
  const annuaire = lireSource(annuaireId);
  if (!annuaire) return { ok: false, texte: `Aucune source « ${annuaireId} ».` };
  const sources = catalogueDesStyles().sources;
  const avis = jugerPropositionDeSource(entree.adresse, annuaire, sources, sources.filter((s) => s.trouveeDans === annuaireId).length);
  if (!avis.ok) return { ok: false, texte: `Source NON proposée : ${avis.raison}.` };
  let lues = 0;
  const lecture = await lireLaSource(entree.recette, { fichePour: () => lues++ < 5, maxFiches: 5 });
  if (!lecture.ok) return { ok: false, texte: `Source NON proposée : ${lecture.raison}. Corrige la recette avec « bibliotheque_source_essai ».` };
  if (!lecture.lecture.entrees.length) return { ok: false, texte: `Source NON proposée : aucun exemple gardé avec sa consigne.\n${phraseDeLEssai(lecture.lecture, Math.min(lues, 5))}` };
  const maintenant = Date.now();
  const id = idDeSource(avis.valeur);
  const nom = String(entree.nom ?? '').trim().slice(0, 60) || nomDeDepartDeSource(avis.valeur);
  const resume = String(entree.resume ?? '').trim().slice(0, 1100);
  getDb()
    .prepare(
      `INSERT INTO studio_sources_styles (id, adresse, nom, licence, etat, recette, resume, nb_trouves, derniere_analyse, trouvee_dans, cree_le, maj_le)
       VALUES (?, ?, ?, ?, 'a_valider', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      avis.valeur,
      nom,
      String(entree.licence ?? '').trim().slice(0, 300),
      JSON.stringify(entree.recette),
      `${resume}${resume ? '\n' : ''}Trouvée dans « ${annuaire.nom} ».`,
      lecture.lecture.total,
      maintenant,
      annuaireId,
      maintenant,
      maintenant,
    );
  catalogueModifie();
  return { ok: true, texte: `Source proposée : « ${nom} » (${lecture.lecture.total} exemples dans la liste). Elle attend la validation de l’utilisateur dans le volet « Sources ».` };
}

export function validerSource(id: string): void {
  const source = lireSource(id);
  if (!source) throw new Error('source introuvable');
  if (source.etat !== 'a_valider') throw new Error('Cette source n’attend pas de validation.');
  majSource(id, { etat: 'recuperation' });
  void recupererSource(id).catch((err) => log.error('bibliothèque : récupération impossible', err));
}

/** « Contrôler maintenant » : le passage de nuit, à la demande — seulement sur une source déjà validée. */
export function controlerMaintenant(id: string): void {
  const source = lireSource(id);
  if (!source) throw new Error('source introuvable');
  if (!dejaValidee(source.etat)) throw new Error('Seule une source validée se contrôle.');
  if (!source.recette) throw new Error('Cette source n’a pas encore de recette : analysez-la de nouveau.');
  void recupererSource(id).catch((err) => log.error('bibliothèque : contrôle impossible', err));
}

/* ------------------------------------------------------------------ */
/* Le volet « Passer la vérification »                                 */
/* ------------------------------------------------------------------ */

/** Le volet s'ouvre sur une source : son navigateur part sur son adresse. */
export async function ouvrirVerificationDeSource(id: string): Promise<void> {
  const source = lireSource(id);
  if (!source) throw new Error('source introuvable');
  const { ouvrirVerification } = await import('./studio-navigateur.js');
  await ouvrirVerification(id, source.adresse);
}

/**
 * « C'EST FAIT » : la page ne doit plus être une vérification ; la source se lit alors PAR CE NAVIGATEUR (le seul à
 * qui le site a délivré son laissez-passer), et le restera, la nuit comprise.
 */
export async function terminerVerification(id: string): Promise<{ ok: boolean; texte: string }> {
  const source = lireSource(id);
  if (!source) throw new Error('source introuvable');
  const navigateur = await import('./studio-navigateur.js');
  if (await navigateur.verificationEncoreAffichee(id))
    return { ok: false, texte: 'La page demande encore la vérification : passez-la dans le navigateur ci-dessus, puis recommencez.' };
  majSource(id, { par_navigateur: 1, alerte_verification: null });
  if (!source.recette) {
    await navigateur.fermerVerification(id);
    return { ok: true, texte: 'Vérification passée. Cette source n’a pas encore de recette : lancez « Analyser de nouveau ».' };
  }
  const r = await navigateur.lireAvecLeVolet(id, (lecteur) => recupererSource(id, lecteur));
  if (r.erreur) return { ok: false, texte: `La vérification est passée, mais la lecture a échoué : ${r.erreur}` };
  return { ok: true, texte: `Vérification passée : ${r.nouveaux} nouveauté(s). La source se lit désormais par ce navigateur, chaque nuit.` };
}

export function retirerSource(id: string): void {
  if (!lireSource(id)) throw new Error('source introuvable');
  majSource(id, { etat: 'retiree' });
}

/* ------------------------------------------------------------------ */
/* Récupérer les nouveautés                                            */
/* ------------------------------------------------------------------ */

const consigneNormalisee = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();
const passagesEnCours = new Set<string>();

/** Une image animée annoncée existe-t-elle vraiment ? (la collection n'en a que pour certains) */
async function existe(url: string): Promise<boolean> {
  try {
    const r = await appelExterieur(url, 15_000);
    void r.body?.cancel().catch(() => undefined);
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * LE PASSAGE D'UNE SOURCE : la recette rejouée seule, les entrées inconnues
 * rangées « à rédiger » (marque « Nouveau » pour sept jours), puis un agent
 * seulement s'il y a quelque chose à écrire.
 */
export async function recupererSource(
  id: string,
  lecteur?: (url: string) => Promise<{ ok: true; texte: string } | { ok: false; raison: string }>,
): Promise<{ nouveaux: number; erreur?: string }> {
  if (passagesEnCours.has(id)) return { nouveaux: 0, erreur: 'un passage est déjà en cours' };
  passagesEnCours.add(id);
  try {
    const source = lireSource(id);
    if (!source?.recette) throw new Error('source sans recette');
    const db = getDb();
    const connus = new Set((db.prepare('SELECT id_origine FROM studio_styles WHERE source_id = ?').all(id) as { id_origine: string }[]).map((l) => l.id_origine));
    const options = { fichePour: (e: EntreeDeSource) => !connus.has(e.idOrigine) };
    /* LA LECTURE : par le navigateur du volet quand on vient d'y passer la vérification, par le navigateur de la source
       (son profil durable) quand elle se lit ainsi, sinon par le démon. Le démon arrêté par une vérification réessaie
       d'office avec le vrai navigateur (souvent laissé passer sans rien demander) : s'il passe, la source se lit
       désormais ainsi ; sinon, elle attend que l'utilisateur passe la vérification. */
    const navigateur = await import('./studio-navigateur.js');
    const parNavigateur = (r: RecetteDeSource) => navigateur.avecNavigateur(id, source.adresse, (lecteur) => lireLaSource(r, { ...options, lecteur }));
    let lecture = lecteur
      ? await lireLaSource(source.recette, { ...options, lecteur })
      : source.parNavigateur
        ? ((await parNavigateur(source.recette)) ?? { ok: false as const, raison: 'le navigateur des sources est occupé : nouvel essai au prochain passage' })
        : await lireLaSource(source.recette, options);
    if (!lecture.ok && lecture.raison === RAISON_ANTI_ROBOT && !lecteur && !source.parNavigateur) {
      lecture = (await parNavigateur(source.recette)) ?? lecture;
      if (lecture.ok) majSource(id, { par_navigateur: 1 });
    }
    const maintenant = Date.now();
    if (!lecture.ok) {
      // UNE VÉRIFICATION À REFAIRE n'est pas une panne : la source l'attend, ses styles restent, la cloche préviendra.
      const verification = lecture.raison === RAISON_ANTI_ROBOT;
      majSource(id, {
        etat: source.etat === 'retiree' ? 'retiree' : verification ? 'verification' : 'erreur',
        erreur: verification ? 'Le site demande de passer sa vérification anti-robot : ouvrez « Passer la vérification ».' : lecture.raison,
        dernier_passage: maintenant,
        nb_nouveaux: 0,
      });
      log.info(`bibliothèque : « ${source.nom} » ${verification ? 'attend une vérification' : 'en erreur'} — ${lecture.raison}`);
      if (verification) prevenirDesVerifications();
      return { nouveaux: 0, erreur: lecture.raison };
    }
    const tous = db.prepare('SELECT id, lien, consigne FROM studio_styles').all() as { id: string; lien: string | null; consigne: string }[];
    const pris = new Set(tous.map((t) => t.id));
    const publications = new Set(tous.map((t) => clePublication(t.lien)).filter(Boolean));
    const consignes = new Set(tous.map((t) => consigneNormalisee(t.consigne)));
    const ajouter = db.prepare(
      `INSERT OR IGNORE INTO studio_styles (id, source_id, id_origine, etat, rang, titre, titre_origine, categorie_origine, consigne, auteur, auteur_url, lien, affiche, video, anime, ajoute_le, nouveau_jusqua)
       VALUES (?, ?, ?, 'a_rediger', ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let nouveaux = 0;
    let rang = (db.prepare('SELECT COALESCE(MAX(rang), 0) AS r FROM studio_styles').get() as { r: number }).r;
    for (const e of lecture.lecture.entrees) {
      if (connus.has(e.idOrigine)) continue;
      const publication = clePublication(e.lien);
      const consigne = (e.consigne ?? '').slice(0, 40_000);
      if ((publication && publications.has(publication)) || consignes.has(consigneNormalisee(consigne))) continue;
      const styleId = idDeStyleNeuf(e.idOrigine, id, pris);
      if (!styleId) continue;
      const anime = e.anime && nouveaux < 80 && (await existe(e.anime)) ? e.anime : null;
      ajouter.run(
        styleId,
        id,
        e.idOrigine,
        ++rang,
        e.titre?.slice(0, 200) ?? null,
        e.categorie?.slice(0, 60) ?? null,
        consigne,
        (e.auteur ?? '').slice(0, 120),
        e.auteurUrl ?? null,
        e.lien ?? null,
        e.affiche ?? null,
        e.video ?? null,
        anime,
        maintenant,
        maintenant + JOURS_NOUVEAU * 86_400_000,
      );
      pris.add(styleId);
      if (publication) publications.add(publication);
      consignes.add(consigneNormalisee(consigne));
      nouveaux++;
    }
    const enAttente = (db.prepare(`SELECT COUNT(*) AS n FROM studio_styles WHERE source_id = ? AND etat = 'a_rediger'`).get(id) as { n: number }).n;
    majSource(id, {
      etat: source.etat === 'retiree' ? 'retiree' : 'active',
      erreur: lecture.lecture.avertissements.length ? lecture.lecture.avertissements.join(' ; ') : null,
      dernier_passage: maintenant,
      nb_nouveaux: nouveaux,
      nb_trouves: lecture.lecture.total,
    });
    log.info(`bibliothèque : « ${source.nom} » — ${nouveaux} nouveauté(s), ${enAttente} à rédiger`);
    // L'agent qui rédige ne part pas ? Les styles attendent, la source reste saine : le passage suivant le relancera.
    if (enAttente) await lancerRedaction(id, enAttente).catch((err) => log.warn(`bibliothèque : rédaction non lancée (${(err as Error).message})`));
    return { nouveaux };
  } catch (err: any) {
    const raison = err?.message ?? String(err);
    const source = lireSource(id);
    if (source) majSource(id, { etat: source.etat === 'retiree' ? 'retiree' : 'erreur', erreur: raison, dernier_passage: Date.now(), nb_nouveaux: 0 });
    return { nouveaux: 0, erreur: raison };
  } finally {
    passagesEnCours.delete(id);
  }
}

/** UN AGENT RÉDIGE les styles en attente d'une source — un seul à la fois par source. */
async function lancerRedaction(id: string, nombre: number): Promise<void> {
  const source = lireSource(id);
  if (!source || agentDeLaSourceAuTravail(source)) return;
  await demarrerAgent(
    source,
    `Bibliothèque : ${nombre} nouveau${nombre > 1 ? 'x' : ''} style${nombre > 1 ? 's' : ''} de « ${source.nom} »`,
    `L’agent de la bibliothèque du Studio écrit le titre, la phrase et les catégories des styles arrivés de ${source.adresse}. Ils paraissent dans la bibliothèque avec la marque « Nouveau ».`,
    demandeDeRedactionDesStyles({ sourceId: id, nom: source.nom, nombre }),
    'redaction-styles',
  );
}

/* ------------------------------------------------------------------ */
/* Ce que l'agent de rédaction lit et écrit                            */
/* ------------------------------------------------------------------ */

export function lotARediger(sourceId?: string): string {
  const lignes = getDb()
    .prepare(
      `SELECT id, source_id, titre_origine, categorie_origine, auteur, consigne FROM studio_styles WHERE etat = 'a_rediger' ${sourceId ? 'AND source_id = ?' : ''} ORDER BY rang LIMIT ?`,
    )
    .all(...(sourceId ? [sourceId, TAILLE_LOT_REDACTION] : [TAILLE_LOT_REDACTION])) as {
    id: string;
    source_id: string;
    titre_origine: string | null;
    categorie_origine: string | null;
    auteur: string;
    consigne: string;
  }[];
  const reste = (getDb().prepare(`SELECT COUNT(*) AS n FROM studio_styles WHERE etat = 'a_rediger' ${sourceId ? 'AND source_id = ?' : ''}`).get(...(sourceId ? [sourceId] : [])) as { n: number }).n;
  if (!lignes.length) return 'Plus rien à rédiger : tous les styles de cette source sont écrits.';
  const categories = categoriesDeLaBibliotheque().map((c) => `${c.id} (${c.libelle})`).join(', ');
  return [
    `${lignes.length} style(s) dans ce lot, ${reste} en attente en tout.`,
    `CATÉGORIES : ${categories}`,
    '',
    ...lignes.map((l) =>
      [`### ${l.id}`, l.titre_origine ? `titre d’origine : ${l.titre_origine}` : null, l.categorie_origine ? `catégorie d’origine : ${l.categorie_origine}` : null, `auteur : ${l.auteur || '—'}`, `consigne : ${l.consigne.slice(0, 900).replace(/\s+/g, ' ')}`]
        .filter(Boolean)
        .join('\n'),
    ),
  ].join('\n');
}

/** LES TEXTES D'UN LOT : contrôlés un à un, puis le style paraît. */
export function ecrireStylesRediges(entree: { styles?: unknown; categoriesNeuves?: unknown; ecarter?: unknown }): string {
  const db = getDb();
  const rapport: string[] = [];
  const maintenant = Date.now();
  // Les rares catégories neuves d'abord : un style du même lot peut s'en servir.
  for (const c of Array.isArray(entree.categoriesNeuves) ? entree.categoriesNeuves.slice(0, 3) : []) {
    const libelle = String((c as any)?.libelle ?? c ?? '').trim().slice(0, 40);
    const id = idDeCategorieNeuve(libelle);
    if (!id || categoriesDeLaBibliotheque().some((x) => x.id === id)) continue;
    db.prepare('INSERT OR IGNORE INTO studio_categories_ajoutees (id, libelle, cree_le) VALUES (?, ?, ?)').run(id, libelle, maintenant);
    rapport.push(`Catégorie ajoutée : ${id} (${libelle}).`);
  }
  const connues = new Set(categoriesDeLaBibliotheque().map((c) => c.id));
  const enAttente = db.prepare(`SELECT id FROM studio_styles WHERE id = ? AND etat = 'a_rediger'`);
  const ecrire = db.prepare(`UPDATE studio_styles SET etat = 'visible', titre = ?, phrase = ?, mots_cles = ?, genre = ?, categories = ? WHERE id = ? AND etat = 'a_rediger'`);
  let ecrits = 0;
  for (const s of Array.isArray(entree.styles) ? (entree.styles as any[]) : []) {
    const id = String(s?.id ?? '');
    if (!enAttente.get(id)) {
      rapport.push(`${id} : inconnu ou déjà rédigé.`);
      continue;
    }
    const titre = String(s.titre ?? '').trim();
    const phrase = String(s.phrase ?? '').trim();
    const categories = categoriesDuStyle(s.categories, connues);
    if (!titre || titre.length > 80 || !phrase || phrase.length > 260 || !categories.length) {
      rapport.push(`${id} : refusé (titre de 1 à 80 signes, phrase de 1 à 260 signes, au moins une catégorie connue).`);
      continue;
    }
    const motsCles = (Array.isArray(s.motsCles) ? s.motsCles : []).map((m: unknown) => String(m).trim()).filter(Boolean).slice(0, 8);
    ecrire.run(titre, phrase, JSON.stringify(motsCles), s.genre === 'explication' ? 'explication' : 'motion', JSON.stringify(categories), id);
    ecrits++;
  }
  let ecartes = 0;
  for (const id of Array.isArray(entree.ecarter) ? entree.ecarter : []) ecartes += db.prepare(`UPDATE studio_styles SET etat = 'ecarte' WHERE id = ? AND etat = 'a_rediger'`).run(String(id)).changes;
  if (ecrits || ecartes) catalogueModifie();
  const reste = (db.prepare(`SELECT COUNT(*) AS n FROM studio_styles WHERE etat = 'a_rediger'`).get() as { n: number }).n;
  return [`${ecrits} style(s) rédigé(s) et montré(s), ${ecartes} écarté(s). Il en reste ${reste} à rédiger${reste ? ' : redemande « bibliotheque_styles_a_rediger ».' : '.'}`, ...rapport].join('\n');
}

/* ------------------------------------------------------------------ */
/* La nuit                                                             */
/* ------------------------------------------------------------------ */

const jourDe = (ms: number) => new Date(ms).toDateString();

/** Faut-il passer cette source maintenant ? Une fois par nuit, entre 1 h et 6 h. */
export function sourceAPasser(source: Pick<SourceDeStyles, 'etat' | 'dernierPassage' | 'recette'>, maintenant: Date): boolean {
  const h = maintenant.getHours();
  if (h < 1 || h >= 6) return false;
  if (!dejaValidee(source.etat)) return false;
  if (!source.recette) return false;
  return !source.dernierPassage || (jourDe(source.dernierPassage) !== jourDe(maintenant.getTime()) && maintenant.getTime() - source.dernierPassage > 12 * 3600_000);
}

let nuitEnCours = false;

async function passerLaNuit(): Promise<void> {
  if (nuitEnCours) return;
  nuitEnCours = true;
  try {
    const { publicationEnCours } = await import('./deploy.js');
    const projet = store.listProjects().find((p) => p.isSelf);
    // Jamais pendant une publication : la nuit reprend au tour suivant du minuteur.
    if (projet && publicationEnCours(projet.id)) return;
    for (const source of catalogueDesStyles().sources) {
      if (!sourceAPasser(source, new Date())) continue;
      await recupererSource(source.id);
    }
  } catch (err) {
    log.warn(`bibliothèque : passage de nuit (${(err as Error).message})`);
  } finally {
    nuitEnCours = false;
  }
}

/**
 * LA CLOCHE PRÉVIENT QU'UNE VÉRIFICATION EST À REFAIRE — une fois par jour et par source, jamais pendant les heures de
 * silence (la nuit, où la vérification revient, en est souvent) : l'alerte attend alors le premier tour du minuteur
 * d'après. Une attente (genre « attente »), qui mène d'un clic au volet de CETTE source.
 */
export function prevenirDesVerifications(maintenant = new Date()): void {
  const reglages = store.getSettings();
  if (dansLesHeuresDeSilence(maintenant.getHours(), reglages.quietHoursStart, reglages.quietHoursEnd)) return;
  for (const source of catalogueDesStyles().sources) {
    if (source.etat !== 'verification') continue;
    if (source.alerteVerification && jourDe(source.alerteVerification) === jourDe(maintenant.getTime())) continue;
    majSource(source.id, { alerte_verification: maintenant.getTime() });
    void import('./notify.js').then(({ notify }) =>
      notify({
        motif: 'decision-attendue',
        title: `Studio : vérification à refaire pour « ${source.nom} »`,
        body: 'Le site demande de repasser sa vérification anti-robot. Ses styles restent dans la bibliothèque ; ouvrez le volet pour la passer et reprendre les nouveautés.',
        reference: `verification-source:${source.id}:${jourDe(maintenant.getTime())}`,
        element: source.nom,
        url: `#studio/verification:${encodeURIComponent(source.id)}`,
      }),
    );
  }
}

/** Le minuteur de la nuit (toutes les dix minutes). Rend sa fonction d'arrêt. */
export function veillerSurLesSourcesDeStyles(): () => void {
  if (process.env.BELUGA_SOURCES_STYLES_NUIT === '0') return () => {};
  const minuteur = setInterval(() => {
    void passerLaNuit();
    try {
      prevenirDesVerifications();
    } catch (err) {
      log.warn(`bibliothèque : alerte de vérification (${(err as Error).message})`);
    }
  }, 10 * 60_000);
  minuteur.unref();
  return () => clearInterval(minuteur);
}
