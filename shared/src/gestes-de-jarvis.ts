/**
 * LES GESTES DE JARVIS À L'ÉCRAN — règles pures (carte « Relier Beluga Pass dans les réglages », 16/11/2026).
 *
 * Jarvis (l'assistant vocal) agit dans l'interface de Beluga COMME L'UTILISATEUR : il ouvre une page, clique, remplit
 * un champ, devant lui, avec un curseur à lui. Le démon (`server/src/gestes-de-jarvis.ts`) joue un PLAN de gestes sur
 * le seul écran qui tient la conversation vocale ; le navigateur (`web/src/lib/gestes-de-jarvis.ts`) les exécute et
 * les accuse un par un. Ce fichier dit, sans réseau ni écran :
 *   — ce qu'est un geste et ce qu'un plan peut demander (`planValide`) ;
 *   — quel geste ENGAGE (lancer, publier, payer, envoyer, effacer) et demande la confirmation à voix haute ;
 *   — comment les CHEMINS réussis se regroupent la nuit en familles d'action, puis en compétences de Jarvis ;
 *   — quels chemins connus ressemblent à une demande (`cheminsProches`).
 */

/** Les gestes qu'un plan peut demander. */
export const ACTIONS_DE_GESTE = ['ouvrir', 'cliquer', 'saisir', 'touche', 'attendre'] as const;
export type ActionDeGeste = (typeof ACTIONS_DE_GESTE)[number];

/** L'état d'un geste, tel que l'encadré du module de voix le dessine. */
export type EtatDeGeste = 'todo' | 'running' | 'done' | 'stopped' | 'failed';

export interface GesteDeJarvis {
  action: ActionDeGeste;
  /**
   * CE QUI EST VISÉ. « ouvrir » : une adresse interne (« #projet/…/tache/… », « #reglages/belugapass ») ; « cliquer »,
   * « saisir », « attendre » : un repère (« [data-…] », sélecteur CSS) ou un texte visible (« Nouvelle tâche ») ;
   * « touche » : une touche (« Enter », « Escape »).
   */
  cible?: string;
  /** Le texte à taper (« saisir »). */
  texte?: string;
  /** Ce que Jarvis dit faire, en première personne et en mots courants : « Je clique sur « Nouvelle tâche » ». */
  libelle: string;
}

/** Un plan ne dépasse jamais ce nombre de gestes : au-delà, l'agent le découpe. */
export const GESTES_MAX_PAR_PLAN = 20;
/** Le temps laissé au navigateur pour UN geste (trouver la cible, y aller, agir) avant de le dire échoué. */
export const DELAI_D_UN_GESTE_DE_JARVIS_MS = 8_000;
/** Un texte saisi ne dépasse pas cette longueur. */
export const TEXTE_SAISI_MAX = 4_000;

/** Le plan reçu de l'agent est-il jouable ? Rend les gestes nettoyés, ou la raison du refus, en clair. */
export function planValide(brut: unknown): { ok: true; gestes: GesteDeJarvis[] } | { ok: false; raison: string } {
  if (!Array.isArray(brut) || brut.length === 0) return { ok: false, raison: 'Le plan est vide : donne au moins un geste (« gestes »).' };
  if (brut.length > GESTES_MAX_PAR_PLAN) return { ok: false, raison: `Un plan tient en ${GESTES_MAX_PAR_PLAN} gestes au plus : découpe-le.` };
  const gestes: GesteDeJarvis[] = [];
  for (const [i, g] of brut.entries()) {
    const action = String((g as any)?.action ?? '');
    if (!(ACTIONS_DE_GESTE as readonly string[]).includes(action)) {
      return { ok: false, raison: `Geste ${i + 1} : action inconnue « ${action} » (${ACTIONS_DE_GESTE.join(', ')}).` };
    }
    const cible = typeof (g as any).cible === 'string' ? (g as any).cible.trim() : '';
    const texte = typeof (g as any).texte === 'string' ? (g as any).texte : undefined;
    const libelle = typeof (g as any).libelle === 'string' ? (g as any).libelle.trim() : '';
    if (!libelle) return { ok: false, raison: `Geste ${i + 1} : dis ce que tu fais (« libelle », en première personne).` };
    if (!cible) return { ok: false, raison: `Geste ${i + 1} : la « cible » manque.` };
    if (action === 'saisir' && texte === undefined) return { ok: false, raison: `Geste ${i + 1} : « saisir » demande un « texte ».` };
    if (action === 'ouvrir' && !cible.startsWith('#')) return { ok: false, raison: `Geste ${i + 1} : « ouvrir » vise une adresse interne qui commence par « # » (jamais un autre site).` };
    gestes.push({
      action: action as ActionDeGeste,
      cible,
      ...(texte !== undefined ? { texte: texte.slice(0, TEXTE_SAISI_MAX) } : {}),
      libelle: libelle.slice(0, 160),
    });
  }
  return { ok: true, gestes };
}

