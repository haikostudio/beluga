/**
 * LE TOUR D'HORIZON DES PROJETS — ce que Beluga sait de chacun, réuni en UN geste pour Jarvis (carte « Jarvis : micro
 * coupé, vrai concierge », 24/11/2026).
 *
 * À « quel projet peut être rentable ? », Jarvis répondait en théorie, sans regarder ce que Beluga savait déjà : le
 * dossier marketing, les visites, les ventes, l'audit SEO + GEO, les campagnes, le Studio, les tâches. Ce relevé les
 * réunit, projet par projet, regroupés par MARQUE de Communication (ProjetA app et ProjetA vitrine sont UNE marque,
 * MEM-7278), et DIT CE QUI MANQUE avec l'outil de Beluga qui le comble — c'est ce qui permet à Jarvis de répondre
 * d'après les faits, puis de proposer un levier concret plutôt qu'un remplissage théorique.
 *
 * Règles pures : le démon (`server/src/portefeuille-des-projets.ts`) lit la base et remplit ces fiches.
 */

/** Une source qu'on n'a pas pu lire (module absent de l'installation, table illisible) : dite, jamais inventée. */
export const INDISPONIBLE = 'indisponible' as const;
export type Indisponible = typeof INDISPONIBLE;

export interface TachesDuPortefeuille {
  enCours: number;
  aFaire: number;
  aDeployer: number;
  termineesSur30j: number;
  derniereTerminee?: { titre: string; le: number } | null;
}

export type MarketingDuPortefeuille =
  /** Aucun dossier marketing : aucune étude n'a jamais commencé. */
  | { etat: 'absent' }
  | {
      etat: 'dossier';
      /** Remplissage moyen des rubriques, 0 à 100. */
      completion: number;
      /** Les rubriques encore vides (noms lisibles). */
      rubriquesVides: string[];
      /** Où en est l'étude : « nouveau », « pre-diagnostic-pret », « rapport-pret », « etude-en-cours »… */
      etude: string;
    }
  | { etat: Indisponible };

export interface FicheDuPortefeuille {
  nom: string;
  groupe?: string | null;
  /** L'adresse publique du produit (production), si Beluga la connaît. */
  adresse?: string | null;
  /** site, boutique, app, saas — dit par l'outil marketing. */
  nature?: string | null;
  /** Ce que le produit promet, à qui (fiche de l'outil marketing), en une phrase. */
  presentation?: string | null;
  taches: TachesDuPortefeuille;
  marketing: MarketingDuPortefeuille;
  /** `null` : aucun espace marketing (rien n'est suivi). */
  visites: { suivi: string; visiteurs30: number; visiteursAvant: number; vues30: number } | null;
  ventes: { suivies: boolean; nombre30: number; montantCentimes30: number; devise: string | null };
  audit: { note: number | null; faitLe: number; tendance?: string | null } | null | Indisponible;
  /** Les réseaux reliés à ce projet (Instagram, TikTok…) et ses publications des 30 derniers jours. */
  reseaux: { relies: string[]; publications30: number };
  studio: { creations: number; derniere?: { titre: string; le: number } | null };
}

export interface MarqueDuPortefeuille {
  /** Le nom de la marque de Communication ; `null` : un projet sans marque. */
  nom: string | null;
  projets: FicheDuPortefeuille[];
  campagnes: { total: number; enCours: number; titres: string[] } | null;
}

export interface ManqueDuProjet {
  manque: string;
  /** L'outil de Beluga qui le comble, en mots courants. */
  levier: string;
}

/** Le projet a-t-il une présence publique connue (adresse, outil marketing, marque, réseaux) ? Sinon : interne. */
export function projetPublic(f: FicheDuPortefeuille, marque: Pick<MarqueDuPortefeuille, 'nom'>): boolean {
  return !!f.adresse || f.visites !== null || !!marque.nom || f.reseaux.relies.length > 0 || f.marketing.etat === 'dossier';
}

/**
 * CE QUI MANQUE pour juger un projet, et l'outil de Beluga qui le comble. Un projet sans présence publique connue
 * n'a qu'un manque : on ne sait pas ce qu'il vend — lui inventer six manques serait du bruit.
 */
