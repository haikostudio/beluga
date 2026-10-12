/**
 * LE CAHIER DES CHARGES D'UN NOUVEAU PROJET — un parcours de cadrage à part.
 *
 * Décision de l'utilisateur (08.10.2026) : la fenêtre « Nouveau projet » porte
 * une case « Démarrer par un cahier des charges », cochée d'office pour un
 * projet VIDE et décochée pour un dépôt importé. Cochée, elle fait naître une
 * carte « Cahier des charges » dont l'agent de cadrage démarre seul et pose,
 * une à une, les questions de la compétence commune
 * « creer-une-application-complete ». Après CHAQUE réponse, il réécrit le
 * document du projet et l'avancement de la carte (outil `cahier_des_charges`).
 *
 * L'ÉTAT VIT SUR LA CARTE (`Card.cahierDesCharges`), jamais déduit des
 * messages (MEM-0370) : nombre de questions traitées, total prévu, phase en
 * cours, points restants, pause. C'est lui — avec le document — qui permet de
 * reprendre EXACTEMENT là où on s'était arrêté, même des jours plus tard et
 * même quand la session du moteur est perdue.
 *
 * LA PAUSE est un geste de l'utilisateur : elle coupe l'agent (sans toucher à
 * la colonne de la carte, qui reste avant le travail) et ne coûte plus rien.
 * Le document et l'avancement étant enregistrés après chaque réponse, rien n'est
 * à « sauver » au moment de la pause. « Reprendre » renvoie à l'agent le
 * document et l'avancement, et il repart à la question suivante.
 *
 * Règle PURE : ni base, ni disque, ni moteur (`server/src/test/cahier-des-charges.test.ts`).
 */

import { z } from 'zod';
import { echapperHtml as echapper } from './demande-copiable.js';
import type { EtapeDeSuivi } from './frise-de-suivi.js';
import type { SegmentDeSuivi } from './parcours-en-points.js';

/** Le document, rangé dans le projet. */
export const DOCUMENT_DU_CAHIER = 'docs/cahier-des-charges.md';

/** Le titre de la carte qui naît au montage. */
export const TITRE_CARTE_CAHIER = 'Cahier des charges';

/** La compétence commune dont l'agent suit le questionnaire. */
export const COMPETENCE_DU_CAHIER = 'creer-une-application-complete';

/**
 * LES SOURCES D'INSPIRATION fournies par l'utilisateur (images, fichiers joints
 * à ses réponses) : l'agent les recopie ici, dans le dossier du projet, et les
 * liste avec les liens de sites dans la partie « Inspiration » du document.
 */
export const DOSSIER_INSPIRATION = 'docs/inspiration';

/** Le titre de la carte qui prend la suite, une fois le cahier terminé. */
export function titreDeLaCarteDeSuite(nomDuProjet: string): string {
  return `Construction de « ${nomDuProjet} »`;
}

/** La marque d'une partie encore à trancher, dans le document. */
export const MARQUE_A_VOIR = 'à voir';

/** Les phases du questionnaire, dans l'ordre où l'agent les déroule. */
export const PHASES_DU_CAHIER = [
  'vision',
  'interfaces',
  'mecanismes',
  'technologies',
  'hebergement',
  'identite',
  'relecture',
] as const;
export type PhaseDuCahier = (typeof PHASES_DU_CAHIER)[number];

export const LIBELLES_PHASES_DU_CAHIER: Record<PhaseDuCahier, string> = {
  vision: 'Vision et public',
  interfaces: 'Interfaces',
  mecanismes: 'Fonctionnalités',
  technologies: 'Technologies',
  hebergement: 'Hébergement',
  identite: 'Identité visuelle',
  relecture: 'Relecture et plan',
};

