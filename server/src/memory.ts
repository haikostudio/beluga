import fs from 'node:fs';
import path from 'node:path';
import {
  FICHIER_D_ATTENTE,
  fichierDAttentePourCopie,
  instructionsQuiFontFoi,
  nettoyer,
  partsDAccueil,
  texteAccesGithub,
  texteDesCompetences,
  annonceeEnTeteDeSession,
  ficheEnService,
  ficheServieAuProjet,
  COMPETENCES_MINIMUM_POUR_FILTRER,
  type InstructionsDuProjet,
  type NiveauDAccueil,
} from '@beluga/shared';
import { dossierDesCompetences, listerCompetences } from './competences.js';
import { garderLesPertinents } from './jugement-rapide.js';

/**
 * LE BRIEFING D'UN AGENT ET L'HISTORIQUE DES LIVRAISONS.
 *
 * La mémoire du projet ne vit plus ici : elle est en CLASSEURS dans la base du
 * démon (`server/src/classeurs.ts`), et l'ancien arbre de fichiers
 * (`MEMOIRE.md`, `docs/memoire/`, `docs/regles/`, `docs/verifications.md`) a été
 * archivé puis effacé, puis repris dans la base de connaissances (`server/src/connaissances.ts`). Restent :
 *  — le fichier d'instructions qui fait foi, et le squelette posé à l'ajout d'un projet ;
 *  — le briefing de lancement (projet, dossier, compétences, GitHub, façon de
 *    déposer une règle durable) ;
 *  — HISTORIQUE.md : les livraisons datées. Relisible par un humain, jamais
 *    envoyé au moteur.
 */

const HISTORY_NAME = 'HISTORIQUE.md';
const HISTORY_HEADER =
  "# Historique des livraisons\n\n_Tenu automatiquement par Beluga Build. Ce fichier n'est JAMAIS envoyé au moteur : il se relit à la main._\n\n";

export function historyPath(projectPath: string): string {
  return path.join(projectPath, HISTORY_NAME);
}

export function readHistory(projectPath: string): string {
  try {
    return fs.readFileSync(historyPath(projectPath), 'utf8');
  } catch {
    return '';
  }
}

/** Une livraison datée : elle va dans l'historique, jamais dans la mémoire. */
export function appendHistory(projectPath: string, line: string): void {
  const clean = `- ${nettoyer(line)}`;
  let content = readHistory(projectPath);
  if (!content.trim()) content = HISTORY_HEADER;
  const lines = content.split('\n');
  if (lines.some((l) => l.trim().toLowerCase() === clean.toLowerCase())) return;
  lines.push(clean);
  writeSafely(historyPath(projectPath), lines.join('\n'));
}


function writeSafely(file: string, content: string): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content.endsWith('\n') ? content : content + '\n', 'utf8');
  } catch {
    /* la mémoire ne doit jamais faire échouer une tâche */
  }
}

/* ------------------------------------------------------------------ */
/**
 * Le fichier d'instructions qui fait FOI pour ce projet et ce moteur.
 *
 * Le fichier natif du moteur ne porte pas toujours les instructions : à la
 * création d'un projet, `AGENTS.md` ne fait que renvoyer à `CLAUDE.md`. On suit
 * le renvoi, pour qu'un agent Codex lise le VRAI contenu et écrive ses règles
 * durables là où quelqu'un les relira. Rien n'est écrit ni supprimé ici.
 */
export function instructionsDuProjet(projectPath: string, engine?: string): InstructionsDuProjet {
  const lire = (nom: string): string | null => {
    const chemin = path.join(projectPath, nom);
    try {
      return fs.existsSync(chemin) ? fs.readFileSync(chemin, 'utf8') : null;
    } catch {
      return null;
    }
  };
  return instructionsQuiFontFoi(engine, lire);
}

