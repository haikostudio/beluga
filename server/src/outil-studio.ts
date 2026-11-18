import fs from 'node:fs';
import {
  policeEmbarqueeLaPlusProche,
  policesDuProjet,
  familleDisponible,
  type Composition,
  type FormatStudio,
  type OperationStudio,
  type Project,
  type SegmentDessin,
  type SegmentVoix,
  CLES_FORMATS_STUDIO,
  FORMATS_STUDIO,
  POLICES_STUDIO,
  VOIX_FINALES_STUDIO,
  VOIX_ELEVENLABS_STUDIO,
  nomDeVoixFinale,
  dureeDeLaCreation,
  dureeExportee,
  estFormatStudio,
  mimeDuFichier,
  montantLisible,
  nettoyerDessin,
  trouverSegment,
  validerComposition,
  voixPasFinales,
  TYPES_DE_MODELE_DU_STUDIO,
  ligneDesModelesChoisis,
  lignesDesNotes,
  type TypeDeModeleDuStudio,
  voixFinaleDuProjet,
  phraseDansUneAutreVoix,
  tousLesSegments,
  consigneDuMontageDeCarte,
  plansDuMontage,
  AgentQuestion,
  fondGardeParLAnnonce,
  pisteVisuelle,
} from '@beluga/shared';
import {
  ajouterMedia,
  appliquerOperationStudio,
  assurerEspaceStudio,
  compositionCourante,
  creationPilotableParLAgent,
  estMontageDeCarte,
  enregistrerVersion,
  genreDuMime,
  historique,
  listerDepenses,
  listerExports,
  listerMedias,
  lireSelection,
  listerNotes,
  marquerNote,
  nettoyerLesDessins,
  nouvelId,
} from './studio.js';
import { controlerComposition, imagesDeLaComposition, lancerExport } from './studio-rendu.js';
import * as store from './store.js';
import { fichierPermis, joindreUnFichier, racinesDeLAgent, refusDeChemin } from './joindre-fichier.js';
import { payeurOpenRouter, devisDesVoix, fabriquerVoixEssai, fabriquerVoixManquantes, importerPieceJointeMesuree, voixDEssaiDisponibles } from './studio-generation.js';
import { listerModeles, lireModele } from './studio-modeles.js';
import { bibliothequeCommune } from './studio-gestes-avances.js';
import { cleDuService } from './studio-services.js';

/**
 * L'OUTIL « studio » — réservé à l'agent attitré d'une création
 * (`estAgentStudio`). Il agit sur SA création, jamais sur une autre : la
 * création se retrouve par l'agent, pas par un identifiant qu'il donnerait.
 *
 * Un dessin posé par l'agent passe les trois contrôles avant d'exister :
 * nettoyage (liste fermée), syntaxe, puis un vrai Chrome sans réseau
 * (`controlerComposition`). Une erreur n'est jamais avalée : elle lui revient.
 */

interface Contexte {
  agentId: string;
  /** La carte de la conversation du Studio : la pièce importée d'un chemin s'y rattache. */
  cardId?: string;
}
interface Resultat {
  ok: boolean;
  text: string;
  /** Une proposition à prix posée dans le fil (voix finale, personnage 3D) : non bloquante, tranchée au clic. */
  question?: AgentQuestion;
}

/** Une composition lisible par l'agent : entière, sauf les dessins non visés au-delà d'une taille raisonnable. */
function compositionPourLAgent(c: Composition, detailDe?: string): string {
  const copie: any = JSON.parse(JSON.stringify(c));
  let taille = JSON.stringify(copie).length;
  if (taille > 40_000) {
    for (const p of copie.pistes) {
      for (const s of p.segments) {
        if (s.genre !== 'dessin' || s.id === detailDe) continue;
        s.gabarit = { html: `(${s.gabarit.html.length} signes — « lire » avec segmentId « ${s.id} » pour le voir)`, css: '…', animation: '…' };
      }
    }
    taille = JSON.stringify(copie).length;
  }
  return JSON.stringify(copie);
}

function texteDuControle(erreurs: string[], avertissements: string[]): string {
  return [
    ...(erreurs.length ? ['ERREURS (rien n’a été posé, corrige puis rappelle) :', ...erreurs.map((e) => `- ${e}`)] : []),
    ...(avertissements.length ? ['Avertissements :', ...avertissements.slice(0, 8).map((a) => `- ${a}`)] : []),
  ].join('\n');
}

/** L'orientation d'un média, dite à l'agent pour qu'il le place selon le format. */
function orientation(largeur: number, hauteur: number): string {
  return largeur === hauteur ? 'carré' : largeur > hauteur ? 'paysage' : 'portrait';
}

/**
 * UN MODÈLE DONNE LA MISE EN SCÈNE, JAMAIS L'IDENTITÉ (décision de l'utilisateur, 11/11/2026) : une création partie
 * d'un modèle gardait sa police et ses couleurs au lieu de celles du produit visé.
 */
const RAPPEL_IDENTITE_DU_PRODUIT =
  'NÉE D’UN MODÈLE : garde sa structure, son rythme et ses animations, mais PAS son identité. Avant de monter, « identite » (polices et couleurs du produit visé : son kit de marque, sinon son site) ; remplace police, couleurs et logo du modèle par ceux du produit. Une police du produit pas encore dans le projet : « police » l’importe (code, site, bibliothèque libre), sinon demande le fichier. Un doute (couleur du modèle qui porte une animation, deux polices possibles) : « ask_user » d’abord.';

