/*
 * L'OUTIL « ordinateur » DES AGENTS (carte « Choisir l'ordinateur visé depuis le téléphone », 15/11/2026 ; gestes de
 * pilotage du Mac : carte « Piloter le Mac depuis Beluga », 21/11/2026).
 *
 * Lister les ordinateurs de la personne qui parle, puis agir sur l'un d'eux par son programme du Mac
 * (`scripts/relais-mac/relais.js`) : applications, réglages, pilotage d'une application par AppleScript, écran entier
 * (capture, clic, frappe), terminal, corbeille.
 *
 * LES PORTES, À CHAQUE GESTE (`shared/src/droits-d-ordinateur.ts`) :
 *  1. le DROIT du geste, relu en base (Réglages › Extension › l'ordinateur) : éteint → refusé, la phrase le dit ;
 *  2. le TERMINAL et toute SUPPRESSION posent une DEMANDE D'ACCORD qui BLOQUE l'agent comme `ask_user` (DEC-026) :
 *     la fenêtre d'accord s'ouvre dans Beluga chez le propriétaire de l'ordinateur, la SUITE joue le geste après
 *     « Accepter ». « Accepter pour toute la carte » couvre les commandes suivantes de ce même tour, sur ce même
 *     ordinateur — JAMAIS une commande qui supprime, redemandée à chaque fois ;
 *  3. le programme du Mac garde ses propres bornes (application installée, écran principal, corbeille seulement).
 *
 * PÉRIMÈTRE : seulement les ordinateurs du compte de l'INTERLOCUTEUR de l'agent ; un ordinateur éteint se dit, sans
 * bascule sur un autre (décision de l'utilisateur du 15/11/2026).
 */
import {
  AgentQuestion,
  GESTES_DE_L_ORDINATEUR,
  LIBELLE_DU_NAVIGATEUR,
  LIBELLE_ETAT_DU_RELAIS,
  REPONSE_ACCEPTER_POUR_LA_CARTE,
  accordPourLaCarteTient,
  cheminASupprimer,
  choixDeLAccord,
  commandeSupprime,
  commandeValable,
  droitDuGeste,
  droitsDeLOrdinateur,
  issueDeLAccord,
  nomDApplicationValable,
  ordinateurEnLigne,
  ordinateurParDefaut,
  phraseDeLAccord,
  programmeEnLigne,
  refusDuScript,
  reglageValable,
  resoudreLOrdinateur,
  scriptSupprime,
  texteATaper,
  texteDuDroitEteint,
  texteInjoignable,
  type AccordDOrdinateur,
  type Ordinateur,
} from '@beluga/shared';
import * as store from './store.js';
import type { ToolContext, ToolDef, ToolResult } from './tools.js';

/** Les gestes ajoutés par la version 4 du programme du Mac : un programme plus ancien se met d'abord à jour. */
const GESTES_DE_LA_VERSION_4 = new Set(['fermer_application', 'reglage', 'piloter', 'ecran_capturer', 'ecran_cliquer', 'ecran_taper', 'ecran_touche', 'terminal', 'supprimer']);