/** L'état du cahier, écrit sur la carte. */
export const CahierDesCharges = z.object({
  /** Questions déjà tranchées. */
  faites: z.number().int().nonnegative().default(0),
  /** Questions prévues en tout (l'agent l'ajuste en chemin). 0 : pas encore estimé. */
  total: z.number().int().nonnegative().default(0),
  /** La phase en cours. */
  phase: z.enum(PHASES_DU_CAHIER).default('vision'),
  /** Ce qui reste à voir, en mots courants — c'est ce que la reprise relit. */
  restants: z.array(z.string()).default([]),
  /** Dernière écriture du document. */
  majA: z.number().optional(),
  /** Posée par « Mettre en pause », effacée par « Reprendre » ou un nouveau message. */
  enPauseA: z.number().optional(),
  /** Toutes les questions sont tranchées : la carte part dans « Archivé ». */
  termineA: z.number().optional(),
  /**
   * LA CARTE DE CONSTRUCTION NÉE À LA FIN DU CAHIER. Posée une seule fois : un
   * second « termine » ne fait pas naître une seconde carte.
   */
  suiteId: z.string().optional(),
});
export type CahierDesCharges = z.infer<typeof CahierDesCharges>;

/** L'état neuf, posé à la naissance de la carte. */
export function cahierNeuf(): CahierDesCharges {
  return { faites: 0, total: 0, phase: 'vision', restants: [] };
}

export type EtatDuCahier = 'en-cours' | 'en-pause' | 'termine';

export function etatDuCahier(cahier: Pick<CahierDesCharges, 'enPauseA' | 'termineA'>): EtatDuCahier {
  if (cahier.enPauseA) return 'en-pause';
  if (cahier.termineA) return 'termine';
  return 'en-cours';
}

/** La part faite, de 0 à 100. Un total inconnu ne promet rien : 0. */
export function pourcentageDuCahier(cahier: Pick<CahierDesCharges, 'faites' | 'total' | 'termineA'>): number {
  if (cahier.termineA) return 100;
  if (!cahier.total) return 0;
  return Math.max(0, Math.min(100, Math.round((cahier.faites / cahier.total) * 100)));
}

/**
 * CE QUE L'OUTIL REÇOIT, LU ET BORNÉ. Un avancement incohérent (plus de
 * questions faites que prévues) n'est pas refusé : le total est relevé, l'agent
 * ayant simplement découvert des questions en chemin.
 */
export function lireAvancement(
  args: Record<string, unknown>,
  avant: CahierDesCharges,
  maintenant: number,
): { ok: true; cahier: CahierDesCharges } | { ok: false; raison: string } {
  const entier = (v: unknown): number | undefined => {
    const n = typeof v === 'string' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  };
  const faites = entier(args.faites) ?? avant.faites;
  let total = entier(args.total) ?? avant.total;
  if (total < faites) total = faites;
  const phaseLue = String(args.phase ?? avant.phase);
  if (!(PHASES_DU_CAHIER as readonly string[]).includes(phaseLue)) {
    return { ok: false, raison: `Phase inconnue « ${phaseLue} » : ${PHASES_DU_CAHIER.join(', ')}.` };
  }
  const restants = Array.isArray(args.restants)
    ? args.restants.map((r) => String(r ?? '').trim()).filter(Boolean).slice(0, 40).map((r) => r.slice(0, 200))
    : avant.restants;
  const termine = args.termine === true || args.termine === 'true';
  return {
    ok: true,
    cahier: {
      faites,
      total,
      phase: phaseLue as PhaseDuCahier,
      restants: termine ? [] : restants,
      majA: maintenant,
      /* L'agent qui avance n'est plus en pause : il vient de recevoir une réponse. */
      enPauseA: undefined,
      termineA: termine ? avant.termineA ?? maintenant : undefined,
      suiteId: avant.suiteId,
    },
  };
}

/** Le verdict d'un bouton du bandeau : possible, ou la raison de son extinction. */
export interface VerdictDuCahier {
  possible: boolean;
  raison?: string;
}

export function pausePossible(cahier: CahierDesCharges | undefined): VerdictDuCahier {
  if (!cahier) return { possible: false, raison: 'Cette carte n’a pas de cahier des charges.' };
  if (cahier.enPauseA) return { possible: false, raison: 'Le cahier des charges est déjà en pause.' };
  if (cahier.termineA) return { possible: false, raison: 'Toutes les questions ont leur réponse.' };
  return { possible: true };
}