export function manquesDuProjet(f: FicheDuPortefeuille, marque: MarqueDuPortefeuille): ManqueDuProjet[] {
  if (!projetPublic(f, marque)) {
    return [{ manque: 'aucune présence publique connue (ni adresse, ni outil marketing, ni marque)', levier: 'dire à Beluga ce que vend ce projet : outil marketing du projet (adresse, nature, fiche)' }];
  }
  const m: ManqueDuProjet[] = [];
  if (f.marketing.etat === 'absent') {
    m.push({ manque: 'aucune étude marketing', levier: 'étude marketing (écran Marketing : pré-diagnostic, puis étude complète — prix annoncé avant)' });
  } else if (f.marketing.etat === 'dossier' && f.marketing.rubriquesVides.length) {
    m.push({ manque: `dossier marketing incomplet (${f.marketing.rubriquesVides.slice(0, 4).join(', ')}${f.marketing.rubriquesVides.length > 4 ? '…' : ''})`, levier: 'compléter le dossier avec l’agent marketing du projet' });
  }
  if (!f.visites || (f.visites.suivi === 'absent' && f.visites.visiteurs30 === 0)) {
    m.push({ manque: 'aucune visite mesurée', levier: 'poser le suivi des visites de Beluga (une tâche dans le projet)' });
  }
  if (!f.ventes.suivies && f.ventes.nombre30 === 0 && (f.nature === 'boutique' || f.nature === 'app' || f.nature === 'saas')) {
    m.push({ manque: 'ventes non suivies', levier: 'relier les ventes à l’outil marketing du projet (Stripe, boutique, abonnements)' });
  }
  if (f.audit === null && f.adresse) {
    m.push({ manque: 'jamais audité en SEO + GEO', levier: 'audit SEO + GEO (outil « services », référencement)' });
  }
  if (!f.reseaux.relies.length && !(marque.campagnes && marque.campagnes.total > 0)) {
    m.push({ manque: 'aucun réseau relié ni campagne', levier: 'Communication : étude de la marque, puis une campagne' });
  }
  if (f.studio.creations === 0) {
    m.push({ manque: 'aucun visuel ni vidéo', levier: 'un visuel ou une vidéo au Studio' });
  }
  return m;
}

const jourCourt = (instant: number) =>
  new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(instant));
const nombre = (n: number) => new Intl.NumberFormat('fr-FR').format(n);

function tendanceDesVisites(maintenant: number, avant: number): string {
  if (!avant) return maintenant ? 'nouveau' : '';
  const ecart = Math.round(((maintenant - avant) / avant) * 100);
  return `${ecart >= 0 ? '+' : ''}${ecart} % sur les 30 j d’avant`;
}

const LIBELLES_D_ETUDE: Record<string, string> = {
  nouveau: 'entretien commencé, aucune étude rendue',
  'attend-reponse': 'l’agent marketing attend une réponse',
  'pre-diagnostic-en-cours': 'pré-diagnostic en cours',
  'pre-diagnostic-pret': 'pré-diagnostic rendu',
  'etude-en-cours': 'étude complète en cours',
  'en-pause': 'étude en pause',
  'rapport-pret': 'étude complète rendue',
  suivi: 'étude rendue, suivi des chiffres actif',
};

/** Le poids d'un projet dans l'ordre du relevé : ce qui vit d'abord (visites, ventes, travail en cours). */
export function activiteDuProjet(f: FicheDuPortefeuille): number {
  return (f.visites?.visiteurs30 ?? 0) + f.ventes.nombre30 * 50 + (f.taches.enCours + f.taches.aFaire) * 10 + f.taches.termineesSur30j;
}

