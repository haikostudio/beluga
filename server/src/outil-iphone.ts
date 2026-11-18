/*
 * L'OUTIL « iphone » DES AGENTS (13/11/2026) : piloter le VRAI iPhone de la personne par sa recopie à l'écran du Mac
 * (iPhone Mirroring), à travers le relais du Mac relié (`server/src/relais-mac.ts`, `shared/src/relais-mac.ts`).
 *
 * L'agent ne parle qu'en FRACTIONS DE LA CAPTURE (x, y entre 0 et 1) : il ne peut viser rien d'autre que la fenêtre
 * de recopie, et le relais refuse de son côté tout point hors de ses limites, recalculées à chaque geste. Les mots de
 * passe vont du coffre au relais par le démon (`se_connecter`), jamais par le texte du moteur. Mêmes exceptions que
 * Chrome (DEC-508) : argent, suppression d'un compte, nom peut-être définitif dont l'agent n'est pas sûr.
 * Relais absent, Mac verrouillé ou recopie fermée : la conduite de repli (`conduiteDuRelais`) — les gestes envoyés à
 * la personne, avec « C'est fait ».
 */
import {
  GESTES_IPHONE,
  RAPPEL_NOM_DEFINITIF,
  TOUCHES_IPHONE,
  conduiteDuRelais,
  gesteIphoneValide,
  texteATaper,
} from '@beluga/shared';
import * as store from './store.js';
import type { ToolContext, ToolDef, ToolResult } from './tools.js';
import { demanderAuRelais, relaisDuCompte } from './relais-mac.js';

export const OUTIL_IPHONE: ToolDef = {
  name: 'iphone',
  description:
    'PILOTE LE VRAI IPHONE DE LA PERSONNE, par sa recopie à l’écran de son Mac (relais du Mac relié dans Réglages → ' +
    'Extension). À utiliser quand un site exige son APPLICATION (TikTok, X…) ou refuse l’ordinateur. PARCOURS : « etat » ' +
    'd’abord → « capturer » (image de l’écran de l’iPhone, jointe au fil) → « toucher » (x, y en FRACTIONS de la ' +
    'capture, 0 à 1) / « glisser » (x, y → x2, y2) / « taper » (texte) / « touche » (entree, effacer, tab, echap, ' +
    'espace) / « accueil » / « ouvrir_appli » (nom) → « capturer » après chaque geste pour vérifier. CONNEXION : ' +
    '« se_connecter » (fiche = nom de la fiche du coffre-fort) tape l’identifiant et le mot de passe sans que tu les ' +
    'voies. Tu n’agis QUE dans la fenêtre de recopie : rien d’autre du Mac. Autonome, sauf un geste d’argent, la ' +
    'suppression d’un compte, et un NOM PEUT-ÊTRE DÉFINITIF (pseudo, nom de page) dont tu n’es pas sûr : ask_user ' +
    'd’abord. Pas de caméra ni de Face ID à travers la recopie. RELAIS INDISPONIBLE : prépare tout, puis envoie à la ' +
    'personne par ask_user la liste numérotée des gestes à faire sur son téléphone, avec « C’est fait » / « Plus tard ».',
  inputSchema: {
    type: 'object',
    required: ['geste'],
    properties: {
      geste: { type: 'string', enum: [...GESTES_IPHONE] },
      x: { type: 'number', description: 'toucher / glisser : abscisse en fraction de la capture (0 à 1)' },
      y: { type: 'number', description: 'toucher / glisser : ordonnée en fraction de la capture (0 à 1)' },
      x2: { type: 'number', description: 'glisser : abscisse d’arrivée' },
      y2: { type: 'number', description: 'glisser : ordonnée d’arrivée' },
      texte: { type: 'string', description: 'taper : le texte' },
      touche: { type: 'string', enum: [...TOUCHES_IPHONE], description: 'touche : la touche' },
      nom: { type: 'string', description: 'ouvrir_appli : le nom de l’application' },
      fiche: { type: 'string', description: 'se_connecter : le nom de la fiche du coffre-fort' },
      nomDefinitif: { type: 'boolean', description: 'taper : ce texte est un pseudo ou un nom peut-être définitif' },
    },
  },
};