export function reprisePossible(cahier: CahierDesCharges | undefined): VerdictDuCahier {
  if (!cahier) return { possible: false, raison: 'Cette carte n’a pas de cahier des charges.' };
  if (!cahier.enPauseA) return { possible: false, raison: 'Le cahier des charges n’est pas en pause.' };
  return { possible: true };
}

/**
 * LE VOLET DU CAHIER EST UN VOLET À PART (décision de l'utilisateur, 09.10.2026) :
 * sans onglets, sans barre d'écriture, sans bouton de lancement — on répond dans
 * le panneau de décision —, avec ses trois étapes à lui. UN SEUL PRÉDICAT pour
 * tous ces écrans : une carte ordinaire ne peut pas en être touchée.
 */
export function estVoletDuCahier(carte: { cahierDesCharges?: unknown } | null | undefined): boolean {
  return !!carte?.cahierDesCharges;
}

/** L'étape où se trouve le cahier : la définition, ou « Terminé ». */
export function etapeCouranteDuCahier(cahier: Pick<CahierDesCharges, 'termineA'>): EtapeDeSuivi {
  return cahier.termineA ? 'termine' : 'cahier';
}

/**
 * LES TROIS ÉTAPES DE LA BARRE : « Création du projet » (toujours franchie : la
 * carte naît du montage), « Définition du cahier des charges » (en cours, ou en
 * attente d'un geste pendant la pause), « Terminé ».
 */
export function barreDuCahier(cahier: Pick<CahierDesCharges, 'termineA' | 'enPauseA'>): SegmentDeSuivi[] {
  const fini = !!cahier.termineA;
  return [
    { etape: 'creation', etat: 'fait' },
    { etape: 'cahier', etat: fini ? 'fait' : cahier.enPauseA ? 'question' : 'encours' },
    { etape: 'termine', etat: fini ? 'fait' : 'avenir' },
  ];
}

/** La case de la fenêtre « Nouveau projet » : cochée d'office pour un projet vide seulement. */
export function caseCahierCocheeParDefaut(source: 'vide' | 'github'): boolean {
  return source === 'vide';
}

/** Une partie du document, pour l'écran : son titre, son texte, et si elle reste à voir. */
export interface PartieDuCahier {
  titre: string;
  texte: string;
  aVoir: boolean;
}

/**
 * LE DOCUMENT DÉCOUPÉ EN PARTIES (« ## »). Une partie est « à voir » quand elle
 * porte la marque, ou qu'elle est vide. Ce qui précède le premier « ## » (titre
 * du document, chapeau) forme une partie sans titre.
 */
export function partiesDuCahier(markdown: string): PartieDuCahier[] {
  const parties: PartieDuCahier[] = [];
  let courante: PartieDuCahier | null = null;
  const fermer = () => {
    if (!courante) return;
    courante.texte = courante.texte.trim();
    courante.aVoir = !courante.texte || courante.texte.toLowerCase().includes(MARQUE_A_VOIR);
    if (courante.titre || courante.texte) parties.push(courante);
  };
  for (const ligne of String(markdown ?? '').split('\n')) {
    const titre = /^##\s+(.+?)\s*$/.exec(ligne);
    if (titre) {
      fermer();
      courante = { titre: titre[1]!, texte: '', aVoir: false };
      continue;
    }
    if (!courante) courante = { titre: '', texte: '', aVoir: false };
    courante.texte += `${ligne}\n`;
  }
  fermer();
  /* Le chapeau sans titre n'est jamais « à voir » : il n'attend aucune réponse. */
  return parties.map((p) => (p.titre ? p : { ...p, aVoir: false }));
}

/* ------------------------------------------------------------------ */
/* Les textes envoyés à l'agent                                        */
/* ------------------------------------------------------------------ */

/**
 * LA CONSIGNE DU PARCOURS, ajoutée à la consigne système du cadrage pour CETTE
 * carte seulement (`server/src/runtime.ts`). Elle ne change pas d'un tour à
 * l'autre : le genre de la carte est fixé à sa naissance.
 */
