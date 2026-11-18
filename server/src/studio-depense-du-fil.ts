/**
 * LA VOIX FINALE ET LE PERSONNAGE 3D PROPOSÉS DANS LA CONVERSATION DU STUDIO
 * (01/11/2026) : le clic sur « Générer · prix » arrive ici, côté démon. Seul le
 * libellé exact du bouton lance ; une phrase écrite ne dépense jamais. La
 * dépense reste celle des autres chemins : décidée une seule fois pour le 3D,
 * revérifiée contre le prix du moment pour la voix (`validerVoixFinales`).
 */
import { depenseAccordeeParLaReponse, type DepenseDuFil } from '@beluga/shared';
import { deciderDepense, listerDepenses } from './studio.js';
import { validerVoixFinales } from './studio-generation.js';

/** Deux propositions de voix cliquées coup sur coup : la seconde attend la fin de la vérification de la première, et la voit. */
const voixEnDecision = new Set<string>();

export async function trancherLaDepenseDuFil(d: DepenseDuFil, reponse: string): Promise<{ ok: true } | { ok: false; raison: string }> {
  const accord = depenseAccordeeParLaReponse(reponse);
  if (d.genre === 'modele3d') {
    if (!d.depenseId) return { ok: false, raison: 'cette proposition ne porte plus sa dépense' };
    const r = deciderDepense(d.depenseId, accord ? 'validee' : 'refusee');
    if (!r.ok) return r;
    if (accord) (await import('./studio-3d.js')).lancerLePersonnage3d(d.depenseId);
    return { ok: true };
  }
  if (!accord) return { ok: true };
  if (voixEnDecision.has(d.creationId) || listerDepenses(d.creationId).some((x) => x.genre === 'voix' && x.etat === 'validee')) {
    return { ok: false, raison: 'une voix finale est déjà en fabrication sur cette création' };
  }
  voixEnDecision.add(d.creationId);
  try {
    const r = await validerVoixFinales(d.creationId, undefined, d.plafond ?? 0, d.refaire ? { refaire: true } : {});
    return r.ok ? { ok: true } : { ok: false, raison: r.raison };
  } finally {
    voixEnDecision.delete(d.creationId);
  }
}
