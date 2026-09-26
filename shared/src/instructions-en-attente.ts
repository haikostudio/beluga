/**
 * LE FICHIER D'INSTRUCTIONS NE BOUGE PLUS EN PLEINE JOURNÉE.
 *
 * `CLAUDE.md` est chargé par le MOTEUR lui-même à l'ouverture de chaque
 * session, et il forme le PRÉFIXE de tout ce qui suit. Tant qu'il ne change
 * pas, ce préfixe est relu au tarif du cache ; dès qu'il change d'un signe,
 * tous les agents qui démarrent ensuite le repaient au plein tarif. Or il
 * était réécrit TRENTE À SOIXANTE FOIS PAR JOUR — presque chaque carte y
 * touchait en finissant. Mesuré le 17/08/2026 : les jetons FRAIS d'un tour de
 * chef ont été multipliés par 7,5 en neuf jours (`docs/audit-quota-claude.md`).
 *
 * La règle change donc de main : un agent qui apprend une règle durable
 * l'écrit dans un FICHIER D'ATTENTE, et c'est le démon qui la range UNE FOIS
 * PAR NUIT. Le fichier d'attente n'est lu par aucun moteur : le modifier ne
 * coûte rien.
 *
 * LE RANGEMENT SUIT L'ARCHITECTURE DÉJÀ EN PLACE, il ne la contourne pas : le
 * TEXTE ENTIER de la règle va dans le fichier de son SUJET (`docs/regles/`),
 * et seule une ligne de CONTRAT — quand l'agent en écrit une — rejoint
 * `CLAUDE.md`. C'est ce qui empêche le fichier d'instructions de regrossir
 * d'un pavé par carte, comme il vient de le faire (15 938 → 158 743 signes en
 * neuf jours).
 *
 * RIEN N'EST JAMAIS JETÉ EN SILENCE : une entrée mal formée ou visant un sujet
 * inconnu reste dans le fichier d'attente avec sa RAISON écrite dessus, et
 * repasse la nuit suivante.
 */

import { ANCIENS_SUJETS } from './memoire.js';
import { aplatiCompact } from './mots.js';

/** Le fichier où les agents déposent ce qu'ils ont appris, en attendant la nuit. */
export const FICHIER_D_ATTENTE = 'docs/instructions-en-attente.md';

/**
 * …MAIS CHAQUE CARTE ÉCRIT DANS LE SIEN, ET DEUX FICHIERS NE SE HEURTENT PAS.
 *
 * Le fichier ci-dessus était PARTAGÉ : chaque agent ajoutait son entrée à la
 * fin, donc deux cartes finies le même jour écrivaient toutes deux les mêmes
 * dernières lignes, et leur fusion se heurtait — par construction, sans
 * qu'aucune n'ait rien fait de mal. Mesuré sur les 207 publications du
 * 02/08/2026 au 20/08/2026 : `docs/instructions-en-attente.md` arrive en tête
 * des conflits qui SURVIVENT au recollage automatique (les trois derniers en
 * date le portent tous les trois).
 *
 * Un dépôt par CARTE règle la cause au lieu du symptôme : deux fichiers
 * différents ne peuvent pas entrer en conflit, quel que soit le nombre de
 * cartes lancées en parallèle. Le rangement de nuit les lit tous, dans l'ordre,
 * exactement comme il lisait les entrées d'un fichier unique.
 */
export const DOSSIER_D_ATTENTE = 'docs/instructions-en-attente';

/**
 * Le nom de fichier d'attente d'une copie de travail. Il se déduit du NOM DE LA
 * COPIE (« reduire-les-conflits-…-582c24 ») : unique par carte, stable d'un
 * tour à l'autre, et lisible par qui relit le dossier.
 *
 * Rendu `undefined` quand il n'y a pas de copie à soi — dossier partagé du chef,
 * de l'analyse ou de la publication : ceux-là gardent le fichier commun, ils ne
 * travaillent jamais à plusieurs en même temps.
 */
export function fichierDAttentePourCopie(nomDeCopie: string | undefined): string | undefined {
  const propre = (nomDeCopie ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!propre) return undefined;
  return `${DOSSIER_D_ATTENTE}/${propre}.md`;
}

/** Le rendez-vous de rangement : creux de la nuit, avant l'auto-amélioration. */
export const FENETRE_DE_FUSION = { debut: 2, fin: 5 } as const;

/** Une fois par nuit, jamais deux. Vingt heures laissent la fenêtre revenir. */
export const PERIODE_DE_FUSION_MS = 20 * 60 * 60 * 1000;

