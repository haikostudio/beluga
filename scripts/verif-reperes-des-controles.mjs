#!/usr/bin/env node
/*
 * UN CONTRÔLE NAVIGATEUR QUI VISE UN REPÈRE DISPARU EST AVEUGLE, ET PERSONNE NE LE SAIT.
 *
 * Contrôle STATIQUE, sans navigateur, sans base, sans moteur : il ne lit que des fichiers.
 *
 * POURQUOI. Les scripts `scripts/verif-*.mjs` cliquent sur des éléments repérés par un attribut
 * `data-…` (`[data-options-de-carte]`). Quand un écran change et que le repère disparaît de
 * `web/src`, le contrôle casse (ou, pire, saute son étape) sans qu'aucune vérification ne le dise.
 * Relevé du 12/11/2026 : 129 scripts sur 412 visaient au moins un repère introuvable.
 *
 * CE QUE FAIT LE CONTRÔLE. Il croise les `[data-…` cités par les scripts avec les attributs `data-…`
 * présents dans `web/src` et le dossier de l'extension Chrome, puis compare l'écart à la liste
 * EXCEPTIONS ci-dessous (l'existant, GELÉ). Il échoue seulement sur une NOUVELLE dérive :
 *   - un script vise un repère absent qui n'est pas dans ses exceptions ;
 *   - une exception ne correspond plus à rien (repère revenu, script supprimé) : à retirer,
 *     pour que la liste ne pourrisse pas.
 *
 * FAUX POSITIFS ÉCARTÉS. Un repère fabriqué (`dataset.maCle` → `data-ma-cle`, gabarit
 * `data-xxx-${…}`, `data-${…}`) compte comme présent ; les attributs posés par des bibliothèques
 * (Radix, vaul…) ne sont jamais jugés ; un repère qui finit par « - » est un préfixe, pas un repère.
 *
 * COMMANDES.
 *   node scripts/verif-reperes-des-controles.mjs           contrôle (code 1 sur nouvelle dérive)
 *   node scripts/verif-reperes-des-controles.mjs --liste   détail par script, exceptions comprises
 *   node scripts/verif-reperes-des-controles.mjs --figer   réécrit EXCEPTIONS depuis l'état actuel
 *                                                           (à relire : ne sert qu'à geler l'existant)
 *
 * Le contrôle vise le dépôt d'où il PART (`import.meta.url`), jamais un chemin en dur.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FICHIER = fileURLToPath(import.meta.url);

/** Où vivent les repères de l'interface. */
const DOSSIERS_DE_L_INTERFACE = ['web/src', 'extension-chrome'];
const EXTENSIONS_LUES = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.html', '.css']);

/** Attributs posés par des bibliothèques : jamais jugés comme absents. */
const PREFIXES_DE_BIBLIOTHEQUE = ['data-radix-', 'data-vaul-', 'data-sonner-', 'data-cmdk-', 'data-rmiz-'];
const REPERES_DE_BIBLIOTHEQUE = new Set(['data-state', 'data-slot', 'data-orientation', 'data-side', 'data-align', 'data-disabled', 'data-highlighted', 'data-motion', 'data-placeholder', 'data-selected', 'data-focused', 'data-mounted', 'data-removed']);

