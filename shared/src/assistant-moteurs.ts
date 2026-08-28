import { AccountQuota, EngineId, EngineInfo } from './models.js';

/**
 * AU MOINS UN MOTEUR AVANT D'OUVRIR L'APPLICATION.
 *
 * HaikoDev ne sait rien faire sans un moteur en ligne de commande installé sur
 * le serveur ET un compte qui répond : sans cela, chaque carte lancée échoue
 * sur « moteur jamais joint », et rien à l'écran ne disait pourquoi. Cette
 * règle — sans base ni disque, donc testable seule — dit, à partir du catalogue
 * des moteurs et du relevé des comptes, ce qui manque à chacun des trois et
 * s'il en reste au moins un d'utilisable.
 *
 * Elle sert deux endroits : l'ASSISTANT DE DÉMARRAGE (qui bloque l'écran tant
 * que la réponse est non) et la ligne d'état des réglages.
 */

/** L'étape où en est un moteur, du plus loin au plus près. */
export type EtapeMoteur = 'a-installer' | 'a-connecter' | 'a-reconnecter' | 'pret';

export interface MoteurDeLAssistant {
  id: EngineId;
  label: string;
  etape: EtapeMoteur;
  /** L'outil en ligne de commande répond-il sur le serveur ? */
  cliInstalle: boolean;
  version?: string;
  /** Comptes déclarés pour ce moteur, coupés compris. */
  comptes: number;
  /** Comptes dont la connexion tient debout : ce sont eux qui font l'« en ligne ». */
  comptesEnLigne: number;
  /** Ce qu'il reste à faire, en une phrase. */
  libelle: string;
  /** La commande à coller dans un terminal du serveur pour installer l'outil. */
  commandeDInstallation: string;
  /**
   * Ce moteur se connecte-t-il par une PAGE (Claude, Codex) ou par une CLÉ
   * d'accès (Cursor) ? Les deux gestes n'ont rien en commun.
   */
  connexionParCle: boolean;
}

/**
 * Les trois moteurs, dans l'ordre où l'assistant les propose. Le nom affiché
 * suit le catalogue quand il est là ; ces libellés ne servent qu'au cas où le
 * catalogue n'a pas encore répondu.
 */
export const MOTEURS_DE_L_ASSISTANT: readonly { id: EngineId; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex (GPT)' },
  { id: 'cursor', label: 'Cursor' },
];

/**
 * Les commandes d'installation, telles que chaque éditeur les publie. Elles
 * s'exécutent dans un terminal du serveur, jamais depuis l'application : le
 * démon n'a pas les droits d'installer un outil pour l'utilisateur, et un
 * installateur lancé en aveugle poserait l'outil dans le mauvais compte.
 */
export const COMMANDES_D_INSTALLATION: Record<EngineId, string> = {
  claude: 'curl -fsSL https://claude.ai/install.sh | bash',
  codex: 'npm install -g @openai/codex',
  cursor: 'curl https://cursor.com/install -fsS | bash',
};

/** Cursor n'a pas de page de connexion : il se déclare par une clé d'accès. */
function parCle(id: EngineId): boolean {
  return id === 'cursor';
}

/**
 * UN COMPTE COMPTE-T-IL COMME EN LIGNE ?
 *
 * Un compte coupé à la main ne compte pas. Un compte dont la connexion demande
 * à être refaite (jeton absent, expiré, refusé) ne compte pas non plus. En
 * revanche, un compte à COURT DE QUOTA reste un compte configuré : la fenêtre
 * repartira toute seule, et bloquer l'application entière pour cela reviendrait
 * à demander d'ouvrir un second compte pour quelques heures.
 */
export function compteEnLigne(quota: Pick<AccountQuota, 'disabled' | 'connexion'>): boolean {
  if (quota.disabled) return false;
  return !quota.connexion?.doitReconnecter;
}

/** L'état des trois moteurs, prêt à afficher. */
export function moteursDeLAssistant(
  engines: readonly EngineInfo[],
  quotas: readonly AccountQuota[],
): MoteurDeLAssistant[] {
  return MOTEURS_DE_L_ASSISTANT.map(({ id, label }) => {
    const engine = engines.find((e) => e.id === id);
    const comptesDuMoteur = quotas.filter((q) => q.engine === id);
    const comptes = comptesDuMoteur.length;
    const comptesEnLigne = comptesDuMoteur.filter(compteEnLigne).length;

    /*
     * `cliInstalle` est le seul repère qui parle de l'OUTIL et de rien d'autre.
     * `EngineInfo.installed`, lui, veut dire « ce moteur est utilisable » : sur
     * Cursor il est déjà faux quand aucune clé n'est déclarée, alors même que
     * l'outil est bien là. Confondre les deux ferait afficher « à installer »
     * pour un outil déjà installé.
     */
    const cliInstalle = engine?.cliInstalle ?? engine?.installed ?? false;

    let etape: EtapeMoteur;
    if (!cliInstalle) etape = 'a-installer';
    else if (comptesEnLigne > 0) etape = 'pret';
    else if (comptes > 0) etape = 'a-reconnecter';
    else etape = 'a-connecter';

    return {
      id,
      label: engine?.label || label,
      etape,
      cliInstalle,
      version: engine?.version,
      comptes,
      comptesEnLigne,
      libelle: libelleDEtape(etape, parCle(id)),
      commandeDInstallation: COMMANDES_D_INSTALLATION[id],
      connexionParCle: parCle(id),
    };
  });
}

/** Ce qu'il reste à faire, dit en français et sans jargon. */
export function libelleDEtape(etape: EtapeMoteur, connexionParCle: boolean): string {
  switch (etape) {
    case 'a-installer':
      return "L'outil n'est pas encore installé sur le serveur.";
    case 'a-connecter':
      return connexionParCle ? "Outil installé : il manque une clé d'accès." : 'Outil installé : il manque un compte.';
    case 'a-reconnecter':
      return connexionParCle
        ? "La clé d'accès ne répond plus : il en faut une nouvelle."
        : 'Le compte doit être reconnecté.';
    case 'pret':
      return 'Moteur prêt à travailler.';
  }
}

/** Au moins un moteur installé ET connecté : la condition pour entrer. */
export function auMoinsUnMoteurEnLigne(
  engines: readonly EngineInfo[],
  quotas: readonly AccountQuota[],
): boolean {
  return moteursDeLAssistant(engines, quotas).some((m) => m.etape === 'pret');
}

export interface EtatDuDemarrage {
  /** Le premier envoi du serveur est-il arrivé ? */
  pret: boolean;
  /** Le catalogue des moteurs a-t-il été reçu au moins une fois ? */
  engines: readonly EngineInfo[];
  quotas: readonly AccountQuota[];
  /**
   * Le relevé des comptes a-t-il été reçu au moins une fois ? Une liste vide
   * peut vouloir dire « aucun compte » comme « pas encore lu » : sans ce
   * témoin, l'assistant s'ouvrirait une demi-seconde sur un serveur pourtant
   * bien configuré.
   */
  quotasRecus: boolean;
}

/**
 * FAUT-IL BLOQUER L'ÉCRAN ? On ne juge que sur des faits reçus : tant que le
 * catalogue des moteurs ou le relevé des comptes manque, la réponse est non.
 * Mieux vaut une seconde d'attente qu'un assistant qui s'ouvre à tort.
 */
export function assistantNecessaire(etat: EtatDuDemarrage): boolean {
  if (!etat.pret) return false;
  if (!etat.engines.length) return false;
  if (!etat.quotasRecus) return false;
  return !auMoinsUnMoteurEnLigne(etat.engines, etat.quotas);
}
