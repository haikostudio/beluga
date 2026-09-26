/**
 * Une carte proposée ne se perd plus dans le fil.
 *
 * Une proposition était rendue DANS le message qui la porte : elle vivait donc
 * dans la zone qui défile, remontait dès qu'un échange arrivait, et ses boutons
 * « Créer la carte » / « Refuser » sortaient de l'écran — sur téléphone, une
 * description de quatre parties suffisait à les pousser hors du champ.
 *
 * Les propositions ENCORE EN ATTENTE sortent donc du fil et se posent dans un
 * bandeau FIXE entre la conversation et la barre d'écriture, sur le modèle du
 * volet des tâches. Une proposition DÉCIDÉE (validée ou refusée) reste, elle,
 * dans le fil : elle appartient à l'histoire de l'échange, plus à ce qu'on
 * attend de vous.
 *
 * La règle est pure — ni base ni navigateur — donc elle se teste seule et le
 * fil comme le bandeau se partagent la MÊME lecture : jamais deux tris qui se
 * contredisent, jamais une proposition affichée deux fois ni nulle part.
 */

/** Ce qu'il faut savoir d'une proposition pour la trier. */
export interface PropositionTriable {
  decision?: 'pending' | 'accepted' | 'refused' | 'merged';
}

/** Ce qu'il faut savoir d'un message pour en tirer ses propositions. */
export interface MessagePourPropositions<P extends PropositionTriable> {
  id: string;
  agentId?: string;
  proposals: P[];
}

/** Une proposition et ce qui permet de la décider : son message, son agent. */
export interface PropositionEnAttente<P extends PropositionTriable> {
  messageId: string;
  /** L'agent de la conversation : la carte hérite de SES réglages par défaut. */
  agentId?: string;
  proposal: P;
}

/**
 * Une proposition attend-elle encore un clic ? Une décision absente vaut
 * « en attente » : c'est la valeur de départ du modèle.
 */
export function propositionEnAttente(proposal: PropositionTriable): boolean {
  return (proposal.decision ?? 'pending') === 'pending';
}

/**
 * Les propositions qui restent dans le FIL, à leur place d'origine : celles
 * déjà validées ou refusées. Aucune n'est perdue — ce qui sort d'ici entre
 * dans le bandeau.
 */
export function propositionsDuFil<P extends PropositionTriable>(proposals: P[]): P[] {
  return proposals.filter((proposal) => !propositionEnAttente(proposal));
}

/**
 * Ce que le bandeau affiche : toutes les propositions encore en attente de la
 * conversation, dans l'ordre des messages — la plus ancienne d'abord, comme
 * elles sont arrivées. Aucune en attente : la liste est vide, et le bandeau ne
 * rend rien du tout (il ne prend alors aucune place).
 */
export function propositionsEnAttente<P extends PropositionTriable>(
  messages: MessagePourPropositions<P>[],
): PropositionEnAttente<P>[] {
  const retenues: PropositionEnAttente<P>[] = [];
  for (const message of messages) {
    for (const proposal of message.proposals) {
      if (!propositionEnAttente(proposal)) continue;
      retenues.push({ messageId: message.id, agentId: message.agentId, proposal });
    }
  }
  return retenues;
}

/**
 * Au-delà de ce nombre de signes, la description d'une vignette est REPLIÉE :
 * le bandeau doit rester une bande, pas un second écran. Le seuil tient un
 * constat court en entier ; une description de carte en règle (320 signes au
 * moins, `jugerDescription`) est donc toujours repliée.
 */
export const DESCRIPTION_REPLIEE_MAX = 160;

/** La description mérite-t-elle un bouton pour la déplier ? */
export function descriptionRepliable(description: string | undefined): boolean {
  return (description?.trim().length ?? 0) > DESCRIPTION_REPLIEE_MAX;
}
