/**
 * LE PERSONNAGE 3D ANIMÉ DU STUDIO (demande du 01/11/2026) — côté démon.
 *
 *  1. DEVIS (`devisDuPersonnage3d`, outil « studio » action « modele3d ») : l'agent
 *     ne dépense rien ; une dépense « modele3d » EN ATTENTE paraît avec son prix
 *     (crédits Meshy et leur estimation en dollars). MEM-4352 : seul un clic humain
 *     la valide.
 *  2. AU CLIC (`lancerLePersonnage3d`, depuis `studio.depense.valider`) : Meshy
 *     fabrique le modèle d'après l'image, son squelette, puis les mouvements ; le
 *     bloc d'attente paraît au bas du fil (MEM-5372).
 *  3. LE TOURNAGE, dans la file lourde (`rendu-3d.ts`) : une WebM transparente par
 *     mouvement, rangée dans la bibliothèque de la création et POSÉE sur sa piste
 *     (une version « systeme », qu'« Annuler » défait).
 *  4. LE COÛT RÉEL : les crédits rendus par chaque tâche (`consumed_credits`), au
 *     tarif du compte ; affiché sous le média livré (`medias-livres.ts`).
 *
 * Le modèle rigué est GARDÉ (fichier local + tâche de squelette) : refilmer un autre
 * mouvement ne coûte que ce mouvement (3 crédits), ou rien pour la marche et la course.
 * Les fichiers de Meshy ne vivent que 3 jours chez lui : ils sont rapatriés aussitôt.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  CADRE_RENDU_3D,
  CATALOGUE_PUBLIC_MESHY,
  CREDITS_MESHY,
  DOLLARS_PAR_CREDIT_MESHY,
  MOUVEMENTS_OFFERTS_MESHY,
  type Creation,
  type DepenseStudio,
  type GenreDeTacheMeshy,
  type MouvementMeshy,
  type RequeteMeshy,
  devisPersonnage3d,
  dureeDuMouvement3d,
  glbDeLaTache,
  lireCatalogueMeshy,
  lireCreationMeshy,
  lireSuiviMeshy,
  montantLisible,
  mouvementsDemandes,
  requeteDeSuiviMeshy,
  requeteDesMouvements,
  requeteDuSquelette,
  requeteImageVers3d,
  AgentQuestion,
} from '@beluga/shared';
import { CONFIG } from './config.js';
import { getMeta, setMeta } from './db.js';
import { dansLaFileLourde } from './file-lourde.js';
import { joindreUnFichier } from './joindre-fichier.js';
import { log } from './logger.js';
import { annoncerUnMedia, terminerUnMedia } from './medias-en-fabrication.js';
import { cheminDePieceJointe } from './pieces-jointes.js';
import { filmerUnModele3d } from './rendu-3d.js';
import * as store from './store.js';
import {
  ajouterMedia,
  appliquerOperationStudio,
  compositionCourante,
  creerDepense,
  ecrireDetailsDepense,
  fichierDuMedia,
  lireCreation,
  lireDepense,
  lireMedia,
  solderDepense,
} from './studio.js';
import { cleDuService } from './studio-services.js';

type Resultat<T> = ({ ok: true } & T) | { ok: false; raison: string };

/** Le rythme du suivi des tâches Meshy (surchargé par les tests). */
export const RYTHME_MESHY = { pauseMs: 5_000, delaiMaxMs: 40 * 60_000 };

const dossierDes3d = (creationId: string) => path.join(CONFIG.dataDir, 'studio', '3d', creationId);
const cleDesModeles = (creationId: string) => `studio.3d.modeles.${creationId}`;

/** Un modèle 3D GARDÉ pour une création : refilmé sans repayer le personnage. */
export interface ModeleGarde {
  id: string;
  nom: string;
  /** La tâche de squelette chez Meshy (sert aux mouvements payés). */
  tacheSquelette: string;
  /** Le personnage rigué, rapatrié. */
  glb: string;
  creeLe: number;
}

export function modelesGardes(creationId: string): ModeleGarde[] {
  try {
    const brut = getMeta(cleDesModeles(creationId));
    return brut ? (JSON.parse(brut) as ModeleGarde[]).filter((m) => fs.existsSync(m.glb)) : [];
  } catch {
    return [];
  }
}

