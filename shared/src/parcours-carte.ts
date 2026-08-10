import { coutDuTour } from './cout-tour.js';
import { tourMesure, type TourMesureAgent } from './couches-tokens.js';

/**
 * LE PARCOURS D'UNE TÂCHE, ÉTAPE PAR ÉTAPE.
 *
 * L'onglet « Détails » empilait sept blocs qui se répondaient mal : réglages,
 * préparation du chef, jetons par agent, « Analyse initiale », « Exécution
 * réelle », ventilation, projection. Chacun disait vrai, mais aucun ne racontait
 * ce qui s'était PASSÉ — et deux d'entre eux comptaient les mêmes jetons deux
 * fois, une fois comme analyse, une fois comme exécution.
 *
 * Ce module rend à la place UNE LIGNE DE TEMPS : du tri par le chef d'orchestre
 * jusqu'à la mise en production, une étape par moment réel, dans l'ordre. Chaque
 * étape dit deux choses, et rien d'autre :
 *
 *   — CE QU'ELLE EST ALLÉE CHERCHER (accueil reçu, sujets de mémoire demandés,
 *     description de la carte, lectures) ;
 *   — CE QU'ELLE A RÉELLEMENT CONSOMMÉ, pris dans la table `usage`, c'est-à-dire
 *     dans la mesure rendue par le moteur à la fin de chaque tour.
 *
 * Deux interdits, tenus par la forme même du module :
 *   — JAMAIS d'estimation. Une étape sans mesure porte la RAISON de son absence,
 *     jamais un zéro ni une projection déguisée en chiffre.
 *   — JAMAIS un jeton compté deux fois. Une étape = un ou plusieurs AGENTS, et
 *     un tour appartient à un seul agent : les totaux s'additionnent sans se
 *     recouvrir.
 *
 * Aucune base, aucun disque : le serveur rassemble les faits, ce module les met
 * en ordre — donc il se teste seul (`server/src/test/parcours-carte.test.ts`).
 */

export type CleEtape = 'tri' | 'autorisation' | 'execution' | 'deploiement' | 'production';

/** Où en est l'étape. Une étape « à venir » n'a rien consommé, et le dit. */
export type EtatEtapeParcours = 'faite' | 'en-cours' | 'a-venir';

/** Ce qu'une étape a réellement envoyé et reçu, additionné une seule fois. */
export interface MesureEtape {
  /** Nombre de tours de moteur réellement mesurés. */
  tours: number;
  /** Entrée nouvelle, hors cache relu. */
  entree: number;
  /** Absent quand le moteur n'a pas communiqué la part relue du cache. */
  cache?: number;
  sortie: number;
  /** Absent dès qu'une part manque : un total partiel serait un faux total. */
  total?: number;
  /** En francs, seulement si le tarif de CHAQUE tour compté est connu. */
  cout?: number;
  /** Durée machine cumulée, en secondes. */
  secondes: number;
}

/** Une étape du parcours, telle qu'elle s'affiche. */
export interface EtapeParcours {
  cle: CleEtape;
  /** Le titre court de l'étape, en français. */
  titre: string;
  /** Une phrase : ce que fait cette étape. */
  quoi: string;
  /** Quand elle a eu lieu, si on le sait. */
  quand?: number;
  /** Ce qu'elle est allée chercher — une ligne par source, jamais devinée. */
  cherche: string[];
  /** La mesure RÉELLE, ou rien. */
  mesure?: MesureEtape;
  /** Pourquoi la mesure manque, quand elle manque. Toujours dit. */
  sansMesure?: string;
  /**
   * Cette étape appelle-t-elle NORMALEMENT le moteur ?
   *
   * Autoriser une dépense, fusionner une branche sans conflit, mettre en
   * production : ce sont des gestes, pas des tours. Leur absence de mesure n'est
   * donc pas un TROU — et le total ne doit pas la compter comme tel, sous peine
   * de faire douter de chiffres pourtant complets.
   */
  attendMesure: boolean;
  etat: EtatEtapeParcours;
}

