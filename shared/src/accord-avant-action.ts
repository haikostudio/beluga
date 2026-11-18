/**
 * L'ACCORD AVANT CHAQUE ACTION IMPORTANTE (décision de l'utilisateur du 12/11/2026, carte « Communication et Studio :
 * série de retouches », captures #8adf et #40a2 : l'agent de campagne avait créé une nouvelle vidéo au lieu de
 * retoucher la démo existante, sans rien demander).
 *
 * Cinq gestes passent TOUJOURS par une question « ask_user » dans le fil, et attendent la réponse : créer un nouveau
 * média, toute dépense payante, supprimer ou remplacer, programmer ou publier, lancer la fabrication de toute une série.
 * Une retouche modifie la création EXISTANTE (son historique garde chaque version) : elle n'est pas un nouveau média.
 *
 * La consigne le dit à l'agent ; le SERVICE le tient quand il le peut : un geste capital arrivé sans question tranchée
 * dans le fil depuis peu est refusé, avec sa raison (`accordRecent`).
 */

export const ACTIONS_CAPITALES = [
  'créer un nouveau média',
  'toute dépense payante',
  'supprimer ou remplacer',
  'programmer ou publier',
  'lancer la fabrication de toute une série',
] as const;

/** Combien de temps une réponse de la personne vaut accord pour le geste qui suit. */
export const FENETRE_D_ACCORD_MS = 30 * 60_000;

/** Ce que la règle lit d'une question du fil. */
export interface QuestionPourLAccord {
  answer?: string;
  answeredAt?: number;
  cancelled?: boolean;
  /** Le miroir d'un bouton à prix du Studio n'est pas un accord donné à l'agent. */
  relaiDe?: unknown;
  /** Une compétence proposée non plus. */
  competence?: unknown;
}

/**
 * LA PERSONNE A-T-ELLE TRANCHÉ UNE QUESTION DE L'AGENT DEPUIS PEU ? Une réponse qui n'est pas un refus, posée dans la
 * fenêtre d'accord. Un « non », « annuler », « pas maintenant »… ne vaut pas accord.
 */
export function accordRecent(
  messages: readonly { questions?: readonly QuestionPourLAccord[] }[],
  maintenant: number,
  fenetreMs = FENETRE_D_ACCORD_MS,
): boolean {
  for (const m of messages) {
    for (const q of m.questions ?? []) {
      if (q.cancelled || q.relaiDe || q.competence || q.answer === undefined || !q.answeredAt) continue;
      if (maintenant - q.answeredAt > fenetreMs) continue;
      if (estUnRefus(q.answer)) continue;
      return true;
    }
  }
  return false;
}

const REFUS = /^(non\b|annul|pas (maintenant|encore|question)|refus|stop|ne (fais|cr[ée]e) pas|aucun|laisse tomber)/i;

/** Une réponse qui dit non. */
export function estUnRefus(reponse: string): boolean {
  return REFUS.test(reponse.trim());
}

/** Le refus rendu à l'agent qui a tenté un geste capital sans accord. */
export function refusSansAccord(geste: string, conseil?: string): string {
  return [
    `REFUSÉ : « ${geste} » est une action importante, qui passe d’abord par une question « ask_user » dans le fil — et attend la réponse.`,
    conseil ?? '',
    'Pose la question (ton option recommandée en premier, avec ce que chaque choix coûte), puis relance ce geste une fois la réponse donnée.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Le paragraphe de consigne des agents de campagne. */
export const CONSIGNE_DES_ACCORDS = [
  'ACCORD AVANT CHAQUE ACTION IMPORTANTE (décision de l’utilisateur) : avant de ' + ACTIONS_CAPITALES.join(', ') + ', pose UNE question « ask_user » et ATTENDS la réponse — jamais une question écrite en texte. Le service refuse ces gestes sans réponse récente.',
  'UN MÉDIA QUI EXISTE SE RETOUCHE : si la campagne a déjà une création au Studio, une demande de changement (« change la musique », « raccourcis », « refais la fin ») passe par « retouche » sur CETTE création (son historique garde chaque version) — jamais par « video » ou « image », qui créent un NOUVEAU média.',
  'MONTRER LE MÉDIA : quand la personne demande à voir la vidéo, l’image ou « où en est le média », appelle « services » (studio, action « montrer », creationId ou rien pour la dernière de ta campagne) : le lecteur et son suivi se posent dans le fil. Ne dis JAMAIS « voir le bloc ci-dessus/ci-dessous » sans l’avoir posé ainsi dans ce tour.',
].join('\n');
