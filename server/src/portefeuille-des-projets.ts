/**
 * LE TOUR D'HORIZON DES PROJETS, lu dans la base en UN appel (outil `assistant_portefeuille` de l'assistant global,
 * carte « Jarvis : micro coupé, vrai concierge », 24/11/2026).
 *
 * Sans moteur et sans réseau : des lectures SQLite bornées, projet par projet — tâches, fiche de l'outil marketing,
 * visites et ventes des 30 derniers jours, dernier audit SEO + GEO, réseaux reliés et publications, créations du
 * Studio, marque de Communication et ses campagnes, et (installation complète) le dossier marketing. Chaque source se
 * lit dans son propre filet : une table absente fait « indisponible », jamais une panne de l'outil. La mise en forme et
 * les manques vivent dans `shared/src/portefeuille-des-projets.ts`.
 */
import {
  INDISPONIBLE,
  texteDuPortefeuille,
  type FicheDuPortefeuille,
  type MarketingDuPortefeuille,
  type MarqueDuPortefeuille,
} from '@beluga/shared';
import { getDb } from './db.js';
import * as store from './store.js';
import { lireEspace } from './marketing.js';
import { marqueDuProjet } from './communication.js';
import { log } from './logger.js';
import type { ToolResult } from './tools.js';

const JOUR = 86_400_000;

/** Une lecture dans son filet : une table absente ou illisible rend la valeur de repli. */
function lire<T>(source: string, lecture: () => T, repli: T): T {
  try {
    return lecture();
  } catch (e) {
    log.debug(`tour d'horizon : ${source} illisible`, String((e as Error)?.message ?? e));
    return repli;
  }
}

/** Un texte coupé à un mot entier, avec « … » quand il est plus long. */
function couper(texte: string, max: number): string {
  const t = texte.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const coupe = t.slice(0, max);
  return `${coupe.slice(0, Math.max(coupe.lastIndexOf(' '), max * 0.6)).replace(/[\s,;:—-]+$/, '')}…`;
}

function adresseHttp(...candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    const a = (c ?? '').trim();
    if (/^https?:\/\//i.test(a)) {
      try {
        const u = new URL(a);
        return `${u.protocol}//${u.host}`;
      } catch {
        /* adresse illisible : la suivante */
      }
    }
  }
  return null;
}

/** Le dossier marketing de chaque projet (installation complète seulement), par identifiant de projet. */
async function dossiersMarketing(): Promise<Map<string, MarketingDuPortefeuille> | null> {
  let dossiers: Map<string, MarketingDuPortefeuille> | null = null;
  return dossiers;
}

function ficheDuProjet(
  p: ReturnType<typeof store.listProjects>[number],
  groupe: string | null,
  dossiers: Map<string, MarketingDuPortefeuille> | null,
  maintenant: number,
): FicheDuPortefeuille {
  const db = getDb();
  const depuis = maintenant - 30 * JOUR;
  const espace = lire('outil marketing', () => lireEspace(p.id), null);

  const cartes = lire('tâches', () => store.listCards(p.id), []);
  const terminees = cartes.filter((c) => (c.doneAt ?? 0) >= depuis).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  const taches = {
    enCours: cartes.filter((c) => c.column === 'running').length,
    aFaire: cartes.filter((c) => c.column === 'planned').length,
    aDeployer: cartes.filter((c) => c.column === 'to_deploy').length,
    termineesSur30j: terminees.length,
    derniereTerminee: terminees[0] ? { titre: terminees[0].title.slice(0, 80), le: terminees[0].doneAt ?? 0 } : null,
  };

  const visites = espace
    ? lire(
        'visites',
        () => {
          const compter = (de: number, a: number) =>
            db
              .prepare("SELECT COUNT(DISTINCT visiteur) AS visiteurs, SUM(type = 'vue') AS vues FROM marketing_evenements WHERE project_id = ? AND instant >= ? AND instant < ?")
              .get(p.id, de, a) as { visiteurs: number | null; vues: number | null };
          const ici = compter(depuis, maintenant + 1);
          const avant = compter(depuis - 30 * JOUR, depuis);
          return { suivi: espace.configuration.etatSuivi, visiteurs30: ici.visiteurs ?? 0, visiteursAvant: avant.visiteurs ?? 0, vues30: ici.vues ?? 0 };
        },
        { suivi: espace.configuration.etatSuivi, visiteurs30: 0, visiteursAvant: 0, vues30: 0 },
      )
    : null;

  const ventesLues = lire(
    'ventes',
    () =>
      db
        .prepare('SELECT COUNT(*) AS nombre, SUM(montant_centimes) AS montant, MAX(devise) AS devise FROM marketing_ventes WHERE project_id = ? AND instant >= ?')
        .get(p.id, depuis) as { nombre: number; montant: number | null; devise: string | null },
    { nombre: 0, montant: null, devise: null },
  );

  const audit = lire<FicheDuPortefeuille['audit']>(
    'audit SEO + GEO',
    () => {
      const lignes = db.prepare('SELECT note, fait_le FROM referencement_releves WHERE project_id = ? ORDER BY fait_le DESC LIMIT 2').all(p.id) as {
        note: number | null;
        fait_le: number;
      }[];
      if (!lignes[0]) return null;
      const avant = lignes[1]?.note;
      const note = lignes[0].note;
      const tendance = note === null || avant === null || avant === undefined ? null : note > avant ? 'en hausse' : note < avant ? 'en baisse' : 'stable';
      return { note, faitLe: lignes[0].fait_le, tendance };
    },
    INDISPONIBLE,
  );

  const reseaux = lire(
    'réseaux',
    () => {
      const relies = (db.prepare("SELECT DISTINCT reseau FROM marketing_comptes WHERE project_id = ? AND etat = 'relie' ORDER BY reseau").all(p.id) as { reseau: string }[]).map((r) => r.reseau);
      const pub = db
        .prepare('SELECT COUNT(*) AS n FROM marketing_publications mp JOIN marketing_comptes mc ON mc.id = mp.compte_id WHERE mc.project_id = ? AND mp.publie_le >= ?')
        .get(p.id, depuis) as { n: number };
      return { relies, publications30: pub.n };
    },
    { relies: [], publications30: 0 },
  );

  const studio = lire(
    'Studio',
    () => {
      const n = (db.prepare('SELECT COUNT(*) AS n FROM studio_creations WHERE project_id = ?').get(p.id) as { n: number }).n;
      const derniere = db.prepare('SELECT titre, maj_le FROM studio_creations WHERE project_id = ? ORDER BY maj_le DESC LIMIT 1').get(p.id) as
        | { titre: string; maj_le: number }
        | undefined;
      return { creations: n, derniere: derniere ? { titre: derniere.titre.slice(0, 60), le: derniere.maj_le } : null };
    },
    { creations: 0, derniere: null },
  );

  const fiche = espace?.fiche;
  const presentation = couper(
    [fiche?.promesse, fiche?.cible ? `pour ${fiche.cible}` : '', fiche?.prix ? `prix : ${fiche.prix}` : '']
      .map((x) => (x ?? '').trim())
      .filter(Boolean)
      .join(' — '),
    180,
  );

  return {
    nom: p.name,
    groupe,
    adresse: adresseHttp(espace?.configuration.adresse, (p as { adresseProduction?: string }).adresseProduction),
    nature: espace?.configuration.nature ?? null,
    presentation: presentation || couper(espace?.configuration.explication ?? '', 180) || null,
    taches,
    marketing: dossiers ? (dossiers.get(p.id) ?? { etat: 'absent' }) : { etat: INDISPONIBLE },
    visites,
    ventes: {
      suivies: !!espace?.configuration.sourcesVentes?.length,
      nombre30: ventesLues.nombre ?? 0,
      montantCentimes30: ventesLues.montant ?? 0,
      devise: ventesLues.devise,
    },
    audit,
    reseaux,
    studio,
  };
}