/** Ce qu'un agent dépose : une règle durable, son sujet, et l'invariant à nommer. */
export interface EntreeDInstruction {
  /** Le nom de la règle, tel qu'il paraîtra dans le fichier du sujet. */
  titre: string;
  /** Le sujet de `docs/regles/` où le texte entier sera rangé. */
  sujet: string;
  /** La ligne — UNE seule — à ajouter au contrat de `CLAUDE.md`. Facultative. */
  contrat?: string;
  /** Le titre exact d'une ligne de contrat devenue périmée. Facultatif. */
  retire?: string;
  /** Le texte entier de la règle. */
  texte: string;
}

/**
 * LA MARQUE D'UN REFUS. Elle est ÉCRITE par `fichierApresFusion` et RETIRÉE par
 * `lireEntrees` : sans ce retour, chaque nuit recollait un avertissement de plus
 * sous la même entrée, et le fichier d'attente grossissait de trois lignes par
 * entrée bloquée et par nuit — indéfiniment, puisqu'une entrée bloquée le reste.
 */
const MARQUE_DE_REFUS = '> [!WARNING]';

/** Une entrée que la nuit n'a pas pu ranger, et pourquoi. */
export interface EntreeRefusee {
  entree: EntreeDInstruction;
  raison: string;
}

export interface PlanDeFusion {
  /** Le texte à ajouter, par fichier de sujet. */
  parSujet: { sujet: string; texte: string }[];
  /**
   * Les lignes de contrat à ajouter à `CLAUDE.md`, chacune sous le sujet qui la
   * range. Le TITRE voyage avec : quand le plafond refuse une ligne, il faut
   * savoir de quelle règle elle vient pour l'écrire dans le fichier du sujet.
   */
  contrat: { sujet: string; ligne: string; titre: string }[];
  /** Les titres de lignes de contrat à retirer, sous leur sujet. */
  retraits: { sujet: string; titre: string }[];
  /** Ce qui reste en attente, avec sa cause. */
  refusees: EntreeRefusee[];
}

const ENTETE_DU_FICHIER = `# Instructions en attente de rangement

Ce fichier n'est lu par AUCUN moteur : l'écrire ne coûte pas un jeton et ne casse le cache de
personne. Un agent qui apprend une règle durable la dépose ICI ; le démon la range une seule fois
par nuit comme fiche de règle dans le classeur du projet (écran « Mémoire »), et n'ajoute au contrat
de \`CLAUDE.md\` que la ligne \`contrat :\` quand elle est écrite.

Format d'une entrée — le titre en \`##\`, puis les repères, puis le texte entier :

\`\`\`
## Le nom de la règle
- sujet : cartes
- retire : Le nom d'une règle devenue fausse (facultatif)
- contrat : la ligne courte à nommer dans CLAUDE.md (facultative)

Le texte entier de la règle, avec les fichiers qui la portent et les contrôles qui la verrouillent.
\`\`\`
`;

/** Le fichier d'attente vide, avec son mode d'emploi. */
export function fichierDAttenteVide(): string {
  return `${ENTETE_DU_FICHIER}\n`;
}

/** Le texte d'UNE entrée, tel qu'un agent l'ajoute à la fin du fichier d'attente. */
export function entreeEnMarkdown(entree: EntreeDInstruction): string {
  const lignes = [`## ${entree.titre.trim()}`, `- sujet : ${entree.sujet.trim()}`];
  if (entree.retire?.trim()) lignes.push(`- retire : ${entree.retire.trim()}`);
  if (entree.contrat?.trim()) lignes.push(`- contrat : ${entree.contrat.trim()}`);
  lignes.push('', entree.texte.trim(), '');
  return lignes.join('\n');
}

/**
 * Les entrées déposées dans le fichier. Tout ce qui précède la première
 * section `##` est le mode d'emploi et n'est jamais lu comme une entrée.
 */
