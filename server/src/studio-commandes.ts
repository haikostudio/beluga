import fs from 'node:fs';
import {
  type FormatStudio,
  type OperationStudio,
  VOIX_FINALES_STUDIO,
  VOIX_ELEVENLABS_STUDIO,
  dureeExportee,
  estFormatStudio,
  voixPasFinales,
  compositionVide,
  cleDesModelesChoisis,
  lireModelesChoisis,
} from '@beluga/shared';
import { PREFIXE_COPIE_ALPHA, type CopieAlphaDApercu } from '@beluga/shared';
import { assurerLesCopiesAlpha } from './studio-copie-alpha.js';
import { fondsRetiresDuProjet } from './studio-fond.js';
import { getDb } from './db.js';
import { getMeta } from './db.js';
import { cleDuService } from './studio-services.js';
import * as store from './store.js';
import {
  adresseSigneeDuMedia,
  annuler,
  appliquerOperationStudio,
  assurerEspaceStudio,
  compositionCourante,
  creerCreation,
  deciderDepense,
  dupliquerCreation,
  ecrireEspaceStudio,
  ecrireSelection,
  ajouterNote,
  jalonsDeLaCreation,
  listerNotes,
  marquerNote,
  poserUnJalon,
  supprimerNote,
  etatAnnulerRetablir,
  historique,
  lireCreation,
  lireMedia,
  listerCreations,
  viderLesExports,
  listerDepenses,
  listerExports,
  listerMedias,
  modifierCreation,
  reglerAgentDeLaCreation,
  modifierMedia,
  restaurer,
  retablir,
  supprimerCreation,
  lireSelection,
  supprimerMedia,
  totalDepense,
} from './studio.js';
import { annulerExport, lancerExport, mediasCites, outilsDeRendu } from './studio-rendu.js';
import {
  devisDesVoix,
  extraitsDisponibles,
  fabriquerVoixEssai,
  fabriquerVoixManquantes,
  importerPieceJointeMesuree,
  soldeOpenRouter,
  validerVoixFinales,
  voixDEssaiDisponibles,
} from './studio-generation.js';
import { lancerAgentStudio } from './assistant-studio.js';
import { bibliothequeCommune, calerLesPlansSurLeRythme, couperAuTexte, declinerEnLangue, envoyerVersReseaux, motsDuMedia, rythmeDeLaCreation } from './studio-gestes-avances.js';
import { copierModele, creerDepuisModele, listerModeles, modeleDeLaCreation, resumeDuModele, supprimerModele, validerCreationEnModele } from './studio-modeles.js';

/**
 * LES COMMANDES DE L'ÉCRAN DU STUDIO (`studio.*`, `shared/src/protocol.ts`).
 * Chaque geste est rendu tel qu'il s'est passé : un refus lève une erreur que
 * l'écran affiche, jamais un succès de façade.
 */

function ou<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error((r as unknown as { raison: string }).raison);
  return r as Extract<T, { ok: true }>;
}