/**
 * CE QUI NE SE DÉFAIT PAS ne se joue pas à l'écran sans la confirmation dite à voix haute (décision de l'utilisateur du
 * 17/11/2026, même règle que la consigne du direct) : mettre en PRODUCTION, PAYER, écrire à un CLIENT, SUPPRIMER. Tout le
 * reste — lancer une carte, déployer sur ce serveur, archiver, créer, modifier — se joue sans question. Lu sur ce que le
 * geste vise et sur ce qu'il dit faire.
 */
const MOTS_QUI_ENGAGENT =
  /\b(mettre en production|mise en production|met en production|production|payer|paie|paye|acheter|achat|commander|valider le paiement|(envoyer|envoie|repondre|reponds|ecrire|ecris)\b[^.]*\bclients?|supprimer|supprime|effacer|efface|delier|vider)\b/;

export function gesteEngageant(geste: Pick<GesteDeJarvis, 'action' | 'cible' | 'libelle'>): boolean {
  if (geste.action !== 'cliquer' && geste.action !== 'touche') return false;
  const lu = sansAccents(`${geste.cible ?? ''} ${geste.libelle ?? ''}`).replace(/[-_]/g, ' ');
  return MOTS_QUI_ENGAGENT.test(lu);
}

/* ------------------------------------------------------------------ */
/* Les chemins et leur rangement de nuit                                */
/* ------------------------------------------------------------------ */

/** Un chemin RÉUSSI, tel qu'il est gardé : la demande d'origine, le projet, les gestes joués dans l'ordre. */
export interface CheminDeJarvis {
  id: number;
  quand: number;
  intention: string;
  projet?: string | null;
  gestes: GesteDeJarvis[];
}

function sansAccents(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const MOTS_VIDES = new Set(
  (
    'le la les un une des du de d l et ou a au aux en dans sur pour par avec sans mon ma mes ton ta tes son sa ses ce cette ces ' +
    'je tu il elle on nous vous ils me te se moi toi lui leur y qui que quoi est sont peux peut pouvez veux voudrais ' +
    'jarvis stp svp plait s il merci ok bon alors donc maintenant tout suite fais faire moi-meme nouvelle nouveau'
  ).split(' '),
);

/** Les mots qui portent le sens d'une demande, sans accents ni mots vides. */
export function motsDeLIntention(texte: string): string[] {
  return sansAccents(texte)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((m) => m.length > 1 && !MOTS_VIDES.has(m));
}

/** Les verbes reconnus, ramenés à une forme : « crée », « ajoute » → creer. */
const VERBES: Record<string, string> = {
  cree: 'creer', creer: 'creer', creez: 'creer', ajoute: 'creer', ajouter: 'creer', ajoutez: 'creer', nouvelle: 'creer',
  ouvre: 'ouvrir', ouvrir: 'ouvrir', ouvrez: 'ouvrir', va: 'ouvrir', aller: 'ouvrir', allez: 'ouvrir', affiche: 'ouvrir', montre: 'ouvrir',
  change: 'modifier', changer: 'modifier', modifie: 'modifier', modifier: 'modifier', renomme: 'modifier', regle: 'modifier', active: 'modifier', desactive: 'modifier',
  deplace: 'deplacer', deplacer: 'deplacer', range: 'deplacer',
  cherche: 'trouver', trouve: 'trouver', trouver: 'trouver',
  lance: 'lancer', lancer: 'lancer',
  ferme: 'fermer', fermer: 'fermer',
};
/** Les objets reconnus, ramenés à une forme : « carte », « tâche » → tache. */
const OBJETS: Record<string, string> = {
  tache: 'tache', taches: 'tache', carte: 'tache', cartes: 'tache',
  projet: 'projet', projets: 'projet',
  reglage: 'reglages', reglages: 'reglages', parametres: 'reglages', theme: 'reglages', langue: 'reglages',
  page: 'page', onglet: 'page',
  note: 'note', notes: 'note', memoire: 'memoire',
  coffre: 'coffre', acces: 'coffre',
  message: 'messagerie', messages: 'messagerie', messagerie: 'messagerie',
  statistiques: 'statistiques', stats: 'statistiques',
  sauvegarde: 'sauvegardes', sauvegardes: 'sauvegardes', backup: 'sauvegardes', backups: 'sauvegardes',
  surveillance: 'surveillance', site: 'surveillance',
  studio: 'studio', video: 'studio', image: 'studio',
};

/**
 * LA FAMILLE D'UNE DEMANDE : un verbe et un objet reconnus (« crée une tâche dans Beluga » → creer-tache). Les chemins
 * d'une même famille se rangent dans UNE compétence de Jarvis (`jarvis-creer-tache`). Sans verbe ou sans objet
 * reconnu, la famille prend les deux premiers mots porteurs ; une demande vide n'a pas de famille.
 */
export function familleDeLIntention(intention: string): string | null {
  const mots = motsDeLIntention(intention);
  const verbe = mots.map((m) => VERBES[m]).find(Boolean);
  const objet = mots.map((m) => OBJETS[m]).find(Boolean);
  if (verbe && objet) return `${verbe}-${objet}`;
  const porteurs = mots.filter((m) => !VERBES[m]).slice(0, 2);
  if (verbe && porteurs.length) return `${verbe}-${porteurs[0]}`.slice(0, 40);
  if (objet) return `ouvrir-${objet}`;
  return porteurs.length ? porteurs.join('-').slice(0, 40) : null;
}

/** Le nom de la compétence d'une famille : « jarvis-creer-tache ». */
export function nomDeCompetenceDeJarvis(famille: string): string {
  return `jarvis-${famille}`.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/-$/, '').slice(0, 49);
}

