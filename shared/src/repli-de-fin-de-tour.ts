/**
 * LE REPLI DE FIN DE TOUR (carte « Retouches charte et fin de tâche », 06/11/2026, décision de l'utilisateur) : à la
 * fin d'un travail d'agent, la liste des tâches et « Ce que l'agent a vu » se REPLIENT ; ils se ROUVRENT tout seuls au
 * démarrage du travail suivant. C'est un repli DE SESSION : le pli retenu d'une fois sur l'autre (préférences) n'en sait
 * rien, et un clic rouvre le volet pendant l'inactivité.
 *
 * Seule une TRANSITION OBSERVÉE agit : ouvrir une conversation déjà inactive ne replie rien (le premier état vu n'est
 * comparé à rien). Une question laissée sans réponse ne replie pas : le travail n'est pas fini, il attend.
 */
export interface EtatDuRepliDeFinDeTour {
  /** L'agent travaillait-il au dernier état observé ? `undefined` : rien observé encore. */
  occupeAvant: boolean | undefined;
  /** Les volets sont-ils repliés par la fin du tour ? */
  replie: boolean;
}

export function repliApresObservation(
  etat: EtatDuRepliDeFinDeTour,
  occupe: boolean,
  options: { questionEnAttente?: boolean } = {},
): EtatDuRepliDeFinDeTour {
  const avant = etat.occupeAvant;
  if (avant === undefined || avant === occupe) return { occupeAvant: occupe, replie: etat.replie };
  /* inactif → occupé : le travail suivant démarre, tout se rouvre. */
  if (occupe) return { occupeAvant: true, replie: false };
  /* occupé → inactif : le travail est fini, sauf s'il attend une réponse. */
  return { occupeAvant: false, replie: !options.questionEnAttente };
}
