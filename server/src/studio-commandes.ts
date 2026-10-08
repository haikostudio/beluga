import {
  type FormatStudio,
  type OperationStudio,
  VOIX_FINALES_STUDIO,
  compositionVide,
  DUREE_VOULUE_PAR_DEFAUT,
  dureeExportee,
  estFormatStudio,
  formatDuCanal,
  voixPasFinales,
} from '@beluga/shared';
import * as store from './store.js';
import {
  adresseSigneeDuMedia,
  annuler,
  appliquerOperationStudio,
  assurerEspaceStudio,
  compositionCourante,
  creationsDuContenu,
  creerCreation,
  deciderDepense,
  dupliquerCreation,
  ecrireEspaceStudio,
  ecrireSelection,
  etatAnnulerRetablir,
  historique,
  importerPieceJointe,
  lireCreation,
  lireMedia,
  listerCreations,
  listerDepenses,
  listerExports,
  listerMedias,
  modifierCreation,
  modifierMedia,
  restaurer,
  retablir,
  supprimerCreation,
  supprimerMedia,
  totalDepense,
} from './studio.js';
import { annulerExport, lancerExport, mediasCites, outilsDeRendu } from './studio-rendu.js';
import {
  devisDesVoix,
  extraitsDisponibles,
  fabriquerVoixEssai,
  fabriquerVoixManquantes,
  lancerGenerationValidee,
  soldeOpenRouter,
  validerVoixFinales,
  voixDEssaiDisponibles,
} from './studio-generation.js';
import { lancerAgentStudio } from './assistant-studio.js';
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
  const adressesMedias: Record<string, { url: string; genre: string }> = {};
  for (const mid of ids) {
    const m = lireMedia(mid);
    if (m && m.projectId === creation.projectId && m.attachmentId) adressesMedias[mid] = { url: adresseSigneeDuMedia(creation.id, mid), genre: m.genre };
  }
  const outils = outilsDeRendu();
  return {
    creation,
    composition,
    projet: store.getProject(creation.projectId)?.name ?? '',
    annulerRetablir: etatAnnulerRetablir(id),
    medias,
    adressesMedias,
    exports: listerExports(id),
    depenses: listerDepenses(id),
    depenseTotale: totalDepense(id),
    espace,
    voixEssai: voixDEssaiDisponibles(),
    voixFinales: VOIX_FINALES_STUDIO.map((v) => ({ id: v.id, label: v.id, genre: v.genre, timbre: v.timbre })),
    voixEnEssai: voixPasFinales(composition).length,
    rendu: { pret: !!outils.hyperframes && !!outils.gsap },
    /* Le modèle de CETTE création (« Garder comme modèle », fenêtre « Mettre en production »), et ceux du projet. */
    modele: (() => {
      const m = modeleDeLaCreation(creation.id);
      return m ? { id: m.id, version: m.version, majLe: m.majLe } : null;
    })(),
    modeles: listerModeles(creation.projectId).map(resumeDuModele),
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

    case 'studio.creation.creer': {
      if (cmd.depuisModele) return { creation: ou(creerDepuisModele(String(cmd.depuisModele), cmd.titre)).creation };
      let composition;
      const formats = formatsRecus(cmd.formats);
      if (cmd.depuisMedia) {
        // Un dessin gardé devient le premier segment d'une création neuve.
        const m = lireMedia(String(cmd.depuisMedia));
        if (!m?.dessin) throw new Error('dessin introuvable dans la bibliothèque');
        composition = compositionVide(formats[0] ?? '9:16');
        const visuels = composition.pistes.find((p) => p.genre === 'visuel')!;
        visuels.segments.push({ id: 'des1', genre: 'dessin', debut: 0, duree: 4, nom: m.nom, gabarit: m.dessin.gabarit, parametres: m.dessin.parametres, valeurs: m.dessin.valeurs });
      }
      const r = ou(creerCreation({ projectId: String(cmd.projectId ?? ''), titre: cmd.titre, formats, ...(composition ? { composition } : {}) }));
      return { creation: r.creation };
    }

    case 'studio.creation.ouvrir':
      return creationOuverte(String(cmd.id ?? ''));

    case 'studio.creation.modifier':
      return { creation: ou(modifierCreation(String(cmd.id ?? ''), cmd)).creation };

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
      return { media: ou(importerPieceJointe(String(cmd.projectId ?? ''), String(cmd.attachmentId ?? ''), { licence: cmd.licence, creationId: cmd.creationId })).media };

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

    case 'studio.styles.lire': {
      const { detailDuStyle } = await import('./studio-styles.js');
      const detail = detailDuStyle(String(cmd.id ?? ''));
      if (!detail) throw new Error('style introuvable');
      return { detail };
    }

    /* LES SOURCES : chaque geste rend la liste à jour ; l'agent et le passage partent sans retenir l'écran. */
    case 'studio.sources.lister':
    case 'studio.sources.ajouter':
    case 'studio.sources.valider':
    case 'studio.sources.analyser':
    case 'studio.sources.controler':
    case 'studio.sources.retirer': {
      const sources = await import('./studio-sources.js');
      const id = String(cmd.id ?? '');
      if (cmd.type === 'studio.sources.ajouter') await sources.ajouterSource(cmd.adresse);
      else if (cmd.type === 'studio.sources.valider') sources.validerSource(id);
      else if (cmd.type === 'studio.sources.analyser') await sources.lancerAnalyse(id);
      else if (cmd.type === 'studio.sources.retirer') sources.retirerSource(id);
      else if (cmd.type === 'studio.sources.controler') sources.controlerMaintenant(id);
      return { sources: sources.sourcesPourLeVolet() };
    }

    case 'studio.navigateur.ouvrir':
    case 'studio.navigateur.geste':
    case 'studio.navigateur.terminer':
    case 'studio.navigateur.fermer': {
      const sources = await import('./studio-sources.js');
      const navigateur = await import('./studio-navigateur.js');
      const id = String(cmd.sourceId ?? '');
      if (cmd.type === 'studio.navigateur.ouvrir') await sources.ouvrirVerificationDeSource(id);
      else if (cmd.type === 'studio.navigateur.geste') await navigateur.gesteVerification(id, cmd.geste);
      else if (cmd.type === 'studio.navigateur.fermer') await navigateur.fermerVerification(id);
      else return { ...(await sources.terminerVerification(id)), sources: sources.sourcesPourLeVolet() };
      return { ok: true };
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
          ),
        ).export,
      };
    }

    case 'studio.export.annuler':
      ou(annulerExport(String(cmd.id ?? '')));
      return { ok: true };

    case 'studio.depense.valider': {
      const r = ou(deciderDepense(String(cmd.id ?? ''), 'validee'));
      // Le clic vaut lancement : la génération part, et sa dépense se soldera seule.
      if (r.depense.genre !== 'voix') void lancerGenerationValidee(r.depense.id);
      return { depense: r.depense };
    }

    case 'studio.depense.refuser':
      return { depense: ou(deciderDepense(String(cmd.id ?? ''), 'refusee')).depense };

    case 'studio.credit':
      return await soldeOpenRouter();

    case 'studio.assistant':
      return await lancerAgentStudio({ creationId: String(cmd.creationId ?? ''), demande: String(cmd.demande ?? '') });

    case 'studio.depuisMarketing': {
      const { lireContenu } = await import('./marketing.js');
      const contenu = lireContenu(String(cmd.contenuId ?? ''));
      if (!contenu) throw new Error('contenu introuvable');
      // Le visuel d'un contenu se reprend là où on l'a laissé : une seule création par contenu.
      const deja = creationsDuContenu(contenu.id)[0];
      if (deja) return { creation: deja, nouvelle: false };
      const format = formatDuCanal(contenu.canal);
      const texte = contenu.texte.trim();
      // Le marqueur bleu ne coupe jamais la voix du contenu : il couvre au moins sa durée estimée.
      const dureeVoix = texte && texte.length <= 400 ? Math.max(2, texte.length / 15) : 0;
      const composition = compositionVide(format, Math.max(DUREE_VOULUE_PAR_DEFAUT, Math.ceil(dureeVoix + 1)));
      const visuels = composition.pistes.find((p) => p.genre === 'visuel')!;
      visuels.segments.push({
        id: 'titre',
        genre: 'texte',
        debut: 0,
        duree: 4,
        nom: 'Titre du contenu',
        texte: contenu.titre.slice(0, 120),
        taille: 88,
        couleur: '#ffffff',
        position: { x: 50, y: 45 },
        gras: true,
        entree: 'glisse-haut',
      });
      if (texte && texte.length <= 400) {
        composition.pistes
          .find((p) => p.id === 'voix')!
          .segments.push({ id: 'voix1', genre: 'voix', debut: 0, duree: Math.max(2, texte.length / 15), texte, voixEssai: 'fr_FR-siwis-medium', etat: 'aucune', volume: 1 });
      }
      const r = ou(
        creerCreation({ projectId: contenu.projectId, titre: contenu.titre || 'Visuel du contenu', formats: [format], contenuMarketingId: contenu.id, composition }),
      );
      return { creation: r.creation, nouvelle: true };
    }
  }
  throw new Error(`commande du studio inconnue : ${cmd.type}`);
}
