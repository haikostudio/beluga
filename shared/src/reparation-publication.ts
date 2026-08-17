/*
 * UNE ÉTAPE DE PUBLICATION QUI TOMBE SE RÉPARE, PUIS SE REJOUE.
 *
 * Trois étapes savaient déjà se relever seules : la FUSION (un agent résout le
 * conflit), les CONTRÔLES et la CONSTRUCTION (un agent répare, on rejoue).
 * Toutes les autres s'arrêtaient net : un envoi refusé parce que le dépôt
 * distant avait avancé, un dossier servi devenu inaccessible, un service qui
 * refuse de repartir, une adresse publique muette — chacune laissait la
 * publication ROUGE, et il fallait revenir la relancer à la main.
 *
 * Le mécanisme est le même partout, et il tient en quatre temps :
 *
 *  1. l'étape tombe, avec sa SORTIE (la vraie, celle de la commande) ;
 *  2. la panne est RECONNUE à son message — jamais devinée ;
 *  3. un agent de dépannage reçoit la panne NOMMÉE et ses GESTES ;
 *  4. l'étape est REJOUÉE, dans la limite d'un petit nombre de reprises.
 *
 * DEUX REFUS tiennent tout l'édifice. Une panne NON RECONNUE n'est jamais
 * bricolée : elle est rendue telle quelle, avec ce qui a été tenté. Et une
 * panne reconnue mais NON RÉPARABLE par un agent (un identifiant refusé, un
 * droit d'administration à configurer) est NOMMÉE, sans qu'on envoie personne
 * tourner autour.
 *
 * Ces règles sont PURES : elles ne connaissent ni la base, ni git, ni le
 * disque. Elles lisent un texte et rendent un nom, des gestes et des phrases —
 * donc elles se rejouent seules, sans publication en cours.
 *
 * DEUX LIMITES QUE LA RÉPARATION NE FRANCHIT JAMAIS, écrites dans les gestes
 * eux-mêmes : elle ne met rien en ligne que l'utilisateur n'ait demandé (elle
 * rejoue l'étape d'une publication DÉJÀ lancée par lui, rien d'autre), et elle
 * ne redémarre jamais le démon HaikoDev, qui porte tous les agents au travail.
 */

import type { DeployStepKey } from './models.js';

/**
 * Combien de fois une étape tombée est rejouée après passage d'un agent.
 *
 * Deux, comme les contrôles et la construction, qui suivaient déjà cette règle
 * (`REPARATIONS_MAX`, `server/src/deploy.ts`). Un plafond volontairement bas :
 * une panne qui résiste à deux réparations n'est pas une panne de plomberie, et
 * la rejouer indéfiniment ne ferait que masquer sa cause.
 */
export const REPRISES_ETAPE_MAX = 2;

/** Une panne reconnue sur une étape de publication. */
export interface PanneDePublication {
  /** Son nom, en français, tel qu'il s'affichera dans le déroulé. */
  nom: string;
  /**
   * Un agent peut-il y faire quelque chose ? Faux pour ce qui se règle
   * ailleurs : un identifiant refusé, un droit d'administration manquant. On le
   * DIT au lieu d'envoyer un agent tourner en rond.
   */
  reparable: boolean;
  /** Les gestes demandés à l'agent de dépannage, dans l'ordre. */
  gestes: string[];
}

type Signature = { motifs: RegExp[]; panne: PanneDePublication };

/*
 * Les pannes connues, PAR ÉTAPE. On reconnaît au MESSAGE, comme le fait déjà
 * la réparation des dossiers de travail (`reparation-worktree.ts`) : git,
 * systemd et le système écrivent toujours les mêmes phrases.
 */
