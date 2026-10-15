import { NOM_ACCES_MAX } from './coffre-fort.js';
import { minusculesSansAccents } from './mots.js';

/**
 * LA RÉORGANISATION DU COFFRE-FORT — le plan, sans rien écrire.
 *
 * Le coffre a grossi fiche après fiche : un même service (Stripe, Resend,
 * WordPress…) éparpillé sur plusieurs projets, des noms qui ne suivent pas tous
 * « <Projet> — <service> — <rôle> (<env>) », des fiches révoquées encore
 * actives. Ce fichier décide, pour chaque fiche, d'après son NOM et son type :
 *
 *  - le DOSSIER où la ranger (un seul niveau) ;
 *  - le PROJET auquel elle appartient réellement ;
 *  - son nom harmonisé — par de simples séparateurs, JAMAIS en changeant un mot :
 *    des lecteurs du coffre (relais, studio, installation) retrouvent une fiche
 *    à son nom ou à un mot de son nom ;
 *  - ce qu'il faut ARCHIVER, et seulement ce qui est explicite : une fiche dite
 *    révoquée ou remplacée, ou le doublon exact d'une autre fiche du même projet.
 *    Tout le reste de douteux est SIGNALÉ, jamais touché.
 *
 * La fonction est pure : le script (`scripts/reorganiser-coffre.mjs`) lui donne
 * l'état du coffre et applique ce qu'elle rend, après avoir mis l'état d'avant
 * de côté. Elle ne reçoit JAMAIS une valeur secrète — seulement l'empreinte
 * qui permet de reconnaître deux fiches identiques.
 */

export interface FicheAPlanifier {
  id: string;
  nom: string;
  type: string;
  projectId: string | null;
  projetNom: string | null;
  /** L'empreinte des valeurs secrètes (jamais les valeurs) ; `null` si la fiche n'en porte aucune. */
  empreinte: string | null;
  /** Combien de champs et d'images la fiche porte : à égalité de doublon, la plus riche reste. */
  richesse: number;
  modifieLe: number;
  /** Un lecteur du coffre la retrouve par son nom exact : ni renommée, ni archivée. */
  figee: boolean;
}

export interface ProjetConnu {
  id: string;
  name: string;
}

export interface PlanDeFiche {
  id: string;
  nomAvant: string;
  nomApres: string;
  projetAvant: string | null;
  projetApres: string | null;
  /** Le nom du dossier, ou `null` : la fiche reste à la racine. */
  dossier: string | null;
  /** La raison de l'archivage, ou `null`. */
  archiver: string | null;
  /** Un cas douteux qu'on ne touche pas, dit à l'utilisateur. */
  signaler: string | null;
}

export interface PlanDeDossier {
  nom: string;
  projectId: string | null;
  fiches: number;
}

export interface PlanDeReorganisation {
  fiches: PlanDeFiche[];
  dossiers: PlanDeDossier[];
}

const norme = (texte: string) => minusculesSansAccents(texte ?? '').replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------ */
/* QUI POSSÈDE LA FICHE                                                */
/* ------------------------------------------------------------------ */

/**
 * Des appellations du nom qui ne sont pas le nom d'un projet : « ProjetA » est le
 * produit, son projet est « ProjetA Saas » ; « HaikoBeluga » vit dans « HaikoDev ».
 * `projet` est le NOM du projet visé, cherché parmi les projets connus.
 */
const ALIAS_DE_PROPRIETAIRE: ReadonlyArray<{ cle: string; affiche: string; projet: string | null }> = [
  { cle: 'projeta', affiche: 'ProjetA', projet: 'ProjetA Saas' },
  { cle: 'projeta vps', affiche: 'ProjetA VPS', projet: 'ProjetA Interface VPS' },
  { cle: 'haikobeluga', affiche: 'HaikoBeluga', projet: 'HaikoDev' },
  { cle: 'beluga heberge', affiche: 'Beluga hébergé', projet: 'Beluga Build' },
  { cle: 'haiko studio', affiche: 'Haiko Studio', projet: 'Haiko Studio' },
  { cle: 'projetc dashboard', affiche: 'ProjetC', projet: 'projetc' },
];

/** Un projet « d'ensemble » : ses fiches se rangent par fournisseur, pas sous son nom. */
const PROJETS_PARTAGES = new Set(['beluga', 'vps', 'beluga build']);