export const OUTIL_ORDINATEUR: ToolDef = {
  name: 'ordinateur',
  description:
    'LES ORDINATEURS DE LA PERSONNE QUI TE PARLE (Réglages → Extension) et ce que Beluga a le DROIT d’y faire. ' +
    '« lister » : leur état, navigateurs, programme du Mac et droits allumés. Sur un Mac où le programme est installé : ' +
    '« applications » / « ouvrir_application » / « fermer_application » (nom) ; « reglage » (reglage : volume [valeur ' +
    '0-100], sourdine, mode_sombre, wifi [valeur oui/non], luminosite [plus/moins], veille_ecran) ; « piloter » ' +
    '(application, script : AppleScript envoyé à CETTE application, ex. créer un rendez-vous dans Calendrier — jamais ' +
    '« do shell script ») ; « ecran_capturer » (l’écran entier, joint au fil) puis « ecran_cliquer » (x, y en FRACTIONS ' +
    'de la capture, double, droit) / « ecran_taper » (texte) / « ecran_touche » (touche : entree, effacer, tab, echap, ' +
    'espace, haut, bas, gauche, droite, ou une lettre ; modificateurs : cmd, maj, option, ctrl) ; « terminal » ' +
    '(commande, phrase : ce que tu veux faire, en clair, pour la personne ; delai en secondes, 120 par défaut) et ' +
    '« supprimer » (chemin, phrase : met À LA CORBEILLE). PRÉFÈRE les gestes nommés au terminal et à l’écran. ' +
    'Le terminal et toute suppression ATTENDENT L’ACCORD de la personne dans une fenêtre de Beluga : l’appel ne rend la ' +
    'main qu’après sa réponse ; un refus ne se contourne jamais (ni par l’écran, ni par un script). Un droit éteint se ' +
    'dit à la personne. « ordinateur » (son nom) vise un autre ordinateur que celui retenu ; un ordinateur éteint : ' +
    'dis-le, ne bascule jamais sur un autre. Pour agir DANS le navigateur, outil « chrome ».',
  inputSchema: {
    type: 'object',
    required: ['geste'],
    properties: {
      geste: { type: 'string', enum: [...GESTES_DE_L_ORDINATEUR] },
      nom: { type: 'string', description: 'ouvrir_application / fermer_application : le nom de l’application (« Mail », « Finder »…)' },
      reglage: { type: 'string', enum: ['volume', 'sourdine', 'luminosite', 'mode_sombre', 'wifi', 'veille_ecran'] },
      valeur: { description: 'reglage : 0-100 (volume), oui/non (sourdine, mode_sombre, wifi), plus/moins (luminosite)' },
      application: { type: 'string', description: 'piloter : l’application visée' },
      script: { type: 'string', description: 'piloter : les lignes AppleScript jouées dans « tell application … »' },
      x: { type: 'number' },
      y: { type: 'number' },
      double: { type: 'boolean' },
      droit: { type: 'boolean', description: 'ecran_cliquer : clic droit' },
      texte: { type: 'string', description: 'ecran_taper : le texte' },
      touche: { type: 'string' },
      modificateurs: { type: 'array', items: { type: 'string', enum: ['cmd', 'maj', 'option', 'ctrl'] } },
      commande: { type: 'string', description: 'terminal : la commande exacte (zsh, dossier personnel)' },
      delai: { type: 'number', description: 'terminal : secondes avant de couper (5 à 600, défaut 120)' },
      chemin: { type: 'string', description: 'supprimer : le chemin absolu (ou depuis ~/) à mettre à la corbeille' },
      phrase: { type: 'string', description: 'terminal / supprimer / piloter qui supprime : ce que tu veux faire, en une phrase claire pour la personne' },
      ordinateur: { type: 'string', description: 'L’ordinateur visé (son nom) ; défaut : celui retenu pour la carte' },
    },
  },
};

function ligneDOrdinateur(o: Ordinateur, retenu: string | null): string {
  const navigateurs = o.navigateurs.map((n) => `${LIBELLE_DU_NAVIGATEUR[n.genre]}${n.enLigne ? ' (ouvert)' : ' (fermé)'}`).join(', ') || 'aucun navigateur';
  const programme = o.programme ? `programme du Mac : ${LIBELLE_ETAT_DU_RELAIS[o.programme.etat]}` : 'pas de programme du Mac';
  const droits = droitsDeLOrdinateur(o.droits);
  const allumes = Object.entries(droits)
    .filter(([, v]) => v)
    .map(([k]) => k);
  return `- « ${o.nom} »${o.id === retenu ? ' — RETENU pour cette carte' : ''} : ${ordinateurEnLigne(o) ? 'allumé' : 'éteint ou hors ligne'} ; ${navigateurs} ; ${programme} ; droits allumés : ${allumes.join(', ') || 'aucun'}.`;
}

/* ------------------------------------------------------------------ */
/* « Accepter pour toute la carte » : le terminal, pour CE tour         */
/* ------------------------------------------------------------------ */

