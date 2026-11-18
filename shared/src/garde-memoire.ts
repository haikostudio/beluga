import { ATTENTE_MAX_DES_TRAVAUX_LOURDS_MS, porteDesTravauxLourds, type PressionMemoire } from './capacite.js';
import { lanceUnServeur, morceaux, sansHeredocs } from './garde-attentes.js';

/**
 * LES ESSAIS D'UNE TÂCHE REGARDENT LA MÉMOIRE AVANT DE PARTIR (18/11/2026).
 *
 * Un serveur d'essai (vite, le démon d'essai « beluga-essai-<port> ») et son
 * navigateur pèsent 1 à 1,3 Go par carte. Le 17/11 à 17:17 et le 18/11 à
 * 08:29, ils sont partis sur une machine pleine, fichier d'échange compris, et
 * le démon s'est figé jusqu'à 63 s. Rien ne les retenait : la porte des départs
 * ne garde que le lancement des cartes.
 *
 * Le garde des commandes (`server/garde-demon.mjs`) les retient donc, ET LE DIT
 * à l'agent : machine pleine, la commande est refusée avec une phrase stable
 * qui dit quoi faire en attendant. L'attente est BORNÉE : passé
 * `ATTENTE_MAX_DES_TRAVAUX_LOURDS_MS` depuis le premier refus dans ce dossier
 * de travail, la commande part quand même — les vérifications d'une tâche ne
 * tombent jamais en panne pour une machine pleine.
 */

/** La commande lance-t-elle un essai lourd (serveur d'essai, navigateur de test) ? Rend ce qu'elle lance, ou `null`. */
export function commandeLanceUnEssai(brute: string): string | null {
  if (!brute?.trim()) return null;
  for (const m of morceaux(sansHeredocs(brute))) {
    const serveur = lanceUnServeur(m.texte);
    if (serveur) return serveur;
    if (/\b(npx|pnpx|bunx)\s+playwright\s+test\b/.test(m.texte) || /^playwright\s+test\b/.test(m.texte.trim())) return 'playwright test';
  }
  return null;
}

export interface VerdictDuGardeDeMemoire {
  /** passe : rien à dire ; refuse : la commande attend (texte à rendre) ; force : elle part après l'attente bornée. */
  verdict: 'passe' | 'refuse' | 'force';
  /** Ce qu'on lance (pour le texte). */
  essai?: string;
  texte?: string;
}

export function gardeDeMemoire(e: {
  commande: string;
  pression: PressionMemoire;
  /** L'instant du premier refus encore en cours dans ce dossier de travail, s'il y en a un. */
  premierRefusLe?: number;
  maintenant: number;
  maxMs?: number;
}): VerdictDuGardeDeMemoire {
  const essai = commandeLanceUnEssai(e.commande);
  if (!essai) return { verdict: 'passe' };
  const attente = e.premierRefusLe !== undefined ? Math.max(0, e.maintenant - e.premierRefusLe) : 0;
  const verdict = porteDesTravauxLourds(e.pression, attente, e.maxMs ?? ATTENTE_MAX_DES_TRAVAUX_LOURDS_MS);
  if (verdict === 'partir') return { verdict: 'passe', essai };
  if (verdict === 'forcer') return { verdict: 'force', essai };
  return {
    verdict: 'refuse',
    essai,
    texte:
      `La mémoire de la machine est pleine : « ${essai} » attend qu'elle se libère, pour ne pas figer le serveur. ` +
      `En attendant, avance sur ce qui ne lance rien de lourd (lire, écrire le code), puis relance la même commande : ` +
      `elle part dès que la mémoire se libère, et au plus tard après quelques minutes d'attente, même si elle reste pleine.`,
  };
}
