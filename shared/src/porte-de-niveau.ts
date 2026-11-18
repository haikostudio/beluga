/*
 * LA PORTE DE NIVEAU DU MICRO (demande de l'utilisateur, 16/11/2026 : « il écoutait les conversations qu'il y avait à
 * côté »). Une voix lointaine arrive FAIBLE au micro du téléphone ; celle de la personne qui le tient, nettement plus
 * fort. La porte apprend le bruit de fond de l'endroit (le plancher) et ne laisse passer que ce qui dépasse ce
 * plancher d'un écart franc ; une fois ouverte, elle reste ouverte un court instant (le maintien) pour ne pas hacher
 * les fins de mots. Règle pure : elle ne connaît ni micro ni navigateur, elle juge des niveaux.
 */

export interface ReglageDePorte {
  /** L'écart, en décibels, au-dessus du plancher pour ouvrir. */
  ecartDb: number;
  /** Le temps, en millisecondes, pendant lequel la porte reste ouverte après le dernier son fort. */
  maintienMs: number;
  /** Le plancher le plus bas admis (micro très silencieux) : en dessous, on ne descend pas. */
  plancherMin: number;
  /** Combien de blocs calmes retenir pour apprendre le plancher. */
  memoire: number;
  /**
   * LE PLANCHER LE PLUS HAUT ADMIS (carte « Jarvis n'entend ni ne répond », 17/11/2026). Un plancher appris trop haut
   * (endroit bruyant, ou appris AVANT que l'iPhone passe en mode « appel », dont le traitement change tous les niveaux)
   * fermait la porte à la voix de la personne qui tient le téléphone : la conversation s'ouvrait et rien n'arrivait.
   * Borné ici, le seuil reste sous une voix tenue à la main (≈ -30 dBFS, 0,03).
   */
  plancherMax: number;
}

export const REGLAGE_DE_PORTE: ReglageDePorte = { ecartDb: 12, maintienMs: 350, plancherMin: 0.003, memoire: 40, plancherMax: 0.006 };

/** Le niveau efficace (RMS) d'un bloc d'échantillons. */
export function niveauRms(echantillons: ArrayLike<number>): number {
  if (!echantillons.length) return 0;
  let somme = 0;
  for (let i = 0; i < echantillons.length; i += 1) somme += echantillons[i]! * echantillons[i]!;
  return Math.sqrt(somme / echantillons.length);
}

export interface PorteDeNiveau {
  /** Apprend un bloc entendu (même hors conversation) et dit si la porte est ouverte pour lui. */
  juger(niveau: number, dureeMs: number): boolean;
  /** Le plancher appris, pour les essais. */
  plancher(): number;
  /** Ouvre la porte d'office pendant `ms` (le début du mot qu'on rejoue ne se coupe jamais). */
  ouvrirPendant(ms: number): void;
  /** Oublie le fond appris : le mode audio vient de changer, ses niveaux d'avant ne valent plus. */
  oublier(): void;
}

