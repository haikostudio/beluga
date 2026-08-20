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

/** Le fichier où les agents déposent ce qu'ils ont appris, en attendant la nuit. */
export const FICHIER_D_ATTENTE = 'docs/instructions-en-attente.md';

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
  /** Ce qui reste en attente, avec sa cause. */
  refusees: EntreeRefusee[];
}

const ENTETE_DU_FICHIER = `# Instructions en attente de rangement

Ce fichier n'est lu par AUCUN moteur : l'écrire ne coûte pas un jeton et ne casse le cache de
personne. Un agent qui apprend une règle durable la dépose ICI ; le démon la range dans
\`docs/regles/<sujet>.md\` une seule fois par nuit, et n'ajoute au contrat de \`CLAUDE.md\` que la
ligne \`contrat :\` quand elle est écrite.

Format d'une entrée — le titre en \`##\`, puis les deux repères, puis le texte entier :

\`\`\`
## Le nom de la règle
- sujet : cartes
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
    let contrat: string | undefined;
    const corps: string[] = [];
    for (const ligne of courante.lignes) {
      const repere = /^- *(sujet|contrat) *: *(.*)$/i.exec(ligne.trim());
      if (repere && !corps.some((l) => l.trim())) {
        if (repere[1].toLowerCase() === 'sujet') sujet = repere[2].trim();
        else contrat = repere[2].trim() || undefined;
        continue;
      }
      corps.push(ligne);
    }
    entrees.push({ titre: courante.titre, sujet, contrat, texte: sansAvertissements(corps).trim() });
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
 * LE SUJET DE REPLI : celui qui accueille une entrée déposée sans sujet ou avec
 * un sujet qui n'existe pas. `methode` est le sujet fourre-tout de la
 * documentation — la méthode de travail, les moteurs, les outils : une règle
 * mal étiquetée y est mal rangée, mais elle est RANGÉE, relue et déplaçable.
 * Un projet qui n'a pas ce fichier n'a pas de repli, et l'entrée est refusée
 * comme avant.
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
  const plan: PlanDeFusion = { parSujet: [], contrat: [], refusees: [] };

  for (const entree of entrees) {
    if (!entree.texte.trim()) {
      plan.refusees.push({ entree, raison: 'entrée sans texte : rien à ranger' });
      continue;
    }

    const demande = entree.sujet.toLowerCase();
    const reconnu = demande && connus.has(demande);
    if (!reconnu && !repli) {
      plan.refusees.push({
        entree,
        raison: demande
          ? `sujet inconnu « ${entree.sujet} » — les sujets existants sont : ${sujetsConnus.join(', ')}`
          : 'aucun sujet indiqué (ligne « - sujet : … »)',
      });
      continue;
    }

    const sujet = reconnu ? demande : repli;
    // Le déplacement se DIT : sans cette phrase, une règle d'interface rangée
    // dans « methode » passerait pour une règle de méthode.
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
function nu(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Les mots de plus de trois lettres d'un texte — ceux qui le distinguent d'un autre. */
function motsUtiles(texte: string): Set<string> {
  return new Set(nu(texte).split(' ').filter((mot) => mot.length > 3));
}

/**
 * DEUX PHRASES DISENT-ELLES LA MÊME CHOSE ? Mesuré par la part de mots qu'elles
 * partagent. Les agents écrivent le titre en clair et le contrat EN MAJUSCULES,
 * avec deux ou trois mots de différence : une égalité stricte ne voyait jamais
 * le doublon, et la ligne payait deux fois la même idée à chaque session.
 */
export function ditLaMemeChose(a: string, b: string, seuil = 0.6): boolean {
  const gauche = motsUtiles(a);
  const droite = motsUtiles(b);
  if (!gauche.size || !droite.size) return nu(a) === nu(b);
  const communs = [...gauche].filter((mot) => droite.has(mot)).length;
  const reunis = new Set([...gauche, ...droite]).size;
  return communs / reunis >= seuil;
}

/** La ligne de contrat d'une règle : sans redire son titre quand le contrat le répète. */
export function ligneDeContrat(titre: string, contrat: string): string {
  const nom = titre.trim();
  const dit = contrat.trim();
  return !dit || ditLaMemeChose(nom, dit) ? `- **${nom}**` : `- **${nom}** — ${dit}`;
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
 * La phrase ajoutée dans le fichier du SUJET pour un invariant que le plafond
 * n'a pas laissé nommer. Elle dit la règle EN ENTIER — c'est elle qui fait foi —
 * et pourquoi son nom manque à `CLAUDE.md`.
 */
export function contratMisDeCote(entree: { titre: string; ligne: string }): string {
  return (
    `\n  _(« ${entree.titre} » n'est PAS nommée dans le fichier d'instructions : son plafond de ` +
    `${PLAFOND_INSTRUCTIONS_SIGNES} signes était atteint. La règle fait foi quand même, et \`project_memory\` ` +
    `la sert avec ce sujet.)_\n`
  );
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
