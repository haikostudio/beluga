/**
 * LE COURRIEL D'UNE PANNE DE SITE — les règles pures.
 *
 * La surveillance avait deux canaux : la trame WebSocket de la première chute
 * (`texteAlerte`) et le web-push. Ni l'une ni l'autre ne survit à un écran
 * fermé : les services surveillés hors de Beluga Build s'étaient donc chacun
 * écrit leur propre contrôle à eux, avec son propre envoi de courriel — et deux
 * courriels PAR HEURE quand la panne durait, sans aucune mémoire du message
 * précédent.
 *
 * LE COURRIEL DEVIENT UN CANAL DE LA SURVEILLANCE, ET IL SE TAIT :
 *  1. RIEN AVANT `ECHECS_AVANT_COURRIEL` ÉCHECS D'AFFILÉE — le même compteur
 *     que le dépannage (`echecsDeSuiteDuSite`), pas un second.
 *  2. UN SEUL COURRIEL PAR PANNE — l'envoi est noté sur la fiche du site, et
 *     seul un contrôle réussi l'oublie.
 *  3. UN RAPPEL TOUTES LES `RAPPEL_COURRIEL_MS`, pas un par passage, tant que
 *     la panne dure.
 *  4. UN MOT QUAND TOUT EST REVENU, mais seulement si un courriel de panne
 *     était parti : sinon personne n'attend d'apaisement.
 *
 * Le serveur (`server/src/alerte-courriel-site.ts`) écrit et envoie par Resend ;
 * `server/src/surveillance.ts` compte, note la date AVANT l'envoi et déclenche.
 */

import { construireFragment } from './adresse-navigateur.js';
import { ADRESSE_ADMINISTRATION } from './courriels-clients.js';
import {
  blocAIcone,
  champ,
  courrielEnBlocs,
  echapper,
  lienEnClair,
  listeNumerotee,
  rangeeDeBoutons,
  texteAvecCodes,
  texteEnHtml,
} from './gabarit-courriel.js';
import type { ControleSurveillance, SiteSurveille } from './surveillance.js';
import {
  LIBELLE_RAISON,
  bornerPeriode,
  etapesDeRecetteSurveillance,
  phraseDePeriode,
  phraseDeRecetteSurveillance,
} from './surveillance.js';

/** Combien de contrôles ratés d'affilée avant d'écrire. Le seuil du dépannage. */
export const ECHECS_AVANT_COURRIEL = 3;

/**
 * L'écart entre deux courriels pour la MÊME panne. Une panne qui dure n'a rien
 * de neuf à dire toutes les cinq minutes ; un rappel deux fois par jour suffit
 * à ce qu'elle ne s'oublie pas.
 */
export const RAPPEL_COURRIEL_MS = 6 * 3_600_000;

/** Ce que la fiche d'un site garde de ses courriels d'alerte. */
export interface AlerteCourrielDuSite {
  /** Quand le dernier courriel est PARTI — posé avant l'envoi, jamais après. */
  alerteCourrielLe?: number;
  /** Le début de la panne ANNONCÉE par courriel. Absent : rien n'a été écrit. */
  alerteCourrielDepuis?: number;
}

export type RaisonDeNePasEcrire = 'pas-assez-d-echecs' | 'rappel-trop-recent';

export type GenreDeCourriel = 'panne' | 'rappel';

export type DecisionDeCourriel =
  | { ecrire: true; genre: GenreDeCourriel }
  | { ecrire: false; raison: RaisonDeNePasEcrire };

/**
 * CE SITE MÉRITE-T-IL UN COURRIEL ? Deux refus possibles : le compte d'échecs
 * n'y est pas encore, ou le dernier courriel de cette panne est trop récent.
 *
 * Le refus « rappel trop récent » se juge sur `alerteCourrielLe`, POSÉE AVANT
 * l'envoi : un envoi refusé par Resend ne se rejoue donc pas au contrôle
 * suivant, et un rappel en boucle est impossible.
 */
export function decisionDeCourrielDePanne(
  site: AlerteCourrielDuSite,
  echecsDeSuite: number,
  maintenant = Date.now(),
): DecisionDeCourriel {
  if (echecsDeSuite < ECHECS_AVANT_COURRIEL) return { ecrire: false, raison: 'pas-assez-d-echecs' };
  if (!site.alerteCourrielDepuis) return { ecrire: true, genre: 'panne' };
  const dernier = Number(site.alerteCourrielLe ?? 0);
  if (dernier && maintenant - dernier < RAPPEL_COURRIEL_MS) return { ecrire: false, raison: 'rappel-trop-recent' };
  return { ecrire: true, genre: 'rappel' };
}

/**
 * FAUT-IL DIRE QUE C'EST REVENU ? Seulement à qui a reçu la mauvaise nouvelle :
 * un site qui retombe et revient sans avoir atteint le seuil n'a jamais fait
 * partir de courriel, et n'en fait donc pas partir un second.
 */