/**
 * LES ACCORDS « POUR TOUTE LA CARTE » : (ordinateur, carte ou agent) → le tour pendant lequel l'accord a été donné.
 * Il ne vaut que tant que CE tour tourne : la fin du travail (rapport rendu, arrêt, carte rangée) le fait tomber sans
 * rien à nettoyer. En mémoire seulement : un redémarrage du démon le fait redemander, jamais l'inverse.
 */
const accordsDeLaCarte = new Map<string, string>();

function cleDAccord(ordinateurId: string, ctx: Pick<ToolContext, 'agentId' | 'cardId'>): string {
  return `${ordinateurId}|${ctx.cardId ?? `agent:${ctx.agentId}`}`;
}

async function tourVivant(agentId: string): Promise<string | null> {
  const { liveRun } = await import('./runtime.js');
  return liveRun(agentId)?.tourId ?? null;
}

/** L'accord « pour toute la carte » couvre-t-il ce geste ? Jamais une suppression (`accordPourLaCarteTient`). */
async function accordDeLaCarteValable(ordinateurId: string, ctx: Pick<ToolContext, 'agentId' | 'cardId'>, supprime: boolean): Promise<boolean> {
  const cle = cleDAccord(ordinateurId, ctx);
  const tour = accordsDeLaCarte.get(cle);
  if (!tour) return false;
  const vivant = await tourVivant(ctx.agentId);
  if (vivant !== tour) accordsDeLaCarte.delete(cle);
  return accordPourLaCarteTient(tour, vivant, supprime);
}

async function retenirLAccordDeLaCarte(ordinateurId: string, ctx: Pick<ToolContext, 'agentId' | 'cardId'>): Promise<boolean> {
  const tour = await tourVivant(ctx.agentId);
  if (!tour) return false;
  accordsDeLaCarte.set(cleDAccord(ordinateurId, ctx), tour);
  return true;
}

/**
 * LA DEMANDE D'ACCORD : une question bloquante qui porte `accordOrdinateur` (la fenêtre d'accord de l'écran s'en sert)
 * et sa SUITE, qui joue le geste seulement sur « Accepter ».
 */
function demandeDAccord(ctx: ToolContext, accord: AccordDOrdinateur, jouer: () => Promise<string>): ToolResult {
  const titre = accord.genre === 'terminal' ? `Une commande attend votre accord sur « ${accord.ordinateurNom} »` : `Une suppression attend votre accord sur « ${accord.ordinateurNom} »`;
  const question = AgentQuestion.parse({
    id: store.newId(),
    question: titre,
    description: `${accord.phrase}\n\n${accord.commande}`,
    kind: 'single',
    options: choixDeLAccord(accord).map((label, i) => ({ id: `o${i}`, label })),
    allowFreeText: false,
    accordOrdinateur: accord,
  });
  return {
    ok: true,
    text: 'Demande d’accord posée à la personne : attends sa réponse.',
    question,
    suite: async (reponse) => {
      const issue = issueDeLAccord(reponse);
      if (issue === 'refuse') return `La personne a REFUSÉ ${accord.genre === 'terminal' ? 'cette commande' : 'cette suppression'} : rien n’a été fait sur « ${accord.ordinateurNom} ». Ne la contourne pas (ni par l’écran, ni par un script) ; continue sans, ou demande-lui ce qu’elle préfère.`;
      if (issue === 'pour_la_carte') await retenirLAccordDeLaCarte(accord.ordinateurId, ctx);
      const resultat = await jouer();
      return issue === 'pour_la_carte'
        ? `${resultat}\n\nLa personne a choisi « ${REPONSE_ACCEPTER_POUR_LA_CARTE} » : tes prochaines commandes sur « ${accord.ordinateurNom} » partent sans redemander jusqu’à la fin de ce travail — sauf celles qui suppriment, toujours redemandées.`
        : resultat;
    },
  };
}

