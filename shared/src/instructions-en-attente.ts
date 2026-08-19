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

/** Une entrée que la nuit n'a pas pu ranger, et pourquoi. */
export interface EntreeRefusee {
  entree: EntreeDInstruction;
  raison: string;
}

export interface PlanDeFusion {
  /** Le texte à ajouter, par fichier de sujet. */
  parSujet: { sujet: string; texte: string }[];
  /** Les lignes de contrat à ajouter à `CLAUDE.md`, chacune sous le sujet qui la range. */
  contrat: { sujet: string; ligne: string }[];
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
    entrees.push({ titre: courante.titre, sujet, contrat, texte: corps.join('\n').trim() });
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
 * Ce que la nuit va ranger, et ce qu'elle refuse. Le sujet doit exister : on
 * ne fabrique jamais un fichier de règles à partir d'un nom mal tapé, sinon la
 * règle irait dormir dans un fichier que `project_memory` ne sert à personne.
 */
export function planDeFusion(entrees: readonly EntreeDInstruction[], sujetsConnus: readonly string[]): PlanDeFusion {
  const connus = new Set(sujetsConnus.map((s) => s.toLowerCase()));
  const plan: PlanDeFusion = { parSujet: [], contrat: [], refusees: [] };

  for (const entree of entrees) {
    if (!entree.texte.trim()) {
      plan.refusees.push({ entree, raison: 'entrée sans texte : rien à ranger' });
      continue;
    }
    if (!entree.sujet) {
      plan.refusees.push({ entree, raison: 'aucun sujet indiqué (ligne « - sujet : … »)' });
      continue;
    }
    if (!connus.has(entree.sujet.toLowerCase())) {
      plan.refusees.push({
        entree,
        raison: `sujet inconnu « ${entree.sujet} » — les sujets existants sont : ${sujetsConnus.join(', ')}`,
      });
      continue;
    }

    const sujet = entree.sujet.toLowerCase();
    const texte = `\n- **${entree.titre}** — ${entree.texte.trim()}\n`;
    const deja = plan.parSujet.find((p) => p.sujet === sujet);
    if (deja) deja.texte += texte;
    else plan.parSujet.push({ sujet, texte });

    if (entree.contrat) {
      const memeTexte = entree.contrat.trim().toLowerCase() === entree.titre.trim().toLowerCase();
      const ligne = memeTexte ? `- **${entree.titre}**` : `- **${entree.titre}** — ${entree.contrat}`;
      plan.contrat.push({ sujet, ligne });
    }
  }

  return plan;
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