const SIGNATURES: Partial<Record<DeployStepKey, Signature[]>> = {
  push: [
    {
      motifs: [/\brejected\b/i, /non-fast-forward/i, /fetch first/i, /behind its remote/i],
      panne: {
        nom: 'le dépôt distant a avancé depuis le départ de la publication',
        reparable: true,
        gestes: [
          'Récupère ce qui est arrivé sur le dépôt distant (`git fetch origin`).',
          'Rejoue l’historique local par-dessus (`git rebase origin/<branche>`), ou fusionne si le rebase n’est pas possible.',
          'Résous les conflits en GARDANT LES DEUX INTENTIONS : le travail distant et le lot en cours de publication.',
          'Vérifie que le projet compile encore une fois l’historique remis d’aplomb.',
          'N’envoie RIEN toi-même et ne force jamais l’envoi (`--force`) : la publication rejouera l’envoi elle-même.',
        ],
      },
    },
    {
      motifs: [/Permission denied \(publickey\)/i, /Authentication failed/i, /could not read Username/i, /403 Forbidden/i],
      panne: {
        nom: 'le dépôt distant refuse l’identifiant du serveur',
        reparable: false,
        gestes: [],
      },
    },
  ],

  publish: [
    {
      motifs: [/EACCES/i, /Permission denied/i, /operation not permitted/i],
      panne: {
        nom: 'le dossier servi refuse l’écriture',
        reparable: true,
        gestes: [
          'Regarde le dossier visé par l’installation : à qui appartient-il, qui a le droit d’y écrire.',
          'Rends-le écrivable par le compte qui fait tourner la publication, sans jamais élargir les droits au-delà de ce dossier.',
          'Ne déplace pas le dossier servi et ne change pas la configuration du serveur web : seul le droit d’écriture est en cause.',
        ],
      },
    },
    {
      motifs: [/ENOSPC/i, /No space left on device/i],
      panne: {
        nom: 'le disque est plein',
        reparable: true,
        gestes: [
          'Mesure ce qui occupe le disque (`df -h`, puis `du` sur les gros dossiers).',
          'Libère de la place sur ce qui se régénère seul : caches d’installation, anciennes constructions, journaux.',
          'NE SUPPRIME AUCUN travail : ni dossier de carte, ni dépôt, ni base de données, ni sauvegarde.',
        ],
      },
    },
    {
      motifs: [/ENOENT/i, /no such file or directory/i],
      panne: {
        nom: 'un fichier ou un dossier attendu par l’installation manque',
        reparable: true,
        gestes: [
          'Nomme le fichier ou le dossier manquant à partir de la sortie.',
          'S’il devait être produit par la construction, relance la construction et dis ce qu’elle rend.',
          'S’il s’agit d’un dossier de destination, crée-le à l’endroit exact que la sortie indique.',
        ],
      },
    },
  ],

  restart: [
    {
      motifs: [/sudo|sudoers|droits d’administration|manque de droits/i],
      panne: {
        nom: 'le redémarrage du service demande des droits d’administration absents',
        reparable: false,
        gestes: [],
      },
    },
    {
      motifs: [/Unit .* not found/i, /could not be found/i, /Failed to start/i, /status=\d+/i, /Job for .* failed/i],
      panne: {
        nom: 'le service système du projet refuse de repartir',
        reparable: true,
        gestes: [
          'Lis le journal du service (`journalctl -u <service> -n 100 --no-pager`) et NOMME la ligne qui explique le refus.',
          'Répare la cause dans le projet : dépendance absente, fichier de configuration erroné, port déjà pris, construction incomplète.',
          'Ne redémarre pas le service toi-même : la publication rejouera le redémarrage.',
          'NE TOUCHE JAMAIS au service du démon HaikoDev : il porte toutes les publications et tous les agents au travail, le couper interromprait celle-ci.',
        ],
      },
    },
  ],
};
/*
 * Ni `merge`, ni `verify`, ni `build` ne figurent ici : ces trois étapes ont
 * DÉJÀ leur réparation, écrite avant celle-ci et plus fine (l'agent y reçoit
 * les fichiers en conflit, les contrôles tombés par leur nom, la commande de
 * construction). On ne les double pas — on complète les quatre qui n'avaient
 * rien.
 */

/**
 * La panne d'une ADRESSE qui ne répond pas — le verdict final d'un
 * déploiement, et le seul qui juge le RÉSULTAT plutôt que le processus.
 *
 * Elle ne dépend d'aucun message : une adresse muette est toujours la même
 * panne, quel que soit le motif rendu par le réseau. Elle est donc nommée à
 * part, et toujours réparable — c'est précisément le cas où un agent a quelque
 * chose à regarder.
 */
export function panneDAdresseMuette(url: string): PanneDePublication {
  return {
    nom: `l’adresse publique ${url} ne répond pas après la mise en ligne`,
    reparable: true,
    gestes: [
      `Vérifie ce qui répond à ${url}, puis remonte la chaîne : le service du projet tourne-t-il, écoute-t-il le bon port, le serveur web le vise-t-il ?`,
      'Lis le journal du service du projet et nomme l’erreur au démarrage, s’il y en a une.',
      'Répare la cause : construction incomplète, port changé, configuration du serveur web désaccordée, dépendance absente.',
      'NE REDÉMARRE JAMAIS le démon HaikoDev pour « débloquer » : il porte cette publication et tous les agents au travail.',
      'Ne relance pas la publication : elle recontrôlera l’adresse toute seule dès que tu auras fini.',
    ],
  };
}

/**
 * La panne reconnue sur cette étape, à partir de sa sortie — ou `null` quand
 * rien ne correspond.
 *
 * `null` est une réponse à part entière, et la plus importante : elle veut dire
 * « je ne sais pas ce que c'est », donc « on ne bricole pas ».
 */
export function reconnaitrePanneDePublication(
  etape: DeployStepKey,
  sortie: string,
): PanneDePublication | null {
  const texte = sortie ?? '';
  if (!texte.trim()) return null;
  for (const signature of SIGNATURES[etape] ?? []) {
    if (signature.motifs.some((motif) => motif.test(texte))) return signature.panne;
  }
  return null;
}

/**
 * La consigne envoyée à l'agent de dépannage.
 *
 * Elle dit TROIS choses et rien d'autre : ce qui bloque (nommé), la sortie
 * réelle, et les gestes attendus. Elle rappelle aussi les deux interdits — ne
 * rien mettre en ligne, ne pas relancer la publication —, parce qu'un agent
 * qui « finit le travail » à la place de la publication la ferait repartir sur
 * un état qu'elle ne connaît pas.
 */