/* BEGIN EXCEPTIONS (réécrit par --figer) */
const DATE_DU_GEL = "13/11/2026";
const EXCEPTIONS = {
  "verif-adresse-nouveau-projet.mjs": { reperes: ["data-champ-dicte"] },
  "verif-archivage-partout.mjs": { reperes: ["data-colonne-en-route"] },
  "verif-assistant-global.mjs": { reperes: ["data-assistant-validation","data-bouton-fin-de-tache"] },
  "verif-backups.mjs": { reperes: ["data-backups-historique","data-backups-projets-toggle"] },
  "verif-bandeau-production.mjs": { reperes: ["data-anneau-colonne","data-anneau-progression","data-bouton-infos-publication","data-fermer-tiroir-production","data-onglet-tiroir-production","data-pied-rangee"] },
  "verif-barre-de-l-heure.mjs": { reperes: ["data-essai-barre"] },
  "verif-bas-du-fil.mjs": { reperes: ["data-file-attente-pastille"] },
  "verif-branches-regroupement.mjs": { reperes: ["data-branche-membre"] },
  "verif-cahier-des-charges.mjs": { reperes: ["data-cahier-avancement","data-cahier-des-charges","data-cahier-jauge","data-cahier-pause"] },
  "verif-cahier-du-plan.mjs": { reperes: ["data-cahier-bascule","data-cahier-replie","data-cahier-touchee"] },
  "verif-campagne-studio-et-mode.mjs": { reperes: ["data-interrupteur-creation","data-interrupteur-plan","data-interrupteur-realisation"] },
  "verif-canal-coupe.mjs": { reperes: ["data-toast-reconnecter"] },
  "verif-carte-en-question.mjs": { reperes: ["data-carte-en-route"] },
  "verif-carte-fil-cadrage.mjs": { reperes: ["data-boutons-plan","data-details-techniques","data-entete-plan","data-flux-cadrage","data-frise-parcours","data-plan-refuser","data-plan-valider","data-point-boutons-secondaires","data-point-copier","data-point-exporter","data-raison-du-geste","data-reglages-avant-lancement"] },
  "verif-carte-sans-suite.mjs": { reperes: ["data-repondre-carte"] },
  "verif-cartes-systeme-terminees.mjs": { reperes: ["data-bande-productions","data-compte-en-route","data-liste-terminee","data-systeme-non-lu"] },
  "verif-colonne-en-cours.mjs": { reperes: ["data-pile"] },
  "verif-commandes-slash.mjs": { reperes: ["data-commande-reconnue"] },
  "verif-communication-v2.mjs": { reperes: ["data-communication-rond-chef","data-tete-en-place","data-v2-aller-au-plan","data-v2-assistant","data-v2-barre-rond","data-v2-etapes-du-haut","data-v2-grille-periode","data-v2-jour-programme","data-v2-lancer-plan","data-v2-ouvrir-etude","data-v2-pas-assistant","data-v2-plan","data-v2-preparer-plan","data-v2-renvoi-plan","data-v2-retirer"] },
  "verif-comprehension-en-points.mjs": { reperes: ["data-comprehension-bascule","data-comprehension-technique-bascule","data-hypotheses"] },
  "verif-comprehension-structuree.mjs": { reperes: ["data-volet-bascule"] },
  "verif-config-projet.mjs": { reperes: ["data-base-production","data-consignes-deploiement","data-effacer-projet","data-etape-agent","data-etapes-agent","data-generer-deploiement","data-generer-production","data-type-cible"] },
  "verif-contexte-envoye.mjs": { reperes: ["data-contexte-envoye"] },
  "verif-couts-du-projet.mjs": { reperes: ["data-tableau-jetons"] },
  "verif-curseur-pastilles-selecteur.mjs": { reperes: ["data-pastille-projet","data-recherche-tiroir-projets","data-tiroir-projets","data-tiroir-projets-vide"] },
  "verif-defilement-tableau.mjs": { reperes: ["data-disposition-tableau"] },
  "verif-degrade-bande-et-colonnes.mjs": { reperes: ["data-cadre-colonne"] },
  "verif-depannage-bon-volet.mjs": { reperes: ["data-onglet-production","data-onglets-production"] },
  "verif-depart-programme.mjs": { reperes: ["data-depart-nouvelle-carte"] },
  "verif-deux-volets-de-publication.mjs": { reperes: ["data-deux-colonnes"] },
  "verif-duree-des-gestes.mjs": { reperes: ["data-comprehension-technique","data-comprehension-technique-bascule","data-volet-bascule"] },
  "verif-ecran-connaissances.mjs": { reperes: ["data-assistant-global-rond","data-memoire-confirmer","data-memoire-importer","data-memoire-regenerer"] },
  "verif-en-route.mjs": { reperes: ["data-anciennete-carte","data-apercu-glisse-en-route","data-carte-archivee-sans-mise-en-ligne","data-compte-en-cours","data-compte-en-route","data-etape-libelle","data-etiquettes-carte","data-liste-a-terminer","data-liste-en-route","data-liste-terminee","data-onglets-en-route","data-pile-agents-colonne","data-rail-en-route","data-suite-en-route","data-tout-archiver-en-route"] },
  "verif-espace-client.mjs": { reperes: ["data-attente-de","data-avancer","data-basculer-discussion","data-carrousel","data-champ-type","data-fermer-pieces","data-filtre-attente","data-filtre-type","data-nouveaute-vignette","data-poignee-demande","data-porte","data-reculer","data-type-demande","data-volet-ancre"] },
  "verif-espace-dev.mjs": { reperes: ["data-compteur-non-consulte"] },
  "verif-espace-messagerie.mjs": { reperes: ["data-bande-icones","data-destination-bande"] },
  "verif-etapes-illustrees.mjs": { reperes: ["data-trace-bascule"] },
  "verif-extension-chrome.mjs": { reperes: ["data-comparer","data-extraire","data-outils"] },
  "verif-fil-de-publication.mjs": { reperes: ["data-message-id","data-processus-etapes"] },
  "verif-haiko-chat.mjs": { reperes: ["data-mon-nom"] },
  "verif-indicateur-comprehension.mjs": { reperes: ["data-avis-avant-lancement","data-avis-du-juge","data-avis-sur-le-plan","data-effort-propose"] },
  "verif-indicateurs-de-projet.mjs": { reperes: ["data-loupe-projets","data-menu-des-projets","data-tiroir-projets"] },
  "verif-initialisation-production.mjs": { reperes: ["data-base-production","data-card-id","data-etude-apercu","data-etude-processus","data-etude-voir-plus","data-fermer-tiroir-production","data-info","data-liste-terminee","data-miroir-public","data-onglet-tiroir-production","data-processus-branche","data-prompt-production","data-systeme-non-lu","data-tiroir-etude-processus","data-type-cible-production"] },
  "verif-interface-maison.mjs": { reperes: ["data-bouton-central","data-tiroir-du-bas"] },
  "verif-langues.mjs": { reperes: ["data-theme-menu"] },
  "verif-liste-des-agents.mjs": { reperes: ["data-colonne-de-page","data-ligne-tableau-de-bord","data-liste-archives","data-options-de-carte","data-titre-archives"] },
  "verif-lot-production.mjs": { reperes: ["data-bouton-fin-de-tache"] },
  "verif-marketing.mjs": { reperes: ["data-marketing-champ","data-marketing-fiche","data-marketing-fiche-enregistrer","data-marketing-onglet","data-marketing-texte"] },
  "verif-media-vers-piste.mjs": { reperes: ["data-apercu-piece","data-copie-alpha","data-zone-defilement"] },
  "verif-medias-livres.mjs": { reperes: ["data-medias-livres","data-medias-livres-tout-telecharger","data-piece-ambiance","data-tableau-ambiance"] },
  "verif-menu-carte.mjs": { reperes: ["data-liste-archives"] },
  "verif-menus-et-mises-en-ligne.mjs": { reperes: ["data-bande-productions","data-mises-en-ligne"] },
  "verif-messagerie-mobile.mjs": { reperes: ["data-onglet-colonne","data-projets-client"] },
  "verif-mode-realisation.mjs": { reperes: ["data-card-id","data-chemin-pret","data-chemin-suivant","data-communication-medias-vide","data-enveloppe-apercus","data-interrupteur-creation","data-interrupteur-plan","data-interrupteur-realisation","data-realisation-avancement","data-realisation-etat","data-realisation-eteindre","data-realisation-genre","data-realisation-jauge","data-realisation-lancer","data-realisation-pause","data-realisation-reprendre","data-relais-realisation","data-tableau-ambiance","data-trait-chemin","data-zone-defilement"] },
  "verif-notifications-poussees.mjs": { reperes: ["data-tags-carte"] },
  "verif-notifications.mjs": { reperes: ["data-surveillance-ajouter","data-surveillance-nom","data-surveillance-url","data-tiroir-agent"] },
  "verif-nouvel-agent-tableau-de-bord.mjs": { reperes: ["data-zone-defilement"] },
  "verif-onglet-actif-et-ligne-plan.mjs": { reperes: ["data-reglages-avant-lancement"] },
  "verif-parcours-complet-telephone.mjs": { reperes: ["data-communication-conversation"] },
  "verif-parcours-en-direct.mjs": { reperes: ["data-flux-cadrage","data-point-traces-contenu","data-reglages-avant-lancement"] },
  "verif-parcours-telephone.mjs": { reperes: ["data-cale-essai","data-entete-maitre","data-tags-carte"] },
  "verif-pastille-non-consulte.mjs": { reperes: ["data-liste-en-route","data-repere-termine","data-signal-termine"] },
  "verif-pied-du-tiroir.mjs": { reperes: ["data-bouton-fin-de-tache","data-tiroir-fin-de-tache"] },
  "verif-plan-en-volet-telephone.mjs": { reperes: ["data-niveau-plan","data-pied-plan","data-plan-ouvrir-volet","data-plan-refuser","data-plan-valider","data-volet-plan-corps","data-volet-plan-pied"] },
  "verif-plan-replie-et-programmation.mjs": { reperes: ["data-bloc-du-plan-bascule","data-boutons-plan","data-entete-plan","data-niveau-plan","data-pied-plan","data-plan-refuser","data-plan-valide","data-plan-valider","data-retour-au-point"] },
  "verif-plaquette.mjs": { reperes: ["data-lx-envoyer","data-lx-zoom","data-lx-zoom-option","data-lx-zoom-plus","data-lx-zoom-valeur","data-plaquette-bulle","data-plaquette-compteur","data-plaquette-fil"] },
  "verif-polices-veille-anciens-outils.mjs": { reperes: ["data-liste-deroulante-panneau"] },
  "verif-production-groupe.mjs": { reperes: ["data-bande-productions","data-liste-en-route","data-liste-terminee"] },
  "verif-publication-reseaux.mjs": { reperes: ["data-communication-canaux","data-communication-champ-reponse","data-communication-fil-ouvert","data-communication-non-lu","data-marketing-cible","data-marketing-ou-publier","data-marketing-publier-maintenant"] },
  "verif-question-fermee-avec-la-carte.mjs": { reperes: ["data-liste-archives","data-repondre-carte"] },
  "verif-questions-en-attente.mjs": { reperes: ["data-tags-carte"] },
  "verif-rapport-plan.mjs": { reperes: ["data-entete-rapport-plan","data-entree-sommaire-plan"] },
  "verif-reglages-carte.mjs": { reperes: ["data-preparation-chef"] },
  "verif-reglages-nettoyes.mjs": { reperes: ["data-disposition-tableau"] },
  "verif-relais-installations.mjs": { reperes: ["data-ce-qui-part","data-identifiant-installation","data-partage-statistiques"] },
  "verif-repli-fin-de-tour.mjs": { reperes: ["data-message-id","data-panneau-question"] },
  "verif-responsable-creatif.mjs": { reperes: ["data-actions-piece","data-corriger-avec-agent","data-interrupteur-realisation","data-menu-realisation","data-modifier-piece","data-onglet-suivi","data-onglets-du-suivi","data-pagination-formulaire"] },
  "verif-retouches-3d.mjs": { reperes: ["data-cible-du-visage"] },
  "verif-retouches-colonne.mjs": { reperes: ["data-archives-de-plus","data-ligne-tableau-de-bord","data-silhouette-taches","data-voir-archives"] },
  "verif-retouches-espace-client.mjs": { reperes: ["data-basculer-archivees","data-toasts-client","data-volet-ancre"] },
  "verif-retouches-pages-de-service.mjs": { reperes: ["data-communication-entete"] },
  "verif-retouches-services.mjs": { reperes: ["data-communication-canaux","data-retour-de-colonne"] },
  "verif-retour-du-studio.mjs": { reperes: ["data-branche-membre","data-studio-calque-notes","data-studio-calques","data-studio-colonne-calques","data-studio-editeur-calques","data-studio-gestes-creation","data-studio-panneau-notes","data-zone-silhouette"] },
  "verif-rien-ne-fige-a-l-envoi.mjs": { reperes: ["data-point-rang-lu"] },
  "verif-signal-attention.mjs": { reperes: ["data-attention-conversation","data-compteur-non-consulte"] },
  "verif-silhouettes-chargement.mjs": { reperes: ["data-silhouette-colonne","data-silhouette-onglets"] },
  "verif-sortie-archive.mjs": { reperes: ["data-bouton-fin-de-tache"] },
  "verif-statistiques-script.mjs": { reperes: ["data-beluga-bandeau","data-r"] },
  "verif-statistiques-tableau.mjs": { reperes: ["data-stats-choix-vide","data-stats-selecteur"] },
  "verif-statistiques.mjs": { reperes: ["data-beluga-bandeau","data-periode-champ","data-r","data-stats-recherche-effacer"] },
  "verif-studio-discussion.mjs": { reperes: ["data-interrupteur-creation","data-interrupteur-plan","data-interrupteur-realisation"] },
  "verif-studio-voix-par-phrase.mjs": { reperes: ["data-seg"] },
  "verif-suppositions-du-cadrage.mjs": { reperes: ["data-hypotheses","data-supposition"] },
  "verif-suppression-projet.mjs": { reperes: ["data-effacer-projet"] },
  "verif-surveillance.mjs": { reperes: ["data-surveillance-url"] },
  "verif-temoin-pendant-commandes.mjs": { reperes: ["data-steps"] },
  "verif-terminal-volet.mjs": { reperes: ["data-projet-actif","data-terminal-bouton-tableau","data-terminal-pastille"] },
  "verif-tete-colonne-figee.mjs": { reperes: ["data-colonne-de-page"] },
  "verif-themes.mjs": { reperes: ["data-favicon","data-pastille-projet"] },
  "verif-tiroir-carte-telephone.mjs": { reperes: ["data-tags-carte"] },
  "verif-tiroir-deploiement.mjs": { reperes: ["data-deux-colonnes","data-fil-compte","data-groupe-production","data-pile-groupe"] },
  "verif-visionneuse.mjs": { reperes: ["data-ligne-tableaux-de-bord"] },
  "verif-voile-et-liste-des-projets.mjs": { reperes: ["data-emplacement-reglages","data-epingler-projet","data-groupe-du-menu","data-recherche-tiroir-projets","data-tiroir-projets"] },
  "verif-volet-du-cahier.mjs": { reperes: ["data-cahier-avancement","data-cahier-des-charges","data-cahier-jauge","data-cahier-pause","data-cahier-reprendre","data-options-de-carte"] },
};
/* END EXCEPTIONS */