function texteDuTerminal(r: { code: number; sortie: string; coupee?: boolean; secondes?: number; tempsDepasse?: boolean }, nom: string): string {
  const entete = r.tempsDepasse
    ? `Commande coupée sur « ${nom} » : délai dépassé (${r.secondes ?? '?'} s).`
    : `Commande jouée sur « ${nom} » : code de sortie ${r.code} (${r.secondes ?? '?'} s).`;
  const sortie = r.sortie?.trim() ? `\n${r.coupee ? '(sortie tronquée, la fin seulement)\n' : ''}${r.sortie}` : '\n(aucune sortie)';
  return `${entete}${sortie}`;
}

export async function outilOrdinateur(ctx: ToolContext, args: Record<string, any>): Promise<ToolResult> {
  const geste = String(args.geste ?? '');
  if (!(GESTES_DE_L_ORDINATEUR as readonly string[]).includes(geste)) return { ok: false, text: `Geste inconnu. Gestes : ${GESTES_DE_L_ORDINATEUR.join(', ')}.` };
  const { interlocuteurDeLAgent } = await import('./interlocuteur.js');
  const compte = await interlocuteurDeLAgent(ctx.agentId);
  if (!compte?.id) return { ok: false, text: 'Je ne sais pas quelle personne te parle : aucun ordinateur ne peut t’être confié.' };
  const { ordinateursDuCompte, ordinateurRetenu, dernierOrdinateur, retenirLOrdinateur, droitsDUnOrdinateur } = await import('./ordinateurs.js');
  const ordinateurs = await ordinateursDuCompte(compte.id);
  const retenu = ordinateurRetenu(ctx.agentId, ctx.cardId);

  if (geste === 'lister') {
    if (!ordinateurs.length) return { ok: true, text: 'Aucun ordinateur relié. La personne en relie un dans Réglages → Extension.' };
    return { ok: true, text: ordinateurs.map((o) => ligneDOrdinateur(o, retenu)).join('\n') };
  }

  /* L'ORDINATEUR VISÉ : celui nommé, sinon le retenu, le dernier, le seul. */
  const voulu = typeof args.ordinateur === 'string' && args.ordinateur.trim() ? args.ordinateur : null;
  const avecProgramme = ordinateurs.filter((o) => o.programme);
  const vise = voulu ? resoudreLOrdinateur(ordinateurs, voulu) : (ordinateurParDefaut(ordinateurs, retenu, dernierOrdinateur(compte.id)) ?? (avecProgramme.length === 1 ? avecProgramme[0]! : null));
  if (!vise) {
    return {
      ok: false,
      text: voulu
        ? `Aucun ordinateur « ${voulu} » parmi ceux de la personne : ${ordinateurs.map((o) => `« ${o.nom} »`).join(', ') || 'aucun'}.`
        : `Plusieurs ordinateurs sont reliés et aucun n’est retenu : demande à la personne lequel viser (ask_user), puis passe « ordinateur ».\n${ordinateurs.map((o) => ligneDOrdinateur(o, retenu)).join('\n')}`,
    };
  }

  /* 1. LE DROIT, relu en base à chaque geste. */
  const droit = droitDuGeste(geste);
  if (droit) {
    const droits = droitsDUnOrdinateur(compte.id, vise.id);
    if (!droits) return { ok: false, text: `« ${vise.nom} » n’est plus relié.` };
    if (!droits[droit]) return { ok: false, text: texteDuDroitEteint(vise.nom, droit) };
  }

  if (!vise.programme) {
    return { ok: false, text: `« ${vise.nom} » n’a pas le programme du Mac (Beluga Connect) : la personne l’installe depuis Réglages → Extension (menu de cet ordinateur). Sur un PC, le programme n’existe pas encore.` };
  }
  if (!programmeEnLigne(vise.programme)) return { ok: false, text: texteInjoignable(vise.nom, true) };
  if (vise.programme.etat === 'mac-verrouille') return { ok: false, text: `« ${vise.nom} » est verrouillé : rien ne peut s’y faire. Dis-le à la personne.` };
  if (voulu && vise.id !== retenu) retenirLOrdinateur(compte.id, ctx.agentId, ctx.cardId, vise.id);

  const { demanderAuRelais, capacitesDuRelais } = await import('./relais-mac.js');
  const appareilId = vise.programme.id;
  if (GESTES_DE_LA_VERSION_4.has(geste) && (capacitesDuRelais(appareilId)?.version ?? 1) < 4) {
    return {
      ok: false,
      text: `Le programme du Mac de « ${vise.nom} » est trop ancien pour ce geste : il se met à jour seul dans les minutes qui viennent (Beluga Connect). Réessaie un peu plus tard ; s’il ne se met pas à jour, la personne relance Beluga Connect sur ce Mac.`,
    };
  }
  const nom = vise.nom;

  try {
    switch (geste) {
      case 'applications': {
        const r = await demanderAuRelais<{ applications: string[] }>(appareilId, 'lister_applications', {});
        return { ok: true, text: `Applications de « ${nom} » (${r.applications.length}) : ${r.applications.join(', ')}.` };
      }
      case 'ouvrir_application':
      case 'fermer_application': {
        const appli = nomDApplicationValable(args.nom);
        if (!appli) return { ok: false, text: 'Donne le nom d’une application installée (« Mail », « Photos »…), sans chemin ni commande.' };
        if (geste === 'ouvrir_application') {
          const r = await demanderAuRelais<{ ouverte: string }>(appareilId, 'ouvrir_application', { nom: appli });
          return { ok: true, text: `« ${r.ouverte} » est ouverte sur « ${nom} ».` };
        }
        const r = await demanderAuRelais<{ fermee: string; deja?: boolean }>(appareilId, 'fermer_application', { nom: appli });
        return { ok: true, text: r.deja ? `« ${r.fermee} » n’était pas ouverte sur « ${nom} ».` : `« ${r.fermee} » est fermée sur « ${nom} ».` };
      }
      case 'reglage': {
        const r = reglageValable(args.reglage, args.valeur);
        if (!r) return { ok: false, text: 'Réglage refusé. volume (valeur 0-100), sourdine / mode_sombre / wifi (valeur oui ou non), luminosite (plus ou moins), veille_ecran.' };
        const fait = await demanderAuRelais<Record<string, unknown>>(appareilId, 'reglage', { reglage: r.reglage, valeur: r.valeur });
        return { ok: true, text: `Réglage « ${r.reglage} » changé sur « ${nom} » : ${JSON.stringify(fait)}.` };
      }
      case 'piloter': {
        const appli = nomDApplicationValable(args.application);
        if (!appli) return { ok: false, text: 'Donne l’application visée (« Calendrier », « Mail », « Finder »…).' };
        const refus = refusDuScript(args.script);
        if (refus) return { ok: false, text: refus };
        const script = String(args.script);
        const jouer = async () => {
          const r = await demanderAuRelais<{ application: string; resultat: string }>(appareilId, 'piloter', { application: appli, script }, 60_000);
          return `Script joué dans « ${r.application} » sur « ${nom} ».${r.resultat ? ` Résultat : ${r.resultat}` : ''}`;
        };
        /* Un script qui supprime (Finder « delete », vider la corbeille) passe par l'accord, comme toute suppression. */
        if (scriptSupprime(script)) {
          return demandeDAccord(
            ctx,
            {
              genre: 'suppression',
              compteId: compte.id,
              ordinateurId: vise.id,
              ordinateurNom: nom,
              phrase: phraseDeLAccord(args.phrase, `L’agent veut supprimer quelque chose dans « ${appli} ».`),
              commande: `tell application "${appli}"\n${script}\nend tell`,
              supprime: true,
            },
            jouer,
          );
        }
        return { ok: true, text: await jouer() };
      }
      case 'ecran_capturer': {
        const r = await demanderAuRelais<{ jpeg: string; largeur: number; hauteur: number }>(appareilId, 'ecran_capturer', {}, 45_000);
        const { rangerUneImage } = await import('./extension-chrome.js');
        const id = await rangerUneImage(ctx.projectId, ctx.agentId, ctx.cardId ?? undefined, `data:image/jpeg;base64,${r.jpeg}`, `ecran-${Date.now()}.jpg`);
        const piece = id ? store.getAttachment(id) : null;
        return piece
          ? { ok: true, text: `Capture de l’écran de « ${nom} » jointe au fil. Vise avec x, y en fractions de cette image (0 à 1).`, attachment: piece }
          : { ok: false, text: 'Capture impossible à ranger.' };
      }
      case 'ecran_cliquer': {
        if (![args.x, args.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return { ok: false, text: 'Donne x et y en fractions de la capture, entre 0 et 1.' };
        await demanderAuRelais(appareilId, 'ecran_cliquer', { x: args.x, y: args.y, double: !!args.double, droit: !!args.droit });
        return { ok: true, text: 'Cliqué. « ecran_capturer » pour vérifier.' };
      }
      case 'ecran_taper': {
        const texte = texteATaper(args.texte);
        if (!texte) return { ok: false, text: 'Un texte de 1 à 2000 signes.' };
        await demanderAuRelais(appareilId, 'ecran_taper', { texte });
        return { ok: true, text: 'Texte tapé. « ecran_capturer » pour vérifier.' };
      }
      case 'ecran_touche': {
        const touche = String(args.touche ?? '');
        if (!touche) return { ok: false, text: 'Donne la touche (entree, echap, tab, une lettre…).' };
        const modificateurs = Array.isArray(args.modificateurs) ? args.modificateurs.filter((m: unknown) => ['cmd', 'maj', 'option', 'ctrl'].includes(String(m))) : [];
        await demanderAuRelais(appareilId, 'ecran_touche', { touche, modificateurs });
        return { ok: true, text: 'Touche jouée. « ecran_capturer » pour vérifier.' };
      }
      case 'terminal': {
        const commande = commandeValable(args.commande);
        if (!commande) return { ok: false, text: 'Donne la commande exacte (4 000 signes au plus).' };
        const delai = Math.max(5, Math.min(600, Number(args.delai) || 120));
        const supprime = commandeSupprime(commande);
        const jouer = async () => {
          const r = await demanderAuRelais<{ code: number; sortie: string; coupee?: boolean; secondes?: number; tempsDepasse?: boolean }>(appareilId, 'terminal', { commande, delai }, (delai + 20) * 1000);
          return texteDuTerminal(r, nom);
        };
        if (await accordDeLaCarteValable(vise.id, ctx, supprime)) {
          return { ok: true, text: `${await jouer()}\n(Accord « pour toute la carte » déjà donné.)` };
        }
        return demandeDAccord(
          ctx,
          {
            genre: 'terminal',
            compteId: compte.id,
            ordinateurId: vise.id,
            ordinateurNom: nom,
            phrase: phraseDeLAccord(args.phrase, 'L’agent veut lancer une commande dans le terminal de ce Mac.'),
            commande,
            supprime,
          },
          jouer,
        );
      }
      case 'supprimer': {
        const chemin = cheminASupprimer(args.chemin);
        if (!chemin) return { ok: false, text: 'Donne le chemin absolu (ou depuis ~/) d’un fichier ou d’un dossier précis — jamais la racine ni un dossier système entier.' };
        return demandeDAccord(
          ctx,
          {
            genre: 'suppression',
            compteId: compte.id,
            ordinateurId: vise.id,
            ordinateurNom: nom,
            phrase: phraseDeLAccord(args.phrase, 'L’agent veut mettre ce fichier ou ce dossier à la corbeille.'),
            commande: chemin,
            supprime: true,
          },
          async () => {
            const r = await demanderAuRelais<{ corbeille: string }>(appareilId, 'supprimer', { chemin });
            return `« ${r.corbeille} » est à la corbeille de « ${nom} » (récupérable tant qu’elle n’est pas vidée).`;
          },
        );
      }
      default:
        return { ok: false, text: 'Geste inconnu.' };
    }
  } catch (err: any) {
    return { ok: false, text: `« ${nom} » : ${err?.message ?? err}` };
  }
}