function garderLeModele(creationId: string, m: ModeleGarde): void {
  const liste = [...modelesGardes(creationId).filter((x) => x.id !== m.id), m].slice(-20);
  setMeta(cleDesModeles(creationId), JSON.stringify(liste));
}

/** Le tarif d'un crédit : celui posé par l'utilisateur (méta), sinon l'offre Pro. */
export function dollarsParCreditMeshy(): number {
  const n = Number(getMeta('studio.meshy.dollarsParCredit'));
  return Number.isFinite(n) && n > 0 ? n : DOLLARS_PAR_CREDIT_MESHY;
}

/* ------------------------------------------------------------------ */
/* Le catalogue des mouvements (public, sans clé)                       */
/* ------------------------------------------------------------------ */

let catalogue: { lu: number; liste: MouvementMeshy[] } | null = null;

export async function catalogueDesMouvements(): Promise<MouvementMeshy[]> {
  if (catalogue && Date.now() - catalogue.lu < 24 * 3600_000) return catalogue.liste;
  try {
    const r = await fetch(CATALOGUE_PUBLIC_MESHY, { signal: AbortSignal.timeout(20_000) });
    const liste = lireCatalogueMeshy(await r.json());
    if (liste.length) catalogue = { lu: Date.now(), liste };
  } catch (err) {
    log.warn(`studio 3d : catalogue des mouvements illisible (${(err as Error).message})`);
  }
  return catalogue?.liste ?? [];
}