/**
 * Le fichier d'instructions posé À L'AJOUT d'un projet, s'il n'en a aucun.
 * Un squelette vide vaut mieux qu'une absence : il dit ce qu'on attend de lui,
 * et le premier agent qui touche à une règle durable le remplit au lieu de se
 * demander où l'écrire. Un projet qui a déjà le sien n'est jamais touché.
 */
export function creerFichierInstructions(projectPath: string, projectName: string): boolean {
  const existants = ['CLAUDE.md', 'AGENTS.md'].filter((f) => fs.existsSync(path.join(projectPath, f)));
  if (existants.length) return false;

  const contenu = `# ${projectName} — instructions du moteur

Fichier court et factuel, tenu à jour AU FIL des tâches par les agents : comment lancer, comment
vérifier, où vivent les choses, ce qu'on n'enfreint pas. Aucun journal ici — les livraisons vont
dans \`HISTORIQUE.md\`, la mémoire (faits, règles, contrôles) en classeurs dans Beluga Build — outils
\`memoire\` et \`remember\` —, les règles durables déposées dans \`${FICHIER_D_ATTENTE}\` (rangées la
nuit par le démon dans le classeur du projet).

## Où vivent les choses

_À remplir : les dossiers du projet et leur rôle, une ligne chacun._

## Lancer

\`\`\`bash
# À remplir : installer, construire, lancer en développement.
\`\`\`

## Vérifier

\`\`\`bash
# À remplir : les tests, les scripts de contrôle.
\`\`\`

## Règles à ne pas enfreindre

- Ne jamais publier de sa propre initiative : enregistrer et pousser, oui ; mettre en ligne est un
  geste de l'utilisateur.
`;
  writeSafely(path.join(projectPath, 'CLAUDE.md'), contenu);
  return true;
}

/**
 * LE BRIEFING COUPÉ SELON SON ORIGINE, et c'est cette coupure que le tiroir
 * « Contexte envoyé » donne à lire :
 *  — `sansMemoire` : ce qui vient du PROJET — son dossier, ses fichiers
 *    d'instructions ;
 *  — `socle` : ce qui vient de la PLATEFORME et serait le même sur n'importe
 *    quel projet — les compétences partagées, l'accès GitHub, la façon d'écrire
 *    une règle durable. Absent quand l'accueil n'en emporte rien ;
 *
 * La mémoire, elle, ne part plus avec le briefing : les PISTES de la mémoire en
 * classeurs sont ajoutées à part par l'exécution (`server/src/runtime.ts`).
 */
export interface BriefingSepare {
  sansMemoire: string;
  socle?: string;
}

/**
 * LES MODES D'EMPLOI UTILES À CE TRAVAIL, SELON LE JUGE LOCAL.
 *
 * Rend les NOMS des fiches annoncées que Laya ne juge pas hors sujet, ou
 * `undefined` sans avis (Laya absent, endormi, usage éteint, pool trop petit
 * pour valoir un tri) : le briefing retombe alors sur le classement par les
 * mots. Express : un lancement n'attend jamais un modèle qui dort.
 */
export async function competencesPertinentes(
  travail: string,
  ctx: { cardId?: string; projectId?: string; projet?: string },
): Promise<Set<string> | undefined> {
  if (!travail.trim()) return undefined;
  try {
    // Seules les fiches que CE projet recevra sont jugées : celles d'un autre
    // projet ne lui sont jamais servies (`ficheServieAuProjet`).
    const servies = listerCompetences().filter(
      (f) =>
        ficheEnService(f.etat) &&
        annonceeEnTeteDeSession(f) &&
        (ctx.projet === undefined || ficheServieAuProjet(f, ctx.projet)),
    );
    if (servies.length < COMPETENCES_MINIMUM_POUR_FILTRER) return undefined;
    const gardees = await garderLesPertinents(
      travail,
      servies,
      { cle: (f) => f.nom, texte: (f) => `${f.nom} : ${f.description}` },
      { usage: 'pertinence-competences', ...ctx },
    );
    /* Rien d'écarté = pas d'avis utile : le classement par les mots décide. */
    return gardees.length === servies.length ? undefined : new Set(gardees.map((f) => f.nom));
  } catch {
    return undefined;
  }
}