/** Les fournisseurs reconnus dans un nom de fiche rangée sous un projet partagé. */
const FOURNISSEURS: ReadonlyArray<[string, string]> = [
  ['infomaniak', 'Infomaniak'],
  ['hetzner', 'Hetzner'],
  ['hostinger', 'Hostinger'],
  ['google', 'Google'],
  ['openrouter', 'OpenRouter'],
  ['resend', 'Resend'],
  ['xiaomi', 'Xiaomi MiMo'],
  ['wordfence', 'Wordfence'],
  ['stripe', 'Stripe'],
  ['github', 'GitHub'],
  ['cloudflare', 'Cloudflare'],
];

/** Ce qui est personnel (identité, banque) : un dossier à part. */
const MOTS_PERSONNELS: readonly RegExp[] = [
  /\biban\b/,
  /carte bancaire/,
  /informations personnelles/,
  /(^|[^\w.])x\.com\b/,
];

/** Jusqu'à ce nombre de fiches, un propriétaire tient dans un seul dossier. */
const MAX_FICHES_D_UN_DOSSIER_UNIQUE = 8;
/** Un service n'a son dossier qu'à partir de ce nombre de fiches. */
const MIN_FICHES_D_UN_SERVICE = 3;

const DOSSIER_PERSONNEL = 'Personnel';
const DOSSIER_NOMS_DE_DOMAINE = 'Noms de domaine';
const DOSSIER_SERVICES_PARTAGES = 'Services partagés';

/** Le service qu'une fiche sert, d'après le deuxième segment (ou le nom entier). */
const SERVICES: ReadonlyArray<[string, string]> = [
  ['stripe', 'Stripe'],
  ['openrouter', 'OpenRouter'],
  ['resend', 'Resend'],
  ['wordpress', 'WordPress'],
  ['github', 'GitHub'],
  ['google', 'Google'],
  ['hetzner', 'Hetzner'],
  ['infomaniak', 'Infomaniak'],
  ['brevo', 'Brevo'],
  ['pocketbase', 'PocketBase'],
  ['supabase', 'Supabase'],
  ['centrifugo', 'Centrifugo'],
  ['didit', 'Didit'],
  ['verotel', 'Verotel'],
  ['revenuecat', 'RevenueCat'],
  ['vapid', 'Notifications push'],
  ['notifications', 'Notifications push'],
  ['android', 'Android'],
  ['postgres', 'Base de données'],
  ['mysql', 'Base de données'],
  ['jwt', 'Secrets de l’application'],
  ['secret_key', 'Secrets de l’application'],
  ['chiffrement', 'Secrets de l’application'],
];

interface Proprietaire {
  affiche: string;
  projet: ProjetConnu | null;
}

function construireLesProprietaires(projets: readonly ProjetConnu[]): Map<string, Proprietaire> {
  const parNom = new Map(projets.map((p) => [norme(p.name), p]));
  const table = new Map<string, Proprietaire>();
  for (const p of projets) table.set(norme(p.name), { affiche: p.name, projet: p });
  for (const alias of ALIAS_DE_PROPRIETAIRE) {
    table.set(alias.cle, { affiche: alias.affiche, projet: alias.projet ? (parNom.get(norme(alias.projet)) ?? null) : null });
  }
  return table;
}

/** Le propriétaire dont le premier segment du nom porte le nom (le plus long gagne). */
function trouverLeProprietaire(premier: string, table: Map<string, Proprietaire>): { cle: string; proprietaire: Proprietaire } | null {
  const n = norme(premier);
  let meilleur: { cle: string; proprietaire: Proprietaire } | null = null;
  for (const [cle, proprietaire] of table) {
    if (n === cle || n.startsWith(`${cle} `) || n.startsWith(`${cle}(`)) {
      if (!meilleur || cle.length > meilleur.cle.length) meilleur = { cle, proprietaire };
    }
  }
  return meilleur;
}

/* ------------------------------------------------------------------ */
/* LE NOM                                                              */
/* ------------------------------------------------------------------ */

const SUFFIXES_DE_PROPRIETAIRE = /^(.+?)\s+(Android|iOS|production|prod)$/i;

