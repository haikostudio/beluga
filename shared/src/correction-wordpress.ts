/**
 * CORRIGER CE QUE LA SURVEILLANCE WORDPRESS A DÉTECTÉ — les règles pures.
 *
 * Sous la liste des soucis du bloc « État WordPress », un bouton ouvre une
 * carte dans le projet du site et lui donne TOUT ce que le contrôle a relevé :
 * chaque souci avec sa phrase, sa version, sa cible et sa date d'apparition, le
 * rythme du contrôle, et où se trouve le site (copie de test comprise). Un agent
 * de cadrage étudie, rend sa compréhension puis le plan ; le plan ATTEND la
 * validation de l'utilisateur — rien n'est corrigé ni mis en ligne sans lui.
 *
 * Le serveur (`server/src/depannage-site.ts`) ouvre la carte et lance le tour.
 */

import type { SiteSurveille } from './surveillance.js';
import { phraseDePeriode, bornerPeriode } from './surveillance.js';
import { phraseDeLaCopieDeTest, phraseDuSouci, type SouciEnCours } from './surveillance-wordpress.js';

/** L'étiquette des cartes ouvertes pour corriger un site. */
export const LABEL_CORRECTION_SITE = 'correction à faire';

/** Le titre de la carte : « Corriger <site> ». */
export function titreDeCarteDeCorrection(nomDuSite: string): string {
  const nom = String(nomDuSite ?? '').replace(/\s+/g, ' ').trim() || 'un site surveillé';
  const court = nom.length > 46 ? `${nom.slice(0, 45)}…` : nom;
  return `Corriger ${court}`;
}

function jour(instant: number): string {
  if (!instant) return 'date inconnue';
  return new Date(instant).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/** La description de la carte, lue par quelqu'un qui ne programme pas. */
export function descriptionDeCarteDeCorrection(site: Pick<SiteSurveille, 'nom' | 'url'>, soucis: readonly SouciEnCours[]): string {
  const n = soucis.length;
  return (
    `La surveillance de ${site.nom} (${site.url}) a relevé ${n} point${n > 1 ? 's' : ''} à corriger. ` +
    'Un agent étudie chacun d’eux et propose un plan de correction, qui attend votre accord : ' +
    'rien n’est corrigé ni mis en ligne sans vous.'
  );
}

/**
 * LA DEMANDE ENVOYÉE À L'AGENT DE CADRAGE : l'ensemble des données détectées,
 * sans aucun secret (l'accès au serveur n'est qu'une référence au coffre-fort).
 * Elle exige l'ENQUÊTE puis le PLAN, et interdit `ask_user` pour ce qui se
 * vérifie soi-même.
 */
export function demandeDeCorrectionWordpress(entree: {
  site: SiteSurveille;
  soucis: readonly SouciEnCours[];
  projet: { nom: string; chemin: string; rattache: boolean; devine: boolean } | null;
}): string {
  const { site, soucis, projet } = entree;
  const wp = site.wordpress;
  const resume = site.wpResume;
  const lignes: string[] = [
    `L’UTILISATEUR DEMANDE DE CORRIGER CE QUE LA SURVEILLANCE A DÉTECTÉ sur ${site.nom} : ${soucis.length} point(s) relevé(s) par le contrôle WordPress.`,
    '',
    'LE SITE',
    `- nom : ${site.nom}`,
    `- adresse : ${site.url}`,
    `- état du site au dernier contrôle : ${site.etat}`,
    `- rythme des contrôles : ${phraseDePeriode(bornerPeriode(site.periodeMs))}`,
    ...(resume?.extensionsLe ? [`- extensions relevées le : ${jour(resume.extensionsLe)}${resume.extensions ? ` (${resume.extensions} extensions)` : ''}`] : []),
    ...(resume?.journauxLe ? [`- journaux lus le : ${jour(resume.journauxLe)}`] : []),
    ...(resume && !resume.faillesActives ? ['- failles connues non cherchées : la clé Wordfence manque au coffre-fort (les mises à jour et les extensions abandonnées restent fiables)'] : []),
    ...(wp
      ? [
          `- dossier de WordPress sur le serveur : ${wp.racine}`,
          `- outil en ligne de commande : ${wp.wpCli}`,
          `- journaux surveillés : ${wp.journaux.join(', ') || '(aucun)'}`,
          `- extensions attendues actives : ${wp.extensionsAttendues.join(', ') || '(aucune)'}`,
          `- accès au serveur : fiche « ${wp.acces.id} » du coffre-fort (aucun secret dans cette demande)`,
        ]
      : []),
    '',
    `CE QUI A ÉTÉ DÉTECTÉ (${soucis.length})`,
    ...soucis.map((s, i) => {
      const details = [
        `clé ${s.cle}`,
        `genre ${s.genre}`,
        s.version ? `version installée ${s.version}` : '',
        s.versionCible ? `version cible ${s.versionCible}` : '',
        s.nombre !== undefined ? `nombre ${s.nombre}` : '',
        s.habituel !== undefined ? `habituel ${s.habituel}` : '',
        `depuis ${jour(s.depuis)}`,
      ].filter(Boolean);
      return `${i + 1}. ${phraseDuSouci(s)}\n   (${details.join(' ; ')})`;
    }),
    '',
  ];
  if (projet) {
    lignes.push(
      `LE PROJET DE CE SITE : ${projet.nom} (${projet.chemin})`,
      projet.devine
        ? 'Il a été DEVINÉ d’après l’adresse du site : vérifie que c’est bien le bon dépôt, et dis-le si ce n’en est pas un.'
        : projet.rattache
          ? 'Il a été rattaché à la main sur la fiche du site : c’est le bon dépôt.'
          : 'Aucun projet n’est rattaché à ce site : cette carte s’est ouverte sur le tableau de Beluga Build, faute de mieux. Dis-le en toutes lettres, et cherche d’abord OÙ vit ce site.',
      '',
    );
  }
  lignes.push(
    'CE QUE TU FAIS MAINTENANT',
    '1. ÉTUDIE CHAQUE POINT POUR DE VRAI : ce qu’il touche, son risque, la correction exacte (mise à jour, désactivation, remplacement d’une extension abandonnée, cause d’une erreur dans les journaux), et dans quel ordre les traiter. Ce que tu n’as pas pu vérifier se dit comme non vérifié.',
    '2. RENDS CE QUE TU AS COMPRIS avec « rendre_comprehension », puis le plan de correction te sera demandé dans un second tour. Le plan attend la validation de l’utilisateur.',
    wp?.copieDeTest
      ? `3. ${phraseDeLaCopieDeTest(wp.copieDeTest, projet?.nom)} Le site en ligne reste en lecture seule jusqu’à la mise en production.`
      : '3. Le site en ligne reste en lecture seule : une correction se prépare sur la copie de test du projet, puis se rejoue à la mise en production.',
    '',
    'NE TOUCHE À AUCUN FICHIER pendant ce tour : tu comprends, puis tu proposes. Ce que seul l’utilisateur peut trancher se prépare dans le champ « questions » de « rendre_comprehension ».',
  );
  return lignes.join('\n');
}