/** La suite des gestes d'un chemin, réduite à ce qui compte pour le reconnaître : actions et cibles. */
function signature(chemin: Pick<CheminDeJarvis, 'gestes'>): string {
  return chemin.gestes.map((g) => `${g.action}:${g.action === 'saisir' ? '' : (g.cible ?? '')}`).join(' > ');
}

export interface FamilleDeChemins {
  famille: string;
  /** La variante retenue : la plus COURTE qui a réussi, la plus récente à longueur égale. */
  retenu: CheminDeJarvis;
  /** Les variantes distinctes (doublons fusionnés), retenue comprise, avec le nombre de réussites de chacune. */
  variantes: { chemin: CheminDeJarvis; reussites: number }[];
  /** Les demandes d'origine, distinctes : elles disent QUAND servir la compétence. */
  intentions: string[];
  /** Les projets où elle a servi. */
  projets: string[];
}

/**
 * LE RANGEMENT DE NUIT : regroupe les chemins par famille d'action, fusionne les doublons (mêmes gestes vers les mêmes
 * cibles), et retient la variante la plus courte. Les familles sont rendues de la plus servie à la moins servie.
 */
export function regrouperLesChemins(chemins: CheminDeJarvis[]): FamilleDeChemins[] {
  const parFamille = new Map<string, CheminDeJarvis[]>();
  for (const c of chemins) {
    if (!c.gestes.length) continue;
    const famille = familleDeLIntention(c.intention);
    if (!famille) continue;
    parFamille.set(famille, [...(parFamille.get(famille) ?? []), c]);
  }
  const familles: FamilleDeChemins[] = [];
  for (const [famille, liste] of parFamille) {
    const parSignature = new Map<string, { chemin: CheminDeJarvis; reussites: number }>();
    for (const c of liste) {
      const cle = signature(c);
      const avant = parSignature.get(cle);
      if (!avant) parSignature.set(cle, { chemin: c, reussites: 1 });
      else parSignature.set(cle, { chemin: c.quand > avant.chemin.quand ? c : avant.chemin, reussites: avant.reussites + 1 });
    }
    const variantes = [...parSignature.values()].sort(
      (a, b) => a.chemin.gestes.length - b.chemin.gestes.length || b.reussites - a.reussites || b.chemin.quand - a.chemin.quand,
    );
    familles.push({
      famille,
      retenu: variantes[0]!.chemin,
      variantes,
      intentions: [...new Set(liste.map((c) => c.intention.trim()).filter(Boolean))].slice(0, 12),
      projets: [...new Set(liste.map((c) => c.projet ?? '').filter(Boolean))],
    });
  }
  return familles.sort((a, b) => b.variantes.reduce((n, v) => n + v.reussites, 0) - a.variantes.reduce((n, v) => n + v.reussites, 0));
}