/**
 * Le nom harmonisé : des séparateurs uniformes (« — »), et un suffixe d'usage
 * collé au propriétaire (« Kipou production — … ») détaché en son propre
 * segment. Aucun mot n'est ajouté, retiré ni réordonné.
 */
export function harmoniserLeNom(nom: string, proprietaires: Map<string, Proprietaire>): string {
  let propre = (nom ?? '').replace(/\s+/g, ' ').trim().replace(/\s+[-–]{1,2}\s+/g, ' — ');
  const segments = propre.split(' — ');
  if (segments.length >= 2) {
    const suffixe = SUFFIXES_DE_PROPRIETAIRE.exec(segments[0]!);
    if (suffixe && trouverLeProprietaire(suffixe[1]!, proprietaires)?.cle === norme(suffixe[1]!)) {
      segments.splice(0, 1, suffixe[1]!, suffixe[2]!);
      propre = segments.join(' — ');
    }
  }
  return propre;
}

/** Les mots d'un nom, sans ponctuation : deux noms qui ne diffèrent que par les séparateurs ont les mêmes. */
function mots(nom: string): string {
  return norme(nom).replace(/[—–\-:,;()«»"'’]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ */
/* LE PLAN                                                             */
/* ------------------------------------------------------------------ */

interface Analyse {
  fiche: FicheAPlanifier;
  proprietaire: Proprietaire | null;
  /** Vrai : la fiche se range par fournisseur (projet partagé). */
  parFournisseur: boolean;
  service: string | null;
  nomApres: string;
}

function analyser(fiche: FicheAPlanifier, table: Map<string, Proprietaire>): Analyse {
  const nomHarmonise = harmoniserLeNom(fiche.nom, table);
  const nomApres =
    fiche.figee || nomHarmonise === fiche.nom || mots(nomHarmonise) !== mots(fiche.nom) || nomHarmonise.length > NOM_ACCES_MAX
      ? fiche.nom
      : nomHarmonise;

  const segments = nomApres.split(' — ').map((s) => s.trim());
  // « ProjetA SaaS + VPS » parle de deux projets à la fois : il n'appartient à aucun des deux.
  const trouve = segments[0]!.includes(' + ') ? null : trouverLeProprietaire(segments[0]!, table);
  const projetCle = norme(fiche.projetNom ?? '');
  const partage = !fiche.projetNom || PROJETS_PARTAGES.has(projetCle);

  let proprietaire: Proprietaire | null = trouve?.proprietaire ?? null;
  let parFournisseur = false;
  if (!proprietaire) {
    if (!partage && fiche.projetNom) {
      // Un nom qui ne nomme pas de projet, rangé sous un vrai projet : il lui appartient.
      proprietaire = { affiche: fiche.projetNom, projet: { id: fiche.projectId!, name: fiche.projetNom } };
    } else parFournisseur = true;
  }

  // Le service : le deuxième segment d'abord, puis le premier (suffixe), puis le nom entier.
  const sources = [segments[1] ?? '', trouve ? segments[0]!.slice(trouve.cle.length) : '', nomApres];
  let service: string | null = null;
  for (const source of sources) {
    const n = norme(source);
    const hit = SERVICES.find(([cle]) => n.includes(cle));
    if (hit) {
      service = hit[1];
      break;
    }
  }
  if (!service && fiche.type === 'base-de-donnees') service = 'Base de données';
  return { fiche, proprietaire, parFournisseur, service, nomApres };
}

/**
 * Décide du dossier, du projet, du nom et de l'archivage de chaque fiche.
 * `projets` : les projets connus (pour rattacher une fiche à son vrai projet).
 */
export function planifierReorganisation(
  fiches: readonly FicheAPlanifier[],
  projets: readonly ProjetConnu[],
): PlanDeReorganisation {
  const table = construireLesProprietaires(projets);
  const analyses = fiches.map((f) => analyser(f, table));

  // 1. Le dossier de chaque fiche : par propriétaire, puis par service s'il y en a assez.
  const dossierDe = new Map<string, { nom: string; projectId: string | null }>();
  const parProprietaire = new Map<string, Analyse[]>();
  for (const a of analyses) {
    const n = norme(a.fiche.nom);
    // Une carte bancaire ou une identité n'appartient à aucun projet, où qu'elle ait été rangée.
    if (MOTS_PERSONNELS.some((m) => m.test(n))) {
      dossierDe.set(a.fiche.id, { nom: DOSSIER_PERSONNEL, projectId: null });
      continue;
    }
    if (a.parFournisseur) {
      if (/code de transfert epp|transfert epp/.test(n)) {
        dossierDe.set(a.fiche.id, { nom: DOSSIER_NOMS_DE_DOMAINE, projectId: null });
        continue;
      }
      const fournisseur = FOURNISSEURS.find(([cle]) => n.split(' — ')[0]!.includes(cle));
      dossierDe.set(a.fiche.id, { nom: fournisseur ? fournisseur[1] : DOSSIER_SERVICES_PARTAGES, projectId: null });
      continue;
    }
    if (!a.proprietaire) continue;
    const cle = norme(a.proprietaire.affiche);
    const liste = parProprietaire.get(cle) ?? [];
    liste.push(a);
    parProprietaire.set(cle, liste);
  }
  /*
   * UN PROPRIÉTAIRE = UN PROJET. « ProjetA » et « ProjetA Saas » désignent le même
   * projet : leurs fiches vont ensemble, sous le nom le plus utilisé.
   */
  const parProjet = new Map<string, Analyse[]>();
  for (const [cle, liste] of parProprietaire) {
    const groupe = liste[0]!.proprietaire!.projet?.id ?? `nom:${cle}`;
    parProjet.set(groupe, [...(parProjet.get(groupe) ?? []), ...liste]);
  }
  for (const liste of parProjet.values()) {
    const frequence = new Map<string, number>();
    for (const a of liste) frequence.set(a.proprietaire!.affiche, (frequence.get(a.proprietaire!.affiche) ?? 0) + 1);
    const affiche = [...frequence.entries()].sort((x, y) => y[1] - x[1] || x[0].length - y[0].length)[0]![0];
    const projet = liste.map((a) => a.proprietaire!.projet).find(Boolean) ?? null;
    // Un propriétaire sans projet connu garde le projet que la plupart de ses fiches portent déjà.
    const projets = new Map<string | null, number>();
    for (const a of liste) projets.set(a.fiche.projectId, (projets.get(a.fiche.projectId) ?? 0) + 1);
    const leCourant = [...projets.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    const projectId = projet ? projet.id : leCourant;

    if (liste.length < 2) continue; // un dossier d'une seule fiche n'range rien
    if (liste.length <= MAX_FICHES_D_UN_DOSSIER_UNIQUE) {
      for (const a of liste) dossierDe.set(a.fiche.id, { nom: affiche, projectId });
      continue;
    }
    // Un service qui compte assez de fiches a son dossier ; le reste reste au dossier du propriétaire.
    const parService = new Map<string, Analyse[]>();
    for (const a of liste) {
      if (!a.service) continue;
      parService.set(a.service, [...(parService.get(a.service) ?? []), a]);
    }
    for (const a of liste) dossierDe.set(a.fiche.id, { nom: affiche, projectId });
    for (const [service, membres] of parService) {
      if (membres.length < MIN_FICHES_D_UN_SERVICE) continue;
      for (const a of membres) dossierDe.set(a.fiche.id, { nom: `${affiche} — ${service}`, projectId });
    }
  }

  // Un dossier n'a qu'un projet : une fiche dont le projet ne doit pas bouger
  // (une base de données lue par le garde de production) reste à la racine.
  const plans: PlanDeFiche[] = analyses.map((a) => {
    const f = a.fiche;
    let dossier = dossierDe.get(f.id) ?? null;
    let signaler: string | null = null;
    let projetApres = f.projectId;
    if (dossier) {
      if (f.type === 'base-de-donnees' && dossier.projectId !== f.projectId) {
        signaler = `Base de données rangée sous un autre projet que celui de son dossier « ${dossier.nom} » : laissée à la racine, son projet porte la protection des sites.`;
        dossier = null;
      } else projetApres = dossier.projectId;
    }
    return {
      id: f.id,
      nomAvant: f.nom,
      nomApres: a.nomApres,
      projetAvant: f.projectId,
      projetApres,
      dossier: dossier ? dossier.nom : null,
      archiver: null,
      signaler,
    };
  });

  // 2. Les archives — seulement l'explicite.
  const parId = new Map(plans.map((p) => [p.id, p]));
  for (const a of analyses) {
    const plan = parId.get(a.fiche.id)!;
    if (a.fiche.figee) continue;
    if (/r[ée]voqu[ée]/i.test(a.fiche.nom)) plan.archiver = 'Fiche dite révoquée : la clé ne fonctionne plus.';
    else if (/\bremplac[ée]e?\b/i.test(a.fiche.nom)) plan.archiver = 'Fiche dite remplacée par une autre.';
  }
  // Un doublon exact : même type, mêmes valeurs secrètes, MÊME projet. Une même
  // clé partagée entre deux projets n'est pas un doublon : chaque projet la
  // retrouve sous son nom.
  const groupes = new Map<string, Analyse[]>();
  for (const a of analyses) {
    if (!a.fiche.empreinte) continue;
    const plan = parId.get(a.fiche.id)!;
    if (plan.archiver) continue;
    const cle = `${a.fiche.type}|${a.fiche.empreinte}|${plan.projetApres ?? ''}`;
    groupes.set(cle, [...(groupes.get(cle) ?? []), a]);
  }
  for (const groupe of groupes.values()) {
    if (groupe.length < 2) continue;
    const classes = [...groupe].sort(
      (x, y) =>
        Number(x.fiche.figee) - Number(y.fiche.figee) === 0
          ? y.fiche.richesse - x.fiche.richesse || y.fiche.modifieLe - x.fiche.modifieLe || y.fiche.nom.length - x.fiche.nom.length
          : Number(y.fiche.figee) - Number(x.fiche.figee),
    );
    const gardee = classes[0]!;
    const motsGardee = new Set(mots(gardee.fiche.nom).split(' '));
    for (const a of classes.slice(1)) {
      if (a.fiche.figee) continue;
      const plan = parId.get(a.fiche.id)!;
      const siens = mots(a.fiche.nom).split(' ');
      // Le même secret sous deux noms qui ne se recouvrent pas sert peut-être deux usages
      // (deux variables d'environnement, deux applications) : on le signale, on ne l'archive pas.
      if (siens.every((m) => motsGardee.has(m))) {
        plan.archiver = `Doublon exact de « ${gardee.fiche.nom} » (même projet, mêmes valeurs, même nom à peu près).`;
      } else {
        plan.signaler = `Mêmes valeurs que « ${gardee.fiche.nom} » sous un nom différent : deux usages peut-être, à confirmer.`;
      }
    }
  }

  // 3. Les cas douteux, dits sans y toucher.
  for (const a of analyses) {
    const plan = parId.get(a.fiche.id)!;
    if (plan.archiver || plan.signaler) continue;
    if (/\b(ancien(ne)?|p[ée]rim[ée]e?|obsol[èe]te|historique|devenu faux|ne fonctionne plus)\b/i.test(a.fiche.nom)) {
      plan.signaler = 'Le nom la dit ancienne ou périmée : à confirmer avant de l’archiver.';
    }
  }

  // Un dossier archivé d'avance n'a plus de fiche : on ne range pas ce qui part aux archives.
  for (const plan of plans) if (plan.archiver) plan.dossier = null;

  // Un dossier d'une seule fiche n'est pas un rangement : la fiche reste à la racine
  // (et garde son projet, qu'un dossier aurait imposé).
  const effectif = new Map<string, number>();
  for (const plan of plans) if (plan.dossier) effectif.set(plan.dossier, (effectif.get(plan.dossier) ?? 0) + 1);
  for (const plan of plans) {
    if (plan.dossier && (effectif.get(plan.dossier) ?? 0) < 2) {
      plan.dossier = null;
      plan.projetApres = plan.projetAvant;
      dossierDe.delete(plan.id);
    }
  }

  const compte = new Map<string, PlanDeDossier>();
  for (const plan of plans) {
    if (!plan.dossier) continue;
    const entree = compte.get(plan.dossier) ?? {
      nom: plan.dossier,
      projectId: dossierDe.get(plan.id)?.projectId ?? null,
      fiches: 0,
    };
    entree.fiches += 1;
    compte.set(plan.dossier, entree);
  }
  return {
    fiches: plans,
    dossiers: [...compte.values()].sort((x, y) => x.nom.localeCompare(y.nom)),
  };
}