/**
 * Le briefing compact injecté au lancement de chaque agent : il sait déjà où
 * regarder au lieu de redécouvrir le projet de zéro.
 *
 * `avecMemoire` est faux pour les tours SUIVANTS d'une même session : la façon
 * d'écrire une règle durable est déjà dans le contexte de l'agent.
 */
export function briefingSepare(
  projectPath: string,
  projectName: string,
  avecMemoire = true,
  engine?: string,
  /**
   * Le dossier où l'agent travaille VRAIMENT, quand ce n'est pas celui du projet :
   * une carte lancée reçoit une copie de travail à elle. La mémoire et les
   * instructions se lisent toujours au même endroit — le projet — mais le dossier
   * annoncé doit être celui où l'agent écrit.
   */
  dossierDeTravail?: string,
  /**
   * Ce que l'accueil emporte. « minimal » ne dit que le projet et le dossier :
   * un agent appelé pour un dépannage de publication n'a que faire de la carte
   * de la mémoire ni de la liste des compétences (`shared/src/accueil-agent.ts`).
   */
  niveau: NiveauDAccueil = 'complet',
  /**
   * LE TRAVAIL RÉEL DE LA CARTE — son titre, puis son constat. Il sert à SERVIR
   * LE POOL DE COMPÉTENCES AU POIDS DE LA DEMANDE (les fiches qui en parlent
   * sont nommées, les autres comptées). Absent — une conversation, le chef
   * d'orchestre —, la liste entière part.
   */
  travail = '',
  /** Les compétences jugées utiles par le juge local, par nom (`texteDesCompetences`). */
  competencesPertinentes?: ReadonlySet<string>,
): BriefingSepare {
  const emporte = partsDAccueil(niveau);
  const dossier = dossierDeTravail?.trim() || projectPath;
  const parts: string[] = [
    dossier === projectPath
      ? `Projet : ${projectName} (dossier ${projectPath}).`
      : `Projet : ${projectName}. Tu travailles dans ${dossier} — une copie de travail à toi seul, ouverte pour cette carte (le projet vit dans ${projectPath}).`,
  ];

  const { fichier: quiFaitFoi, renvoiDepuis } = instructionsDuProjet(projectPath, engine);
  const instructions = emporte.instructions
    ? [quiFaitFoi, 'CLAUDE.md', 'AGENTS.md', 'README.md'].filter(
        (f, i, tab) => tab.indexOf(f) === i && fs.existsSync(path.join(projectPath, f)),
      )
    : [];
  if (instructions.length) parts.push(`Fichiers d'instructions présents : ${instructions.join(', ')}.`);
  if (emporte.instructions && renvoiDepuis) {
    parts.push(
      `${renvoiDepuis} ne fait que RENVOYER à ${quiFaitFoi} : c'est ${quiFaitFoi} qui porte les instructions de ce projet, ` +
        `c'est lui que tu lis — et que tu ne modifies pas toi-même.`,
    );
  }

  /*
   * Les compétences partagées sont ANNONCÉES, jamais supposées connues. Claude
   * les trouve dans le coffre de son compte, mais Codex n'a pas la notion et le
   * chef d'orchestre n'a pas le droit d'ouvrir celles de son moteur : sans
   * cette ligne, le même projet « ne sait pas créer une offre » d'un moteur à
   * l'autre. Un chemin de fichier se lit partout.
   */
  const socle: string[] = [];
  const competences = emporte.competences
    ? texteDesCompetences(listerCompetences(), dossierDesCompetences(), travail, competencesPertinentes, projectName)
    : '';
  if (competences) socle.push(competences);

  /*
   * L'accès GitHub est ANNONCÉ, jamais supposé deviné. Le jeton est posé dans
   * l'environnement de tout agent (`server/src/github.ts`), mais un agent qui
   * l'ignore continue de proposer une carte pour un `gh pr view` de dix
   * secondes. Une ligne, valable sur tous les projets, sans réglage
   * (`shared/src/acces-github.ts`).
   */
  if (emporte.github) socle.push(texteAccesGithub());

  const sansMemoire = parts.join('\n\n');
  if (!avecMemoire || !emporte.memoire) {
    return { sansMemoire, socle: socle.length ? socle.join('\n\n') : undefined };
  }

  /*
   * LA FAÇON D'ÉCRIRE UNE RÈGLE DURABLE EST DU SOCLE, PAS DE LA MÉMOIRE. Elle
   * était collée au bloc mémoire, ce qui faisait passer pour « venu du projet »
   * un paragraphe identique sur les dix-huit projets. Le tiroir compte
   * désormais chaque signe du bon côté.
   *
   * LE DÉPÔT D'UNE RÈGLE APPRISE EST PROPRE À LA CARTE, PLUS COMMUN À TOUTES.
   * Tant que le briefing nommait UN fichier, chaque agent ajoutait son entrée à
   * la fin du MÊME fichier : deux cartes finies le même jour écrivaient les
   * mêmes dernières lignes et se heurtaient à la fusion, par construction. Un
   * agent qui travaille dans SA copie écrit donc dans SON fichier — deux
   * fichiers différents ne peuvent pas entrer en conflit. Les dossiers PARTAGÉS
   * (chef, analyse, publication) gardent le fichier commun : ils ne travaillent
   * jamais à plusieurs en même temps.
   *
   * C'EST LA SEULE CONSIGNE SUR LE FICHIER D'INSTRUCTIONS : la méthode imposée
   * (`METHODE`, `server/src/runtime.ts`) renvoie ici, elle ne dit plus de le
   * modifier — ce que le socle interdit.
   */
  const depotDAttente =
    (dossier !== projectPath ? fichierDAttentePourCopie(path.basename(dossier)) : undefined) ??
    FICHIER_D_ATTENTE;

  socle.push(
    `RÈGLE DURABLE APPRISE : si ta tâche change une règle durable, une architecture ou une commande, NE TOUCHE PAS à ${quiFaitFoi} — ` +
      `écris-la à la fin de « ${depotDAttente} » (crée le fichier s'il n'existe pas), et le démon la rangera cette nuit comme fiche de règle dans le classeur du projet. ` +
      `${quiFaitFoi} est chargé par le MOTEUR à chaque session : le modifier fait repayer aux agents suivants tout ce qu'il contient, au plein tarif. ` +
      `Le fichier d'attente, lui, n'est lu par aucun moteur et ne coûte rien.\n` +
      `Format d'une entrée : un titre en « ## », puis « - sujet : <un thème : cartes, publication, interface, methode, branches, projets, quotas…> », puis « - contrat : <une ligne> » seulement si l'invariant doit être NOMMÉ dans ${quiFaitFoi}, ` +
      `puis le texte entier de la règle. Court et factuel : comment lancer, comment vérifier, où vivent les choses, ce qu'on n'enfreint pas. Aucun journal, aucune trace de tâche.\n` +
      `Un FAIT (décision, piège, convention) n'est pas une règle : il s'écrit avec l'outil « remember », et un fait devenu faux se remplace (« replaces »), il ne s'empile pas.`,
  );

  return { sansMemoire, socle: socle.length ? socle.join('\n\n') : undefined };
}

/** Le briefing complet, tel qu'envoyé au moteur : la part du projet, puis le socle. */
export function briefing(
  projectPath: string,
  projectName: string,
  avecMemoire = true,
  engine?: string,
  dossierDeTravail?: string,
  niveau: NiveauDAccueil = 'complet',
): string {
  const { sansMemoire, socle } = briefingSepare(
    projectPath,
    projectName,
    avecMemoire,
    engine,
    dossierDeTravail,
    niveau,
  );
  return [sansMemoire, socle].filter(Boolean).join('\n\n');
}