/** Le catalogue, en texte pour l'agent : filtré par des mots, borné. */
export async function catalogueEnTexte(recherche: string): Promise<string> {
  const liste = await catalogueDesMouvements();
  const mots = recherche.toLowerCase().split(/\s+/).filter(Boolean);
  const trouves = (mots.length ? liste.filter((m) => mots.some((w) => `${m.nom} ${m.categorie} ${m.sousCategorie}`.toLowerCase().includes(w))) : liste).slice(0, 80);
  return [
    `MOUVEMENTS OFFERTS (avec le squelette, sans frais) : ${MOUVEMENTS_OFFERTS_MESHY.map((m) => `${m.id} ${m.nom}`).join(', ')}.`,
    `MOUVEMENTS DU CATALOGUE (${CREDITS_MESHY.mouvement} crédits chacun) — ${liste.length} au total${mots.length ? `, ${trouves.length} pour « ${recherche} »` : ''} (« demande » filtre par mots anglais : walk, dance, wave, jump…) :`,
    ...trouves.map((m) => `- ${m.id} : ${m.nom} (${m.categorie} / ${m.sousCategorie})`),
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* 1. Le devis                                                          */
/* ------------------------------------------------------------------ */

function imageDuPersonnage(creation: Creation, args: Record<string, unknown>): Resultat<{ fichier: string; nom: string }> {
  const mediaId = String(args.imageSource ?? '').trim();
  if (mediaId) {
    const m = lireMedia(mediaId);
    if (!m || m.projectId !== creation.projectId || m.genre !== 'image') return { ok: false, raison: `« ${mediaId} » n’est pas une image de la bibliothèque de ce projet` };
    const fichier = fichierDuMedia(m);
    if (!fichier || !fs.existsSync(fichier)) return { ok: false, raison: `le fichier de « ${m.nom} » est introuvable` };
    return { ok: true, fichier, nom: m.nom };
  }
  const attachmentId = String(args.attachmentId ?? '').trim();
  if (attachmentId) {
    const piece = store.getAttachment(attachmentId);
    if (!piece || piece.projectId !== creation.projectId || !/^image\/(png|jpe?g|webp)$/i.test(piece.mime)) return { ok: false, raison: `la pièce « ${attachmentId} » n’est pas une image PNG, JPEG ou WebP de ce projet` };
    return { ok: true, fichier: cheminDePieceJointe(piece), nom: piece.name };
  }
  return { ok: false, raison: 'il faut « imageSource » (une image de la bibliothèque), « attachmentId » (une pièce jointe) ou « modeleId » (un modèle 3D déjà gardé)' };
}

export async function devisDuPersonnage3d(creation: Creation, args: Record<string, unknown>): Promise<{ ok: boolean; text: string; question?: AgentQuestion }> {
  if (args.catalogue === true) return { ok: true, text: await catalogueEnTexte(String(args.demande ?? '')) };
  if (!cleDuService('meshy')) {
    return { ok: false, text: 'Meshy n’a pas sa clé : dis-le à l’utilisateur — il crée un compte sur meshy.ai, achète des crédits, puis colle sa clé dans les paramètres, rubrique « Services de création ». Rien n’est chiffré avant.' };
  }
  const garde = String(args.modeleId ?? '').trim();
  const modele = garde ? modelesGardes(creation.id).find((m) => m.id === garde) : undefined;
  if (garde && !modele) return { ok: false, text: `Aucun modèle 3D gardé « ${garde} » sur cette création. Modèles gardés : ${modelesGardes(creation.id).map((m) => `${m.id} (${m.nom})`).join(', ') || 'aucun'}.` };
  const image = modele ? null : imageDuPersonnage(creation, args);
  if (image && !image.ok) return { ok: false, text: `Devis impossible : ${image.raison}.` };
  const mouvements = mouvementsDemandes(args.mouvements, await catalogueDesMouvements());
  if (!mouvements.ok) return { ok: false, text: `Devis impossible : ${mouvements.raison}.` };
  const composition = compositionCourante(creation.id);
  const pisteId = String(args.pisteId ?? '').trim();
  if (pisteId && !composition?.pistes.some((p) => p.id === pisteId && p.genre === 'video')) return { ok: false, text: `« ${pisteId} » n’est pas une piste Vidéo de la création (sans « pisteId », une piste Vidéo est ajoutée au premier plan).` };
  const duree = dureeDuMouvement3d(args.duree);
  const debut = Number(args.debut) >= 0 ? Math.round(Number(args.debut) * 100) / 100 : 0;
  const taux = dollarsParCreditMeshy();
  const devis = devisPersonnage3d({ modeleNeuf: !modele, mouvements: mouvements.ids, dollarsParCredit: taux });
  const nom = String(args.nom ?? '').trim().slice(0, 60) || (modele ? modele.nom : (image as { nom: string }).nom.replace(/\.[a-z0-9]+$/i, '')) || 'Personnage 3D';
  const catalogueLu = await catalogueDesMouvements();
  const nomsDesMouvements = mouvements.ids.map((id) => MOUVEMENTS_OFFERTS_MESHY.find((m) => m.id === id)?.nom ?? catalogueLu.find((m) => m.id === id)?.nom ?? String(id));
  const detail = [
    ...(modele ? [] : [`modèle et squelette (${CREDITS_MESHY.modele + CREDITS_MESHY.squelette} crédits)`]),
    `${nomsDesMouvements.join(', ')}${devis.payants.length ? ` (${devis.payants.length * CREDITS_MESHY.mouvement} crédits)` : ' (offert)'}`,
  ].join(' + ');
  const depense = creerDepense({
    projectId: creation.projectId,
    creationId: creation.id,
    genre: 'modele3d',
    modele: 'meshy',
    plafond: devis.dollars,
    raison: `Personnage 3D « ${nom} » chez Meshy : ${detail} — ${devis.credits} crédits ≈ ${montantLisible(devis.dollars)} (${taux} $ le crédit). Filmé sans fond, ${duree} s par mouvement, posé sur la ligne de temps.`,
    details: {
      nom,
      ...(modele ? { modeleId: modele.id } : { image: (image as { fichier: string }).fichier }),
      mouvements: mouvements.ids,
      nomsDesMouvements,
      duree,
      debut,
      ...(pisteId ? { pisteId } : {}),
      credits: devis.credits,
      taux,
      /* Proposée dans le fil : l'encadré au-dessus de la conversation ne la montre pas une seconde fois. */
      duFil: true,
    },
    demandeePar: 'agent',
  });
  return {
    ok: true,
    text: `Devis posé (${depense.id}) : ${devis.credits} crédits Meshy ≈ ${montantLisible(devis.dollars)}. Le bouton « Générer · prix » part dans le fil : rien ne part sans le clic de l’utilisateur, et ce clic ne te réveille pas. Dis en UNE phrase ce que ce personnage apportera, puis termine ton tour.`,
    question: AgentQuestion.parse({
      id: store.newId(),
      question: `Générer le personnage 3D « ${nom} » ?`,
      description: detail,
      kind: 'text',
      options: [],
      allowFreeText: true,
      depenseDuFil: { genre: 'modele3d', creationId: creation.id, plafond: devis.dollars, depenseId: depense.id },
    }),
  };
}

/* ------------------------------------------------------------------ */
/* 2. La fabrication, au clic                                           */
/* ------------------------------------------------------------------ */

async function appelerMeshy(r: RequeteMeshy): Promise<{ statut: number; corps: any }> {
  const reponse = await fetch(r.adresse, {
    method: r.methode,
    headers: r.entetes,
    ...(r.corps !== undefined ? { body: JSON.stringify(r.corps) } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  const texte = await reponse.text().catch(() => '');
  try {
    return { statut: reponse.status, corps: texte ? JSON.parse(texte) : {} };
  } catch {
    return { statut: reponse.status, corps: texte };
  }
}

/** Crée une tâche puis la suit jusqu'au bout ; rend la tâche finie et ses crédits. */
async function tacheMeshy(cle: string, genre: GenreDeTacheMeshy, requete: RequeteMeshy, avancer: (texte: string) => void): Promise<{ id: string; tache: any; credits: number }> {
  const cree = await appelerMeshy(requete);
  const lu = lireCreationMeshy(genre, cree.statut, cree.corps);
  if (!lu.ok) throw new Error(lu.raison);
  return suivreMeshy(cle, genre, lu.id, avancer);
}

async function suivreMeshy(cle: string, genre: GenreDeTacheMeshy, id: string, avancer: (texte: string) => void): Promise<{ id: string; tache: any; credits: number }> {
  const limite = Date.now() + RYTHME_MESHY.delaiMaxMs;
  while (Date.now() < limite) {
    let suivi: { statut: number; corps: any };
    try {
      suivi = await appelerMeshy(requeteDeSuiviMeshy(cle, genre, id));
    } catch {
      await new Promise((r) => setTimeout(r, RYTHME_MESHY.pauseMs));
      continue;
    }
    const e = lireSuiviMeshy(suivi.statut, suivi.corps);
    if (e.etat === 'fini') return { id, tache: e.tache, credits: e.credits ?? 0 };
    if (e.etat === 'echec') throw new Error(`${e.raison}${e.rembourse ? ' (crédits remboursés par Meshy)' : ''}`);
    avancer(`${genre} ${Math.round(e.progression)} %`);
    await new Promise((r) => setTimeout(r, RYTHME_MESHY.pauseMs));
  }
  throw new Error(`Meshy n’a pas fini la tâche ${id} à temps : elle continue chez lui, refaites le devis plus tard`);
}

async function rapatrier(url: string, fichier: string): Promise<string> {
  const r = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!r.ok) throw new Error(`téléchargement du modèle refusé (${r.status})`);
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  fs.writeFileSync(fichier, Buffer.from(await r.arrayBuffer()));
  return fichier;
}

function enDataUri(fichier: string): string {
  const ext = path.extname(fichier).slice(1).toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(fichier).toString('base64')}`;
}

const enCours = new Set<string>();

/** Le clic « Valider » d'une dépense « modele3d » : la fabrication part, sans bloquer la commande. */
export function lancerLePersonnage3d(depenseId: string): void {
  if (enCours.has(depenseId)) return;
  enCours.add(depenseId);
  void fabriquerLePersonnage3d(depenseId)
    .catch((err) => log.warn(`studio 3d : ${depenseId} — ${(err as Error).message}`))
    .finally(() => enCours.delete(depenseId));
}

/** Au redémarrage : une fabrication validée et jamais soldée est dite coupée, jamais laissée « en cours ». */
export function rattraperLesPersonnages3dCoupes(depenses: readonly DepenseStudio[]): void {
  for (const d of depenses) if (d.genre === 'modele3d' && d.etat === 'validee' && !enCours.has(d.id)) solderDepense(d.id, { erreur: 'fabrication coupée par un redémarrage du serveur : refaites le devis (les crédits déjà pris chez Meshy y restent)' });
}

export async function fabriquerLePersonnage3d(depenseId: string): Promise<void> {
  const depense = lireDepense(depenseId);
  if (!depense || depense.genre !== 'modele3d' || depense.etat !== 'validee') return;
  const creation = lireCreation(depense.creationId);
  const cle = cleDuService('meshy');
  const d = depense.details as {
    nom: string;
    image?: string;
    modeleId?: string;
    mouvements: number[];
    nomsDesMouvements?: string[];
    duree: number;
    debut: number;
    pisteId?: string;
    taux?: number;
  };
  const taux = Number(d.taux) > 0 ? Number(d.taux) : dollarsParCreditMeshy();
  let credits = 0;
  const bloc = creation
    ? annoncerUnMedia({
        projectId: creation.projectId,
        cardId: creation.cardId ?? null,
        agentId: creation.agentId ?? null,
        sujet: `Personnage 3D — ${d.nom}`,
        outil: 'Meshy · personnage 3D animé',
        prix: depense.plafond,
        format: '3:4',
        genre: 'video',
        suivi: 'service',
      })
    : null;
  const avancer = (texte: string) => ecrireDetailsDepense(depenseId, { ...depense.details, avancement: texte });
  try {
    if (!creation) throw new Error('la création a disparu');
    if (!cle) throw new Error('Meshy n’a plus sa clé : recollez-la dans « Services de création »');
    const dossier = dossierDes3d(creation.id);

    // LE MODÈLE RIGUÉ : neuf (image → modèle → squelette) ou gardé.
    let modele = d.modeleId ? modelesGardes(creation.id).find((m) => m.id === d.modeleId) : undefined;
    let tacheSquelette: any = null;
    if (!modele) {
      if (!d.image || !fs.existsSync(d.image)) throw new Error('l’image du personnage est introuvable');
      const brut = await tacheMeshy(cle, 'image-to-3d', requeteImageVers3d(cle, enDataUri(d.image)), avancer);
      credits += brut.credits;
      const rig = await tacheMeshy(cle, 'rigging', requeteDuSquelette(cle, brut.id), avancer);
      credits += rig.credits;
      tacheSquelette = rig.tache;
      const url = glbDeLaTache('rigging', rig.tache);
      if (!url) throw new Error('Meshy n’a rendu aucun personnage rigué');
      const glb = await rapatrier(url, path.join(dossier, `${rig.id}.glb`));
      modele = { id: rig.id, nom: d.nom, tacheSquelette: rig.id, glb, creeLe: Date.now() };
      garderLeModele(creation.id, modele);
    }

    // LES MOUVEMENTS : offerts (marche, course) lus sur le squelette ; payés, en une seule tâche.
    const fichiers: { id: number; glb: string; clip: number }[] = [];
    const offerts = d.mouvements.filter((id) => id < 0);
    const payants = d.mouvements.filter((id) => id >= 0);
    if (offerts.length) {
      tacheSquelette ??= (await suivreMeshy(cle, 'rigging', modele.tacheSquelette, avancer)).tache;
      for (const id of offerts) {
        const cleOfferte = MOUVEMENTS_OFFERTS_MESHY.find((m) => m.id === id)!.cle;
        const url = glbDeLaTache('rigging', tacheSquelette, cleOfferte);
        if (!url) throw new Error(`Meshy n’a pas rendu le mouvement offert « ${cleOfferte} »`);
        fichiers.push({ id, glb: await rapatrier(url, path.join(dossier, `${modele.id}-${cleOfferte}.glb`)), clip: 0 });
      }
    }
    if (payants.length) {
      const anim = await tacheMeshy(cle, 'animations', requeteDesMouvements(cle, modele.tacheSquelette, payants), avancer);
      credits += anim.credits;
      const url = glbDeLaTache('animations', anim.tache);
      if (!url) throw new Error('Meshy n’a rendu aucun fichier de mouvements');
      const glb = await rapatrier(url, path.join(dossier, `${anim.id}.glb`));
      payants.forEach((id, rang) => fichiers.push({ id, glb, clip: rang }));
    }

    // LE TOURNAGE, PUIS LA POSE : une vidéo transparente par mouvement, l'une après l'autre sur la piste.
    const ordre = d.mouvements.map((id) => fichiers.find((f) => f.id === id)!).filter(Boolean);
    let pisteId = d.pisteId && compositionCourante(creation.id)?.pistes.some((p) => p.id === d.pisteId) ? d.pisteId : '';
    if (!pisteId) {
      const ajout = appliquerOperationStudio(creation.id, { op: 'piste-ajouter', genre: 'video', position: 0 }, 'systeme');
      if (!ajout.ok) throw new Error(`piste impossible à ajouter : ${ajout.raison}`);
      pisteId = ajout.composition.pistes[0]!.id;
    }
    let premiere: string | null = null;
    let debut = d.debut;
    for (const [rang, f] of ordre.entries()) {
      const nomDuMouvement = d.nomsDesMouvements?.[d.mouvements.indexOf(f.id)] ?? String(f.id);
      const sortie = path.join(dossier, `${modele.id}-${f.id}-${Date.now()}.webm`);
      avancer(`tournage ${rang + 1}/${ordre.length}`);
      await dansLaFileLourde(() => filmerUnModele3d({ glb: f.glb, clip: f.clip, sortie, duree: d.duree, ...CADRE_RENDU_3D }));
      const jointe = await joindreUnFichier({ projectId: creation.projectId, cardId: creation.cardId, fichier: sortie, nom: `${d.nom} — ${nomDuMouvement}.webm` });
      fs.rmSync(sortie, { force: true });
      if (!jointe.ok) throw new Error(jointe.refus);
      premiere ??= jointe.attachment.id;
      const media = ajouterMedia({
        projectId: creation.projectId,
        creationId: creation.id,
        genre: 'video',
        provenance: 'genere',
        nom: `${d.nom} — ${nomDuMouvement}`,
        attachmentId: jointe.attachment.id,
        mime: 'video/webm',
        duree: d.duree,
        largeur: CADRE_RENDU_3D.largeur,
        hauteur: CADRE_RENDU_3D.hauteur,
        categorie: 'personnage-3d',
        usage: `Personnage 3D sans fond (modèle gardé ${modele.id})`,
        licence: 'Fabriqué par Meshy pour ce compte',
      });
      const pose = appliquerOperationStudio(
        creation.id,
        { op: 'inserer', pisteId, segment: { genre: 'video', debut, duree: d.duree, mediaId: media.id, ajustement: 'contenir', debutMedia: 0, volume: 0, nom: media.nom } },
        'systeme',
      );
      if (!pose.ok) log.warn(`studio 3d : « ${media.nom} » rangé mais non posé (${pose.raison})`);
      debut = Math.round((debut + d.duree) * 100) / 100;
    }
    const montantReel = Math.round(credits * taux * 1e4) / 1e4;
    ecrireDetailsDepense(depenseId, { ...depense.details, avancement: 'fini', credits, ...(premiere ? { attachmentId: premiere } : {}) });
    solderDepense(depenseId, { montantReel });
    if (bloc) terminerUnMedia(bloc.id, { attachmentId: premiere, prix: montantReel, legende: `Personnage 3D « ${d.nom} » filmé sans fond (${(d.nomsDesMouvements ?? []).join(', ')}) et posé sur la ligne de temps — ${credits} crédits Meshy, soit ${montantLisible(montantReel)}.` });
  } catch (err) {
    const raison = String((err as Error)?.message ?? err).slice(0, 300);
    ecrireDetailsDepense(depenseId, { ...depense.details, avancement: 'echec', credits });
    solderDepense(depenseId, { erreur: raison, montantReel: Math.round(credits * taux * 1e4) / 1e4 });
    if (bloc) terminerUnMedia(bloc.id, { echec: raison });
    throw err;
  }
}

/** Pour l'agent qui lit sa création : les modèles gardés, refilmables sans repayer le personnage. */
export function ligneDesModelesGardes(creationId: string): string {
  const liste = modelesGardes(creationId);
  return liste.length ? `MODÈLES 3D GARDÉS (« modele3d » avec « modeleId » : seul le mouvement se paie) : ${liste.map((m) => `${m.id} (${m.nom})`).join(', ')}` : '';
}