export function doitApaiserParCourriel(site: AlerteCourrielDuSite): boolean {
  return !!site.alerteCourrielDepuis;
}

/* ------------------------------------------------------------------ */
/* Les textes                                                           */
/* ------------------------------------------------------------------ */

/** Une heure lisible, la même que dans le récit d'une carte de panne. */
function heure(instant: number): string {
  if (!instant) return 'heure inconnue';
  return new Date(instant).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/** Une durée en clair : « 3 h 20 min », « 14 min ». */
export function phraseDeDuree(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const heures = Math.floor(minutes / 60);
  const reste = minutes % 60;
  return reste ? `${heures} h ${reste} min` : `${heures} h`;
}

/** Le verdict d'un contrôle, en une ligne : ce qui a cassé, où, et ce qui est revenu. */
export function ligneDeVerdict(site: Pick<SiteSurveille, 'raison' | 'code' | 'etapeEchouee'>): string {
  const raison = site.raison ? LIBELLE_RAISON[site.raison] : 'Serveur injoignable';
  const code = site.code ? ` (code ${site.code})` : '';
  const etape = site.etapeEchouee ? ` — étape « ${site.etapeEchouee} »` : '';
  return `${raison}${code}${etape}`;
}

/** Le détail du dernier contrôle raté, quand il en dit plus que le verdict. */
function detailDuDernierEchec(controles: readonly ControleSurveillance[]): string | null {
  const dernier = [...controles].sort((a, b) => b.instant - a.instant).find((c) => c.etat === 'panne');
  const detail = dernier?.detail?.trim();
  return detail ? detail : null;
}

export interface CourrielDeSite {
  sujet: string;
  texte: string;
  html: string;
}

/**
 * LA FICHE DU SITE DANS BELUGA, ouverte directement : l'adresse décrite par
 * `adresse-navigateur.ts`, jamais un chemin recopié à la main.
 */
export function lienDeLaSurveillance(siteId: string): string {
  return `${ADRESSE_ADMINISTRATION}/#${construireFragment({ vue: 'surveillance', siteId })}`;
}

/** Les boutons de fin d'un courriel de surveillance : la fiche dans Beluga, puis le service lui-même. */
export function boutonsDeSurveillance(site: { id?: string; url: string }): string {
  return rangeeDeBoutons([
    ...(site.id ? [{ libelle: 'Voir dans Beluga', lien: lienDeLaSurveillance(site.id) }] : []),
    { libelle: 'Ouvrir le service', lien: site.url },
  ]);
}

/** Le bloc « Adresse du service », commun aux courriels de la surveillance. */
export function blocDAdresse(url: string): string {
  return blocAIcone({ icone: 'lien', teinte: 'gris', titre: 'Adresse du service', contenu: lienEnClair(url) });
}

/** La ligne du pied : qui surveille quoi. */
export function piedDeSurveillance(nom: string): string {
  return `Surveillance automatisée de ${nom}, par Beluga Build`;
}

/**
 * LE COURRIEL DE PANNE, ET SON RAPPEL. Il dit ce que la surveillance sait :
 * depuis quand, ce qui casse, ce que la recette vérifiait — et, quand la recette
 * porte une explication, le REMÈDE qui y a été écrit. C'est tout ce que les
 * anciens contrôles isolés apportaient, sans leur rafale.
 */
export function courrielDePanneDuSite(entree: {
  site: SiteSurveille;
  controles?: readonly ControleSurveillance[];
  echecsDeSuite: number;
  genre: GenreDeCourriel;
  maintenant?: number;
}): CourrielDeSite {
  const { site, genre } = entree;
  const maintenant = entree.maintenant ?? Date.now();
  const depuis = site.depuis || site.dernierePanne || maintenant;
  const detail = detailDuDernierEchec(entree.controles ?? []);
  const explication = site.recette?.explication?.trim();
  const sujet =
    genre === 'rappel'
      ? `${site.nom} est toujours en panne (${phraseDeDuree(maintenant - depuis)})`
      : `${site.nom} ne répond plus`;
  const lignes: string[] = [
    genre === 'rappel'
      ? `${site.nom} est toujours en panne, depuis ${phraseDeDuree(maintenant - depuis)} (${heure(depuis)}).`
      : `${site.nom} a raté ${entree.echecsDeSuite} contrôles d’affilée. La panne a commencé à ${heure(depuis)}.`,
    '',
    `Adresse : ${site.url}`,
    `Ce qui cloche : ${ligneDeVerdict(site)}`,
    ...(detail ? [`Détail du dernier contrôle : ${detail}`] : []),
    `Ce qui est vérifié : ${phraseDeRecetteSurveillance(site.recette ?? { type: 'appel' })}`,
    ...(explication ? ['', explication] : []),
    '',
    `Contrôlé ${phraseDePeriode(bornerPeriode(site.periodeMs))}. Dernier contrôle à ${heure(site.verifieLe)}.`,
    `Prochain courriel dans ${phraseDeDuree(RAPPEL_COURRIEL_MS)} au plus tôt, et un mot dès que tout est revenu.`,
  ];
  const duree = phraseDeDuree(maintenant - depuis);
  const verdict = blocAIcone({
    icone: 'alerte',
    teinte: 'rouge',
    titre: 'Ce qui cloche',
    contenu: texteAvecCodes(ligneDeVerdict(site)),
  });
  const html = courrielEnBlocs({
    titre: 'Surveillance',
    apercu: lignes[0],
    bandeau: {
      teinte: 'rouge',
      surtitre: 'Incident en cours',
      date: heure(maintenant),
      titre: genre === 'rappel' ? `${site.nom} est toujours en panne` : `${site.nom} ne répond plus`,
      texteHtml:
        genre === 'rappel'
          ? `En panne depuis <strong>${echapper(duree)}</strong> — début à ${echapper(heure(depuis))}.`
          : `<strong>${entree.echecsDeSuite} contrôles</strong> ratés d’affilée. La panne a commencé à ${echapper(heure(depuis))}.`,
      pastille: { libelle: `Incident en cours · ${duree}`, teinte: 'rouge' },
      illustration: genre === 'rappel' ? 'rappel' : 'panne',
    },
    ...(site.id ? { lienEnTete: { libelle: 'Voir dans Beluga', lien: lienDeLaSurveillance(site.id) } } : {}),
    blocs: [
      blocDAdresse(site.url),
      detail
        ? verdict + blocAIcone({ icone: 'document', teinte: 'gris', titre: 'Détail du dernier contrôle', contenu: texteAvecCodes(detail) })
        : verdict,
      blocAIcone({
        icone: 'liste',
        teinte: 'gris',
        titre: 'Ce qui est vérifié',
        contenu: listeNumerotee(etapesDeRecetteSurveillance(site.recette ?? { type: 'appel' })),
      }),
      ...(explication
        ? [blocAIcone({ icone: 'diagnostic', teinte: 'ambre', titre: 'Diagnostic probable', contenu: texteAvecCodes(explication) })]
        : []),
      blocAIcone({
        icone: 'horloge',
        teinte: 'gris',
        titre: 'Suivi et prochaines étapes',
        contenu:
          champ('Rythme', echapper(`Contrôlé ${phraseDePeriode(bornerPeriode(site.periodeMs))}. Dernier contrôle à ${heure(site.verifieLe)}.`)) +
          champ('Prochain courriel', echapper(`Dans ${phraseDeDuree(RAPPEL_COURRIEL_MS)} au plus tôt, et un mot dès que tout est revenu.`)) +
          boutonsDeSurveillance(site),
      }),
    ],
    pied: piedDeSurveillance(site.nom),
  });
  return { sujet, texte: lignes.join('\n'), html };
}

/** LE MOT DE FIN. Court : la panne est finie, voilà combien de temps elle a duré. */
export function courrielDeRetourDuSite(entree: {
  site: Pick<SiteSurveille, 'nom' | 'url'> & { id?: string };
  /** Le début de la panne annoncée par courriel. */
  panneDepuis?: number;
  maintenant?: number;
}): CourrielDeSite {
  const maintenant = entree.maintenant ?? Date.now();
  const duree = entree.panneDepuis ? phraseDeDuree(maintenant - entree.panneDepuis) : null;
  const lignes = [
    duree
      ? `${entree.site.nom} répond de nouveau. La panne a duré ${duree}.`
      : `${entree.site.nom} répond de nouveau.`,
    '',
    `Adresse : ${entree.site.url}`,
    `Rétabli à ${heure(maintenant)}.`,
  ];
  const html = courrielEnBlocs({
    titre: 'Surveillance',
    apercu: lignes[0],
    bandeau: {
      teinte: 'vert',
      surtitre: 'Service rétabli',
      date: heure(maintenant),
      titre: `${entree.site.nom} répond de nouveau`,
      ...(duree ? { texteHtml: `La panne a duré <strong>${echapper(duree)}</strong>.` } : {}),
      pastille: { libelle: 'Rétabli', teinte: 'vert' },
      illustration: 'retour',
    },
    ...(entree.site.id ? { lienEnTete: { libelle: 'Voir dans Beluga', lien: lienDeLaSurveillance(entree.site.id) } } : {}),
    blocs: [
      blocDAdresse(entree.site.url),
      blocAIcone({
        icone: 'coche',
        teinte: 'vert',
        titre: 'Retour à la normale',
        contenu: texteEnHtml(`Rétabli à ${heure(maintenant)}.`) + boutonsDeSurveillance(entree.site),
      }),
    ],
    pied: piedDeSurveillance(entree.site.nom),
  });
  return { sujet: `${entree.site.nom} répond de nouveau`, texte: lignes.join('\n'), html };
}
