/*
 * L'OUTIL « ordinateur » DES AGENTS (carte « Choisir l'ordinateur visé depuis le téléphone », 15/11/2026).
 *
 * Lister les ordinateurs de la personne qui parle (allumés ou non, navigateurs, programme du Mac), et OUVRIR UNE
 * APPLICATION sur l'un d'eux par le programme du Mac (`scripts/relais-mac/relais.js`, geste « ouvrir_application »).
 * JAMAIS de commande libre : le nom est vérifié ici (`nomDApplicationValable`), puis comparé par le Mac à la liste de
 * ses applications installées. Le navigateur se pilote avec l'outil « chrome ».
 *
 * PÉRIMÈTRE : seulement les ordinateurs du compte de l'INTERLOCUTEUR de l'agent ; un ordinateur éteint se dit, sans
 * bascule sur un autre (décision de l'utilisateur du 15/11/2026).
 */
import {
  LIBELLE_DU_NAVIGATEUR,
  LIBELLE_ETAT_DU_RELAIS,
  nomDApplicationValable,
  ordinateurEnLigne,
  ordinateurParDefaut,
  programmeEnLigne,
  resoudreLOrdinateur,
  texteInjoignable,
  type Ordinateur,
} from '@beluga/shared';
import type { ToolContext, ToolDef, ToolResult } from './tools.js';

export const GESTES_ORDINATEUR = ['lister', 'applications', 'ouvrir_application'] as const;

export const OUTIL_ORDINATEUR: ToolDef = {
  name: 'ordinateur',
  description:
    'LES ORDINATEURS DE LA PERSONNE QUI TE PARLE (Réglages → Extension) : « lister » les montre avec leur état ' +
    '(allumé ou non), leurs navigateurs reliés et le programme du Mac, et dit lequel est retenu pour la carte. Sur un ' +
    'Mac où le programme est installé : « applications » liste les applications installées, « ouvrir_application » ' +
    '(nom, ex. « Mail », « Photos ») en ouvre une. Jamais de commande libre. « ordinateur » (son nom) vise un autre ' +
    'ordinateur que celui retenu. Un ordinateur éteint : dis-le à la personne, ne bascule jamais sur un autre. Pour ' +
    'agir DANS le navigateur de l’ordinateur, outil « chrome ».',
  inputSchema: {
    type: 'object',
    required: ['geste'],
    properties: {
      geste: { type: 'string', enum: [...GESTES_ORDINATEUR] },
      nom: { type: 'string', description: 'ouvrir_application : le nom de l’application (« Mail », « Finder »…)' },
      ordinateur: { type: 'string', description: 'L’ordinateur visé (son nom) ; défaut : celui retenu pour la carte' },
    },
  },
};

function ligneDOrdinateur(o: Ordinateur, retenu: string | null): string {
  const navigateurs = o.navigateurs.map((n) => `${LIBELLE_DU_NAVIGATEUR[n.genre]}${n.enLigne ? ' (ouvert)' : ' (fermé)'}`).join(', ') || 'aucun navigateur';
  const programme = o.programme ? `programme du Mac : ${LIBELLE_ETAT_DU_RELAIS[o.programme.etat]}` : 'pas de programme du Mac';
  return `- « ${o.nom} »${o.id === retenu ? ' — RETENU pour cette carte' : ''} : ${ordinateurEnLigne(o) ? 'allumé' : 'éteint ou hors ligne'} ; ${navigateurs} ; ${programme}.`;
}

export async function outilOrdinateur(ctx: ToolContext, args: Record<string, any>): Promise<ToolResult> {
  const geste = String(args.geste ?? '');
  if (!(GESTES_ORDINATEUR as readonly string[]).includes(geste)) return { ok: false, text: `Geste inconnu. Gestes : ${GESTES_ORDINATEUR.join(', ')}.` };
  const { interlocuteurDeLAgent } = await import('./interlocuteur.js');
  const compte = await interlocuteurDeLAgent(ctx.agentId);
  if (!compte?.id) return { ok: false, text: 'Je ne sais pas quelle personne te parle : aucun ordinateur ne peut t’être confié.' };
  const { ordinateursDuCompte, ordinateurRetenu, dernierOrdinateur, retenirLOrdinateur } = await import('./ordinateurs.js');
  const ordinateurs = await ordinateursDuCompte(compte.id);
  const retenu = ordinateurRetenu(ctx.agentId, ctx.cardId);

  if (geste === 'lister') {
    if (!ordinateurs.length) return { ok: true, text: 'Aucun ordinateur relié. La personne en relie un dans Réglages → Extension.' };
    return { ok: true, text: ordinateurs.map((o) => ligneDOrdinateur(o, retenu)).join('\n') };
  }

  /* L'ORDINATEUR VISÉ : celui nommé, sinon le retenu, le dernier, le seul. */
  const voulu = typeof args.ordinateur === 'string' && args.ordinateur.trim() ? args.ordinateur : null;
  const avecProgramme = ordinateurs.filter((o) => o.programme);
  const vise = voulu ? resoudreLOrdinateur(ordinateurs, voulu) : (ordinateurParDefaut(ordinateurs, retenu, dernierOrdinateur(compte.id)) ?? (avecProgramme.length === 1 ? avecProgramme[0]! : null));
  if (!vise) {
    return {
      ok: false,
      text: voulu
        ? `Aucun ordinateur « ${voulu} » parmi ceux de la personne : ${ordinateurs.map((o) => `« ${o.nom} »`).join(', ') || 'aucun'}.`
        : `Plusieurs ordinateurs sont reliés et aucun n’est retenu : demande à la personne lequel viser (ask_user), puis passe « ordinateur ».\n${ordinateurs.map((o) => ligneDOrdinateur(o, retenu)).join('\n')}`,
    };
  }
  if (!vise.programme) {
    return { ok: false, text: `« ${vise.nom} » n’a pas le programme du Mac : il faut l’installer depuis Réglages → Extension (menu de cet ordinateur, « Installer le programme du Mac ») pour y ouvrir une application.` };
  }
  if (!programmeEnLigne(vise.programme)) return { ok: false, text: texteInjoignable(vise.nom, true) };
  if (vise.programme.etat === 'mac-verrouille') return { ok: false, text: `« ${vise.nom} » est verrouillé : aucune application ne peut s’y ouvrir. Dis-le à la personne.` };
  if (voulu && vise.id !== retenu) retenirLOrdinateur(compte.id, ctx.agentId, ctx.cardId, vise.id);

  const { demanderAuRelais } = await import('./relais-mac.js');
  try {
    if (geste === 'applications') {
      const r = await demanderAuRelais<{ applications: string[] }>(vise.programme.id, 'lister_applications', {});
      return { ok: true, text: `Applications de « ${vise.nom} » (${r.applications.length}) : ${r.applications.join(', ')}.` };
    }
    const nom = nomDApplicationValable(args.nom);
    if (!nom) return { ok: false, text: 'Donne le nom d’une application installée (« Mail », « Photos »…), sans chemin ni commande.' };
    const r = await demanderAuRelais<{ ouverte: string }>(vise.programme.id, 'ouvrir_application', { nom });
    return { ok: true, text: `« ${r.ouverte} » est ouverte sur « ${vise.nom} ».` };
  } catch (err: any) {
    return { ok: false, text: `« ${vise.nom} » : ${err?.message ?? err}` };
  }
}