export function creerPorteDeNiveau(reglage: ReglageDePorte = REGLAGE_DE_PORTE): PorteDeNiveau {
  const calmes: number[] = [];
  let resteOuverte = 0;
  const plancher = () => {
    if (!calmes.length) return reglage.plancherMin;
    const tries = [...calmes].sort((a, b) => a - b);
    return Math.min(reglage.plancherMax, Math.max(reglage.plancherMin, tries[Math.floor(tries.length / 2)]!));
  };
  const facteur = Math.pow(10, reglage.ecartDb / 20);
  return {
    juger(niveau, dureeMs) {
      const seuil = plancher() * facteur;
      if (niveau >= seuil) {
        resteOuverte = reglage.maintienMs;
        return true;
      }
      // Un bloc sous le seuil est du fond : il nourrit le plancher (médiane glissante).
      calmes.push(niveau);
      if (calmes.length > reglage.memoire) calmes.shift();
      if (resteOuverte > 0) {
        resteOuverte -= dureeMs;
        return true;
      }
      return false;
    },
    plancher,
    ouvrirPendant(ms) {
      resteOuverte = Math.max(resteOuverte, ms);
    },
    oublier() {
      calmes.length = 0;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Ce qui a été dit pendant la connexion                                */
/* ------------------------------------------------------------------ */

/** Le niveau RMS au-dessus duquel un bloc compte comme de la parole proche (≈ -36 dBFS). */
export const NIVEAU_DE_PAROLE = 0.016;
/** Combien de parole, cumulée, il faut pour dire « il a parlé » (un claquement ou un souffle n'y suffisent pas). */
export const PAROLE_MIN_MS = 300;

/**
 * L'UTILISATEUR A-T-IL PARLÉ PENDANT LA CONNEXION ? (décision du 17/11/2026 : ce qu'il dit pendant que Jarvis arrive est
 * gardé sur l'appareil et transmis dès l'ouverture ; il a parlé → Jarvis lui répond, sans salut ; il s'est tu → Jarvis
 * le salue.) `niveaux` : le RMS de chaque bloc entendu depuis le geste, `blocMs` la durée d'un bloc.
 */
export function paroleEntendue(niveaux: readonly number[], blocMs: number, seuil = NIVEAU_DE_PAROLE): boolean {
  let parole = 0;
  for (const niveau of niveaux) {
    if (niveau >= seuil) parole += blocMs;
    if (parole >= PAROLE_MIN_MS) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Le contrôle de vie de la conversation                                */
/* ------------------------------------------------------------------ */

/** Ce que l'écran mesure du micro, une fois par seconde, pendant la conversation. */
export interface MesureDuMicro {
  /** Combien de blocs le traitement du son a vus depuis l'ouverture (il s'arrête quand le son est coupé). */
  blocs: number;
  /** L'état du contexte audio (« running », « suspended », « interrupted », « closed »). */
  contexte: string;
  /** Le plus fort niveau ENTENDU par le micro réel sur la dernière seconde. */
  entendu: number;
  /** Le plus fort niveau ENVOYÉ à Jarvis sur la dernière seconde. */
  envoye: number;
  /** La piste du micro est-elle finie (« ended ») ? */
  pisteFinie: boolean;
}

/** Une voix franche au micro (≈ -28 dBFS) : en dessous, rien n'envoyer peut être voulu (porte, silence). */
export const VOIX_FRANCHE = 0.04;
/** Combien de secondes d'affilée un défaut doit durer avant d'être dit en panne. */
export const SECONDES_AVANT_PANNE = 4;

export type VerdictDeVie = 'ok' | 'relancer' | 'panne';

/**
 * LE CONTRÔLE DE VIE (17/11/2026) : la bulle disait « je t'écoute » alors qu'aucun son ne partait. Nourri chaque seconde,
 * il rend « relancer » au premier signe d'un son coupé (contexte suspendu, traitement arrêté — l'écran tente alors de le
 * relancer), puis « panne » si le défaut dure : son arrêté, piste du micro finie, ou voix franche entendue sans que rien
 * ne parte. Le silence de l'utilisateur n'est JAMAIS une panne.
 */
export function creerControleDeVie(secondes = SECONDES_AVANT_PANNE): { juger(mesure: MesureDuMicro): VerdictDeVie; raison(): string } {
  let derniersBlocs = -1;
  let defaut = 0;
  let raison = '';
  return {
    juger(mesure) {
      const arrete = derniersBlocs >= 0 && mesure.blocs === derniersBlocs;
      derniersBlocs = mesure.blocs;
      const coupe = mesure.contexte !== 'running' || arrete;
      const muet = !coupe && mesure.entendu >= VOIX_FRANCHE && mesure.envoye < 0.001;
      if (mesure.pisteFinie) {
        raison = 'piste du micro finie';
        return 'panne';
      }
      if (!coupe && !muet) {
        defaut = 0;
        return 'ok';
      }
      defaut += 1;
      raison = coupe ? `son coupé (contexte ${mesure.contexte}${arrete ? ', traitement arrêté' : ''})` : 'voix entendue, rien envoyé';
      if (defaut >= secondes) return 'panne';
      return coupe ? 'relancer' : 'ok';
    },
    raison: () => raison,
  };
}