/** Une création ouverte : tout ce que l'éditeur affiche, en une lecture. */
export function creationOuverte(id: string) {
  const creation = lireCreation(id);
  const composition = compositionCourante(id);
  if (!creation || !composition) throw new Error('création introuvable');
  const espace = assurerEspaceStudio(creation.projectId);
  const medias = listerMedias(creation.projectId, creation.id);
  // Les adresses SIGNÉES de tout ce que l'aperçu peut citer : la bibliothèque et les sons de la création.
  const ids = new Set([...medias.map((m) => m.id), ...mediasCites(composition, espace.kit.logoMediaId)]);
  const adressesMedias: Record<string, { url: string; genre: string; copieAlpha?: CopieAlphaDApercu }> = {};
  for (const mid of ids) {
    const m = lireMedia(mid);
    if (m && m.projectId === creation.projectId && m.attachmentId) adressesMedias[mid] = { url: adresseSigneeDuMedia(creation.id, mid), genre: m.genre };
  }
  /* LA COPIE D'UNE VIDÉO TRANSPARENTE : l'aperçu de Safari et de l'iPhone, qui ne lisent pas son alpha. */
  for (const l of getDb().prepare("SELECT id, categorie, largeur, hauteur FROM studio_medias WHERE project_id = ? AND categorie LIKE 'copie-alpha:%'").all(creation.projectId) as { id: string; categorie: string; largeur: number | null; hauteur: number | null }[]) {
    const video = adressesMedias[l.categorie.slice(PREFIXE_COPIE_ALPHA.length)];
    if (video && l.largeur && l.hauteur) video.copieAlpha = { url: adresseSigneeDuMedia(creation.id, l.id), largeur: l.largeur, hauteur: l.hauteur };
  }
  /* Celles qui manquent se fabriquent en tâche de fond ; l'écran est prévenu à la sortie de chacune. */
  assurerLesCopiesAlpha(creation.id, creation.projectId, mediasCites(composition, espace.kit.logoMediaId));
  const outils = outilsDeRendu();
  return {
    creation,
    composition,
    projet: store.getProject(creation.projectId)?.name ?? '',
    annulerRetablir: etatAnnulerRetablir(id),
    medias,
    adressesMedias,
    /* Le lien entre les fichiers détourés et leurs originaux : les menus en déduisent « Retirer » ou « Remettre le fond ». */
    fondsRetires: fondsRetiresDuProjet(creation.projectId),
    exports: listerExports(id),
    /* Les notes posées sur l'image, et les versions nommées (`shared/src/studio-montage-avance.ts`). */
    notes: listerNotes(id),
    /* La tête de lecture laissée la dernière fois : l'aperçu s'y rouvre (`shared/src/studio-ouverture.ts`). */
    curseurRetenu: lireSelection(id).curseur,
    jalons: jalonsDeLaCreation(id),
    depenses: listerDepenses(id),
    depenseTotale: totalDepense(id),
    espace,
    voixEssai: voixDEssaiDisponibles(),
    voixFinales: [
      ...VOIX_FINALES_STUDIO.map((v) => ({ id: v.id, label: v.id, genre: v.genre, timbre: v.timbre })),
      // Les voix ElevenLabs passent par kie.ai : proposées dès que sa clé est au coffre.
      ...(cleDuService('kie') ? VOIX_ELEVENLABS_STUDIO.map((v) => ({ id: v.id, label: v.nom, genre: v.genre, fournisseur: 'elevenlabs' as const })) : []),
    ],
    voixEnEssai: voixPasFinales(composition).length,
    rendu: { pret: !!outils.hyperframes && !!outils.gsap },
    /* Le modèle de CETTE création (« Garder comme modèle », fenêtre « Mettre en production »), et ceux du projet. */
    modele: (() => {
      const m = modeleDeLaCreation(creation.id);
      return m ? { id: m.id, version: m.version, majLe: m.majLe } : null;
    })(),
    modeles: listerModeles(creation.projectId).map(resumeDuModele),
    /* Les modèles retenus par type de fabrication (voix, musique, image, vidéo) : le choix de l'utilisateur, imposé aux devis. */
    modelesChoisis: lireModelesChoisis(getMeta(cleDesModelesChoisis(creation.id))),
    projets: store
      .listProjects()
      .filter((p) => !p.archived)
      .map((p) => ({ id: p.id, name: p.name })),
  };
}

function formatsRecus(valeur: unknown): FormatStudio[] {
  return Array.isArray(valeur) ? (valeur.filter(estFormatStudio) as FormatStudio[]) : [];
}