/** Un agent qui a touché la carte, avec ses tours déjà mesurés. */
export interface AgentDuParcours {
  id: string;
  role: string;
  titre?: string;
  createdAt: number;
  tours: TourMesureAgent[];
  /** Les sujets de mémoire que cet agent est allé demander, par leur nom. */
  sujetsMemoire: string[];
  /**
   * Les PASSAGES de documentation remontés à cet agent par la recherche
   * (`passages-doc.ts`) : ce que la machine est allée chercher toute seule.
   * Absent sur un agent qui a reçu l'index de la mémoire tel quel.
   */
  passages?: { source: string; titre: string; score: number; tokens: number }[];
  /** Ce que son accueil emportait : instructions, compétences, index de mémoire. */
  accueil: { instructions: boolean; competences: boolean; memoire: boolean };
}

/** Ce que le serveur rassemble pour construire le parcours. */
export interface SourceParcours {
  origin: 'user' | 'agent';
  createdAt: number;
  /** L'utilisateur a autorisé la dépense. */
  autorisee: boolean;
  colonne: string;
  doneAt?: number;
  deployedAt?: number;
  archivedAt?: number;
  /** Le tour du chef d'orchestre qui a produit la carte, quand il est rattaché. */
  tri?: { tours: TourMesureAgent[]; sujetsMemoire: string[] };
  /** Les agents de la carte, du plus ancien au plus récent. */
  agents: AgentDuParcours[];
  /**
   * La ventilation MESURÉE du contexte d'exécution (en caractères réellement
   * partis), telle que le démon la range sur le chiffrage de la carte.
   */
  ventilation?: {
    consignes?: number;
    description?: number;
    memoireEtInstructions?: number;
  };
}

/** La somme des tours d'un ou plusieurs agents, sans jamais recouvrir. */
export function mesurerTours(tours: TourMesureAgent[]): MesureEtape | undefined {
  const mesures = tours.filter(tourMesure);
  if (!mesures.length) return undefined;

  const somme = (lire: (tour: TourMesureAgent) => number) =>
    mesures.reduce((total, tour) => total + lire(tour), 0);

  const couts = mesures.map((tour) =>
    coutDuTour({
      inputTokens: tour.inputTokens,
      cachedTokens: tour.cachedTokens,
      outputTokens: tour.outputTokens,
      model: tour.model,
    }),
  );

  const entree = somme((tour) => tour.inputTokens);
  const cache = somme((tour) => tour.cachedTokens);
  const sortie = somme((tour) => tour.outputTokens);
  return {
    tours: mesures.length,
    entree,
    cache,
    sortie,
    total: entree + cache + sortie,
    // Un seul tarif manquant et le total serait sous-évalué sans le dire.
    cout: couts.some((cout) => cout === undefined)
      ? undefined
      : couts.reduce<number>((total, cout) => total + (cout ?? 0), 0),
    secondes: somme((tour) => tour.seconds),
  };
}

/** Le nom d'un rôle d'agent, en français. */
export function nomDuRole(role: string): string {
  switch (role) {
    case 'orchestrator':
      return "chef d'orchestre";
    case 'analysis':
      return 'analyse';
    case 'task':
      return 'exécution';
    case 'deploy':
      return 'publication';
    default:
      return 'agent';
  }
}

/** Ce qu'un accueil a emporté, en clair — c'est du contexte réellement envoyé. */
function lignesDAccueil(accueil: AgentDuParcours['accueil'], recherche = false): string[] {
  const lignes: string[] = [];
  // La recherche REMPLACE l'index : dire les deux ferait compter deux fois un
  // contexte qui n'est parti qu'une seule fois.
  if (accueil.memoire && !recherche) lignes.push("l'index de la mémoire du projet");
  else if (!accueil.memoire) lignes.push('aucun index de mémoire — accueil allégé');
  if (accueil.instructions) lignes.push('la liste des fichiers d’instructions');
  if (accueil.competences) lignes.push('la liste des compétences partagées');
  return lignes;
}

/** Les sujets de mémoire demandés, en une ligne. Rien à dire s'il n'y en a pas. */
function ligneSujets(sujets: string[]): string[] {
  if (!sujets.length) return [];
  return [`la mémoire des sujets ${sujets.map((s) => `« ${s} »`).join(', ')}`];
}

/**
 * Les PASSAGES retrouvés par la recherche, en clair : combien, d'où, et ce
 * qu'ils ont coûté. Une ligne par passage — c'est ce que l'agent a vraiment eu
 * sous les yeux à la place de l'index de la mémoire.
 */
