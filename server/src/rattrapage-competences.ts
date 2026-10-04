/**
 * LE RATTRAPAGE DES COMPÉTENCES — côté démon (règles pures dans
 * `shared/src/rattrapage-competences.ts`).
 *
 * Pose UNE carte « Rattrapage des compétences » dans chaque projet actif qui a
 * du travail terminé à relire. Décision de l'utilisateur (2026-10-02) : tous les
 * projets d'un coup, un agent par projet, lancés ensemble. « Lancer » arme donc
 * chaque carte en « dès que possible » : c'est l'ordonnanceur qui les démarre,
 * échelonnées, selon la place et le quota — le même chemin qu'un départ demandé
 * à la main, avec ses portes.
 *
 * Le geste reste celui de l'utilisateur : il se demande à un agent (outil
 * « competences », action « rattrapage »), jamais de lui-même.
 */

import {
  COLONNES_DU_TRAVAIL_FAIT,
  LABEL_RATTRAPAGE,
  TITRE_RATTRAPAGE,
  consigneDeRattrapage,
  descriptionDuRattrapage,
  estUnRegroupement,
  projetsDuRattrapage,
  type ChoixDuRattrapage,
  type RunConfig,
} from '@beluga/shared';
import { bus } from './bus.js';
import { PATHS } from './config.js';
import * as store from './store.js';

/** Les colonnes où une carte de rattrapage est encore ouverte : elle attend ou travaille. */
const COLONNES_RANGEES = new Set<string>([...COLONNES_DU_TRAVAIL_FAIT]);

export interface BilanDuRattrapage {
  posees: { projet: string; cardId: string; cartesFaites: number }[];
  ecartes: { projet: string; raison: string }[];
  lancees: boolean;
}

/** Les projets du tableau, réduits à ce que la règle de choix demande. */
function candidats(): ChoixDuRattrapage {
  return projetsDuRattrapage(
    store.listProjects(true).map((projet) => {
      const cartes = store.listCards(projet.id);
      return {
        id: projet.id,
        nom: projet.name,
        archive: projet.archived,
        regroupement: estUnRegroupement(projet),
        cartesFaites: cartes.filter((c) => COLONNES_RANGEES.has(c.column)).length,
        rattrapageOuvert: cartes.some((c) => c.labels.includes(LABEL_RATTRAPAGE) && !COLONNES_RANGEES.has(c.column)),
      };
    }),
  );
}

/**
 * POSER (ET LANCER) LE RATTRAPAGE. `createCard` est passé en argument : il vit
 * dans `tools.ts`, qui importe déjà ce module — l'importer ici bouclerait.
 */
export function poserLeRattrapage(options: {
  lancer: boolean;
  run?: RunConfig;
  createCard: (projectId: string, input: Parameters<typeof import('./tools.js').createCard>[1]) => ReturnType<typeof import('./tools.js').createCard>;
}): BilanDuRattrapage {
  const { retenus, ecartes } = candidats();
  const bilan: BilanDuRattrapage = {
    posees: [],
    ecartes: ecartes.map(({ projet, raison }) => ({ projet: projet.nom, raison })),
    lancees: options.lancer,
  };
  for (const candidat of retenus) {
    const projet = store.getProject(candidat.id);
    if (!projet) continue;
    const carte = options.createCard(projet.id, {
      title: TITRE_RATTRAPAGE,
      description: descriptionDuRattrapage(candidat),
      // La demande ENTIÈRE part dans le prompt de lancement : la carte n'a pas
      // de cadrage, il n'y a rien à discuter — l'utilisateur a déjà tranché.
      briefing: consigneDeRattrapage({
        projet: { id: projet.id, nom: projet.name, chemin: projet.path, cartesFaites: candidat.cartesFaites },
        base: PATHS.db,
      }),
      labels: [LABEL_RATTRAPAGE],
      origin: 'agent',
      auteur: 'agent',
      run: options.run,
    });
    const armee = options.lancer
      ? store.saveCard({
          ...carte,
          scheduling: { ...(carte.scheduling ?? { asap: false, attempts: 0, restarts: 0 }), asap: true },
        })
      : carte;
    bus.emit({ type: 'card.upsert', card: armee });
    bilan.posees.push({ projet: projet.name, cardId: armee.id, cartesFaites: candidat.cartesFaites });
  }
  return bilan;
}

/** Le bilan, en clair, pour l'agent qui a demandé le rattrapage. */
export function texteDuBilanDeRattrapage(bilan: BilanDuRattrapage): string {
  const posees = bilan.posees.length
    ? `${bilan.posees.length} carte(s) « ${TITRE_RATTRAPAGE} » posée(s)${bilan.lancees ? ', armées pour partir dès que possible (l’ordonnanceur les échelonne selon la place et le quota)' : ' dans « Planifié », à lancer'} :\n` +
      bilan.posees.map((p) => `- ${p.projet} (${p.cartesFaites} carte(s) à relire)`).join('\n')
    : 'Aucune carte posée.';
  const ecartes = bilan.ecartes.length
    ? `\nProjets laissés de côté :\n${bilan.ecartes.map((e) => `- ${e.projet} : ${e.raison}`).join('\n')}`
    : '';
  return `${posees}${ecartes}`;
}