export async function outilIphone(ctx: ToolContext, args: Record<string, any>): Promise<ToolResult> {
  const geste = args.geste;
  if (!gesteIphoneValide(geste)) return { ok: false, text: `Geste inconnu. Gestes : ${GESTES_IPHONE.join(', ')}.` };
  const { interlocuteurDeLAgent } = await import('./interlocuteur.js');
  const compte = await interlocuteurDeLAgent(ctx.agentId);
  if (!compte?.id) return { ok: false, text: `Je ne sais pas quelle personne te parle : aucun iPhone ne peut t'être confié. ${conduiteDuRelais('absent')}` };
  const relais = relaisDuCompte(compte.id);
  if (!relais.appareilId || relais.etat === 'absent' || relais.etat === 'hors-ligne' || relais.etat === 'mac-verrouille') {
    return { ok: geste === 'etat', text: `Relais du Mac : ${relais.etat}. ${conduiteDuRelais(relais.etat)}` };
  }
  const appareilId = relais.appareilId;
  try {
    switch (geste) {
      case 'etat': {
        const r = await demanderAuRelais<{ recopie: boolean; verrouille?: boolean }>(appareilId, 'etat', {});
        const etat = r.verrouille ? 'mac-verrouille' : r.recopie ? 'pret' : 'recopie-fermee';
        return { ok: true, text: `Relais du Mac : ${etat}. ${conduiteDuRelais(etat)}` };
      }
      case 'ouvrir_recopie': {
        const r = await demanderAuRelais<{ recopie: boolean }>(appareilId, 'ouvrir_recopie', {}, 45_000);
        return { ok: true, text: r.recopie ? 'La recopie de l’iPhone est ouverte : « capturer ».' : `La recopie ne s’ouvre pas. ${conduiteDuRelais('hors-ligne')}` };
      }
      case 'capturer': {
        const r = await demanderAuRelais<{ png: string }>(appareilId, 'capturer', {});
        const { rangerUneImage } = await import('./extension-chrome.js');
        const id = await rangerUneImage(ctx.projectId, ctx.agentId, ctx.cardId ?? undefined, `data:image/png;base64,${r.png}`, `iphone-${Date.now()}.png`);
        const piece = id ? store.getAttachment(id) : null;
        return piece ? { ok: true, text: 'Capture de l’iPhone jointe au fil. Vise avec x, y en fractions de cette image.', attachment: piece } : { ok: false, text: 'Capture impossible à ranger.' };
      }
      case 'toucher':
      case 'glisser': {
        const nombres = geste === 'glisser' ? [args.x, args.y, args.x2, args.y2] : [args.x, args.y];
        if (!nombres.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) {
          return { ok: false, text: 'Donne x et y en fractions de la capture, entre 0 et 1.' };
        }
        const r = await demanderAuRelais<{ texte: string }>(appareilId, geste, { x: args.x, y: args.y, x2: args.x2, y2: args.y2 });
        return { ok: true, text: `${r.texte ?? 'Fait.'} « capturer » pour vérifier.` };
      }
      case 'taper': {
        const texte = texteATaper(args.texte);
        if (!texte) return { ok: false, text: 'Un texte de 1 à 2000 signes.' };
        await demanderAuRelais(appareilId, 'taper', { texte });
        return { ok: true, text: `Texte tapé. « capturer » pour vérifier.${args.nomDefinitif ? `\n\n${RAPPEL_NOM_DEFINITIF}` : ''}` };
      }
      case 'touche': {
        if (!(TOUCHES_IPHONE as readonly string[]).includes(String(args.touche))) return { ok: false, text: `Touches : ${TOUCHES_IPHONE.join(', ')}.` };
        await demanderAuRelais(appareilId, 'touche', { touche: args.touche });
        return { ok: true, text: 'Touche jouée. « capturer » pour vérifier.' };
      }
      case 'accueil':
        await demanderAuRelais(appareilId, 'accueil', {});
        return { ok: true, text: 'Retour à l’écran d’accueil. « capturer ».' };
      case 'ouvrir_appli': {
        const nom = texteATaper(args.nom);
        if (!nom || nom.length > 60) return { ok: false, text: 'Donne le nom de l’application.' };
        await demanderAuRelais(appareilId, 'ouvrir_appli', { nom }, 45_000);
        return { ok: true, text: `« ${nom} » demandée. « capturer » pour voir si elle est ouverte.` };
      }
      case 'se_connecter': {
        const { listerAcces } = await import('./coffre-fort.js');
        const nom = String(args.fiche ?? '').trim().toLowerCase();
        const fiche = listerAcces().find(
          (f) => f.nom.toLowerCase() === nom && (compte.role === 'admin' || (f.projectId && compte.projets?.includes(f.projectId))),
        );
        if (!fiche?.champs?.motDePasse) return { ok: false, text: 'Aucune fiche lisible de ce nom avec un mot de passe dans le coffre-fort.' };
        /* La valeur va du démon au relais : elle ne revient jamais au moteur. */
        await demanderAuRelais(appareilId, 'se_connecter', { identifiant: fiche.champs.identifiant ?? '', motDePasse: fiche.champs.motDePasse });
        return { ok: true, text: `Identifiant et mot de passe de « ${fiche.nom} » tapés. « capturer » pour vérifier.` };
      }
      default:
        return { ok: false, text: 'Geste inconnu.' };
    }
  } catch (err: any) {
    return { ok: false, text: `iPhone : ${err?.message ?? err}. ${conduiteDuRelais('hors-ligne')}` };
  }
}