function lignesPassages(passages: AgentDuParcours['passages']): string[] {
  if (!passages?.length) return [];
  const jetons = passages.reduce((total, p) => total + p.tokens, 0);
  return [
    `${passages.length} passages retrouvés dans la documentation, ${jetons.toLocaleString('fr-CH')} tokens en tout`,
    ...passages.map(
      (passage) =>
        `${passage.source}${passage.titre ? ` — ${passage.titre}` : ''} ` +
        `(pertinence ${Math.round(passage.score * 100)} %, ${passage.tokens.toLocaleString('fr-CH')} tokens)`,
    ),
  ];
}

/** La ventilation mesurée du contexte, en caractères réellement partis. */
function lignesVentilation(ventilation?: SourceParcours['ventilation']): string[] {
  if (!ventilation) return [];
  const lignes: string[] = [];
  const dire = (nombre: number | undefined, quoi: string) => {
    if (nombre === undefined || nombre <= 0) return;
    lignes.push(`${quoi} — ${nombre.toLocaleString('fr-CH')} caractères mesurés`);
  };
  dire(ventilation.description, 'la description de la carte');
  dire(ventilation.memoireEtInstructions, "le briefing et l'index de mémoire");
  dire(ventilation.consignes, 'les consignes de HaikoDev');
  return lignes;
}

/**
 * LE PARCOURS. Les étapes sont produites dans l'ordre du temps, et seules celles
 * qui ont un sens pour CETTE carte apparaissent : une carte née d'une demande
 * directe n'a pas d'étape de tri, une carte jamais publiée n'a pas d'étape de
 * mise en production.
 */