/** Les projets visés : tous les projets actifs, ou ceux nommés (`projets`), d'un groupe (`groupe`), ou le projet visé. */
function projetsVises(args: { projets?: unknown; groupe?: unknown }, projetVise: string | undefined) {
  const groupes = new Map(store.listGroups().map((g) => [g.id, g.name]));
  let projets = store.listProjects().filter((p) => !projetVise || p.id === projetVise);
  const noms = Array.isArray(args.projets) ? args.projets.map((x) => String(x).trim().toLowerCase()).filter(Boolean) : [];
  if (noms.length) projets = projets.filter((p) => noms.some((n) => p.name.toLowerCase().includes(n) || p.id === n));
  const groupe = typeof args.groupe === 'string' ? args.groupe.trim().toLowerCase() : '';
  if (groupe) projets = projets.filter((p) => (p.groupId ? (groupes.get(p.groupId) ?? '') : '').toLowerCase().includes(groupe));
  return { projets, groupes };
}

/** Le relevé : un texte compact, marque par marque, les plus actives d'abord. */
export async function portefeuilleDesProjets(args: { projets?: unknown; groupe?: unknown }, projetVise?: string, maintenant = Date.now()): Promise<ToolResult> {
  const { projets, groupes } = projetsVises(args, projetVise);
  if (!projets.length) return { ok: false, text: `Aucun projet ne répond. Projets : ${store.listProjects().map((p) => p.name).join(', ')}.` };
  const dossiers = await dossiersMarketing();
  const parMarque = new Map<string, MarqueDuPortefeuille>();
  for (const p of projets) {
    const marque = lire('marque', () => marqueDuProjet(p.id), null);
    const cle = marque ? `marque:${marque.id}` : `projet:${p.id}`;
    let m = parMarque.get(cle);
    if (!m) {
      const campagnes = marque
        ? lire(
            'campagnes',
            () => {
              const lignes = getDb().prepare('SELECT titre, statut FROM communication_campagnes WHERE marque_id = ? ORDER BY maj_le DESC').all(marque.id) as { titre: string; statut: string }[];
              const enCours = lignes.filter((l) => l.statut === 'en_cours');
              return { total: lignes.length, enCours: enCours.length, titres: enCours.slice(0, 3).map((l) => l.titre.slice(0, 60)) };
            },
            null,
          )
        : null;
      m = { nom: marque?.nom ?? null, projets: [], campagnes };
      parMarque.set(cle, m);
    }
    m.projets.push(ficheDuProjet(p, p.groupId ? (groupes.get(p.groupId) ?? null) : null, dossiers, maintenant));
  }
  return { ok: true, text: texteDuPortefeuille([...parMarque.values()], { maintenant }) };
}
