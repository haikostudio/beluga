import {
  ESSAIS_VECTEURS,
  DIMENSIONS_VECTEUR,
  LOT_VECTEURS,
  MODELE_VECTEURS,
  URL_VECTEURS,
  attenteAvantEssai,
  normaliserLeVecteur,
  reponseRejouable,
} from '@haikodev/shared';
import { lireVariableDEnvironnement } from './cle-cerveau.js';
import { log } from './logger.js';

/**
 * L'APPEL AU MODÈLE DE VECTORISATION — la seule partie qui touche au réseau.
 *
 * Les décisions (quel modèle, quelle taille, par quels lots, quand on bascule)
 * vivent dans `shared/src/vecteurs-doc.ts` et se testent seules. Ici, on appelle,
 * on retente une panne passagère, et surtout ON NE LÈVE JAMAIS : la recherche de
 * passages ne doit pas pouvoir faire tomber la préparation d'un tour. Sans clé,
 * sans réseau, sans réponse valable, on rend `undefined` et l'ancienne empreinte
 * de mots reprend son travail.
 *
 * La clé se lit comme celle du cerveau : l'environnement du démon d'abord, puis
 * `/etc/haikodev.env`. Deux noms sont acceptés, `HAIKODEV_EMBED_API_KEY` pour
 * une clé dédiée, `OPENROUTER_API_KEY` pour celle déjà posée sur la machine.
 */

/** Les noms sous lesquels la clé peut être posée, dans l'ordre où on les lit. */
export const NOMS_DE_CLE = ['HAIKODEV_EMBED_API_KEY', 'OPENROUTER_API_KEY'] as const;

/** La clé de vectorisation, ou rien. Jamais d'exception : c'est un service en plus. */
export function cleDesVecteurs(): string | undefined {
  for (const nom of NOMS_DE_CLE) {
    const valeur = lireVariableDEnvironnement(nom);
    if (valeur) return valeur;
  }
  return undefined;
}

/** L'adresse de la porte de vectorisation, réglable sans toucher au code. */
function urlDesVecteurs(): string {
  return lireVariableDEnvironnement('HAIKODEV_EMBED_URL') || URL_VECTEURS;
}

/** Le modèle réellement utilisé, réglable de la même façon. */
export function modeleDesVecteurs(): string {
  return lireVariableDEnvironnement('HAIKODEV_EMBED_MODEL') || MODELE_VECTEURS;
}

interface ReponseVecteurs {
  data?: { embedding: number[]; index: number }[];
  error?: { message?: string };
}

/**
 * UN LOT vectorisé. Une panne passagère (surcharge, 500, lien coupé) est
 * retentée après une attente qui double ; un refus franc (clé invalide, modèle
 * inconnu) ne l'est pas — le retenter ne ferait que retarder le repli.
 */
async function vectoriserUnLot(textes: string[], cle: string): Promise<number[][] | undefined> {
  const url = urlDesVecteurs();
  const modele = modeleDesVecteurs();
  for (let essai = 1; essai <= ESSAIS_VECTEURS; essai++) {
    try {
      const reponse = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cle}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://haikodev.haikostudio.cloud',
          'X-Title': 'HaikoDev',
        },
        body: JSON.stringify({ model: modele, input: textes, dimensions: DIMENSIONS_VECTEUR }),
      });
      if (!reponse.ok) {
        const detail = (await reponse.text()).slice(0, 300);
        if (!reponseRejouable(reponse.status)) {
          log.warn(`vectorisation refusée (${reponse.status}) : ${detail}`);
          return undefined;
        }
        throw new Error(`vectorisation ${reponse.status} : ${detail}`);
      }
      const json = (await reponse.json()) as ReponseVecteurs;
      if (!json.data?.length) {
        log.warn(`vectorisation sans données : ${json.error?.message ?? 'réponse vide'}`);
        return undefined;
      }
      const range = [...json.data].sort((a, b) => a.index - b.index);
      if (range.length !== textes.length) {
        log.warn(`vectorisation incomplète : ${range.length} vecteurs pour ${textes.length} textes`);
        return undefined;
      }
      return range.map((ligne) => normaliserLeVecteur(ligne.embedding));
    } catch (err) {
      if (essai >= ESSAIS_VECTEURS) {
        log.warn(`vectorisation abandonnée après ${essai} essais : ${(err as Error).message}`);
        return undefined;
      }
      await new Promise((suite) => setTimeout(suite, attenteAvantEssai(essai)));
    }
  }
  return undefined;
}

/**
 * LA VECTORISATION D'UNE LISTE DE TEXTES, par lots. Rend `undefined` dès qu'un
 * lot échoue : un index à moitié vectorisé se reconnaît (`COUVERTURE_VECTEURS_MIN`)
 * et retombe proprement sur les mots, alors qu'un index à moitié FAUX ne se
 * reconnaîtrait pas.
 */
export async function vectoriser(textes: string[]): Promise<number[][] | undefined> {
  if (!textes.length) return [];
  const cle = cleDesVecteurs();
  if (!cle) return undefined;

  const sortie: number[][] = [];
  for (let debut = 0; debut < textes.length; debut += LOT_VECTEURS) {
    const lot = textes.slice(debut, debut + LOT_VECTEURS);
    const vecteurs = await vectoriserUnLot(lot, cle);
    if (!vecteurs) return undefined;
    sortie.push(...vecteurs);
  }
  return sortie;
}

/**
 * LE VECTEUR D'UNE QUESTION, gardé en mémoire le temps du processus : la même
 * demande sert de question à chaque tour d'une carte, et la repayer à chaque
 * fois n'apporterait rien.
 */
const questionsVues = new Map<string, number[]>();
const QUESTIONS_GARDEES = 200;

export async function vectoriserLaQuestion(question: string): Promise<number[] | undefined> {
  const cle = question.trim();
  if (!cle) return undefined;
  const deja = questionsVues.get(cle);
  if (deja) return deja;
  const vecteurs = await vectoriser([cle]);
  const vecteur = vecteurs?.[0];
  if (!vecteur) return undefined;
  if (questionsVues.size >= QUESTIONS_GARDEES) {
    const premiere = questionsVues.keys().next().value;
    if (premiere !== undefined) questionsVues.delete(premiere);
  }
  questionsVues.set(cle, vecteur);
  return vecteur;
}

/** Ce que les réglages affichent : la vectorisation est-elle disponible ? */
export function etatDesVecteurs(): { clePosee: boolean; modele: string } {
  return { clePosee: !!cleDesVecteurs(), modele: modeleDesVecteurs() };
}