function lireRecursif(dossier, sortie = []) {
  if (!fs.existsSync(dossier)) return sortie;
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    if (entree.name === 'node_modules' || entree.name === 'dist') continue;
    const chemin = path.join(dossier, entree.name);
    if (entree.isDirectory()) lireRecursif(chemin, sortie);
    else if (EXTENSIONS_LUES.has(path.extname(entree.name))) sortie.push(chemin);
  }
  return sortie;
}

const enKebab = (camel) => camel.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Repères présents dans une suite de sources : attributs écrits, dataset.xxx, préfixes de gabarit. */
export function relevePresents(sources) {
  const exacts = new Set();
  const prefixes = new Set(); // `data-xxx-${…}` : tout repère commençant par xxx- est réputé posé
  let toutDynamique = false; // `data-${…}`
  for (const source of sources) {
    for (const m of source.matchAll(/data-[a-z0-9]+(?:-[a-z0-9]+)*(-\$\{|-?)/g)) {
      if (m[1] === '-${') prefixes.add(m[0].slice(0, -2));
      else exacts.add(m[0]);
    }
    for (const m of source.matchAll(/dataset\.([A-Za-z][A-Za-z0-9]*)/g)) exacts.add(`data-${enKebab(m[1])}`);
    for (const m of source.matchAll(/dataset\[\s*['"`]([A-Za-z][A-Za-z0-9]*)/g)) exacts.add(`data-${enKebab(m[1])}`);
    if (/data-\$\{/.test(source)) toutDynamique = true;
  }
  return { exacts, prefixes, toutDynamique };
}

function estDeBibliotheque(repere) {
  return REPERES_DE_BIBLIOTHEQUE.has(repere) || PREFIXES_DE_BIBLIOTHEQUE.some((p) => repere.startsWith(p));
}

export function estPresent(repere, presents) {
  if (estDeBibliotheque(repere) || presents.exacts.has(repere)) return true;
  // Un gabarit `data-xxx-${…}` pose tout repère `data-xxx-…`.
  return [...presents.prefixes].some((p) => repere.startsWith(p));
}

/** Repères visés par un script : `[data-…`, sans les préfixes (finissant par « - »). */
export function reperesVises(source) {
  const trouves = new Set();
  for (const m of source.matchAll(/\[(data-[a-z0-9]+(?:-[a-z0-9]+)*)(-?)/g)) {
    if (!m[2]) trouves.add(m[1]);
  }
  // Un repère que le script pose lui-même (page fabriquée : `<div data-t="x">`) n'est pas visé.
  for (const m of source.matchAll(/(?<!\[)\b(data-[a-z0-9]+(?:-[a-z0-9]+)*)(?=[=\s>'"`])/g)) trouves.delete(m[1]);
  return trouves;
}

/** Pour chaque script : ses repères absents (map nom → tableau trié). `scripts` : { nom: source }. */
export function reperesAbsents(scripts, presents) {
  const absents = {};
  for (const [nom, source] of Object.entries(scripts)) {
    const manquants = [...reperesVises(source)].filter((r) => !estPresent(r, presents)).sort();
    if (manquants.length) absents[nom] = manquants;
  }
  return absents;
}

/** Compare à l'existant gelé : nouvelles dérives et exceptions périmées. */
export function comparer(absents, exceptions) {
  const nouveaux = [];
  const perimes = [];
  for (const [nom, manquants] of Object.entries(absents)) {
    const connus = new Set(exceptions[nom]?.reperes ?? []);
    const neufs = manquants.filter((r) => !connus.has(r));
    if (neufs.length) nouveaux.push({ nom, reperes: neufs });
  }
  for (const [nom, e] of Object.entries(exceptions)) {
    const encore = new Set(absents[nom] ?? []);
    const finis = e.reperes.filter((r) => !encore.has(r));
    if (finis.length) perimes.push({ nom, reperes: finis });
  }
  return { nouveaux, perimes };
}

function chargerLeDepot() {
  const sourcesInterface = DOSSIERS_DE_L_INTERFACE.flatMap((d) => lireRecursif(path.join(RACINE, d))).map((f) => fs.readFileSync(f, 'utf8'));
  const presents = relevePresents(sourcesInterface);
  const dossierScripts = path.join(RACINE, 'scripts');
  const scripts = {};
  for (const nom of fs.readdirSync(dossierScripts).sort()) {
    if (/^verif-.*\.mjs$/.test(nom) && !nom.endsWith(".test.mjs") && path.join(dossierScripts, nom) !== FICHIER) {
      scripts[nom] = fs.readFileSync(path.join(dossierScripts, nom), 'utf8');
    }
  }
  return { presents, scripts };
}

function principal() {
  const args = process.argv.slice(2);
  const { presents, scripts } = chargerLeDepot();
  const absents = reperesAbsents(scripts, presents);

  if (args.includes('--figer')) {
    const lignes = Object.entries(absents).map(([nom, r]) => `  ${JSON.stringify(nom)}: { reperes: ${JSON.stringify(r)} },`);
    const bloc = `/* BEGIN EXCEPTIONS (réécrit par --figer) */\nconst DATE_DU_GEL = ${JSON.stringify(new Date().toLocaleDateString('fr-FR'))};\nconst EXCEPTIONS = {\n${lignes.join('\n')}\n};\n/* END EXCEPTIONS */`;
    const source = fs.readFileSync(FICHIER, 'utf8');
    const debut = source.indexOf('/* BEGIN EXCEPTIONS');
    const finMarque = '/* END EXCEPTIONS */';
    const fin = source.indexOf(finMarque) + finMarque.length;
    fs.writeFileSync(FICHIER, source.slice(0, debut) + bloc + source.slice(fin));
    console.log(`${Object.keys(absents).length} script(s) gelé(s) dans EXCEPTIONS.`);
    return 0;
  }

  const { nouveaux, perimes } = comparer(absents, EXCEPTIONS);
  const total = Object.keys(scripts).length;
  console.log('\nREPÈRES DES CONTRÔLES NAVIGATEUR\n');
  console.log(`  ${total} script(s) verif-*.mjs lus, ${Object.keys(absents).length} visent au moins un repère absent.`);
  console.log(`  ${Object.keys(EXCEPTIONS).length} exception(s) gelée(s) le ${DATE_DU_GEL}.`);

  if (args.includes('--liste')) {
    console.log('');
    for (const [nom, r] of Object.entries(absents)) console.log(`   ${nom} — ${r.join(', ')}`);
  }

  const renomme = Object.entries(absents).filter(([, r]) => r.includes('data-ouvrir-coffre')).length;
  if (renomme) console.log(`  NOTE ${renomme} script(s) visent data-ouvrir-coffre, renommé data-studio-ouvrir-coffre (non réparé ici).`);

  if (nouveaux.length) {
    console.log(`\n ÉCHEC ${nouveaux.length} script(s) visent un repère introuvable dans web/src ou l'extension :\n`);
    for (const n of nouveaux) console.log(`   - ${n.nom} — ${n.reperes.join(', ')}`);
    console.log("\n  Répare le script (repère renommé ?) ou, si l'écran est retiré, supprime le script.\n  N'ajoute JAMAIS un repère à EXCEPTIONS pour faire taire une dérive nouvelle.\n");
  }
  if (perimes.length) {
    console.log(`\n ÉCHEC ${perimes.length} exception(s) ne correspondent plus à rien (repère revenu ou script supprimé) :\n`);
    for (const n of perimes) console.log(`   - ${n.nom} — ${n.reperes.join(', ')}`);
    console.log('\n  Retire-les de EXCEPTIONS (node scripts/verif-reperes-des-controles.mjs --figer regèle tout l\'existant).\n');
  }
  if (nouveaux.length || perimes.length) return 1;
  console.log('\n  OK   aucune nouvelle dérive de repère.\n');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === FICHIER) process.exit(principal());