export function construireParcours(source: SourceParcours): EtapeParcours[] {
  const etapes: EtapeParcours[] = [];

  /* 1. LE TRI — seulement pour une carte née d'une proposition du chef. */
  if (source.origin === 'agent') {
    const mesure = source.tri ? mesurerTours(source.tri.tours) : undefined;
    etapes.push({
      cle: 'tri',
      titre: "Tri par le chef d'orchestre",
      quoi: 'Le chef a transformé la demande en carte et choisi le niveau de son agent.',
      quand: source.createdAt,
      cherche: [
        'la conversation en cours',
        ...(source.tri ? ligneSujets(source.tri.sujetsMemoire) : []),
        "rien du code du projet — le chef trie, il n'étudie pas",
      ],
      mesure,
      sansMesure: mesure
        ? undefined
        : "Le tour du chef n'est pas rattaché à cette carte : sa mesure existe dans sa conversation, pas ici.",
      attendMesure: true,
      etat: 'faite',
    });
  }

  /* 2. L'AUTORISATION — un geste humain, jamais un appel au moteur. */
  etapes.push({
    cle: 'autorisation',
    titre: 'Autorisation de la dépense',
    quoi: source.autorisee
      ? 'Vous avez autorisé la dépense. La carte attend encore un geste pour partir.'
      : "La carte attend votre autorisation. Tant qu'elle attend, elle ne coûte rien.",
    quand: source.autorisee ? undefined : undefined,
    cherche: [],
    sansMesure: 'Aucun appel au moteur : une carte qui attend ne consomme rien.',
    attendMesure: false,
    etat: source.autorisee ? 'faite' : 'a-venir',
  });

  /* 3. L'EXÉCUTION — un pas par agent de travail, dans l'ordre où ils sont nés. */
  const travailleurs = source.agents.filter((agent) => agent.role !== 'deploy');
  for (const [rang, agent] of travailleurs.entries()) {
    const mesure = mesurerTours(agent.tours);
    const premier = rang === 0;
    etapes.push({
      cle: 'execution',
      titre:
        travailleurs.length > 1
          ? `Travail de l’agent — ${nomDuRole(agent.role)} (${rang + 1})`
          : 'Étude, chiffrage et exécution',
      quoi: premier
        ? "Un seul agent étudie le projet, chiffre la tâche et l'exécute dans le même tour."
        : `Un tour de plus sur la même carte (${nomDuRole(agent.role)}).`,
      quand: agent.createdAt,
      cherche: [
        ...lignesDAccueil(agent.accueil, !!agent.passages?.length),
        ...lignesPassages(agent.passages),
        ...ligneSujets(agent.sujetsMemoire),
        ...(premier ? lignesVentilation(source.ventilation) : []),
      ],
      mesure,
      sansMesure: mesure ? undefined : "Aucun tour mesuré : le moteur n'a rien rendu pour cet agent.",
      attendMesure: true,
      etat: mesure ? (source.doneAt ? 'faite' : 'en-cours') : 'en-cours',
    });
  }

  if (!travailleurs.length) {
    etapes.push({
      cle: 'execution',
      titre: 'Étude, chiffrage et exécution',
      quoi: "Rien n'est encore parti au moteur : le lancement reste un geste humain.",
      cherche: [],
      sansMesure: 'Aucun appel au moteur : la carte n’a pas encore été lancée.',
      attendMesure: true,
      etat: 'a-venir',
    });
  }

  /* 4. LE DÉPLOIEMENT. */
  const publieurs = source.agents.filter((agent) => agent.role === 'deploy');
  const mesurePublication = mesurerTours(publieurs.flatMap((agent) => agent.tours));
  const deploye = !!source.deployedAt || source.colonne === 'in_production';
  if (deploye || source.colonne === 'to_deploy' || publieurs.length) {
    etapes.push({
      cle: 'deploiement',
      titre: 'Déploiement',
      quoi: 'La branche de la carte est fusionnée dans la principale, enregistrée, poussée.',
      quand: source.deployedAt,
      cherche: publieurs.length ? ['les fichiers en conflit ou les contrôles tombés, quand il y en a'] : [],
      mesure: mesurePublication,
      sansMesure: mesurePublication
        ? undefined
        : 'Aucun tour de moteur rattaché à cette carte : un déploiement sans incident est une opération git, pas un appel au moteur.',
      // Un déploiement n'appelle le moteur QUE sur incident : sans agent de
      // publication, son silence est normal, pas un trou.
      attendMesure: publieurs.length > 0,
      etat: deploye ? 'faite' : 'a-venir',
    });
  }

  /* 5. LA MISE EN PRODUCTION. */
  if (source.colonne === 'in_production' || source.colonne === 'archived' || source.archivedAt) {
    etapes.push({
      cle: 'production',
      titre: 'Mise en production',
      quoi: 'La mise en ligne suit le prompt réglé du projet — un second geste, séparé du déploiement.',
      quand: source.archivedAt,
      cherche: [],
      sansMesure:
        'La mise en production est menée pour le projet entier : sa mesure ne se découpe pas par carte.',
      attendMesure: false,
      etat: source.colonne === 'archived' || source.archivedAt ? 'faite' : 'en-cours',
    });
  }

  return etapes;
}

/**
 * LE TOTAL DU PARCOURS : la somme des étapes RÉELLEMENT mesurées. Il ne s'affiche
 * que si au moins une étape porte une mesure, et il dit combien d'étapes ne sont
 * pas comptées — sinon il se lirait comme le coût entier de la tâche.
 */
export function totalDuParcours(etapes: EtapeParcours[]): {
  total: number;
  tours: number;
  cout?: number;
  etapesMesurees: number;
  etapesSansMesure: number;
} | undefined {
  const mesurees = etapes.filter((etape) => etape.mesure);
  if (!mesurees.length) return undefined;

  const couts = mesurees.map((etape) => etape.mesure!.cout);
  const totaux = mesurees.map((etape) => etape.mesure!.total);
  return {
    total: totaux.reduce<number>((somme, valeur) => somme + (valeur ?? 0), 0),
    tours: mesurees.reduce((somme, etape) => somme + etape.mesure!.tours, 0),
    cout: couts.some((cout) => cout === undefined)
      ? undefined
      : couts.reduce<number>((somme, cout) => somme + (cout ?? 0), 0),
    etapesMesurees: mesurees.length,
    // Une étape « à venir », ou qui n'appelle jamais le moteur (un geste, une
    // fusion sans conflit), n'a rien à mesurer : elle ne compte pas comme un trou.
    etapesSansMesure: etapes.filter(
      (etape) => etape.attendMesure && !etape.mesure && etape.etat !== 'a-venir',
    ).length,
  };
}