export function consigneDuCahier(cheminCompetence: string, cheminDuProjet: string): string {
  return `CETTE CARTE SUIT LE PARCOURS DU CAHIER DES CHARGES D'UN NOUVEAU PROJET. Là où il diffère du cadrage ordinaire, c'est ce parcours qui prime.

TON MODE D'EMPLOI est la compétence commune « ${COMPETENCE_DU_CAHIER} » : lis-la ENTIÈRE dès ton premier tour (${cheminCompetence}, avec ses annexes dans le même dossier) et suis son questionnaire, phase par phase : ${PHASES_DU_CAHIER.map((p) => LIBELLES_PHASES_DU_CAHIER[p]).join(' → ')}.

UNE QUESTION À LA FOIS, AVEC « ask_user » : chacune a ses choix, sa « description » (ce que change la réponse, en mots courants) et la réponse que tu CONSEILLES, en tête et marquée « (recommandé) ». Saute ce que les réponses précédentes rendent sans objet. Une précision de produit ne se suppose jamais ; une manière de construire se décide et s'écrit comme décidée.

APRÈS CHAQUE RÉPONSE, AVANT LA QUESTION SUIVANTE, appelle « cahier_des_charges » avec le document ENTIER mis à jour et l'avancement : « faites » (questions tranchées), « total » (questions prévues, ajusté en chemin), « phase », « restants » (ce qui reste à voir, en quelques mots chacun). Le document suit le gabarit de la compétence ; une partie pas encore tranchée porte « ${MARQUE_A_VOIR} ». L'outil l'écrit dans ${DOCUMENT_DU_CAHIER} du projet, et l'utilisateur le lit depuis la carte pendant qu'il s'écrit. C'est AUSSI ce qui permet de reprendre après une pause : rien ne doit vivre seulement dans la conversation.

L'UTILISATEUR RÉPOND DANS LE PANNEAU DE DÉCISION : il n'a pas de barre d'écriture sur cette carte. Il y coche un choix, écrit sa propre réponse, et peut JOINDRE des images ou des fichiers.

LES SOURCES D'INSPIRATION SE DEMANDENT, dans la phase « ${LIBELLES_PHASES_DU_CAHIER.identite} » : une question dédiée invite à donner des liens de sites qui plaisent et à joindre des images ou des fichiers (captures, logo, maquettes, charte). Chaque fichier reçu avec une réponse se RECOPIE dans ${cheminDuProjet}/${DOSSIER_INSPIRATION}/ ; le document les liste, avec les liens et ce qui plaît dans chacun, dans sa partie « ## Inspiration ».

LA PILE TECHNIQUE SE CHOISIT COUCHE PAR COUCHE, dans la phase « ${LIBELLES_PHASES_DU_CAHIER.technologies} » : UNE question par couche utile au projet (interface, serveur, base de données, comptes et connexion, notifications, paiement, courriels, temps réel, IA, stockage de fichiers…), chacune avec deux à quatre alternatives tirées de la grille technologique de la compétence, la recommandée en tête « (recommandé) », et dans sa description les projets récents qui l'emploient déjà. Une couche sans objet pour ce projet se saute.

L'UTILISATEUR PEUT METTRE EN PAUSE à tout moment : ton tour s'arrête net. À la reprise, on te redonne le document et l'avancement : relis-les, ne repose JAMAIS une question déjà tranchée, et enchaîne sur la suivante.

QUAND TOUT EST TRANCHÉ (relecture comprise) : appelle « cahier_des_charges » avec « termine » = vrai et le document complet (plus aucune marque « ${MARQUE_A_VOIR} »). C'EST LA FIN DE CETTE CARTE : elle part dans « Archivé », et une NOUVELLE carte naît pour rendre la compréhension et le plan de construction à partir du document. Tu ne rends donc NI compréhension NI plan ici, à aucun moment : termine ton tour par une phrase qui dit que le cahier est complet.`;
}