/** Les lignes d'un projet : ses chiffres, puis ce qui manque. `bref` : une seule ligne. */
export function lignesDuProjet(f: FicheDuPortefeuille, marque: MarqueDuPortefeuille, bref = false): string[] {
  const tete = [f.nature, f.adresse?.replace(/^https?:\/\//, '')].filter(Boolean).join(', ');
  const titre = `· ${f.nom}${tete ? ` (${tete})` : ''}${f.groupe ? ` — groupe ${f.groupe}` : ''}`;
  const manques = manquesDuProjet(f, marque);
  if (bref) return [`${titre} — ${f.taches.enCours + f.taches.aFaire} tâche(s) ouverte(s) ; manque : ${manques.map((x) => x.manque).join(' ; ') || 'rien de notable'}`];
  const t = f.taches;
  const chiffres: string[] = [
    `tâches ${t.enCours} en cours · ${t.aFaire} à faire · ${t.aDeployer} à déployer · ${t.termineesSur30j} finies en 30 j${t.derniereTerminee ? ` (dernière « ${t.derniereTerminee.titre} », ${jourCourt(t.derniereTerminee.le)})` : ''}`,
  ];
  if (f.visites) {
    const tend = tendanceDesVisites(f.visites.visiteurs30, f.visites.visiteursAvant);
    chiffres.push(`visites ${nombre(f.visites.visiteurs30)} visiteurs en 30 j${tend ? ` (${tend})` : ''}, ${nombre(f.visites.vues30)} pages vues, suivi ${f.visites.suivi}`);
  }
  if (f.ventes.nombre30 || f.ventes.suivies) {
    chiffres.push(`ventes ${f.ventes.nombre30} en 30 j${f.ventes.montantCentimes30 ? ` (${nombre(Math.round(f.ventes.montantCentimes30 / 100))} ${f.ventes.devise ?? '€'})` : ''}`);
  }
  if (f.marketing.etat === 'dossier') chiffres.push(`dossier marketing ${f.marketing.completion} % (${LIBELLES_D_ETUDE[f.marketing.etude] ?? f.marketing.etude})`);
  if (f.audit && f.audit !== INDISPONIBLE) {
    chiffres.push(`audit SEO + GEO ${f.audit.note ?? '?'}/100 au ${jourCourt(f.audit.faitLe)}${f.audit.tendance ? ` (${f.audit.tendance})` : ''}`);
  }
  if (f.reseaux.relies.length) chiffres.push(`réseaux ${f.reseaux.relies.join(', ')} (${f.reseaux.publications30} publication(s) en 30 j)`);
  if (f.studio.creations) chiffres.push(`Studio ${f.studio.creations} création(s)${f.studio.derniere ? `, dernière « ${f.studio.derniere.titre} » (${jourCourt(f.studio.derniere.le)})` : ''}`);
  const lignes = [titre];
  if (f.presentation) lignes.push(`  ${f.presentation}`);
  lignes.push(`  ${chiffres.join(' | ')}`);
  if (manques.length) lignes.push(`  MANQUE : ${manques.map((x) => `${x.manque} → ${x.levier}`).join(' ; ')}`);
  return lignes;
}

/** Le plafond du relevé, en signes : au-delà, les projets les moins actifs passent en une ligne. */
export const PLAFOND_DU_PORTEFEUILLE = 9_000;

/**
 * LE TEXTE DU RELEVÉ, rendu à Jarvis. Les marques les plus actives d'abord, les projets sans marque réunis en dernier ;
 * au-delà du plafond, chaque projet restant tient en une ligne (jamais coupé en silence).
 */
export function texteDuPortefeuille(marques: MarqueDuPortefeuille[], options: { maintenant: number; plafond?: number }): string {
  const plafond = options.plafond ?? PLAFOND_DU_PORTEFEUILLE;
  const poids = (m: MarqueDuPortefeuille) => m.projets.reduce((s, f) => s + activiteDuProjet(f), 0) + (m.campagnes?.enCours ?? 0) * 30;
  const avecProjets = marques.filter((m) => m.projets.length);
  const sansMarque: MarqueDuPortefeuille = { nom: null, projets: avecProjets.filter((m) => !m.nom).flatMap((m) => m.projets), campagnes: null };
  const rangees = [...avecProjets.filter((m) => m.nom).sort((a, b) => poids(b) - poids(a)), ...(sansMarque.projets.length ? [sansMarque] : [])];
  const nbProjets = rangees.reduce((s, m) => s + m.projets.length, 0);
  const entete = [
    `TOUR D’HORIZON DE ${nbProjets} PROJET(S) — ce que Beluga sait au ${jourCourt(options.maintenant)} (30 derniers jours), les plus actifs d’abord.`,
    'Réponds D’APRÈS ces faits : cite les chiffres, dis ce qui manque, puis propose le levier de Beluga qui le comble (lancé seulement après un « oui »).',
  ];
  const blocs: string[] = [];
  let taille = entete.join('\n').length;
  let bref = false;
  for (const m of rangees) {
    const tete = m.nom
      ? `■ Marque ${m.nom}${m.projets.length > 1 ? ` — ${m.projets.length} projets d’une même marque : ${m.projets.map((f) => f.nom).join(', ')}` : ''}${
          m.campagnes ? ` ; campagnes : ${m.campagnes.total ? `${m.campagnes.total} (${m.campagnes.enCours} en cours${m.campagnes.titres.length ? ` : ${m.campagnes.titres.join(', ')}` : ''})` : 'aucune'}` : ''
        }`
      : '■ Projets sans marque de Communication';
    const lignes = [tete];
    taille += tete.length + 2;
    for (const f of [...m.projets].sort((a, b) => activiteDuProjet(b) - activiteDuProjet(a))) {
      let suite = lignesDuProjet(f, m, bref);
      if (!bref && taille + suite.join('\n').length > plafond) {
        bref = true;
        suite = lignesDuProjet(f, m, true);
      }
      taille += suite.join('\n').length + 1;
      lignes.push(...suite);
    }
    blocs.push(lignes.join('\n'));
  }
  if (!blocs.length) return `${entete[0]}\nAucun projet à relever.`;
  return [...entete, '', blocs.join('\n\n'), ...(bref ? ['', '(Au-delà du plafond, les projets les moins actifs tiennent en une ligne : ouvre-les avec « projet » pour le détail.)'] : [])].join('\n');
}