/** Les gestes d'un chemin, écrits pour être rejoués : une ligne par geste. */
export function gestesEnLignes(gestes: GesteDeJarvis[]): string {
  return gestes
    .map((g, i) => {
      const texte = g.action === 'saisir' ? ` — texte : « ${g.texte ?? ''} »` : '';
      return `${i + 1}. ${g.libelle} — \`${g.action}\` sur \`${g.cible ?? ''}\`${texte}`;
    })
    .join('\n');
}

/**
 * LA COMPÉTENCE D'UNE FAMILLE, prête pour la porte d'écriture du pool (`ecrireLaFiche`) : description qui dit QUAND
 * la servir (les demandes d'origine), procédure = le chemin retenu, variantes en annexe de la section « Pièges ».
 */
export function competenceDeLaFamille(f: FamilleDeChemins, maintenant = Date.now()): {
  nom: string;
  description: string;
  themes: string[];
  symptomes: string[];
  symptome: string;
  procedure: string;
  verification: string;
  pieges: string;
} {
  const nom = nomDeCompetenceDeJarvis(f.famille);
  const exemples = f.intentions.slice(0, 4).map((i) => `« ${i} »`).join(', ');
  const total = f.variantes.reduce((n, v) => n + v.reussites, 0);
  const autres = f.variantes.slice(1, 4);
  return {
    nom,
    description: `À utiliser quand l'utilisateur demande à Jarvis, à la voix, de faire dans Beluga : ${exemples}. Chemin déjà réussi ${total} fois à l'écran, à rejouer par « assistant_ecran » « jouer » au lieu d'explorer.`,
    themes: ['jarvis', 'voix', 'interface'],
    symptomes: f.intentions.slice(0, 6),
    symptome: `Demandes d'origine : ${f.intentions.map((i) => `« ${i} »`).join(' ; ')}.${f.projets.length ? ` Projets : ${f.projets.join(', ')}.` : ''}`,
    procedure: `Rejouer ce plan avec « assistant_ecran » « jouer » (adapter le texte saisi et le projet à la demande) :\n\n${gestesEnLignes(f.retenu.gestes)}`,
    verification: `Chaque geste revient « fait » dans l'encadré « Jarvis agit sur l'écran » du module de voix, et le résultat se voit à l'écran. Rangée par la nuit du ${new Date(maintenant).toISOString().slice(0, 10)}, d'après ${total} réussite(s).`,
    pieges: autres.length
      ? `Autres chemins qui ont aussi réussi (plus longs) :\n\n${autres.map((v) => gestesEnLignes(v.chemin.gestes)).join('\n\n---\n\n')}\n\nUne cible qui a changé à l'écran se retrouve par « lire » avant de rejouer.`
      : "Une cible qui a changé à l'écran se retrouve par « lire » avant de rejouer.",
  };
}

/**
 * LES CHEMINS CONNUS QUI RESSEMBLENT À UNE DEMANDE, du plus proche au plus lointain : même famille d'abord, puis le
 * plus de mots porteurs en commun. Aucun mot commun : rien.
 */
export function cheminsProches(intention: string, chemins: CheminDeJarvis[], combien = 3): CheminDeJarvis[] {
  const voulus = new Set(motsDeLIntention(intention));
  const famille = familleDeLIntention(intention);
  const notes = chemins
    .map((c) => {
      const communs = motsDeLIntention(c.intention).filter((m) => voulus.has(m)).length;
      const memeFamille = famille && familleDeLIntention(c.intention) === famille ? 1 : 0;
      return { c, note: memeFamille * 10 + communs };
    })
    .filter((n) => n.note > 0)
    .sort((a, b) => b.note - a.note || a.c.gestes.length - b.c.gestes.length || b.c.quand - a.c.quand);
  const vus = new Set<string>();
  const rendus: CheminDeJarvis[] = [];
  for (const { c } of notes) {
    const cle = signature(c);
    if (vus.has(cle)) continue;
    vus.add(cle);
    rendus.push(c);
    if (rendus.length >= combien) break;
  }
  return rendus;
}