/** La création est-elle partie d'un modèle (sa première version le dit, `creerDepuisModele`), ou y est-elle revenue ? */
function neeDUnModele(creationId: string): boolean {
  return historique(creationId).some((v) => /^(depuis le|repart du) modèle/.test(v.raison));
}

export async function outilStudio(ctx: Contexte, project: Project, args: Record<string, any>): Promise<Resultat> {
  // Sa création, ou le MONTAGE de sa carte (grand volet de montage) : jamais une autre.
  const creation = creationPilotableParLAgent(ctx.agentId);
  if (!creation) return { ok: false, text: 'Cet outil est réservé à l’agent attitré d’une création du Studio, ou aux agents d’une carte qui a un montage.' };
  const composition = compositionCourante(creation.id);
  if (!composition) return { ok: false, text: 'La création n’a plus de composition.' };
  const action = String(args.action ?? '');
  const format: FormatStudio | undefined = estFormatStudio(args.format) ? args.format : undefined;

  switch (action) {
    case 'lire': {
      const espace = assurerEspaceStudio(creation.projectId);
      const selection = lireSelection(creation.id);
      const medias = listerMedias(creation.projectId, creation.id);
      const exports = listerExports(creation.id).slice(0, 5);
      const depenses = listerDepenses(creation.id).filter((d) => d.etat === 'en-attente');
      if (args.segmentId) {
        const t = trouverSegment(composition, String(args.segmentId));
        if (!t) return { ok: false, text: `Aucun segment « ${args.segmentId} ».` };
        return { ok: true, text: `SEGMENT ${t.segment.id} (piste « ${t.piste.nom} ») :\n${JSON.stringify(t.segment, null, 1)}` };
      }
      return {
        ok: true,
        text: [
          ...(estMontageDeCarte(creation) ? [consigneDuMontageDeCarte(composition)] : []),
          `CRÉATION « ${creation.titre} » — version ${creation.version}, formats ${creation.formats.join(', ')}, contenu ${dureeDeLaCreation(composition).toFixed(1)} s.`,
          composition.dureeVoulue !== undefined
            ? `DURÉE VOULUE (marqueur bleu posé par l’utilisateur) : ${composition.dureeVoulue.toFixed(1)} s — c’est la longueur visée, l’export COUPE là. Ne la change que par « operation » {op: "composition", dureeVoulue} après accord de l’utilisateur.`
            : 'DURÉE VOULUE : aucune (la vidéo dure ce que dure son contenu).',
          `SÉLECTION À L’ÉCRAN : ${selection.segmentIds.length ? selection.segmentIds.join(', ') : 'aucun segment'}${selection.elementId ? `, pièce « ${selection.elementId} »` : ''}, curseur ${selection.curseur.toFixed(2)} s${selection.format ? `, format affiché ${selection.format}` : ''}.`,
          ...(() => {
            const notes = lignesDesNotes(listerNotes(creation.id));
            return notes.length ? ['NOTES OUVERTES SUR L’IMAGE :', ...notes] : [];
          })(),
          ...(neeDUnModele(creation.id) ? [RAPPEL_IDENTITE_DU_PRODUIT] : []),
          `KIT DE MARQUE : ${JSON.stringify(espace.kit)}`,
          `FORMATS (largeur × hauteur) : ${CLES_FORMATS_STUDIO.map((f) => `${f} ${FORMATS_STUDIO[f].largeur}×${FORMATS_STUDIO[f].hauteur}`).join(', ')}`,
          `POLICES DU PROJET (la vraie police du produit, importée) : ${policesDuProjet(espace.kit).map((p) => `${p.famille} (${p.fichiers.length} fichier(s), ${p.source})`).join(', ') || 'aucune — « police » en importe une'}`,
          `POLICES EMBARQUÉES : ${POLICES_STUDIO.map((p) => p.famille).join(', ')}`,
          `VOIX D’ESSAI (gratuites, champ voixEssai) : ${voixDEssaiDisponibles().map((v) => `${v.id} (${v.label})`).join(', ') || 'aucune posée'}`,
          `VOIX FINALE : celle du projet, choisie par l’utilisateur dans la fenêtre « Construction » — aujourd’hui ${voixFinaleDuProjet(espace.voixFinale)} — sauf pour une phrase qui a SA voix (champ voixChoisie du segment, réglé par « proprietes » seulement si l’utilisateur le demande ; vide = voix du projet). Le champ voixFinale d’un segment est refusé : c’est la voix réellement produite. Voix possibles : ${VOIX_FINALES_STUDIO.map((v) => `${v.id} (${v.genre}, ${v.timbre})`).join(', ')}${cleDuService('kie') ? ` ; et par kie.ai : ${VOIX_ELEVENLABS_STUDIO.map((v) => `${v.id} (${nomDeVoixFinale(v.id)}, ${v.genre}, ${v.description})`).join(', ')}` : ''}`,
          `VOIX PAS ENCORE FINALES : ${voixPasFinales(composition).map((v) => `${v.id} (${v.etat})`).join(', ') || 'aucune'}${(() => {
            const autres = tousLesSegments(composition).filter((s): s is SegmentVoix => s.genre === 'voix' && phraseDansUneAutreVoix(s, voixFinaleDuProjet(espace.voixFinale)));
            return autres.length ? ` — FAITES DANS UNE AUTRE VOIX : ${autres.map((v) => `${v.id} (${v.voixFinale ?? '?'})`).join(', ')}` : '';
          })()}`,
          'PHRASES CHOISIES : seules les phrases à refaire (texte changé, ajoutée, autre voix) sont redites ; les autres gardent leur son. L’utilisateur coche lui-même les phrases à générer dans « Construction ». Les phrases d’une même voix sont dites d’un seul appel puis découpées (même timbre). Préviens l’utilisateur avant de toucher au texte d’une voix déjà finale.',
          ...(() => {
            const modeles = listerModeles(creation.projectId);
            return modeles.length
              ? [
                  `MODÈLES DU PROJET (${modeles.length}, vidéos validées — « modele » pour en repartir ou reprendre une scène) :`,
                  ...modeles.slice(0, 20).map(
                    (m) =>
                      `- [${m.id}] « ${m.titre} » · ${m.duree.toFixed(1)} s · scènes : ${m.composition.pistes
                        .filter((p) => pisteVisuelle(p.genre))
                        .flatMap((p) => p.segments.map((x) => `${x.id}${x.nom ? ` (${x.nom})` : ''}`))
                        .join(', ')}`,
                  ),
                ]
              : ['MODÈLES DU PROJET : aucun.'];
          })(),
          ...(() => {
            /* LA BIBLIOTHÈQUE COMMUNE : ce que le projet a fabriqué ailleurs, à prendre par « importer » avec « attachmentId », sans copie. */
            const ailleurs = bibliothequeCommune(creation.id).filter((l) => !l.mediaId).slice(0, 30);
            return ailleurs.length ? [`AILLEURS DANS LE PROJET (« importer » avec cet attachmentId) :`, ...ailleurs.map((l) => `- ${l.attachmentId} · ${l.genre} · « ${l.nom} » · ${l.origine}`)] : [];
          })(),
          `BIBLIOTHÈQUE (${medias.length}) :`,
          ...medias.slice(0, 60).map(
            (m) =>
              `- [${m.id}] ${m.genre} · ${m.provenance} · « ${m.nom} »${m.categorie ? ` · ${m.categorie}` : ''}${m.usage ? ` · ${m.usage}` : ''}${m.largeur && m.hauteur ? ` · ${m.largeur}×${m.hauteur}` : ''}${m.duree ? ` · ${m.duree.toFixed(1)} s` : ''}${m.licence ? ` · licence : ${m.licence}` : m.genre === 'audio' && m.provenance === 'import' ? ' · SANS LICENCE NOTÉE (inutilisable)' : ''}`,
          ),
          depenses.length ? `DEVIS EN ATTENTE DU CLIC : ${depenses.map((d) => `${d.genre} ${montantLisible(d.plafond)}`).join(', ')}` : 'DEVIS EN ATTENTE : aucun.',
          ...(await import('./studio-3d.js').then((m) => [m.ligneDesModelesGardes(creation.id)].filter(Boolean))),
          exports.length ? `DERNIERS EXPORTS : ${exports.map((e) => `${e.format} ${e.genre} ${e.etat}`).join(', ')}` : 'EXPORTS : aucun.',
          `COMPOSITION : ${compositionPourLAgent(composition)}`,
        ].join('\n'),
      };
    }

    case 'composer': {
      // UN MONTAGE DE CARTE se retouche geste par geste : une composition entière effacerait d'un coup ses plans versés.
      if (estMontageDeCarte(creation) && plansDuMontage(composition).length) return { ok: false, text: 'Ce montage a déjà ses plans : retouche-le par « operation » (une version par geste), jamais en recomposant tout.' };
      const valide = validerComposition(args.composition);
      if (!valide.ok) return { ok: false, text: `Composition refusée : ${valide.raison}` };
      // LE MARQUEUR BLEU EST CELUI DE L'UTILISATEUR : une composition qui ne le redit pas le garde.
      if (valide.composition.dureeVoulue === undefined && composition.dureeVoulue !== undefined) valide.composition.dureeVoulue = composition.dureeVoulue;
      const propre = nettoyerLesDessins(composition, valide.composition);
      if (!propre.ok) return { ok: false, text: texteDuControle(propre.raison.split('\n'), []) };
      const controle = await controlerComposition(creation, propre.composition);
      if (controle.erreurs.length) return { ok: false, text: texteDuControle(controle.erreurs, controle.avertissements) };
      const v = enregistrerVersion(creation.id, propre.composition, 'première version de l’agent', 'agent');
      if (!v.ok) return { ok: false, text: v.raison };
      return {
        ok: true,
        text: `Composition posée (version ${v.numero}, contenu ${dureeDeLaCreation(propre.composition).toFixed(1)} s, vidéo ${dureeExportee(propre.composition).toFixed(1)} s). ${texteDuControle([], [...valide.avertissements, ...propre.avertissements, ...controle.avertissements])}\nRegarde-la avec « apercu ».`,
      };
    }

    case 'dessiner': {
      const gabarit = { html: String(args.html ?? ''), css: String(args.css ?? ''), animation: String(args.animation ?? '') };
      // Le nettoyage d'abord : il dit les pièces du NOUVEAU dessin, celles dont les retouches survivent.
      const nettoye = nettoyerDessin(gabarit);
      if (!nettoye.ok) return { ok: false, text: texteDuControle(nettoye.erreurs, nettoye.avertissements) };
      let op: OperationStudio;
      let segmentId: string;
      if (args.segmentId) {
        segmentId = String(args.segmentId);
        const t = trouverSegment(composition, segmentId);
        if (!t || t.segment.genre !== 'dessin') return { ok: false, text: `Aucun dessin « ${segmentId} » : sans segmentId, un nouveau segment se pose.` };
        const ops: OperationStudio[] = [
          { op: 'dessin', segmentId, gabarit, parametres: args.parametres ?? (t.segment as SegmentDessin).parametres, elements: nettoye.dessin.elements },
        ];
        const props: Record<string, unknown> = {};
        if (args.nom) props.nom = args.nom;
        if (args.entree) props.entree = args.entree;
        if (args.sortie) props.sortie = args.sortie;
        if (Object.keys(props).length) ops.push({ op: 'proprietes', segmentId, valeurs: props });
        op = ops.length > 1 ? { op: 'lot', operations: ops } : ops[0]!;
      } else {
        const piste = composition.pistes.find((p) => p.id === args.pisteId && p.genre === 'vecteur') ?? composition.pistes.find((p) => p.genre === 'vecteur');
        if (!piste) return { ok: false, text: 'Aucune piste Vecteurs : ajoute-en une avec « operation » piste-ajouter, genre « vecteur ».' };
        segmentId = nouvelId('des');
        op = {
          op: 'inserer',
          pisteId: piste.id,
          segment: {
            id: segmentId,
            genre: 'dessin',
            debut: Number(args.debut ?? 0),
            duree: Number(args.duree ?? 3),
            nom: args.nom,
            entree: args.entree,
            sortie: args.sortie,
            gabarit,
            parametres: args.parametres ?? [],
          },
        };
      }
      // Essai À BLANC d'abord : contrôlé dans un vrai Chrome, posé seulement s'il passe.
      const { appliquerOperation } = await import('@beluga/shared');
      const essai = appliquerOperation(composition, op, nouvelId);
      if (!essai.ok) return { ok: false, text: `Refusé : ${essai.raison}` };
      const propre = nettoyerLesDessins(composition, essai.composition);
      if (!propre.ok) return { ok: false, text: texteDuControle(propre.raison.split('\n'), []) };
      const controle = await controlerComposition(creation, propre.composition);
      if (controle.erreurs.length) return { ok: false, text: texteDuControle(controle.erreurs, controle.avertissements) };
      const r = appliquerOperationStudio(creation.id, op, 'agent');
      if (!r.ok) return { ok: false, text: r.raison };
      const pose = trouverSegment(r.composition, segmentId);
      const elements = pose?.segment.genre === 'dessin' ? pose.segment.elements ?? [] : [];
      return {
        ok: true,
        text: `Dessin posé sur le segment « ${segmentId} » (version ${r.numero}) — pièces déplaçables : ${elements.join(', ') || 'aucune'}. ${texteDuControle([], [...r.avertissements, ...controle.avertissements])}\nRegarde-le avec « apercu » (deux corrections au plus).`,
      };
    }

    case 'detourer': {
      const segmentId = String(args.segmentId ?? '');
      if (!segmentId) return { ok: false, text: 'Il faut « segmentId » : l’image ou la vidéo posée à détourer.' };
      const { detourerUnSegment } = await import('./studio-montage-de-carte.js');
      const r = await detourerUnSegment(creation.id, segmentId, args.fond);
      return r.ok ? { ok: true, text: `${r.resume} Regarde le résultat avec « apercu » avant de répondre.` } : { ok: false, text: `Détourage impossible : ${r.raison}. Rien n’a changé.` };
    }

    case 'operation': {
      const r = appliquerOperationStudio(creation.id, args.operation as OperationStudio, 'agent');
      if (!r.ok) return { ok: false, text: `Refusé : ${r.raison}` };
      return { ok: true, text: `Fait : ${r.resume} (version ${r.numero}). ${texteDuControle([], r.avertissements)}` };
    }

    case 'apercu': {
      const instants = Array.isArray(args.instants) ? args.instants.map(Number).filter(Number.isFinite) : [];
      const r = await imagesDeLaComposition(creation, composition, instants, format);
      if (!r.ok) return { ok: false, text: r.raison };
      return {
        ok: true,
        text: [`${r.images.length} image(s) prise(s) — OUVRE-LES avec ton outil de lecture d’image et regarde-les avant de répondre :`, ...r.images, ...(r.planche ? [`Planche d’ensemble : ${r.planche}`] : [])].join('\n'),
      };
    }

    case 'voix': {
      if (args.devis) {
        const refaire = args.refaire === true;
        const d = await devisDesVoix(creation.id, undefined, { refaire });
        if (!d.ok) return { ok: false, text: d.raison };
        const resume = `${d.devis.segments.length} phrase(s), ≈ ${Math.round(d.devis.secondes)} s, plafond ${montantLisible(d.devis.plafond)}, payé par ${payeurOpenRouter() === 'utilisateur' ? 'le compte OpenRouter de l’utilisateur (branché dans ses paramètres)' : 'l’espace OpenRouter de Beluga Build'}`;
        if (!d.devis.cle) return { ok: false, text: `Devis de la voix finale : ${resume}. Aucune clé n’est branchée : dis-le à l’utilisateur, il la branche dans les paramètres, rubrique « Services de création » ; rien n’est proposé avant.` };
        /* LA VOIX FINALE SE PROPOSE DANS LA CONVERSATION (01/11/2026) : le clic part par `trancherLaDepenseDuFil`, qui revérifie le prix. */
        return {
          ok: true,
          text: `Proposition de voix finale posée dans le fil (bouton « Générer · prix »), pour les phrases à refaire${refaire ? ' (toutes, puisque tu refais la voix)' : ''} : ${resume}. Elle NE T’ARRÊTE PAS et son clic ne te réveille pas : dis en UNE phrase ce qu’elle apporte, puis termine ton tour.`,
          question: AgentQuestion.parse({
            id: store.newId(),
            question: refaire ? 'Refaire la voix finale ?' : 'Générer la voix finale ?',
            description: `${d.devis.segments.length} phrase(s) · environ ${Math.round(d.devis.secondes)} s`,
            kind: 'text',
            options: [],
            allowFreeText: true,
            depenseDuFil: { genre: 'voix', creationId: creation.id, plafond: d.devis.plafond, ...(refaire ? { refaire: true } : {}) },
          }),
        };
      }
      if (args.segmentId) {
        const r = await fabriquerVoixEssai(creation.id, String(args.segmentId));
        return r.ok ? { ok: true, text: `Voix d’essai posée : ${r.duree.toFixed(2)} s. La scène et les sous-titres sont recalés.` } : { ok: false, text: r.raison };
      }
      const r = await fabriquerVoixManquantes(creation.id);
      return { ok: !r.erreurs.length || r.faites > 0, text: `${r.faites} voix d’essai fabriquée(s).${r.erreurs.length ? ` Problèmes : ${r.erreurs.join(' · ')}` : ''}` };
    }

    /* TOUTE FABRICATION PAYANTE PASSE PAR « realiser » (kie.ai, prix annoncé, un bouton par génération) : l'ancienne voie du Studio n'existe plus. */
    case 'generer':
      return {
        ok: false,
        text: 'Une image, un plan vidéo, une musique ou une voix payante se fabrique avec l’outil « realiser » : devis, puis le bouton à prix de l’utilisateur. Un média validé arrive tout seul dans la bibliothèque de la création.',
      };

    /* LE RYTHME DE LA MUSIQUE : ses temps ; avec « caler », les changements de plan s'y posent (une version, annulable). */
    /* LE PERSONNAGE 3D ANIMÉ (01/11/2026) : un DEVIS chez Meshy, que seul le clic de l'utilisateur lance (`studio-3d.ts`). */
    case 'modele3d': {
      const { devisDuPersonnage3d } = await import('./studio-3d.js');
      return devisDuPersonnage3d(creation, args);
    }

    case 'rythme': {
      const { calerLesPlansSurLeRythme, rythmeDeLaCreation } = await import('./studio-gestes-avances.js');
      if (args.caler === true) {
        const r = await calerLesPlansSurLeRythme(creation.id, 'agent');
        return r.ok ? { ok: true, text: `${r.resume} (version ${r.numero}).` } : { ok: false, text: r.raison };
      }
      const { bpm, temps } = await rythmeDeLaCreation(creation.id);
      return bpm ? { ok: true, text: `${bpm} BPM. Temps (s) : ${temps.slice(0, 120).join(', ')}` } : { ok: true, text: 'Aucune musique à la pulsation nette dans cette création.' };
    }

    case 'notes': {
      if (!args.id) return { ok: false, text: 'Donne l’« id » de la note traitée.' };
      return marquerNote(creation.id, String(args.id), true) ? { ok: true, text: 'Note marquée comme traitée.' } : { ok: false, text: 'Aucune note de ce nom sur cette création.' };
    }

    /* LES MODÈLES RETENUS PAR L'UTILISATEUR : « type » et « modele » pour noter le choix qu'il vient de te dire. */
    case 'modeles': {
      const { choisirUnModele, menuDesModeles, modelesChoisisDeLaCreation } = await import('./studio-modeles-choisis.js');
      if (args.type) {
        const choisis = choisirUnModele(creation.id, args.type as TypeDeModeleDuStudio, args.modele ? String(args.modele) : null);
        return { ok: true, text: ligneDesModelesChoisis(choisis) };
      }
      const menu = await menuDesModeles();
      return {
        ok: true,
        text: [
          ligneDesModelesChoisis(modelesChoisisDeLaCreation(creation.id)),
          ...TYPES_DE_MODELE_DU_STUDIO.map((t) => `${t} : ${menu[t].filter((m) => !m.enDirect).map((m) => `« ${m.id} » ${m.nom}${m.prix !== null ? ` (${montantLisible(m.prix)} ${m.unite})` : ''}`).join(' ; ')}`),
        ].join('\n'),
      };
    }

    case 'garder': {
      const t = trouverSegment(composition, String(args.segmentId ?? ''));
      if (!t || t.segment.genre !== 'dessin') return { ok: false, text: 'Donne le segmentId d’un dessin.' };
      const s = t.segment as SegmentDessin;
      const m = ajouterMedia({
        projectId: creation.projectId,
        genre: 'dessin',
        provenance: 'dessin',
        nom: String(args.nom ?? s.nom ?? 'Dessin').slice(0, 120),
        dessin: { gabarit: s.gabarit, parametres: s.parametres, valeurs: s.valeurs },
        ...(args.categorie ? { categorie: String(args.categorie) } : {}),
        ...(args.usage ? { usage: String(args.usage) } : {}),
      });
      return { ok: true, text: `Dessin gardé dans la bibliothèque du projet : [${m.id}] « ${m.nom} ».` };
    }

    case 'modele': {
      const modele = lireModele(String(args.modeleId ?? ''));
      if (!modele || modele.projectId !== creation.projectId) return { ok: false, text: 'Aucun modèle de ce nom dans ce projet : « lire » les liste.' };
      const voulus: string[] = Array.isArray(args.segmentIds) ? args.segmentIds.map(String) : [];
      if (!voulus.length) {
        // LE MODÈLE ENTIER, mais le marqueur bleu reste celui que l'utilisateur a posé ici.
        const entiere = { ...modele.composition, ...(composition.dureeVoulue !== undefined ? { dureeVoulue: composition.dureeVoulue } : {}) };
        const v = enregistrerVersion(creation.id, entiere, `repart du modèle « ${modele.titre} »`, 'agent');
        if (!v.ok) return { ok: false, text: v.raison };
        return { ok: true, text: `La création repart du modèle « ${modele.titre} » (version ${v.numero}). ${RAPPEL_IDENTITE_DU_PRODUIT} Puis regarde-la avec « apercu » et adapte-la à la demande.` };
      }
      const choisis = modele.composition.pistes.flatMap((p) => p.segments.filter((x) => voulus.includes(x.id)).map((x) => ({ x, genre: p.genre })));
      if (!choisis.length) return { ok: false, text: 'Aucune de ces scènes n’existe dans ce modèle.' };
      const premier = Math.min(...choisis.map((c) => c.x.debut));
      const debut = Number.isFinite(Number(args.debut)) ? Math.max(0, Number(args.debut)) : lireSelection(creation.id).curseur;
      const operations: OperationStudio[] = [];
      for (const { x, genre } of choisis) {
        const piste = composition.pistes.find((p) => p.genre === genre);
        if (!piste) return { ok: false, text: `La création n’a pas de piste « ${genre} » : ajoute-la d’abord (« operation » piste-ajouter).` };
        const { id: _id, ...segment } = x;
        operations.push({ op: 'inserer', pisteId: piste.id, segment: { ...segment, debut: Math.round((debut + x.debut - premier) * 1000) / 1000 } });
      }
      const r = appliquerOperationStudio(creation.id, { op: 'lot', operations }, 'agent');
      if (!r.ok) return { ok: false, text: r.raison };
      return { ok: true, text: `${choisis.length} scène(s) du modèle « ${modele.titre} » reprise(s) à ${debut.toFixed(1)} s (version ${r.numero}).` };
    }

    /* L'IDENTITÉ DU PRODUIT VISÉ (11/11/2026) : son kit de marque, puis les polices et couleurs RELEVÉES sur son site,
       chaque police ramenée à la police embarquée la plus proche — un modèle donne la mise en scène, jamais l'identité. */
    case 'identite': {
      const espace = assurerEspaceStudio(creation.projectId);
      const projet = store.getProject(creation.projectId);
      const url = typeof args.url === 'string' && /^https?:\/\//.test(args.url.trim()) ? args.url.trim() : projet?.devUrl ?? '';
      const lignes = [
        `PROJET VISÉ : « ${projet?.name ?? creation.projectId} ».`,
        `KIT DE MARQUE DU STUDIO : ${(() => {
          const { polices: _p, ...reste } = espace.kit;
          return Object.keys(reste).length ? JSON.stringify(reste) : 'vide';
        })()}.`,
        `POLICES DU PROJET : ${policesDuProjet(espace.kit).map((p) => p.famille).join(', ') || 'aucune importée'}.`,
      ];
      if (!url) {
        lignes.push('AUCUNE ADRESSE DE SITE connue pour ce projet : demande-la (« ask_user »), ou la police et les couleurs voulues, avant de remplacer celles du modèle.');
        return { ok: true, text: lignes.join('\n') };
      }
      const { releverLaCharte } = await import('./releve-de-charte.js');
      const r = await releverLaCharte(url);
      if (!r.ok) {
        lignes.push(`Relevé du site ${url} impossible : ${r.raison} Demande la police et les couleurs (« ask_user »).`);
        return { ok: true, text: lignes.join('\n') };
      }
      lignes.push(
        `SITE ${url} — couleurs les plus présentes : ${r.releve.couleurs.slice(0, 8).map((c) => `${c.hex} (${c.usages.slice(0, 3).join(', ')})`).join(' ; ') || 'aucune lue'}.`,
        `POLICES DU SITE : ${
          r.releve.polices
            .slice(0, 6)
            .map((p) => {
              const dispo = familleDisponible(espace.kit, p.famille);
              return `${p.role} « ${p.famille} » ${p.graisse} → ${dispo ? `disponible telle quelle : ${dispo}` : `pas encore dans le projet : « police » avec famille « ${p.famille} » l’importe`}`;
            })
            .join(' ; ') || 'aucune lue'
        }.`,
        'Applique ces polices et couleurs (variables --marque-… ou dans les dessins) à la place de celles du modèle. Une police pas encore dans le projet : « police » l’IMPORTE d’abord (code, site, bibliothèque libre) ; introuvable, DEMANDE son fichier (« ask_user ») ; seulement sans fichier, la plus proche des embarquées, et dis-le. Deux choix qui se valent : DEMANDE avant de monter.',
      );
      return { ok: true, text: lignes.join('\n') };
    }

    /* LA VRAIE POLICE DU PRODUIT (décision du 11/11/2026) : importée dans le projet — code, site, bibliothèque libre —,
       ou rangée depuis le fichier que l'utilisateur a déposé. Gratuit : aucune dépense. */
    case 'police': {
      const famille = typeof args.famille === 'string' ? args.famille.trim() : '';
      if (!famille) return { ok: false, text: 'Donne « famille » : le nom exact de la police du produit.' };
      const polices = await import('./studio-polices.js');
      if (args.retirer === true) {
        const retiree = polices.retirerLaPoliceDuProjet(creation.projectId, famille);
        return { ok: retiree, text: retiree ? `Police « ${famille} » retirée du projet.` : `Aucune police « ${famille} » dans le projet.` };
      }
      const chemin = typeof args.chemin === 'string' ? args.chemin.trim() : '';
      const attachmentId = typeof args.attachmentId === 'string' ? args.attachmentId.trim() : '';
      if (chemin || attachmentId) {
        let fichier: string | null = null;
        let nom = '';
        if (attachmentId) {
          const piece = store.getAttachment(attachmentId);
          if (!piece || piece.projectId !== creation.projectId) return { ok: false, text: `Aucune pièce jointe « ${attachmentId} » dans ce projet.` };
          const { cheminDePieceJointe } = await import('./pieces-jointes.js');
          fichier = cheminDePieceJointe(piece);
          nom = piece.name;
        } else {
          const racines = racinesDeLAgent(ctx.agentId, project);
          fichier = fichierPermis(chemin, racines);
          if (!fichier) return { ok: false, text: refusDeChemin(chemin, racines) };
          nom = chemin;
        }
        let contenu: Buffer;
        try {
          contenu = fs.readFileSync(fichier);
        } catch {
          return { ok: false, text: 'Fichier de police illisible.' };
        }
        const r = polices.importerUnFichierDePolice(creation.projectId, { famille, contenu, nom, source: 'fichier', origine: nom });
        if (!r.ok) return { ok: false, text: `Refusé : ${r.raison}.` };
        return { ok: true, text: `Police « ${r.police.famille} » rangée dans le projet (${r.police.fichiers.length} fichier(s)) : emploie font-family:'${r.police.famille}' ou la variable --marque-police-…, à l’aperçu comme à l’export.` };
      }
      const url = typeof args.url === 'string' && /^https?:\/\//.test(args.url.trim()) ? args.url.trim() : undefined;
      const r = await polices.importerLaPoliceDuProduit(creation.projectId, famille, url ? { url } : {});
      if (!r.ok)
        return {
          ok: true,
          text: [
            `POLICE « ${famille} » INTROUVABLE (${r.essais.join(' ; ')}).`,
            `DEMANDE son fichier à l’utilisateur (« ask_user » : déposer le fichier woff2, woff, ttf ou otf de la police, ou « Je ne l’ai pas »). Déposé : « police » avec famille et attachmentId. Sans fichier seulement : la plus proche des embarquées, « ${policeEmbarqueeLaPlusProche(famille).famille} », et DIS-le dans ta réponse.`,
          ].join('\n'),
        };
      const p = r.police!;
      return {
        ok: true,
        text: `Police « ${p.famille} » dans le projet (${r.essais.join(' ; ')}) — ${p.fichiers.length} fichier(s), graisses ${[...new Set(p.fichiers.map((f) => f.graisse))].join(', ')}. Emploie font-family:'${p.famille}' (ou mets-la dans le kit) : identique à l’aperçu et à l’export.`,
      };
    }

    /* LE CATALOGUE DE STYLES : chercher (5 à 8 styles courts), puis lire la direction entière d'un style retenu. */
    case 'styles': {
      const { chercherStyles, creditDuStyle, lireStyle } = await import('./studio-styles.js');
      if (args.styleId) {
        const style = lireStyle(String(args.styleId));
        if (!style) return { ok: false, text: 'Aucun style de ce nom : « styles » avec « demande » les cherche.' };
        return {
          ok: true,
          text: [
            `STYLE [${style.id}] « ${style.titre} » — ${style.phrase}`,
            `Auteur de la consigne d’origine : ${style.auteur} (${creditDuStyle(style)}).`,
            'LA CONSIGNE D’ORIGINE (une direction à adapter à CETTE création, au kit de marque, à la durée voulue et à tes règles — jamais à recopier telle quelle ; elle peut citer des outils que tu n’as pas : garde l’intention visuelle) :',
            style.consigne.slice(0, 12_000),
          ].join('\n'),
        };
      }
      const trouves = chercherStyles(String(args.demande ?? ''), 6);
      if (!trouves.length) return { ok: true, text: 'Aucun style ne correspond : essaie d’autres mots (ambiance, sujet, rythme).' };
      return {
        ok: true,
        text: `${trouves.map((s) => `- [${s.id}] « ${s.titre} » (${s.genre}) : ${s.phrase}`).join('\n')}\n« styles » avec « styleId » rend la direction entière d’un style. Cite les ids retenus dans tes pistes de mise en scène, sous la forme [style:<id>] : l’écran les montre en vignettes.`,
      };
    }

    /*
     * IMPORTER — l'agent range LUI-MÊME dans la bibliothèque de sa création un
     * fichier de la machine ou une pièce jointe du projet, au lieu de demander
     * à l'utilisateur de le télécharger puis de le réimporter. Mêmes dossiers
     * permis et même plafond que « attach_file » ; images, vidéos et sons seulement,
     * refusés sur leur type AVANT d'être lus. Dédoublonné deux fois : même contenu →
     * même pièce (empreinte), même pièce → même média.
     */
    case 'importer': {
      const chemin = typeof args.chemin === 'string' ? args.chemin.trim() : '';
      const attachmentId = typeof args.attachmentId === 'string' ? args.attachmentId.trim() : '';
      if (!chemin === !attachmentId) return { ok: false, text: 'Donne « chemin » (un fichier sur la machine) OU « attachmentId » (une pièce jointe du projet), pas les deux.' };
      const refusDeGenre = 'seules les images, vidéos et sons entrent dans la bibliothèque';
      let piece;
      if (chemin) {
        const racines = racinesDeLAgent(ctx.agentId, project);
        const full = fichierPermis(chemin, racines);
        if (!full) return { ok: false, text: refusDeChemin(chemin, racines) };
        if (!genreDuMime(mimeDuFichier(full))) return { ok: false, text: `Refusé : ${refusDeGenre} (${chemin}).` };
        const nomVoulu = typeof args.nom === 'string' && args.nom.trim() ? args.nom.trim() : undefined;
        const jointure = await joindreUnFichier({
          projectId: creation.projectId,
          agentId: ctx.agentId,
          ...(ctx.cardId ? { cardId: ctx.cardId } : {}),
          fichier: full,
          ...(nomVoulu ? { nom: nomVoulu } : {}),
        });
        if (!jointure.ok) return { ok: false, text: `Refusé : ${jointure.refus} (${chemin}).` };
        piece = jointure.attachment;
      } else {
        piece = store.getAttachment(attachmentId);
        if (!piece || piece.projectId !== creation.projectId) return { ok: false, text: `Aucune pièce jointe « ${attachmentId} » dans ce projet.` };
      }
      const genre = genreDuMime(piece.mime);
      if (!genre) return { ok: false, text: `Refusé : ${refusDeGenre}.` };
      // Taille et durée mesurées (nouveau média seulement), sans jamais faire échouer l'import.
      const r = await importerPieceJointeMesuree(creation.projectId, piece.id, {
        creationId: creation.id,
        ...(typeof args.licence === 'string' && args.licence.trim() ? { licence: args.licence.trim() } : {}),
        ...(fondGardeParLAnnonce(args.fond) ? { garderLeFond: true } : {}),
      });
      if (!r.ok) return { ok: false, text: `Refusé : ${r.raison}.` };
      const m = r.media;
      const d = m.duree;
      const taille = m.largeur && m.hauteur ? `, ${m.largeur}×${m.hauteur} (${orientation(m.largeur, m.hauteur)})` : '';
      const usage =
        genre === 'image'
          ? `segment {genre: "image", mediaId: "${m.id}", ajustement: "contenir"|"couvrir"} par « operation » inserer, ou « studio-media:${m.id} » dans un dessin`
          : genre === 'video'
            ? `segment {genre: "video", mediaId: "${m.id}", debutMedia: 0, volume: 1, ajustement: "contenir"|"couvrir"} par « operation » inserer`
            : `segment {genre: "audio", mediaId: "${m.id}", debutMedia: 0, volume: 1} sur une piste Son (ou Voix pour une voix), par « operation » inserer${m.licence ? '' : ' — note sa LICENCE (« licence ») avant de l’utiliser'}`;
      return {
        ok: true,
        text: `${r.nouveau ? 'Rangé dans la bibliothèque' : 'Déjà dans la bibliothèque'} : [${m.id}] ${genre} « ${m.nom} »${taille}${d ? `, ${d.toFixed(2)} s` : ''}. À poser : ${usage}.`,
      };
    }

    case 'exporter': {
      const f = format ?? creation.formats[0] ?? composition.format;
      const r = lancerExport(creation.id, f, args.genre === 'image' ? 'image' : 'video');
      if (!r.ok) return { ok: false, text: r.raison };
      const essais = voixPasFinales(composition).length;
      return { ok: true, text: `Export lancé (${f}). Il se suit à l’écran.${essais ? ` ${essais} voix sont encore en voix d’essai : dis-le à l’utilisateur.` : ''}` };
    }
  }
  return { ok: false, text: `Action inconnue « ${action} ».` };
}