export function consigneDeReparationDEtape(input: {
  libelleEtape: string;
  panne: PanneDePublication;
  sortie: string;
  passe: number;
  passesMax: number;
}): string {
  const { libelleEtape, panne, sortie, passe, passesMax } = input;
  return [
    `La publication est EN COURS et bloque à l’étape « ${libelleEtape} » (passe ${passe} sur ${passesMax}).`,
    '',
    `Panne reconnue : ${panne.nom}.`,
    '',
    'Sortie réelle de l’étape :',
    '```',
    (sortie ?? '').slice(-4000).trim() || '(sortie vide)',
    '```',
    '',
    'Fais exactement ceci, et rien d’autre :',
    ...panne.gestes.map((geste, i) => `${i + 1}. ${geste}`),
    '',
    'Deux interdits : ne mets RIEN en ligne toi-même (la mise en ligne est une décision de l’utilisateur, déjà prise pour cette publication-ci), et ne relance pas la publication — elle rejouera l’étape toute seule dès que tu auras fini.',
    'Enregistre ton travail en nommant tes fichiers un par un (`git add` fichier par fichier : le dossier est partagé). Réponds court.',
  ].join('\n');
}

/** Le titre de l'agent de dépannage, pour qu'on le reconnaisse dans la pile. */
export function titreDuDepanneur(libelleEtape: string): string {
  return `Publication — ${libelleEtape} en échec`;
}

/** Ce qu'on écrit dans le déroulé quand un agent part réparer. */
export function mentionDeDepannage(panne: PanneDePublication, passe: number, passesMax: number): string {
  return `Panne reconnue (${panne.nom}) : un agent de dépannage intervient — reprise ${passe} sur ${passesMax}.`;
}

/** Ce qu'on écrit quand l'étape rejouée est enfin passée. */
export function recitEtapeRejouee(passe: number): string {
  return `reprise ${passe} : l’étape a été rejouée et elle est passée`;
}

/** Ce qu'on écrit quand l'étape rejouée retombe. */
export function recitEtapeRetombee(passe: number): string {
  return `reprise ${passe} : l’étape a été rejouée et elle est retombée`;
}

/**
 * Ce qu'on écrit quand on REFUSE de réparer : panne inconnue, ou reconnue mais
 * qui se règle ailleurs. Dans les deux cas, rien n'est bricolé et la raison est
 * dite en clair.
 */
export function recitSansReparation(panne: PanneDePublication | null): string {
  if (!panne) {
    return 'panne non reconnue : rien n’a été bricolé, l’étape est rendue telle quelle';
  }
  return `panne reconnue (${panne.nom}) mais elle ne se répare pas depuis une publication : rien n’a été tenté`;
}

/** Ce qu'on écrit quand l'agent de dépannage lui-même n'a pas abouti. */
export function recitDepanneurEnEchec(passe: number, raison: string): string {
  return `reprise ${passe} : l’agent de dépannage n’a pas abouti (${raison})`;
}

/**
 * Le journal des reprises, ajouté SOUS le détail de l'étape.
 *
 * Il vit dans le déroulé de la colonne, pas dans un fichier de journal : c'est
 * là qu'on regarde quand une publication a été rouge, et on doit y lire d'un
 * coup d'œil ce qui est tombé, ce qui a été tenté, et si ça a fini par passer.
 */
export function journalDesReprises(reparations: string[]): string {
  if (!reparations.length) return '';
  return `\n\nRéparations tentées :\n${reparations.map((r) => `- ${r}`).join('\n')}`;
}

/**
 * L'avertissement d'une publication RÉUSSIE dont la comptabilité a bronché.
 *
 * Ranger les cartes vient APRÈS la mise en ligne : si une carte ne peut pas
 * être relue ou déplacée, le code est en ligne quand même, et l'annoncer en
 * ÉCHEC serait un mensonge. On le dit donc à part, en nommant les cartes
 * restées en arrière — sinon on les chercherait dans la mauvaise colonne sans
 * jamais savoir pourquoi.
 */
export function avertissementCartesNonRangees(cartes: string[]): string {
  if (!cartes.length) return '';
  const sujet =
    cartes.length > 1
      ? `${cartes.length} cartes n’ont pas pu être rangées`
      : 'une carte n’a pas pu être rangée';
  const suite = cartes.length > 1 ? 'Elles restent' : 'Elle reste';
  return (
    `La mise en ligne a bien eu lieu, mais ${sujet} après coup : ${cartes.join(', ')}. ` +
    `${suite} dans la colonne de départ ; le code, lui, est en ligne.`
  );
}

/**
 * La ligne d'état affichée à côté d'une étape réparée : « réparée · 1 reprise ».
 *
 * Zéro reprise ne s'écrit pas : une étape passée du premier coup n'a rien à
 * raconter.
 */
export function mentionDesReprises(reprises: number | undefined): string {
  const n = Number.isFinite(reprises) && (reprises ?? 0) > 0 ? Math.floor(reprises as number) : 0;
  if (!n) return '';
  return n > 1 ? `réparée · ${n} reprises` : 'réparée · 1 reprise';
}
