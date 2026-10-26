import { CONSIGNE_DU_TRADUCTEUR, MODELE_LLM_PAR_DEFAUT, consigneSeTraduit, traductionNettoyee } from '@beluga/shared';
import { relayerDemandeLlm, type ReponseRelais } from './relais-llm.js';
import { log } from './logger.js';

/*
 * LA TRADUCTION DES CONSIGNES DE GÉNÉRATION (décision du 24/10/2026), faite AU
 * DEVIS : la règle (quelles capacités, la consigne du traducteur, le nettoyage)
 * vit dans `shared/src/traduction-des-consignes.ts`. Ici : l'appel.
 *
 * D'abord le relais du coffre (petit modèle peu cher), sinon un compte Claude
 * connecté, chaque voie essayée deux fois au plus. Un échec ne passe JAMAIS en
 * silence au français : l'appelant refuse le devis, rien n'est dépensé.
 */

export interface VoiesDeTraduction {
  relayer: (texte: string) => Promise<string | null>;
  claude: (texte: string) => Promise<string | null>;
}

function lireReponseRelais(r: ReponseRelais): string | null {
  if (!r.ok) return null;
  const corps = r.corps as any;
  const contenu = corps?.choices?.[0]?.message?.content;
  if (typeof contenu === 'string') return contenu;
  if (Array.isArray(contenu)) return contenu.map((b: any) => (typeof b?.text === 'string' ? b.text : '')).join('');
  return null;
}

const VOIES: VoiesDeTraduction = {
  relayer: async (texte) =>
    lireReponseRelais(
      await relayerDemandeLlm({
        modele: MODELE_LLM_PAR_DEFAUT,
        messages: [
          { role: 'system', content: CONSIGNE_DU_TRADUCTEUR },
          { role: 'user', content: texte },
        ] as any,
        temperature: 0,
        maxTokens: 2048,
      }),
    ),
  /* Chargé à la demande : `amorce.ts` tire le moteur et ses outils, qui
     importent eux-mêmes la réalisation — un import en tête bouclerait. */
  claude: async (texte) => {
    const { redigerParUnCompteClaude } = await import('./amorce.js');
    return redigerParUnCompteClaude(CONSIGNE_DU_TRADUCTEUR, texte, 2048);
  },
};

export type TraductionDeConsigne =
  | { ok: true; consigne: string; originale: string | null }
  | { ok: false; raison: string };

/**
 * LES BACS À SABLE DES TESTS n'ont ni relais ni compte : ils posent
 * `BELUGA_TRADUCTION_IDENTITE=1`, et la consigne passe telle quelle — c'est le
 * seul cas où rien n'est traduit sans échec.
 */
const IDENTITE: VoiesDeTraduction = { relayer: async (texte) => texte, claude: async (texte) => texte };
function voiesParDefaut(): VoiesDeTraduction {
  return process.env.BELUGA_TRADUCTION_IDENTITE === '1' ? IDENTITE : VOIES;
}

/** La consigne en anglais. `originale` vaut `null` quand rien n'a changé (déjà en anglais). */
export async function traduireConsigneEnAnglais(texte: string, voies: VoiesDeTraduction = voiesParDefaut()): Promise<TraductionDeConsigne> {
  const source = texte.trim();
  if (!source) return { ok: false, raison: 'consigne vide' };
  for (const voie of [voies.relayer, voies.relayer, voies.claude, voies.claude]) {
    try {
      const traduite = traductionNettoyee(await voie(source));
      if (traduite) return { ok: true, consigne: traduite, originale: traduite === source ? null : source };
    } catch (err) {
      log.warn('traduction de consigne : essai raté', (err as Error)?.message ?? err);
    }
  }
  return { ok: false, raison: 'aucun modèle de traduction n’a répondu (relais du coffre et comptes Claude)' };
}

/**
 * La consigne à ENVOYER pour cette capacité : traduite si elle doit l'être,
 * telle quelle sinon (voix, présentateur, synchronisation).
 */
export async function consigneAEnvoyer(capacite: string, texte: string, voies?: VoiesDeTraduction): Promise<TraductionDeConsigne> {
  if (!consigneSeTraduit(capacite)) return { ok: true, consigne: texte, originale: null };
  return traduireConsigneEnAnglais(texte, voies);
}