export function lireEntrees(fichier: string): EntreeDInstruction[] {
  const entrees: EntreeDInstruction[] = [];
  let courante: { titre: string; lignes: string[] } | undefined;

  /*
   * UN TITRE ÉCRIT DANS UN BLOC DE CODE N'EST PAS UN TITRE. Le mode d'emploi en
   * tête du fichier MONTRE le format entre trois accents graves : lu bêtement,
   * l'exemple devenait une entrée fantôme que la nuit rangeait pour de bon.
   */
  let dansUnBloc = false;

  const fermer = () => {
    if (!courante) return;
    let sujet = '';
    let retire: string | undefined;
    let contrat: string | undefined;
    const corps: string[] = [];
    for (const ligne of courante.lignes) {
      const repere = /^- *(sujet|retire|contrat) *: *(.*)$/i.exec(ligne.trim());
      if (repere && !corps.some((l) => l.trim())) {
        if (repere[1].toLowerCase() === 'sujet') sujet = repere[2].trim();
        else if (repere[1].toLowerCase() === 'retire') retire = repere[2].trim() || undefined;
        else contrat = repere[2].trim() || undefined;
        continue;
      }
      corps.push(ligne);
    }
    const entree: EntreeDInstruction = { titre: courante.titre, sujet, contrat, texte: sansAvertissements(corps).trim() };
    if (retire) entree.retire = retire;
    entrees.push(entree);
    courante = undefined;
  };

  for (const ligne of fichier.split('\n')) {
    if (/^\s*```/.test(ligne)) {
      dansUnBloc = !dansUnBloc;
      if (courante) courante.lignes.push(ligne);
      continue;
    }
    const titre = !dansUnBloc && /^## +(.*)$/.exec(ligne);
    if (titre) {
      fermer();
      const nom = titre[1].trim();
      if (nom) courante = { titre: nom, lignes: [] };
      continue;
    }
    if (courante) courante.lignes.push(ligne);
  }
  fermer();
  return entrees;
}

/**
 * LE TEXTE D'UNE ENTRÉE, DÉBARRASSÉ DES AVERTISSEMENTS DES NUITS PASSÉES. Un
 * bloc de refus commence par « > [!WARNING] » et court tant que les lignes
 * commencent par « > » ; la ligne vide qui le suit part avec lui.
 */
function sansAvertissements(lignes: readonly string[]): string {
  const gardees: string[] = [];
  let dansUnRefus = false;
  for (const ligne of lignes) {
    if (ligne.trim().startsWith(MARQUE_DE_REFUS)) {
      dansUnRefus = true;
      continue;
    }
    if (dansUnRefus) {
      if (ligne.trim().startsWith('>') || !ligne.trim()) continue;
      dansUnRefus = false;
    }
    gardees.push(ligne);
  }
  return gardees.join('\n');
}

/**
 * LE SUJET DE REPLI : celui qui accueille une entrée déposée sans sujet, ou
 * avec un sujet qui n'existe ni comme fichier ni dans la table ci-dessus.
 * `methode` est le sujet fourre-tout de la documentation — la méthode de
 * travail, les moteurs, les outils : une règle mal étiquetée y est mal rangée,
 * mais elle est RANGÉE, relue et déplaçable. Un projet qui n'a pas ce fichier
 * n'a pas de repli, et l'entrée est refusée comme avant.
 */
export const SUJET_DE_REPLI = 'methode';

/**
 * Ce que la nuit va ranger, et ce qu'elle refuse.
 *
 * LE SUJET DOIT EXISTER : on ne fabrique jamais un fichier de règles à partir
 * d'un nom mal tapé, sinon la règle irait dormir dans un fichier que
 * `project_memory` ne sert à personne.
 *
 * …MAIS UNE ENTRÉE NE RESTE PLUS BLOQUÉE POUR TOUJOURS. Refuser et redire la
 * raison chaque nuit semblait prudent ; à l'usage, personne ne relit un fichier
 * que rien n'oblige à ouvrir. Treize entrées y ont dormi des semaines pendant
 * que le fichier passait son plafond, dont neuf déposées sans la moindre ligne
 * « - sujet : ». Une entrée qui a un TEXTE va donc dans le sujet de REPLI, avec
 * une phrase qui dit d'où elle vient et où la déplacer : mal rangée mais lue,
 * plutôt que bien étiquetée et perdue. Seule une entrée VIDE est encore refusée
 * — elle n'a rien à ranger.
 */
export function planDeFusion(
  entrees: readonly EntreeDInstruction[],
  sujetsConnus: readonly string[],
  sujetDeRepli = SUJET_DE_REPLI,
): PlanDeFusion {
  const connus = new Set(sujetsConnus.map((s) => s.toLowerCase()));
  const repli = connus.has(sujetDeRepli.toLowerCase()) ? sujetDeRepli.toLowerCase() : '';
  const plan: PlanDeFusion = { parSujet: [], contrat: [], retraits: [], refusees: [] };

  for (const entree of entrees) {
    if (!entree.texte.trim()) {
      plan.refusees.push({ entree, raison: 'entrée sans texte : rien à ranger' });
      continue;
    }

    const demande = entree.sujet.toLowerCase();
    const reconnuDirect = Boolean(demande && connus.has(demande));
    // UN ANCIEN NOM DE SUJET N'EST PAS UN SUJET INCONNU : la table
    // (`ANCIENS_SUJETS`, `memoire.ts`) dit où vivent VRAIMENT ses invariants,
    // avant qu'on ne tombe au repli — la même table que la lecture.
    const correspondance = !reconnuDirect ? ANCIENS_SUJETS[demande] : undefined;
    const reconnuParTable = Boolean(correspondance && connus.has(correspondance));
    const reconnu = reconnuDirect || reconnuParTable;
    if (!reconnu && !repli) {
      plan.refusees.push({
        entree,
        raison: demande
          ? `sujet inconnu « ${entree.sujet} » — les sujets existants sont : ${sujetsConnus.join(', ')}`
          : 'aucun sujet indiqué (ligne « - sujet : … »)',
      });
      continue;
    }

    const sujet = reconnuDirect ? demande : reconnuParTable ? correspondance! : repli;
    // Le déplacement se DIT : sans cette phrase, une règle d'interface rangée
    // dans « methode » passerait pour une règle de méthode. Un sujet routé par
    // la table, lui, est déjà dans son vrai fichier — pas de note à écrire.
    const note = reconnu
      ? ''
      : ` _(déposée ${
          demande ? `sous le sujet « ${entree.sujet} », qui n'existe pas` : 'sans sujet'
        } ; rangée ici par défaut — à déplacer dans le fichier de son vrai sujet.)_`;
    const texte = `\n- **${entree.titre}** — ${entree.texte.trim()}${note}\n`;
    const deja = plan.parSujet.find((p) => p.sujet === sujet);
    if (deja) deja.texte += texte;
    else plan.parSujet.push({ sujet, texte });

    if (entree.contrat) {
      const ligne = ligneDeContrat(entree.titre, entree.contrat);
      if (!plan.contrat.some((c) => c.ligne === ligne)) plan.contrat.push({ sujet, ligne, titre: entree.titre });
    }
    if (entree.retire && !plan.retraits.some((r) => nu(r.titre) === nu(entree.retire!))) {
      plan.retraits.push({ sujet, titre: entree.retire });
    }
  }

  return plan;
}

/* ------------------------------------------------------------------ */
/* LE PLAFOND DU FICHIER D'INSTRUCTIONS, TENU PAR LE RANGEMENT LUI-MÊME */
/* ------------------------------------------------------------------ */

/**
 * LE PLAFOND, EN SIGNES — la même valeur que celle que vérifie
 * `scripts/verif-taille-instructions.mjs` : les deux doivent bouger ensemble.
 *
 * 25 000 signes font environ 11 400 jetons au rapport mesuré de cette
 * documentation. Le fichier d'instructions est relu par le moteur à CHAQUE
 * aller-retour d'un tour — une soixantaine par carte : chaque millier de signes
 * de trop se paie soixante fois, tous les jours, sur tous les projets.
 *
 * LE RANGEMENT DE NUIT LE TIENT LUI-MÊME, il n'attend pas qu'un contrôle le
 * constate le lendemain. Une règle rangée n'est jamais perdue pour autant : son
 * TEXTE ENTIER va dans le fichier de son sujet quoi qu'il arrive, et seul son
 * NOM — la ligne de contrat — attend une place.
 */
export const PLAFOND_INSTRUCTIONS_SIGNES = 25_000;

/** Un texte réduit à ses mots utiles : sans casse, sans accents, sans ponctuation. */
export const nu = aplatiCompact;

/** Les mots de plus de trois lettres d'un texte — ceux qui le distinguent d'un autre. */
function motsUtiles(texte: string): Set<string> {
  return new Set(nu(texte).split(' ').filter((mot) => mot.length > 3));
}

/**
 * DEUX PHRASES DISENT-ELLES LA MÊME CHOSE ? Deux mesures, l'une OU l'autre suffit :
 *
 *   • le JACCARD (part de mots communs sur l'union) — vrai dès que le titre et le
 *     contrat partagent l'essentiel de leur vocabulaire ;
 *   • le RECOUVREMENT (part de `b` déjà contenue dans `a`) — vrai quand `b` ne fait
 *     que reformuler `a` EN MAJUSCULES sans lui ajouter un mot : le Jaccard seul
 *     ratait ce cas dès que `a` était plus court que `b`, par exemple un contrat qui
 *     développe son titre de deux ou trois mots.
 *
 * Ces deux mesures ne savent PAS, à elles seules, épargner une ligne qui apporte
 * un fichier ou une commande : une suite qui recopie son titre puis nomme un
 * chemin atteint un Jaccard de 0,62. C'est `reditSonTitre` qui les garde, en
 * consultant `reperesNouveaux` AVANT elles.
 */
export function ditLaMemeChose(a: string, b: string, seuil = 0.6, seuilRecouvrement = 0.7): boolean {
  const gauche = motsUtiles(a);
  const droite = motsUtiles(b);
  if (!gauche.size || !droite.size) return nu(a) === nu(b);
  const communs = [...gauche].filter((mot) => droite.has(mot)).length;
  const reunis = new Set([...gauche, ...droite]).size;
  if (communs / reunis >= seuil) return true;
  return communs / droite.size >= seuilRecouvrement;
}

/**
 * UN CONTRAT DÉPOSÉ PAR UN AGENT COMMENCE PARFOIS PAR SON PROPRE TITRE EN GRAS
 * (« **Une carte suspendue…** — UNE CARTE SUSPENDUE… »). Ce préfixe alourdit le
 * texte comparé sans rien y ajouter : il fait chuter le Jaccard et le
 * recouvrement sous leurs seuils (le titre pèse peu face au reste de la
 * phrase), et laisse passer une ligne qui redit son titre deux fois dans
 * `CLAUDE.md`. On le décape AVANT toute comparaison, sur le titre normalisé
 * (`nu`) — pas de fusion floue ici, seulement le cas exact où le contrat cite
 * son propre titre en tête.
 */
function sansPrefixeDeTitre(titre: string, contrat: string): string {
  const prefixe = /^\*\*(.+?)\*\*\s*[—-]\s*([\s\S]*)$/.exec(contrat.trim());
  // Le préfixe ne recopie pas toujours le titre mot pour mot : un agent le
  // reformule parfois (« a DEUX fins… » / « …a deux fins : la réponse en texte
  // libre, ou la compréhension »). L'égalité stricte sur `nu` rate ce cas ;
  // `ditLaMemeChose` le voit, mais avec des seuils plus bas que ses seuils
  // habituels (pensés pour juger le RESTE d'une ligne, plus long que son
  // titre) — un préfixe est écrit par le même auteur que le titre, sur la
  // même idée, donc plus facile à reconnaître sans mordre sur un second
  // invariant simplement fusionné dans la même ligne.
  if (prefixe && ditLaMemeChose(titre, prefixe[1], 0.35, 0.45)) return prefixe[2].trim();
  return contrat;
}

/**
 * CE QUI FAIT QU'UNE SECONDE FORMULATION APPREND QUELQUE CHOSE : un repère
 * qu'on ne peut pas deviner du titre. Un chemin ou une commande entre accents
 * graves, un nom de fichier, un nombre, un libellé cité entre guillemets — voilà
 * ce qu'un agent ne retrouverait nulle part ailleurs dans la ligne.
 */
const REPERE_TECHNIQUE = /`[^`]+`|\b[\w-]+\.(?:ts|tsx|mjs|md|json|sh)\b|\d|«[^»]+»/;

/**
 * Les mêmes repères, TOUS relevés, et les nombres pris EN ENTIER (« 20 » n'est pas
 * « 200 »). `matchAll` travaille sur une copie de l'expression : aucun `lastIndex`
 * partagé entre deux appels.
 */
const REPERES_TECHNIQUES = /`[^`]+`|\b[\w-]+\.(?:ts|tsx|mjs|md|json|sh)\b|\d+(?:[.,]\d+)*|«[^»]+»/g;

/**
 * LES REPÈRES QUE LA SUITE APPORTE ET QUE LE TITRE NE PORTE PAS DÉJÀ.
 *
 * Un repère ne protège une ligne que s'il est NEUF. « …N'EST PLUS « EN TRAVAIL »
 * NULLE PART » derrière un titre qui dit déjà « en travail », ou une suite qui
 * recite `--faint` et `--border` quand le titre les nomme tous les deux : le
 * libellé cité n'apprend rien, et il suffisait pourtant à garder la redite
 * entière — c'est ainsi que le fichier s'est retrouvé à 10 signes de son plafond
 * avec un compactage qui ne gagnait plus rien.
 *
 * La comparaison se fait sur le texte normalisé (`nu`), MOT ENTIER contre mot
 * entier. Un repère que `nu` vide — « ### … », fait de seuls symboles — ne sait
 * pas se comparer : dans le doute, il compte comme neuf et la ligne est GARDÉE.
 */
export function reperesNouveaux(titre: string, suite: string): string[] {
  const dansLeTitre = ` ${nu(titre)} `;
  return [...suite.matchAll(REPERES_TECHNIQUES)]
    .map((trouve) => trouve[0])
    .filter((repere) => {
      const cherche = nu(repere);
      return !cherche || !dansLeTitre.includes(` ${cherche} `);
    });
}

/** La part de lettres en capitales d'un texte. */
function partDeCapitales(texte: string): number {
  const lettres = [...texte].filter((c) => /\p{L}/u.test(c));
  if (!lettres.length) return 0;
  return lettres.filter((c) => c === c.toUpperCase()).length / lettres.length;
}

/**
 * UNE SECONDE FORMULATION QUI NE FAIT QUE CRIER LE TITRE.
 *
 * `ditLaMemeChose` compare les MOTS ; or la redite la plus fréquente du contrat
 * reformule l'invariant en CAPITALES avec un vocabulaire entièrement différent
 * — « L'arrêt vide la file AVANT de couper » suivi de « UN ARRÊT COUPE D'ABORD
 * CE QUI ATTEND DERRIÈRE, ENSUITE LE MOTEUR ». Les deux mesures lexicales
 * restent alors très en dessous de leurs seuils (un seul mot commun sur treize),
 * et la ligne passe : l'invariant est nommé deux fois, payé deux fois, à chaque
 * aller-retour de chaque agent. Trente-six lignes de `CLAUDE.md` étaient dans ce
 * cas, et le fichier n'avait plus que 28 signes de marge sous son plafond.
 *
 * La STRUCTURE tranche là où le vocabulaire ne peut pas : une formulation écrite
 * tout en capitales et dépourvue du moindre repère technique ne porte aucun
 * invariant que le titre ne porte déjà. Le texte ENTIER de la règle vit de toute
 * façon dans `docs/regles/<sujet>.md` — le contrat n'a jamais eu à le redire.
 *
 * Dans le doute, on GARDE : la moindre commande, le moindre chemin, le moindre
 * libellé cité suffit à conserver la ligne entière — À CONDITION D'ÊTRE NEUF.
 * Quand le `titre` est donné, seuls les repères qu'il ne porte pas déjà
 * protègent la ligne (`reperesNouveaux`) ; sans titre, tout repère protège,
 * comme avant.
 */
export function crieLeTitre(contrat: string, titre?: string): boolean {
  const dit = contrat.trim();
  if (!dit) return false;
  if (partDeCapitales(dit) <= 0.9) return false;
  return titre === undefined ? !REPERE_TECHNIQUE.test(dit) : reperesNouveaux(titre, dit).length === 0;
}

/** La part des mots utiles du titre qu'une suite doit reprendre pour être jugée redite. */
const SEUIL_DE_REPRISE_DU_TITRE = 0.55;
/** Sous ce nombre de mots utiles, un titre est trop court pour prouver quoi que ce soit. */
const MOTS_MIN_DU_TITRE = 4;

/**
 * UNE SUITE ÉCRITE NORMALEMENT QUI REPREND SON TITRE.
 *
 * `ditLaMemeChose` ne regarde que dans un sens — la part de la SUITE contenue
 * dans le titre — et `crieLeTitre` ne juge que les capitales. Une suite en
 * minuscules PLUS LONGUE que son titre échappait donc aux deux : « Un seul
 * renouvellement de session Claude à la fois par compte… » suivi de la même
 * phrase, allongée de quelques mots. Le sens qui manquait : quelle part des mots
 * utiles du TITRE la suite reprend-elle ?
 *
 * Deux gardes, parce que dans le doute on GARDE : un titre de moins de quatre
 * mots utiles ne prouve rien, et la suite qui apporte UN SEUL repère neuf —
 * une commande, un fichier, un libellé que le titre n'a pas — reste entière,
 * même quand tout le reste redit. Le texte entier de la règle vit de toute façon
 * dans la base de connaissances : le contrat n'a que le NOM à porter.
 */
export function reprendSonTitre(titre: string, suite: string): boolean {
  const duTitre = motsUtiles(titre);
  if (duTitre.size < MOTS_MIN_DU_TITRE) return false;
  const deLaSuite = motsUtiles(suite);
  const repris = [...duTitre].filter((mot) => deLaSuite.has(mot)).length;
  if (repris / duTitre.size < SEUIL_DE_REPRISE_DU_TITRE) return false;
  return reperesNouveaux(titre, suite).length === 0;
}

/**
 * LE JUGE UNIQUE : la suite d'une ligne de contrat ne fait-elle que redire son
 * titre ? Le rangement de nuit (`ligneDeContrat`, `compacterInstructions`) et le
 * contrôle quotidien (`scripts/verif-taille-instructions.mjs`) passent tous par
 * lui — deux juges divergeraient à la première retouche.
 *
 * UN SEUL REPÈRE NEUF GARDE LA LIGNE, QUEL QUE SOIT LE JUGE. La mesure des mots
 * (`ditLaMemeChose`) promettait qu'une suite portant un fichier resterait sous
 * ses seuils ; c'est faux dès que la suite recopie son titre puis nomme le
 * fichier en deux ou trois mots (Jaccard de 0,62). La garde passe donc AVANT les
 * trois mesures, pas seulement dans deux d'entre elles.
 */
export function reditSonTitre(titre: string, suite: string): boolean {
  const nom = titre.trim();
  const dit = sansPrefixeDeTitre(nom, suite.trim());
  if (!dit) return true;
  if (reperesNouveaux(nom, dit).length) return false;
  return ditLaMemeChose(nom, dit) || crieLeTitre(dit, nom) || reprendSonTitre(nom, dit);
}

/** La ligne de contrat d'une règle : sans redire son titre quand le contrat le répète. */
export function ligneDeContrat(titre: string, contrat: string): string {
  const nom = titre.trim();
  if (reditSonTitre(nom, contrat)) return `- **${nom}**`;
  return `- **${nom}** — ${sansPrefixeDeTitre(nom, contrat.trim())}`;
}

/** Ce qu'un compactage a gagné, pour le dire au journal. */
export interface CompactageInstructions {
  texte: string;
  /** Les lignes en doublon retirées. */
  doublons: number;
  /** Les lignes dont le contrat redisait le titre, ramenées au titre seul. */
  compactees: number;
  /** Les signes gagnés. */
  gagnes: number;
}

/**
 * COMPACTER LE FICHIER D'INSTRUCTIONS SANS PERDRE UN SEUL INVARIANT.
 *
 * Deux gestes, et deux seulement — ils ne retirent jamais un NOM, seulement une
 * répétition :
 *
 *   • UNE LIGNE ÉCRITE DEUX FOIS n'est gardée qu'une. Deux cartes qui déposent
 *     la même règle, ou une carte reprise, l'écrivaient deux fois ;
 *   • UN CONTRAT QUI REDIT SON TITRE est ramené au titre seul. « - **Le menu du
 *     bas emprunte le fond** — LE MENU DU BAS EMPRUNTE LE FOND » coûte le double
 *     de ce qu'il apprend.
 *
 * Tout le reste du fichier est rendu tel quel : ce module ne réécrit pas la
 * prose d'un humain.
 */
export function compacterInstructions(texte: string): CompactageInstructions {
  const lignes = texte.split('\n');
  const vues = new Set<string>();
  let doublons = 0;
  let compactees = 0;

  const gardees = lignes.filter((ligne) => {
    const contrat = /^- \*\*(.+?)\*\*(?: — (.+?))?\s*$/.exec(ligne);
    if (!contrat) return true;
    const cle = nu(contrat[1]);
    if (vues.has(cle)) {
      doublons += 1;
      return false;
    }
    vues.add(cle);
    return true;
  });

  const compactes = gardees.map((ligne) => {
    const contrat = /^- \*\*(.+?)\*\* — (.+?)\s*$/.exec(ligne);
    if (!contrat) return ligne;
    const reduite = ligneDeContrat(contrat[1], contrat[2]);
    if (reduite !== ligne.trimEnd()) compactees += 1;
    return reduite;
  });

  const resultat = compactes.join('\n');
  return { texte: resultat, doublons, compactees, gagnes: texte.length - resultat.length };
}

/** Résultat du retrait explicite de lignes de contrat périmées. */
export interface RetraitContrats {
  texte: string;
  titresRetires: string[];
  gagnes: number;
}

/**
 * RETIRER UNIQUEMENT LES LIGNES NOMMÉES EXPLICITEMENT.
 *
 * Le titre est comparé après `nu()`, comme les autres noms d'instructions,
 * mais jamais par ressemblance : une ligne voisine reste donc intacte.
 */
export function retirerContrats(texte: string, titres: readonly string[]): RetraitContrats {
  const demandes = new Map<string, string>();
  for (const titre of titres) {
    const propre = titre.trim();
    if (propre) demandes.set(nu(propre), propre);
  }
  const titresRetires = new Set<string>();
  const lignes = texte.split('\n').filter((ligne) => {
    const contrat = /^- \*\*(.+?)\*\*(?: — .+?)?\s*$/.exec(ligne);
    if (!contrat) return true;
    const demande = demandes.get(nu(contrat[1]));
    if (!demande) return true;
    titresRetires.add(demande);
    return false;
  });
  const resultat = lignes.join('\n');
  return { texte: resultat, titresRetires: [...titresRetires], gagnes: texte.length - resultat.length };
}

/**
 * CE QUI TIENT SOUS LE PLAFOND, ET CE QUI DÉBORDE.
 *
 * Les lignes sont prises DANS L'ORDRE : une règle déposée avant une autre est
 * nommée avant elle. Rien n'est tronqué au milieu d'une ligne — un invariant
 * coupé en deux ne veut plus rien dire —, et ce qui déborde est RENDU, jamais
 * jeté : l'appelant l'écrit dans le fichier du sujet.
 */
export function contratsQuiTiennent<T extends { ligne: string }>(
  tailleActuelle: number,
  contrat: readonly T[],
  plafond = PLAFOND_INSTRUCTIONS_SIGNES,
): { retenues: T[]; debordent: T[] } {
  const retenues: T[] = [];
  const debordent: T[] = [];
  let taille = Math.max(0, tailleActuelle);
  for (const entree of contrat) {
    const cout = entree.ligne.length + 1;
    if (taille + cout > plafond) {
      debordent.push(entree);
      continue;
    }
    retenues.push(entree);
    taille += cout;
  }
  return { retenues, debordent };
}

/**
 * Le marqueur ajouté après un invariant que le plafond n'a pas laissé nommer
 * dans `CLAUDE.md`. La règle fait foi quand même ; l'explication complète de
 * ce marqueur n'est posée qu'une fois, en tête de chaque fichier de
 * `docs/regles/` — pas répétée à chaque invariant.
 */
export function contratMisDeCote(entree: { titre: string; ligne: string }): string {
  return `\n  _(hors contrat)_\n`;
}

/**
 * COLLE LE MARQUEUR À LA SUITE IMMÉDIATE DE SA RÈGLE, repérée par son titre —
 * jamais un empilement anonyme en fin de fichier, où plus rien ne dit à
 * laquelle des règles du sujet chaque marqueur se rapportait. Un titre
 * introuvable (garde-fou : le texte a changé entre-temps) reçoit quand même
 * son marqueur, à la toute fin plutôt que de le perdre.
 */
export function rattacherHorsContrat(texte: string, titre: string): string {
  const debut = texte.indexOf(`- **${titre}**`);
  if (debut === -1) return texte + contratMisDeCote({ titre, ligne: '' });
  const suite = texte.indexOf('\n- **', debut + 1);
  const fin = suite === -1 ? texte.length : suite;
  return texte.slice(0, fin) + contratMisDeCote({ titre, ligne: '' }) + texte.slice(fin);
}

/** Le fichier d'attente reconstruit : ce qui n'a pas pu être rangé, et pourquoi. */
export function fichierApresFusion(refusees: readonly EntreeRefusee[]): string {
  if (!refusees.length) return fichierDAttenteVide();
  const blocs = refusees.map(
    ({ entree, raison }) =>
      `${entreeEnMarkdown(entree)}\n> [!WARNING]\n> Non rangée cette nuit : ${raison}. Corrige la ligne, elle repassera la nuit suivante.\n`,
  );
  return `${ENTETE_DU_FICHIER}\n${blocs.join('\n')}`;
}

export interface DecisionDeFusion {
  fusionner: boolean;
  raison: string;
}

/**
 * L'heure décide, et le DÉLAI empêche de recommencer. Un fichier d'attente vide
 * ne réveille personne : on ne réécrit pas `CLAUDE.md` pour rien, ce serait
 * exactement le geste qu'on cherche à éviter.
 */
export function decisionDeFusion(entree: {
  maintenant: Date;
  derniereFusionA?: number;
  entreesEnAttente: number;
}): DecisionDeFusion {
  if (!entree.entreesEnAttente) {
    return { fusionner: false, raison: 'rien en attente : le fichier d’instructions ne bouge pas' };
  }

  const heure = entree.maintenant.getHours();
  if (heure < FENETRE_DE_FUSION.debut || heure >= FENETRE_DE_FUSION.fin) {
    return {
      fusionner: false,
      raison: `hors de la fenêtre de rangement (${FENETRE_DE_FUSION.debut} h – ${FENETRE_DE_FUSION.fin} h)`,
    };
  }

  const depuis = entree.derniereFusionA ? entree.maintenant.getTime() - entree.derniereFusionA : Infinity;
  if (depuis < PERIODE_DE_FUSION_MS) {
    return { fusionner: false, raison: 'déjà rangé cette nuit' };
  }

  return { fusionner: true, raison: `${entree.entreesEnAttente} entrée(s) à ranger` };
}
