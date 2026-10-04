import type { SaisieDeQuestion } from '@beluga/shared';

/**
 * CE QUE LES BULLES DE QUESTION TIENNENT, LISIBLE PAR LA BARRE D'ÉCRITURE.
 *
 * Les choix cochés, le texte et les images d'une bulle vivaient dans son seul
 * état local : la barre d'écriture, qui répond pourtant à la même question, ne
 * pouvait pas les voir. On cochait un choix, on écrivait sa précision dans la
 * barre, et le choix était perdu.
 *
 * La bulle garde son état local — c'est lui qui dessine — et en dépose ici un
 * simple reflet, que la barre lit AU MOMENT D'ENVOYER. Rien ne s'abonne à ce
 * registre et il ne traverse pas le magasin général : cocher ou taper dans une
 * bulle ne redessine rien d'autre qu'elle.
 */
interface Reflet extends SaisieDeQuestion {
  agentId: string;
  /** La bulle qui l'a déposé : une même question peut être dessinée deux fois. */
  bulle: string;
}

const reflets = new Map<string, Reflet>();

/** Le préfixe d'une question écrite en texte ordinaire, qui n'a pas d'identifiant d'outil. */
export const SAISIE_EN_TEXTE = 'texte:';

export function retenirLaSaisie(cle: string, agentId: string, bulle: string, saisie: SaisieDeQuestion): void {
  const vide = !saisie.libelles.length && !saisie.texte?.trim() && !saisie.images?.length;
  if (vide) {
    if (reflets.get(cle)?.bulle === bulle) reflets.delete(cle);
    return;
  }
  reflets.set(cle, { ...saisie, agentId, bulle });
}

/** La bulle disparaît (question répondue, annulée, écran quitté) : son reflet aussi. */
export function oublierLaSaisie(cle: string, bulle: string): void {
  if (reflets.get(cle)?.bulle === bulle) reflets.delete(cle);
}

/**
 * Ce que tiennent les bulles de cet agent : par identifiant de question pour
 * celles de l'outil (le serveur sait à laquelle le message répond), et à part
 * pour une question écrite en texte ordinaire.
 */
export function saisiesDeLAgent(agentId: string): {
  parQuestion: Record<string, SaisieDeQuestion>;
  enTexte?: SaisieDeQuestion;
} {
  const parQuestion: Record<string, SaisieDeQuestion> = {};
  let enTexte: SaisieDeQuestion | undefined;
  for (const [cle, { agentId: agent, bulle: _bulle, ...saisie }] of reflets) {
    if (agent !== agentId) continue;
    if (cle.startsWith(SAISIE_EN_TEXTE)) enTexte = saisie;
    else parQuestion[cle] = saisie;
  }
  return { parQuestion, enTexte };
}
