import {
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
  dureeDeLaComposition,
  dureeExportee,
  estFormatStudio,
  montantLisible,
  nettoyerDessin,
  trouverSegment,
  validerComposition,
  voixPasFinales,
  voixFinaleDuProjet,
  phraseDansUneAutreVoix,
  tousLesSegments,
} from '@beluga/shared';
import {
  ajouterMedia,
  appliquerOperationStudio,
  assurerEspaceStudio,
  compositionCourante,
  creationDeLAgent,
  enregistrerVersion,
  listerDepenses,
  listerExports,
  listerMedias,
  lireSelection,
  nettoyerLesDessins,
  nouvelId,
} from './studio.js';
import { controlerComposition, imagesDeLaComposition, lancerExport } from './studio-rendu.js';
import { devisDeGeneration, devisDesVoix, fabriquerVoixEssai, fabriquerVoixManquantes, voixDEssaiDisponibles } from './studio-generation.js';
import { listerModeles, lireModele } from './studio-modeles.js';

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
}
interface Resultat {
  ok: boolean;
  text: string;
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

export async function outilStudio(ctx: Contexte, _project: Project, args: Record<string, any>): Promise<Resultat> {
  const creation = creationDeLAgent(ctx.agentId);
  if (!creation) return { ok: false, text: 'Cet outil est réservé à l’agent attitré d’une création du Studio.' };
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
          `CRÉATION « ${creation.titre} » — version ${creation.version}, formats ${creation.formats.join(', ')}, contenu ${dureeDeLaComposition(composition).toFixed(1)} s.`,
          composition.dureeVoulue !== undefined
            ? `DURÉE VOULUE (marqueur bleu posé par l’utilisateur) : ${composition.dureeVoulue.toFixed(1)} s — c’est la longueur visée, l’export COUPE là. Ne la change que par « operation » {op: "composition", dureeVoulue} après accord de l’utilisateur.`
            : 'DURÉE VOULUE : aucune (la vidéo dure ce que dure son contenu).',
          `SÉLECTION À L’ÉCRAN : ${selection.segmentIds.length ? selection.segmentIds.join(', ') : 'aucun segment'}${selection.elementId ? `, pièce « ${selection.elementId} »` : ''}, curseur ${selection.curseur.toFixed(2)} s${selection.format ? `, format affiché ${selection.format}` : ''}.`,
          `KIT DE MARQUE : ${JSON.stringify(espace.kit)}`,
          `FORMATS (largeur × hauteur) : ${CLES_FORMATS_STUDIO.map((f) => `${f} ${FORMATS_STUDIO[f].largeur}×${FORMATS_STUDIO[f].hauteur}`).join(', ')}`,
          `POLICES EMBARQUÉES : ${POLICES_STUDIO.map((p) => p.famille).join(', ')}`,
          `VOIX D’ESSAI (gratuites, champ voixEssai) : ${voixDEssaiDisponibles().map((v) => `${v.id} (${v.label})`).join(', ') || 'aucune posée'}`,
          `VOIX FINALE : UNE SEULE pour toute la création, celle du projet, choisie par l’utilisateur dans la fenêtre « Mettre en production » — aujourd’hui ${voixFinaleDuProjet(espace.voixFinale)}. Aucun segment ne porte sa propre voix finale (le champ voixFinale d’un segment est refusé) ; tu ne la changes pas. Voix possibles : ${VOIX_FINALES_STUDIO.map((v) => `${v.id} (${v.genre}, ${v.timbre})`).join(', ')}`,
          `VOIX PAS ENCORE FINALES : ${voixPasFinales(composition).map((v) => `${v.id} (${v.etat})`).join(', ') || 'aucune'}${(() => {
            const autres = tousLesSegments(composition).filter((s): s is SegmentVoix => s.genre === 'voix' && phraseDansUneAutreVoix(s, voixFinaleDuProjet(espace.voixFinale)));
            return autres.length ? ` — FAITES DANS UNE AUTRE VOIX : ${autres.map((v) => `${v.id} (${v.voixFinale ?? '?'})`).join(', ')}` : '';
          })()}`,
          'PRISE UNIQUE : la voix finale de TOUTE la vidéo est dite d’un seul appel puis découpée phrase par phrase (même timbre, même accent partout). Dès qu’une seule phrase change (texte, ajout, autre voix), le prochain « Valider la voix » refait TOUTE la prise — jamais une phrase seule. Préviens l’utilisateur avant de toucher au texte d’une voix déjà finale.',
          ...(() => {
            const modeles = listerModeles(creation.projectId);
            return modeles.length
              ? [
                  `MODÈLES DU PROJET (${modeles.length}, vidéos validées — « modele » pour en repartir ou reprendre une scène) :`,
                  ...modeles.slice(0, 20).map(
                    (m) =>
                      `- [${m.id}] « ${m.titre} » · ${m.duree.toFixed(1)} s · scènes : ${m.composition.pistes
                        .filter((p) => p.genre === 'visuel')
                        .flatMap((p) => p.segments.map((x) => `${x.id}${x.nom ? ` (${x.nom})` : ''}`))
                        .join(', ')}`,
                  ),
                ]
              : ['MODÈLES DU PROJET : aucun.'];
          })(),
          `BIBLIOTHÈQUE (${medias.length}) :`,
          ...medias.slice(0, 60).map(
            (m) =>
              `- [${m.id}] ${m.genre} · ${m.provenance} · « ${m.nom} »${m.categorie ? ` · ${m.categorie}` : ''}${m.usage ? ` · ${m.usage}` : ''}${m.duree ? ` · ${m.duree.toFixed(1)} s` : ''}${m.licence ? ` · licence : ${m.licence}` : m.genre === 'audio' && m.provenance === 'import' ? ' · SANS LICENCE NOTÉE (inutilisable)' : ''}`,
          ),
          depenses.length ? `DEVIS EN ATTENTE DU CLIC : ${depenses.map((d) => `${d.genre} ${montantLisible(d.plafond)}`).join(', ')}` : 'DEVIS EN ATTENTE : aucun.',
          exports.length ? `DERNIERS EXPORTS : ${exports.map((e) => `${e.format} ${e.genre} ${e.etat}`).join(', ')}` : 'EXPORTS : aucun.',
          `COMPOSITION : ${compositionPourLAgent(composition)}`,
        ].join('\n'),
      };
    }

    case 'composer': {
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
        text: `Composition posée (version ${v.numero}, contenu ${dureeDeLaComposition(propre.composition).toFixed(1)} s, vidéo ${dureeExportee(propre.composition).toFixed(1)} s). ${texteDuControle([], [...valide.avertissements, ...propre.avertissements, ...controle.avertissements])}\nRegarde-la avec « apercu ».`,
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
        const piste = composition.pistes.find((p) => p.id === args.pisteId) ?? composition.pistes.find((p) => p.genre === 'visuel');
        if (!piste) return { ok: false, text: 'Aucune piste visuelle : ajoute-en une avec « operation » piste-ajouter.' };
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
        const d = await devisDesVoix(creation.id);
        if (!d.ok) return { ok: false, text: d.raison };
        return {
          ok: true,
          text: `Devis de la voix finale, en UNE seule prise pour toute la vidéo : ${d.devis.segments.length} phrase(s), ≈ ${Math.round(d.devis.secondes)} s, plafond ${montantLisible(d.devis.plafond)}, payé par l’espace OpenRouter de Beluga Build${d.devis.cle ? '' : ' — MAIS aucune clé OpenRouter n’est au coffre-fort : dis-le à l’utilisateur, la fenêtre « Mettre en production » le mène au coffre'}. Seul l’utilisateur la lance, avec « Valider la voix » dans la fenêtre « Mettre en production ».`,
        };
      }
      if (args.segmentId) {
        const r = await fabriquerVoixEssai(creation.id, String(args.segmentId));
        return r.ok ? { ok: true, text: `Voix d’essai posée : ${r.duree.toFixed(2)} s. La scène et les sous-titres sont recalés.` } : { ok: false, text: r.raison };
      }
      const r = await fabriquerVoixManquantes(creation.id);
      return { ok: !r.erreurs.length || r.faites > 0, text: `${r.faites} voix d’essai fabriquée(s).${r.erreurs.length ? ` Problèmes : ${r.erreurs.join(' · ')}` : ''}` };
    }

    case 'generer': {
      const genre = String(args.genre ?? '');
      if (genre !== 'musique' && genre !== 'image' && genre !== 'clip') return { ok: false, text: 'genre : musique, image ou clip.' };
      const r = await devisDeGeneration({
        creationId: creation.id,
        genre,
        consigne: String(args.consigne ?? ''),
        duree: Number(args.duree),
        ...(format ? { format } : {}),
        avecSon: !!args.avecSon,
        raison: String(args.raison ?? ''),
        demandeePar: 'agent',
      });
      if (!r.ok) return { ok: false, text: r.raison };
      return {
        ok: true,
        text: `Devis posé à l’écran (${genre}, ${r.depense.plafond === null ? 'prix non publié par le fournisseur' : montantLisible(r.depense.plafond)}). RIEN n’est lancé : l’utilisateur valide ou refuse d’un clic. Dis-lui pourquoi c’est utile, en une phrase.`,
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
        return { ok: true, text: `La création repart du modèle « ${modele.titre} » (version ${v.numero}). Regarde-la avec « apercu », puis adapte-la à la demande.` };
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