/** Le premier tour, envoyé en silence à la naissance de la carte. */
export function demandeDuPremierTour(projet: { name: string; description?: string }): string {
  const description = String(projet.description ?? '').trim();
  return `LE PROJET « ${projet.name} » VIENT D'ÊTRE MONTÉ, et l'utilisateur a demandé à démarrer par un cahier des charges. Personne n'a encore rien écrit dans cette carte : c'est toi qui ouvres la discussion.
${description ? `\nCE QUE L'UTILISATEUR A DIT DU PROJET EN LE CRÉANT :\n${description}\n` : ''}
Lis la compétence « ${COMPETENCE_DU_CAHIER} », écris un premier document (toutes les parties marquées « ${MARQUE_A_VOIR} ») et l'avancement avec « cahier_des_charges », puis pose la PREMIÈRE question de la phase « ${LIBELLES_PHASES_DU_CAHIER.vision} » avec « ask_user ». Continue ensuite question après question.`;
}

/** La reprise après une pause : tout ce qu'il faut pour repartir sans la conversation. */
export function demandeDeRepriseDuCahier(cahier: CahierDesCharges, document: string | undefined): string {
  const restants = cahier.restants.length ? cahier.restants.map((r) => `- ${r}`).join('\n') : '(aucun point noté)';
  return `REPRISE DU CAHIER DES CHARGES APRÈS UNE PAUSE. L'utilisateur revient : repars EXACTEMENT où tu t'étais arrêté.

AVANCEMENT ENREGISTRÉ : ${cahier.faites} question(s) tranchée(s)${cahier.total ? ` sur ${cahier.total} prévue(s)` : ''}, phase « ${LIBELLES_PHASES_DU_CAHIER[cahier.phase]} ».

CE QUI RESTE À VOIR :
${restants}

LE DOCUMENT TEL QU'IL EST ENREGISTRÉ (${DOCUMENT_DU_CAHIER}) :
${String(document ?? '').trim() || '(le document n’a pas pu être lu : reprends depuis l’avancement ci-dessus)'}

Ne repose aucune question déjà tranchée dans ce document. Pose la question SUIVANTE avec « ask_user », puis continue le parcours.`;
}

/**
 * LA PREMIÈRE DEMANDE DE LA CARTE DE SUITE, envoyée en silence à son cadrage
 * quand le cahier est terminé. Elle ne lance RIEN : l'agent rend sa
 * compréhension puis son plan, et c'est la validation du plan qui lance la
 * construction (« rien ne part au moteur avant le lancement »).
 */
export function demandeDeLaCarteDeSuite(projet: { name: string }, cheminDuProjet: string, cheminCompetence: string): string {
  return `LE CAHIER DES CHARGES DU PROJET « ${projet.name} » EST TERMINÉ. Il a été établi question par question avec l'utilisateur sur une autre carte, désormais archivée : cette carte-ci en prend la suite.

LIS D'ABORD, EN ENTIER :
- le cahier des charges : ${cheminDuProjet}/${DOCUMENT_DU_CAHIER} ;
- les sources d'inspiration fournies par l'utilisateur, s'il y en a : ${cheminDuProjet}/${DOSSIER_INSPIRATION}/ ;
- la compétence « ${COMPETENCE_DU_CAHIER} » (${cheminCompetence}), dont la méthode de construction fait foi.

PUIS, sans attendre qu'on te le demande : rends ta compréhension avec « rendre_comprehension », puis le PLAN DE CONSTRUCTION avec « rendre_plan ». Le plan suit la méthode de construction de la compétence ; sa PREMIÈRE étape recopie le cahier des charges et le dossier d'inspiration dans la copie de travail et les enregistre, car la copie de travail d'une carte ne contient que ce qui est enregistré.

Tout ce qui est écrit dans le cahier est TRANCHÉ : ne repose aucune de ses questions. Une précision qui manque vraiment se demande avec « ask_user ». Puis ARRÊTE-TOI : l'utilisateur valide le plan, et c'est ce clic qui lance la construction.`;
}