export async function traiterCommandeStudio(cmd: any): Promise<unknown> {
  switch (cmd.type as string) {
    case 'studio.lister': {
      const creations = listerCreations(cmd.projectId || undefined).map((c) => {
        const composition = compositionCourante(c.id);
        return {
          ...c,
          projet: store.getProject(c.projectId)?.name ?? '',
          duree: composition ? dureeExportee(composition) : 0,
          voixEnEssai: composition ? voixPasFinales(composition).length : 0,
        };
      });
      const projets = store
        .listProjects()
        .filter((p) => !p.archived)
        .map((p) => ({ id: p.id, name: p.name }));
      return { creations, projets };
    }

    case 'studio.espace.ecrire': {
      if (!store.getProject(String(cmd.projectId ?? ''))) throw new Error('projet introuvable');
      return { espace: ecrireEspaceStudio(String(cmd.projectId), cmd) };
    }

    case 'studio.polices.ajouter': {
      const projectId = String(cmd.projectId ?? '');
      if (!store.getProject(projectId)) throw new Error('projet introuvable');
      const piece = store.getAttachment(String(cmd.attachmentId ?? ''));
      if (!piece || piece.projectId !== projectId) throw new Error('fichier introuvable');
      const { cheminDePieceJointe } = await import('./pieces-jointes.js');
      const { familleDuNomDeFichier, importerUnFichierDePolice } = await import('./studio-polices.js');
      const famille = typeof cmd.famille === 'string' && cmd.famille.trim() ? cmd.famille.trim() : familleDuNomDeFichier(piece.name);
      const r = importerUnFichierDePolice(projectId, { famille, contenu: fs.readFileSync(cheminDePieceJointe(piece)), nom: piece.name, source: 'fichier', origine: piece.name });
      if (!r.ok) throw new Error(r.raison);
      return { police: r.police, espace: assurerEspaceStudio(projectId) };
    }

    case 'studio.polices.retirer': {
      const projectId = String(cmd.projectId ?? '');
      if (!store.getProject(projectId)) throw new Error('projet introuvable');
      const { retirerLaPoliceDuProjet } = await import('./studio-polices.js');
      if (!retirerLaPoliceDuProjet(projectId, String(cmd.famille ?? ''))) throw new Error('police introuvable dans le projet');
      return { espace: assurerEspaceStudio(projectId) };
    }

    case 'studio.creation.creer': {
      if (cmd.depuisModele) return { creation: ou(creerDepuisModele(String(cmd.depuisModele), cmd.titre)).creation };
      let composition;
      const formats = formatsRecus(cmd.formats);
      if (cmd.depuisMedia) {
        // Un dessin gardé devient le premier segment d'une création neuve.
        const m = lireMedia(String(cmd.depuisMedia));
        if (!m?.dessin) throw new Error('dessin introuvable dans la bibliothèque');
        composition = compositionVide(formats[0] ?? '9:16');
        const vecteurs = composition.pistes.find((p) => p.genre === 'vecteur')!;
        vecteurs.segments.push({ id: 'des1', genre: 'dessin', debut: 0, duree: 4, nom: m.nom, gabarit: m.dessin.gabarit, parametres: m.dessin.parametres, valeurs: m.dessin.valeurs });
      }
      const r = ou(creerCreation({ projectId: String(cmd.projectId ?? ''), titre: cmd.titre, formats, ...(composition ? { composition } : {}) }));
      return { creation: r.creation };
    }

    case 'studio.creation.ouvrir':
      return creationOuverte(String(cmd.id ?? ''));

    case 'studio.carte.montage': {
      const { ouvrirLeMontageDeLaCarte } = await import('./studio-montage-de-carte.js');
      const r = await ouvrirLeMontageDeLaCarte(String(cmd.cardId ?? ''));
      return { creationId: r.creation.id, aVerser: r.aVerser };
    }

    case 'studio.creation.modifier':
      return { creation: ou(modifierCreation(String(cmd.id ?? ''), cmd)).creation };

    /* Le moteur de l'agent choisi AVANT sa première demande (`null` l'efface). */
    case 'studio.creation.agent':
      return { creation: ou(reglerAgentDeLaCreation(String(cmd.id ?? ''), cmd.run ?? null)).creation };

    case 'studio.creation.supprimer':
      ou(supprimerCreation(String(cmd.id ?? '')));
      return { ok: true };

    case 'studio.creation.dupliquer':
      return { creation: ou(dupliquerCreation(String(cmd.id ?? ''))).creation };

    /* LES MODÈLES : valider une création, les lister, en retirer un, le copier vers un autre projet. */
    case 'studio.modele.valider': {
      const r = ou(validerCreationEnModele(String(cmd.creationId ?? '')));
      return { modele: resumeDuModele(r.modele), nouveau: r.nouveau };
    }

    case 'studio.modele.lister':
      return { modeles: listerModeles(cmd.projectId || undefined).map(resumeDuModele) };

    case 'studio.modele.supprimer':
      ou(supprimerModele(String(cmd.id ?? '')));
      return { ok: true };

    case 'studio.modele.copier': {
      const r = ou(await copierModele(String(cmd.id ?? ''), String(cmd.projectId ?? '')));
      return { modele: resumeDuModele(r.modele), manquants: r.manquants };
    }

    case 'studio.operation': {
      const r = ou(appliquerOperationStudio(String(cmd.creationId ?? ''), cmd.operation as OperationStudio, 'humain'));
      return { numero: r.numero, composition: r.composition, resume: r.resume, annulerRetablir: etatAnnulerRetablir(String(cmd.creationId)) };
    }

    case 'studio.annuler':
      ou(annuler(String(cmd.creationId ?? '')));
      return { ok: true };

    case 'studio.retablir':
      ou(retablir(String(cmd.creationId ?? '')));
      return { ok: true };

    case 'studio.restaurer':
      ou(restaurer(String(cmd.creationId ?? ''), Number(cmd.numero)));
      return { ok: true };

    case 'studio.historique':
      return { versions: historique(String(cmd.creationId ?? '')) };

    case 'studio.selection': {
      if (!lireCreation(String(cmd.creationId ?? ''))) throw new Error('création introuvable');
      ecrireSelection(String(cmd.creationId), cmd);
      return { ok: true };
    }

    case 'studio.media.importer':
      return { media: ou(await importerPieceJointeMesuree(String(cmd.projectId ?? ''), String(cmd.attachmentId ?? ''), { licence: cmd.licence, creationId: cmd.creationId })).media };

    case 'studio.media.modifier': {
      const m = modifierMedia(String(cmd.id ?? ''), cmd);
      if (!m) throw new Error('média introuvable');
      return { media: m };
    }

    case 'studio.media.supprimer':
      ou(supprimerMedia(String(cmd.id ?? '')));
      return { ok: true };

    case 'studio.media.bande': {
      const { bandeDImages } = await import('./studio-montage.js');
      const r = ou(await bandeDImages(String(cmd.creationId ?? ''), String(cmd.mediaId ?? '')));
      return { image: r.image, images: r.images, largeur: r.largeur, hauteur: r.hauteur, duree: r.duree };
    }

    case 'studio.styles.lister': {
      const { categoriesDeLaBibliotheque, stylesPourLaGalerie } = await import('./studio-styles.js');
      return { styles: stylesPourLaGalerie(), categories: categoriesDeLaBibliotheque() };
    }

    case 'studio.style.joindre': {
      const { joindreUnStyle } = await import('./studio-styles.js');
      return joindreUnStyle(String(cmd.creationId ?? ''), String(cmd.styleId ?? ''));
    }

    case 'studio.styles.lire': {
      const { detailDuStyle } = await import('./studio-styles.js');
      const detail = detailDuStyle(String(cmd.id ?? ''));
      if (!detail) throw new Error('style introuvable');
      return { detail };
    }

    case 'studio.voix.essai': {
      if (cmd.segmentId) {
        const r = ou(await fabriquerVoixEssai(String(cmd.creationId ?? ''), String(cmd.segmentId)));
        return { faites: 1, duree: r.duree };
      }
      const r = await fabriquerVoixManquantes(String(cmd.creationId ?? ''));
      if (!r.faites && r.erreurs.length) throw new Error(r.erreurs[0]);
      return r;
    }

    case 'studio.voix.devis':
      return { devis: ou(await devisDesVoix(String(cmd.creationId ?? ''), cmd.segmentIds, { refaire: cmd.refaire === true })).devis };

    case 'studio.voix.valider':
      return { depense: ou(await validerVoixFinales(String(cmd.creationId ?? ''), cmd.segmentIds, Number(cmd.plafond), { refaire: cmd.refaire === true })).depense };

    case 'studio.voix.extraits':
      return { extraits: extraitsDisponibles() };

    case 'studio.exporter': {
      if (!estFormatStudio(cmd.format)) throw new Error('format inconnu');
      return {
        export: ou(
          lancerExport(
            String(cmd.creationId ?? ''),
            cmd.format,
            cmd.genre === 'image' ? 'image' : 'video',
            typeof cmd.instant === 'number' && Number.isFinite(cmd.instant) ? cmd.instant : undefined,
            cmd.reglages,
            typeof cmd.lot === 'string' && cmd.lot ? cmd.lot : undefined,
          ),
        ).export,
      };
    }

    case 'studio.export.annuler':
      ou(annulerExport(String(cmd.id ?? '')));
      return { ok: true };

    case 'studio.exports.vider':
      return { retires: ou(viderLesExports(String(cmd.creationId ?? ''), Array.isArray(cmd.garder) ? cmd.garder.map(String) : [])).retires };

    case 'studio.depense.valider': {
      const r = ou(deciderDepense(String(cmd.id ?? ''), 'validee'));
      // Le clic vaut lancement : la génération part, et sa dépense se soldera seule.
      if (r.depense.genre === 'modele3d') (await import('./studio-3d.js')).lancerLePersonnage3d(r.depense.id);
      return { depense: r.depense };
    }

    case 'studio.depense.refuser':
      return { depense: ou(deciderDepense(String(cmd.id ?? ''), 'refusee')).depense };

    case 'studio.credit':
      return await soldeOpenRouter();

    case 'studio.assistant':
      return await lancerAgentStudio({
        creationId: String(cmd.creationId ?? ''),
        demande: String(cmd.demande ?? ''),
        attachments: Array.isArray(cmd.attachments) ? cmd.attachments.map(String) : [],
      });

    /* LES MODES DE RÉALISATION : ce que les services branchés savent faire, et le mode retenu sur la création. */
    case 'studio.modes.lister': {
      const { modesDeLaCreation } = await import('./studio-modes.js');
      return modesDeLaCreation(String(cmd.creationId ?? ''));
    }
    case 'studio.mode.choisir': {
      const { choisirLeMode } = await import('./studio-modes.js');
      return { mode: choisirLeMode(String(cmd.creationId ?? ''), cmd.mode ?? null) };
    }

    case 'studio.note.ajouter':
      return { note: ou(ajouterNote(String(cmd.creationId ?? ''), cmd)).note };
    case 'studio.note.marquer':
      return { ok: marquerNote(String(cmd.creationId ?? ''), String(cmd.id ?? ''), cmd.traitee === true) };
    case 'studio.note.supprimer':
      supprimerNote(String(cmd.creationId ?? ''), String(cmd.id ?? ''));
      return { ok: true };
    case 'studio.jalon':
      poserUnJalon(String(cmd.creationId ?? ''), String(cmd.nom ?? ''));
      return { ok: true };

    case 'studio.bibliotheque.lister':
      return { lignes: bibliothequeCommune(String(cmd.creationId ?? ''), { recherche: cmd.recherche, genre: cmd.genre }) };
    case 'studio.bibliotheque.prendre': {
      const creation = lireCreation(String(cmd.creationId ?? ''));
      if (!creation) throw new Error('création introuvable');
      const r = ou(await importerPieceJointeMesuree(creation.projectId, String(cmd.attachmentId ?? ''), { creationId: creation.id }));
      return { media: r.media, adresse: adresseSigneeDuMedia(creation.id, r.media.id) };
    }

    case 'studio.poser': {
      const { poserALaMain } = await import('./studio-montage-de-carte.js');
      const r = await poserALaMain({
        creationId: String(cmd.creationId ?? ''),
        debut: Number(cmd.debut) || 0,
        ...(cmd.attachmentId ? { attachmentId: String(cmd.attachmentId) } : {}),
        ...(cmd.mediaId ? { mediaId: String(cmd.mediaId) } : {}),
        ...(cmd.segment ? { segment: cmd.segment } : {}),
        ...(cmd.pisteId ? { pisteId: String(cmd.pisteId) } : {}),
        ...(cmd.nouvellePiste ? { nouvellePiste: true } : {}),
        ...(cmd.mode ? { mode: cmd.mode } : {}),
        ...(cmd.valider ? { valider: true } : {}),
      });
      if (!r.ok && !r.occupe) throw new Error(r.raison);
      if (!r.ok) return { occupe: r.occupe };
      return { composition: r.composition, pisteId: r.pisteId, segmentId: r.segmentId, annulerRetablir: etatAnnulerRetablir(String(cmd.creationId)) };
    }

    case 'studio.fond.retirer':
    case 'studio.fond.remettre': {
      const { lancerLeGesteDuFond } = await import('./studio-montage-de-carte.js');
      return lancerLeGesteDuFond(cmd.type === 'studio.fond.retirer' ? 'retirer' : 'remettre', {
        creationId: String(cmd.creationId ?? ''),
        ...(cmd.attachmentId ? { attachmentId: String(cmd.attachmentId) } : {}),
        ...(cmd.mediaId ? { mediaId: String(cmd.mediaId) } : {}),
      });
    }

    case 'studio.mots':
      return { mots: ou(await motsDuMedia(String(cmd.creationId ?? ''), String(cmd.mediaId ?? ''))).mots };
    case 'studio.couper': {
      const r = ou(couperAuTexte(String(cmd.creationId ?? ''), cmd.passages ?? []));
      return { numero: r.numero, resume: r.resume };
    }

    case 'studio.rythme':
      return { rythme: await rythmeDeLaCreation(String(cmd.creationId ?? '')) };
    case 'studio.rythme.caler': {
      const r = ou(await calerLesPlansSurLeRythme(String(cmd.creationId ?? ''), 'humain'));
      return { numero: r.numero, resume: r.resume };
    }

    case 'studio.decliner.langue':
      return await declinerEnLangue(String(cmd.creationId ?? ''), String(cmd.langue ?? ''));
    case 'studio.versReseaux': {
      const r = ou(await envoyerVersReseaux(String(cmd.creationId ?? '')));
      return { contenuId: r.contenuId, nouveau: r.nouveau };
    }

    /* LE MODÈLE PAR TYPE DE FABRICATION : le menu de kie.ai, et le choix gardé sur la création. */
    case 'studio.modeles.lister': {
      const { clesDesServicesDuStudio, menuDesModeles, modelesChoisisDeLaCreation } = await import('./studio-modeles-choisis.js');
      return { menu: await menuDesModeles(), choisis: cmd.creationId ? modelesChoisisDeLaCreation(String(cmd.creationId)) : {}, cles: await clesDesServicesDuStudio() };
    }
    case 'studio.modeles.choisir': {
      const { choisirUnModele } = await import('./studio-modeles-choisis.js');
      return { choisis: choisirUnModele(String(cmd.creationId ?? ''), cmd.genre, cmd.modele ?? null) };
    }
  }
  throw new Error(`commande du studio inconnue : ${cmd.type}`);
}