/** Le nom du fichier exporté : « Cahier des charges — <projet>.pdf » ou « .md ». */
export function nomDuCahierExporte(nomDuProjet: string, format: 'pdf' | 'md'): string {
  const propre = String(nomDuProjet ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim() || 'projet';
  return `${TITRE_CARTE_CAHIER} — ${propre}.${format}`;
}

/** Le texte d'une ligne : gras, italique, code, liens — le reste échappé. */
function enLigne(texte: string): string {
  return echapper(texte)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2">$2</a>');
}

/**
 * LE DOCUMENT EN HTML, POUR LE PDF. Le cahier n'emploie qu'un Markdown simple —
 * titres, paragraphes, listes, tableaux, gras, liens — : ce rendu le couvre
 * sans bibliothèque, et reste pur (testé seul).
 */
export function htmlDuCahier(markdown: string, titre: string): string {
  const lignes = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n');
  const sortie: string[] = [];
  let liste: 'ul' | 'ol' | null = null;
  let paragraphe: string[] = [];
  const fermerParagraphe = () => {
    if (paragraphe.length) sortie.push(`<p>${paragraphe.map(enLigne).join('<br>')}</p>`);
    paragraphe = [];
  };
  const fermerListe = () => {
    if (liste) sortie.push(`</${liste}>`);
    liste = null;
  };
  for (let i = 0; i < lignes.length; i++) {
    const ligne = lignes[i]!;
    const titreMd = /^(#{1,6})\s+(.*)$/.exec(ligne);
    const puce = /^\s*[-*+]\s+(.*)$/.exec(ligne);
    const numero = /^\s*\d+[.)]\s+(.*)$/.exec(ligne);
    if (!ligne.trim()) {
      fermerParagraphe();
      fermerListe();
    } else if (titreMd) {
      fermerParagraphe();
      fermerListe();
      const niveau = titreMd[1]!.length;
      sortie.push(`<h${niveau}>${enLigne(titreMd[2]!)}</h${niveau}>`);
    } else if (/^\s*\|.*\|\s*$/.test(ligne)) {
      fermerParagraphe();
      fermerListe();
      const rangees: string[][] = [];
      while (i < lignes.length && /^\s*\|.*\|\s*$/.test(lignes[i]!)) {
        const cellules = lignes[i]!.trim().slice(1, -1).split('|').map((c) => c.trim());
        if (!cellules.every((c) => /^:?-{2,}:?$/.test(c))) rangees.push(cellules);
        i++;
      }
      i--;
      const [entete, ...corps] = rangees;
      sortie.push(
        `<table>${entete ? `<thead><tr>${entete.map((c) => `<th>${enLigne(c)}</th>`).join('')}</tr></thead>` : ''}<tbody>${corps
          .map((r) => `<tr>${r.map((c) => `<td>${enLigne(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`,
      );
    } else if (puce || numero) {
      fermerParagraphe();
      const genre = puce ? 'ul' : 'ol';
      if (liste !== genre) {
        fermerListe();
        sortie.push(`<${genre}>`);
        liste = genre;
      }
      sortie.push(`<li>${enLigne((puce ?? numero)![1]!)}</li>`);
    } else if (/^>\s?/.test(ligne)) {
      fermerParagraphe();
      fermerListe();
      sortie.push(`<blockquote>${enLigne(ligne.replace(/^>\s?/, ''))}</blockquote>`);
    } else {
      fermerListe();
      paragraphe.push(ligne.trim());
    }
  }
  fermerParagraphe();
  fermerListe();
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${echapper(titre)}</title><style>
body{font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f;font-size:11pt;line-height:1.5;margin:0}
h1{font-size:20pt;margin:0 0 12pt}h2{font-size:14pt;margin:18pt 0 6pt;padding-bottom:3pt;border-bottom:1px solid #d9d9de}
h3{font-size:12pt;margin:12pt 0 4pt}p{margin:0 0 8pt}ul,ol{margin:0 0 8pt;padding-left:18pt}li{margin:2pt 0}
table{border-collapse:collapse;width:100%;margin:0 0 10pt;font-size:10pt}th,td{border:1px solid #d9d9de;padding:4pt 6pt;text-align:left;vertical-align:top}
th{background:#f3f3f6}code{font-family:ui-monospace,Menlo,monospace;font-size:9.5pt;background:#f3f3f6;padding:0 2pt;border-radius:2pt}
blockquote{margin:0 0 8pt;padding-left:8pt;border-left:3px solid #d9d9de;color:#555}a{color:#0b63c5}
</style></head><body>${sortie.join('\n')}</body></html>`;
}
