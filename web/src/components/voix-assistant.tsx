import * as React from 'react';
import { createPortal } from 'react-dom';
import {
  creerReconnaisseur,
  genreDuRaccourci,
  raccourciEffectif,
  demandeDeFin,
  demandeDeCoupure,
  jarvisAnnonceSaCoupure,
  demandeDeVeille,
  nomDeLAssistant,
  phraseDAppel,
  phraseEcoutee,
  retourEnVeilleDu,
  attenteDuMotPermise,
  attenteRouverteSansGeste,
  ecouteVoulueHorsEcran,
} from '@beluga/shared';
import { client } from '@/lib/client';
import { usePref } from '@/lib/prefs';
import { CLE_VOIX_VISIBLE } from '@/lib/cles-de-voix';
import { useTelephone } from '@/lib/telephone';
import { useApp } from '@/lib/use-app';
import { useAttenteDuMot, jouerLeSonDeVeille } from '@/lib/mot-de-reveil';
import { niveauxEtVoixDuDirect, recevoirLaSynthese, useDirectCodex, useTravailEnVeille, voixDuDirectEntendue, type TourDuDirect } from '@/lib/direct-codex';
import { ID_DE_L_ONGLET, brancherLesGestesDeJarvis } from '@/lib/gestes-de-jarvis';
import { CurseurDeJarvis } from '@/components/jarvis-a-l-ecran';
import { signalerEcouteVoulue } from '@/lib/micro';
import { CLE_JARVIS_DOS, direAuNatif, plateformeNative } from '@/lib/natif';
import { usePageVisible } from '@/lib/page-visible';
import { JarvisNatif } from '@/components/jarvis-natif';
import { BulleVocale, poserLaBasculeDuVolet } from '@/components/voix-du-champ';
import { useVoixDisponible } from '@/lib/voix-disponible';

/** Le signal de la page qui ouvre (ou referme, `{ ouvrir: false }`) le volet de l'assistant en texte. */
const EVENEMENT_OUVRIR_L_ASSISTANT = 'beluga:ouvrir-assistant';
import { t } from '@/lib/langue';
import {
  EVENEMENT_PARLER_A_JARVIS,
  arreterJarvis,
  parlerAJarvis,
  poserLActivationDuSon,
  poserLaRaisonDeFermeture,
  replierLesBullesPendantLAction,
  rouvrirLesBulles,
  publierLeDirect,
  setConversationAllumeeGlobale,
  setMicroOuvertGlobal,
  useDirectVu,
  useEtatVocalGlobal,
} from '@/lib/etat-vocal';
import { useEtatAssistant } from '@/lib/assistant-global';

/**
 * LE BOUTON « VOIX » DU MODULE : activée (défaut), tout marche ; désactivée, TOUT est coupé — micro fermé,
 * conversation fermée. Le module reste visible. Retenue en
 * préférence : elle n'ouvre jamais le micro, donc la règle « repart éteint » (MEM-1247) ne la concerne pas.
 */
export { CLE_VOIX_ACTIVE } from '@/lib/voix-disponible';

/**
 * La clé qui affiche le module vocal flottant (`lib/cles-de-voix.ts`, lisible
 * sans charger ce module). Cachée par défaut (`false`). Le module continue de
 * tourner sans interface tant qu'elle reste éteinte — écoute permanente,
 * conversation, lecture à voix haute — seul son affichage s'efface, comme sur
 * téléphone (`ancreMenu`, plus bas).
 */
export { CLE_VOIX_VISIBLE };

/**
 * La clé du bouton « MICRO » (jadis l'écoute permanente). Coupé À CHAQUE OUVERTURE de l'application :
 * le micro ne s'ouvre jamais sans que l'interrupteur ait été allumé à la main,
 * DANS cette page. Elle était jadis retenue côté serveur, comme les autres
 * réglages de voix — allumée une fois sur un ordinateur, elle rouvrait le micro
 * toute seule au chargement suivant, sur le téléphone comme ailleurs, sans le
 * moindre geste : le repère orange du système s'allumait sans que rien ne le
 * demande. La clé ne sert donc plus qu'à EFFACER une valeur restée allumée.
 */
export const CLE_VOIX_ECOUTE = 'voix.ecoute';

/**
 * La clé de l'ancien bouton CONVERSATION. Une valeur restée allumée en base est
 * effacée (même raison) ; la conversation s'ouvre désormais par le mot de réveil
 * ou un toucher sur les ondes.
 */
export const CLE_VOIX_CONVERSATION = 'voix.conversation';

/** Au-delà, l'écoute du mot de réveil qui se prépare encore est dite en panne, en clair (16/11/2026). */
const CHARGEMENT_DU_MOT_MAX_MS = 15_000;
/** Le micro coupé à la main dans l'application iPhone, retenu dans ce téléphone. */
const CLE_MICRO_COUPE_NATIF = 'beluga-voix-micro-coupe-natif';
/** La phrase du point d'essai (hors production) : ce que l'utilisateur dirait, jamais affiché. */
const PHRASE_DE_VEILLE_D_ESSAI = ['mets-toi', 'en', 'veille'].join(' ');

/**
 * UN INTERRUPTEUR D'ÉCOUTE — éteint à chaque ouverture de l'application.
 *
 * Ce n'est PAS une préférence comme les autres. Un réglage retenu se retrouve au
 * chargement suivant ; ici, cela voudrait dire un micro qui s'ouvre sans que
 * personne ne l'ait demandé sur cet appareil-là, à cet instant-là — exactement le
 * repère orange qui s'allume tout seul sur le téléphone. L'état ne vit donc que
 * dans la page ouverte, et il repart de zéro à chaque fois.
 *
 * La valeur restée en base (d'avant cette règle, ou d'un autre appareil) est
 * ÉTEINTE une bonne fois : sans cela, elle mentirait sur ce que l'application
 * fait vraiment.
 *
 * L'interrupteur lui-même vit désormais dans `lib/etat-vocal.ts` — un magasin
 * PARTAGÉ, non persisté — pour que la section « Voix » de Réglages puisse
 * l'allumer et l'éteindre elle aussi : `valeur` et `ecrire` en viennent, ce
 * hook ne fait plus qu'y greffer la purge d'une ancienne valeur retenue.
 */
function useInterrupteurDEcoute(
  cle: string,
  valeur: boolean,
  ecrire: (valeur: boolean) => void,
): [boolean, (valeur: boolean) => void] {
  // La valeur retenue arrive du serveur APRÈS le premier rendu : on la surveille
  // au lieu de la lire une fois pour toutes, sinon on éteindrait un réglage
  // qu'on n'a pas encore reçu — et il resterait allumé en base pour toujours.
  const [retenu, oublier] = usePref<boolean>(cle, false);
  React.useEffect(() => {
    if (retenu) oublier(false);
  }, [retenu, oublier]);
  return [valeur, ecrire];
}

export function VoixAssistant() {
  const state = useApp();
  const [visible] = usePref<boolean>(CLE_VOIX_VISIBLE, false);
  /*
   * LE BOUTON « VOIX » : désactivé, tout se coupe d'un geste — le micro et la conversation (plus bas). Le module reste à sa place, ses boutons visibles.
   */
  /* DEPUIS LE 17/11/2026, LA VOIX EST « DISPONIBLE » ou non (`useVoixDisponible`) : l'interrupteur ET un compte ChatGPT
     relié. Sans l'un des deux, tout reste coupé — micro, « Dis Jarvis », raccourci, bulle — et le bouton du bord ouvre le
     volet en texte. */
  const { disponible: voixActive } = useVoixDisponible();
  /* Les anciennes annonces à réécouter (retirées le 17/11/2026 avec la voix du serveur) : leur trace s'efface une fois. */
  React.useEffect(() => {
    try {
      window.localStorage.removeItem('beluga.voix.historique');
    } catch {
      /* stockage refusé : rien à effacer */
    }
  }, []);
  React.useEffect(() => {
    if (!voixActive) {
      setMicroOuvertGlobal(false);
      setConversationAllumeeGlobale(false);
    }
  }, [voixActive]);
  /* Téléphone (< 640 px) : la barre d'appel de Jarvis prend la largeur et se pose au-dessus du menu du bas ;
     ailleurs, elle se pose en bas à gauche, à largeur bornée. */
  const ancreMenu = useTelephone();
  /*
   * LE BOUTON « MICRO » : ouvert, le micro attend le mot de réveil SUR L'APPAREIL (`lib/mot-de-reveil.ts`) — aucun
   * son ne part avant le mot. Il repart COUPÉ à chaque ouverture de l'application (`useInterrupteurDEcoute`, MEM-1247) :
   * seul un geste fait dans CETTE page ouvre un micro. Il reste inerte tant que la Voix est désactivée.
   */
  const etatVocalGlobal = useEtatVocalGlobal();
  const [microOuvertBrut, setMicroOuvert] = useInterrupteurDEcoute(
    CLE_VOIX_ECOUTE,
    etatVocalGlobal.microOuvert,
    setMicroOuvertGlobal,
  );
  const microOuvert = microOuvertBrut && voixActive;
  /*
   * L'APPLICATION IPHONE (`natif/`, MEM-7548) : « Dis Jarvis » y est attendu DÈS QUE L'APPLICATION EST À L'ÉCRAN
   * (décision de l'utilisateur, 16/11/2026), et seulement là. Le micro coupé par l'utilisateur est RETENU dans ce
   * téléphone (`CLE_MICRO_COUPE_NATIF`). Le navigateur et l'application installée depuis Safari gardent la règle
   * d'origine : un geste dans la page, à chaque ouverture (MEM-1247).
   */
  const appNative = plateformeNative() === 'ios';
  const [microCoupeNatif, setMicroCoupeNatif] = React.useState<boolean>(() => {
    try {
      return window.localStorage.getItem(CLE_MICRO_COUPE_NATIF) === '1';
    } catch {
      return false;
    }
  });
  const pageVisible = usePageVisible();
  /** Le geste du bouton micro : dans l'application iPhone, il est retenu. */
  const basculerMicro = React.useCallback(
    (ouvrir: boolean) => {
      setMicroOuvert(ouvrir);
      if (!appNative) return;
      setMicroCoupeNatif(!ouvrir);
      try {
        window.localStorage.setItem(CLE_MICRO_COUPE_NATIF, ouvrir ? '0' : '1');
      } catch {
        /* stockage refusé : le choix vaut pour cette visite */
      }
    },
    [appNative, setMicroOuvert],
  );
  // La phrase qui appelle l’assistant : « Dis <nom> », le nom réglé dans Réglages › Voix (« Jarvis » par défaut).
  const motReveil = phraseDAppel(nomDeLAssistant(state.settings));
  const microOuvertRef = React.useRef(microOuvert);
  microOuvertRef.current = microOuvert;
  const voixActiveRef = React.useRef(voixActive);
  voixActiveRef.current = voixActive;

  /*
   * LE RACCOURCI CLAVIER DE JARVIS, réglé dans Réglages › Voix (`Settings.voixRaccourci`, Maj Maj par défaut — carte
   * « Raccourcis libres et Jarvis vocal », 17/11/2026). Un écouteur global suit les appuis ET les relâchements par le
   * reconnaisseur pur (`shared/src/raccourci-clavier.ts`) — le même que la capture des réglages. Il marche partout,
   * champs d'écriture compris, et fait le geste du bouton du bord : conversation fermée → la bulle vocale s'ouvre et
   * Jarvis écoute ; conversation ouverte → elle s'arrête. Voix désactivée : rien. Il ne touche plus au micro d'attente
   * du mot. Écouté en phase de bulle : la capture des réglages, qui arrête l'événement, ne le déclenche donc pas.
   */
  const raccourci = raccourciEffectif(state.settings?.voixRaccourci);
  React.useEffect(() => {
    if (!raccourci) return;
    const reconnaisseur = creerReconnaisseur();
    const combinaison = genreDuRaccourci(raccourci) === 'combinaison';
    const surTouche = (event: KeyboardEvent) => {
      const forme = reconnaisseur.recevoir({
        type: event.type === 'keyup' ? 'up' : 'down',
        code: event.code,
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
        meta: event.metaKey,
        t: event.timeStamp,
        repeat: event.repeat,
      });
      if (forme !== raccourci) return;
      // Seule une combinaison a un effet à empêcher (la lettre tapée, le geste du navigateur).
      if (combinaison) event.preventDefault();
      if (!voixActiveRef.current) return;
      if (conversationAllumeeRef.current) arreterJarvis();
      else parlerAJarvis(null);
    };
    const oublier = () => reconnaisseur.oublier();
    window.addEventListener('keydown', surTouche);
    window.addEventListener('keyup', surTouche);
    window.addEventListener('blur', oublier);
    return () => {
      window.removeEventListener('keydown', surTouche);
      window.removeEventListener('keyup', surTouche);
      window.removeEventListener('blur', oublier);
    };
  }, [raccourci]);

  /*
   * LA CONVERSATION EN DIRECT. Elle s'OUVRE par le mot de réveil ou un toucher sur les ondes, et se FERME par
   * « mets-toi en veille », 30 s de silence (avec un petit son), un second toucher sur les ondes, ou le micro coupé.
   * Ouvrir la conversation ouvre aussi le micro (un seul micro, un seul bouton qui le dit) ; le fermer coupe la
   * conversation (`lib/etat-vocal.ts`). Éteinte à chaque ouverture de l'application.
   */
  const [conversationBrute, setConversationAllumee] = useInterrupteurDEcoute(
    CLE_VOIX_CONVERSATION,
    etatVocalGlobal.conversationAllumee,
    setConversationAllumeeGlobale,
  );
  const conversationAllumee = conversationBrute && voixActive;
  // Lu par les écouteurs (veille, point d'essai) sans les réabonner.
  const conversationAllumeeRef = React.useRef(conversationAllumee);
  conversationAllumeeRef.current = conversationAllumee;

  /*
   * L'AGENT VISÉ PAR LA CONVERSATION (17/11/2026) : celui du champ où l'on a appuyé sur le bouton voix (une carte), ou
   * `null` — l'assistant. Le mot de réveil, Cmd+Espace et le double toucher au dos ouvrent TOUJOURS l'assistant.
   */
  const [cible, setCible] = React.useState<string | null>(null);

  /** Le mot est reconnu : la conversation s'ouvre, sur l'assistant. */
  const surReveil = React.useCallback(() => {
    setCible(null);
    setConversationAllumee(true);
  }, [setConversationAllumee]);
  /*
   * LE MICRO NE VIT PAS HORS DE L'ÉCRAN (`attenteDuMotPermise`, shared/src/micro-demande.ts) : page cachée, l'attente
   * du mot se referme (prise, contexte audio) — c'est elle qui laissait le repère orange allumé application fermée.
   * Seule une conversation en cours continue écran verrouillé, jusqu'à sa fin.
   */
  const attente = useAttenteDuMot(
    microOuvert && attenteDuMotPermise({ visible: pageVisible, conversation: conversationAllumee }),
    phraseEcoutee(state.settings),
    surReveil,
  );
  /* Dans le navigateur et l'application installée depuis Safari, quitter l'écran hors conversation REFERME le micro
     pour de bon : il ne se rouvrira qu'au prochain geste (MEM-1256). */
  React.useEffect(() => {
    if (!pageVisible && !conversationAllumee && !appNative && microOuvertRef.current) setMicroOuvert(false);
  }, [pageVisible, conversationAllumee, appNative, setMicroOuvert]);
  /* Dans l'application iPhone, l'attente s'ouvre seule dès que l'application est à l'écran — sauf micro coupé. */
  React.useEffect(() => {
    if (!pageVisible || !voixActive) return;
    if (attenteRouverteSansGeste({ appNative, coupeParLUtilisateur: microCoupeNatif }) && !microOuvertRef.current) {
      setMicroOuvert(true);
    }
  }, [pageVisible, voixActive, appNative, microCoupeNatif, setMicroOuvert]);
  const [chargementTropLong, setChargementTropLong] = React.useState(false);
  const enChargement = attente.etat === 'ouverture' || attente.etat === 'chargement';
  React.useEffect(() => {
    setChargementTropLong(false);
    if (!enChargement) return;
    const minuterie = window.setTimeout(() => setChargementTropLong(true), CHARGEMENT_DU_MOT_MAX_MS);
    return () => window.clearTimeout(minuterie);
  }, [enChargement]);

  /*
   * LE FIL DE LA CONVERSATION EST CELUI DU DIRECT AVEC CODEX (`lib/direct-codex.ts`) : une vraie conversation vocale
   * en direct, par l'abonnement du compte Codex ; l'assistant général répond avec la voix choisie dans Réglages ›
   * Voix, et reparler lui coupe la parole. Le direct EMPRUNTE le micro du réveil (`attente.entree`) : il n'attend que
   * lui pour partir. Une panne se DIT : plus aucun repli sur l'ancienne chaîne dictée + voix du serveur.
   */
  const direct = useDirectCodex(conversationAllumee && !!attente.entree, attente.entree, cible);
  const fil: TourDuDirect[] = direct.fil;
  // LES GESTES DE JARVIS À L'ÉCRAN : l'écoute se branche une fois, avec le module (`lib/gestes-de-jarvis.ts`).
  React.useEffect(() => brancherLesGestesDeJarvis(), []);

  /*
   * QUITTER L'ÉCRAN REFERME LE MICRO — sauf si une écoute a été VOULUE. La porte
   * unique (`lib/micro.ts`) referme tout quand la page part ou passe en
   * arrière-plan ; un micro ouvert à la main, lui, survit à un simple coup
   * d'œil sur une autre application, sinon il se couperait sans jamais revenir.
   */
  React.useEffect(() => {
    signalerEcouteVoulue(ecouteVoulueHorsEcran({ conversation: conversationAllumee }));
  }, [conversationAllumee]);

  const conversationEcoute = conversationAllumee && (direct.etat === 'ecoute' || direct.etat === 'connexion');
  /* DANS L'APPLICATION IPHONE (`natif/`), le mode « appel » de la session audio (écho annulé, Bluetooth, haut-parleur,
     vie écran verrouillé) est posé par la porte du micro AVANT la capture, et rendu avec le dernier micro (`lib/micro.ts`,
     17/11/2026) : le poser à l'allumage de la conversation, micro déjà ouvert, coupait le son en silence. */

  /*
   * LE RETOUR EN VEILLE. La conversation se referme TOUTE SEULE après 30 s de silence — ni phrase de l'utilisateur,
   * ni voix de Jarvis, ni réponse attendue (`retourEnVeilleDu`) — ou sur « mets-toi en veille » (`demandeDeVeille`), une
   * fois la réponse courte de Jarvis dite. Un petit son l'annonce. Fermer, c'est TOUT fermer (connexion, canal,
   * session du démon) ; le micro, lui, reste ouvert et l'attente du mot reprend.
   */
  const activiteRef = React.useRef(Date.now());
  const veilleDemandeeRef = React.useRef<{ depuis: number; reponseDite: boolean } | null>(null);
  const filRefVeille = React.useRef(fil);
  filRefVeille.current = fil;
  const mettreEnVeille = React.useCallback(() => {
    veilleDemandeeRef.current = null;
    setConversationAllumee(false);
    if (voixActiveRef.current) jouerLeSonDeVeille();
  }, [setConversationAllumee]);
  React.useEffect(() => {
    activiteRef.current = Date.now();
    const dernier = fil[fil.length - 1];
    if (!dernier || !conversationAllumeeRef.current) return;
    // « Mets-toi en veille », une phrase de fin (« c'est bon », « on arrête »…) OU une demande de COUPURE (« coupe-toi,
    // j'y reviendrai », même au milieu d'une phrase longue — 18/11/2026) : la fermeture fait rédiger la synthèse.
    if (dernier.role === 'user' && dernier.final && (demandeDeVeille(dernier.texte) || demandeDeFin(dernier.texte) || demandeDeCoupure(dernier.texte))) {
      poserLaRaisonDeFermeture(demandeDeCoupure(dernier.texte) ? 'coupure demandée à la voix' : 'veille ou fin demandée à la voix');
      veilleDemandeeRef.current = { depuis: Date.now(), reponseDite: false };
    } else if (dernier.role === 'assistant' && dernier.final && veilleDemandeeRef.current) {
      veilleDemandeeRef.current.reponseDite = true;
    } else if (dernier.role === 'assistant' && dernier.final && jarvisAnnonceSaCoupure(dernier.texte)) {
      // UNE PAROLE N'EST PAS UNE ACTION : Jarvis a annoncé qu'il se coupe (« Entendu, j'arrête. ») — on coupe vraiment.
      poserLaRaisonDeFermeture('Jarvis a annoncé qu’il se coupe');
      veilleDemandeeRef.current = { depuis: Date.now(), reponseDite: true };
    }
  }, [fil]);
  React.useEffect(() => {
    if (!conversationAllumee) {
      veilleDemandeeRef.current = null;
      return;
    }
    activiteRef.current = Date.now();
    let silenceDeLaVoixDepuis = Date.now();
    const minuterie = window.setInterval(() => {
      const maintenant = Date.now();
      const voixEntendue = voixDuDirectEntendue();
      if (voixEntendue) {
        activiteRef.current = maintenant;
        silenceDeLaVoixDepuis = maintenant;
      }
      const demande = veilleDemandeeRef.current;
      if (demande) {
        // La réponse courte est dite et la voix s'est tue, ou elle tarde : on ferme.
        if ((demande.reponseDite && maintenant - silenceDeLaVoixDepuis > 1000) || maintenant - demande.depuis > 10_000) {
          mettreEnVeille();
        }
        return;
      }
      // La dernière PAROLE compte : les lignes d'étapes du cerveau et ses points d'avancement (19/11/2026) ne sont pas la
      // réponse — tant qu'elle n'est pas dite, c'est l'attente longue (`ATTENTE_DE_REPONSE_MAX_MS`), pas les 30 s.
      const dernier = [...filRefVeille.current].reverse().find((t) => t.texte && !t.avancement && !t.activite && !t.verifications && !t.tache && !t.action);
      const reponseAttendue = !!dernier && ((dernier.role === 'user' && dernier.final) || (dernier.role === 'assistant' && !dernier.final));
      if (retourEnVeilleDu(maintenant, activiteRef.current, reponseAttendue)) {
        poserLaRaisonDeFermeture('30 s de silence');
        mettreEnVeille();
      }
    }, 500);
    return () => window.clearInterval(minuterie);
  }, [conversationAllumee, mettreEnVeille]);

  // Le point d'essai : demander la veille comme si la phrase venait d'être dite.
  React.useEffect(() => {
    if (import.meta.env.MODE === 'production') return;
    const essai = ((window as any).belugaEssai ??= {});
    essai.demanderLaVeille = (texte = PHRASE_DE_VEILLE_D_ESSAI) => {
      if (!conversationAllumeeRef.current || !(demandeDeVeille(texte) || demandeDeFin(texte))) return false;
      veilleDemandeeRef.current = { depuis: Date.now(), reponseDite: true };
      return true;
    };
    essai.silenceDeVeille = () => {
      activiteRef.current = 0;
    };
    // LES ONDES DU VOLET, sans micro ni Codex : « vous » (jaune), « jarvis » (bleu), ou le silence ; `null` les éteint.
    essai.ondesDuVolet = (qui: 'vous' | 'jarvis' | 'silence' | null) =>
      publierLeDirect(
        qui === null
          ? { etat: 'eteint', lecteur: null }
          : { etat: 'ecoute', lecteur: (n: number) => ({ niveaux: new Array(n).fill(qui === 'silence' ? 0 : 0.8), qui: qui === 'silence' ? null : qui }) },
      );
    /* LES BULLES ET LA SYNTHÈSE, sans micro ni Codex (17/11/2026) : des tours factices posés sur un agent, la rédaction
       en cours, puis une synthèse reçue comme le démon l'envoie. */
    essai.bullesDuDirect = (agentId: string, tours: Partial<TourDuDirect>[], extra: { sonBloque?: boolean } = {}) =>
      publierLeDirect({
        ...extra,
        etat: 'ecoute',
        agentId,
        redaction: null,
        fil: tours.map((tour, i) => ({ id: 100_000 + i, role: 'assistant', texte: '', final: true, projets: [], ...tour }) as TourDuDirect),
        lecteur: (n: number) => ({ niveaux: new Array(n).fill(0.5), qui: 'vous' }),
      });
    /* LE CERCLE DE CHARGEMENT (17/11/2026) : la conversation de cet agent s'ouvre, Jarvis n'écoute pas encore. Le passage
       à `bullesDuDirect` (écoute) lance le morphing. */
    essai.connexionDuDirect = (agentId: string) =>
      publierLeDirect({ etat: 'connexion', agentId, redaction: null, erreur: null, fil: [], lecteur: (n: number) => ({ niveaux: new Array(n).fill(0), qui: null }) });
    essai.redactionDuDirect = (agentId: string) => publierLeDirect({ etat: 'eteint', agentId, redaction: agentId, lecteur: null });
    essai.syntheseDuDirect = (agentId: string, texte: string) => {
      publierLeDirect({ etat: 'eteint', redaction: null, fil: [], lecteur: null });
      window.setTimeout(() => recevoirLaSynthese(agentId, texte), 150);
    };
    return () => {
      delete essai.bullesDuDirect;
      delete essai.connexionDuDirect;
      delete essai.redactionDuDirect;
      delete essai.syntheseDuDirect;
      delete essai.ondesDuVolet;
      delete essai.demanderLaVeille;
      delete essai.silenceDeVeille;
    };
  }, []);

  /* LE RACCOURCI « PARLER À BELUGA » DE L'APPLICATION (`lib/natif.ts`, événement `beluga:ouvrir-voix`) ouvre
     l'application sur Jarvis au bord, micro fermé (MEM-1247) : il n'y a plus de panneau à déplier depuis le
     16/11/2026, le rond au bord EST le module, et un toucher le fait parler. */

  /* LE DOUBLE TOUCHER AU DOS DE L'IPHONE (intention « Parler à Jarvis », `natif/iOS/IntentionJarvis.swift`) : la
     conversation s'ouvre tout de suite — sauf interrupteur coupé dans Réglages › Voix. L'interrupteur est aussi
     redit au natif, qui le garde pour quand la page n'est pas là. */
  const [jarvisDos] = usePref<boolean>(CLE_JARVIS_DOS, true);
  const jarvisDosRef = React.useRef(jarvisDos);
  jarvisDosRef.current = jarvisDos;
  React.useEffect(() => {
    if (appNative) direAuNatif({ type: 'jarvis-dos', actif: jarvisDos });
  }, [appNative, jarvisDos]);
  React.useEffect(() => {
    const lancer = () => {
      if (!jarvisDosRef.current || !voixActiveRef.current) return;
      setCible(null);
      basculerMicro(true);
      setConversationAllumee(true);
    };
    window.addEventListener('beluga:jarvis-conversation', lancer);
    return () => window.removeEventListener('beluga:jarvis-conversation', lancer);
  }, [basculerMicro, setConversationAllumee]);


  /*
   * PARLER À JARVIS DEPUIS LE VOLET (bouton de la zone d'écriture) OU DEPUIS LE MAC (Cmd+Espace, `natif/Mac`) : la
   * conversation s'ouvre tout de suite, micro compris — sauf Voix désactivée (`lib/etat-vocal.ts`).
   */
  React.useEffect(() => {
    const parler = (event: Event) => {
      if (!voixActiveRef.current) return;
      setCible((event as CustomEvent<{ agentId?: string | null } | null>).detail?.agentId ?? null);
      basculerMicro(true);
      setConversationAllumee(true);
    };
    window.addEventListener(EVENEMENT_PARLER_A_JARVIS, parler);
    return () => window.removeEventListener(EVENEMENT_PARLER_A_JARVIS, parler);
  }, [basculerMicro, setConversationAllumee]);

  /*
   * LE VOLET DE L'ASSISTANT MONTRE LA VOIX (carte « Jarvis : volet, voix et rapidité », 16/11/2026) : la barre d'appel
   * et la conversation empilée de Jarvis ont disparu. Une conversation qui s'ouvre (« Dis Jarvis », bouton, Cmd+Espace)
   * OUVRE le volet ; le volet lit ici le fil du direct (chaque tour à son heure), son état et le lecteur des ondes, et
   * en mode voix ses ondes remplacent la zone d'écriture (`assistant-global.tsx`).
   */
  const assistant = useEtatAssistant();
  const assistantRef = React.useRef(assistant);
  assistantRef.current = assistant;
  const admin = state.monRole === 'admin';
  const cibleRef = React.useRef(cible);
  cibleRef.current = cible;
  const ouvrirLeVolet = React.useCallback((ouvrir: boolean) => {
    const courant = assistantRef.current;
    if (courant.retenu.ouvert !== ouvrir) courant.retenir({ ...courant.retenu, ouvert: ouvrir });
  }, []);

  /*
   * LA BULLE VOCALE (carte « Raccourcis libres et Jarvis vocal », 17/11/2026) : une conversation de l'ASSISTANT ne
   * déplie plus le volet ; elle se tient dans la bulle compacte au bord (`BulleVocale`). Le bouton fenêtre de la bulle
   * ouvre le volet, celui du volet le replie (la bulle revient). LE VOLET S'OUVRE TOUT SEUL quand Jarvis PRODUIT
   * quelque chose à voir (carte proposée, image, document : `voix.direct.production`) ou quand la synthèse de fin
   * remplit le champ — jamais pour une simple phrase de l'échange, ni pour un geste à l'écran.
   */
  React.useEffect(() => {
    poserLaBasculeDuVolet(ouvrirLeVolet);
    /* OUVRIR LE VOLET EN TEXTE, sans lancer la voix (le toucher du bouton du bord, lui, parle à Jarvis) : un signal de
       la page, `beluga:ouvrir-assistant` (détail `{ ouvrir }`, vrai par défaut). Les contrôles qui ouvraient le volet
       d'un clic sur le bouton passent par lui — y compris sur une construction de production. */
    const surSignal = (event: Event) => ouvrirLeVolet((event as CustomEvent<{ ouvrir?: boolean } | null>).detail?.ouvrir !== false);
    window.addEventListener(EVENEMENT_OUVRIR_L_ASSISTANT, surSignal);
    return () => {
      poserLaBasculeDuVolet(null);
      window.removeEventListener(EVENEMENT_OUVRIR_L_ASSISTANT, surSignal);
    };
  }, [ouvrirLeVolet]);
  /* PLUS AUCUN CHEMIN N'OUVRE LE VOLET DEPUIS LE MODE VOCAL (décision de l'utilisateur, 20/11/2026) : ce que Jarvis
     produit (carte, image, document, question) se pose dans les bulles au-dessus du mode vocal, et la synthèse de fin
     n'existe plus. Le volet de l'assistant n'existe que quand la voix n'est pas disponible (`app.tsx`). */

  /*
   * JARVIS AGIT DANS L'APPLICATION (décision du 18/11/2026) : sur ORDINATEUR, la fenêtre de conversation (le volet)
   * s'ouvre d'elle-même et montre ses actions ; sur TÉLÉPHONE, la fenêtre reste comme elle est, mais les bulles se
   * replient pour laisser voir l'écran — le chevron les rouvre. Seule une action CONCRÈTE compte (créer, modifier,
   * ouvrir à l'écran…), jamais une lecture.
   */
  const jarvisAgit = conversationAllumee && fil.some((tour) => (tour.activite?.agit && tour.activite.etat === 'en-cours') || !!tour.verifications?.etapes.some((e) => e.agit && e.etat === 'en-cours') || (tour.action && (tour.action.statut === 'en-cours' || tour.action.statut === 'arretee')));
  React.useEffect(() => {
    if (conversationAllumee) rouvrirLesBulles();
  }, [conversationAllumee]);
  React.useEffect(() => {
    if (ancreMenu) replierLesBullesPendantLAction(jarvisAgit);
  }, [jarvisAgit, ancreMenu]);

  /* LA SOURDINE (bouton Muet) : LE MICRO NE CAPTE PLUS RIEN (décision du 18/11/2026 — avant, seule la piste qui part
     se taisait : le micro écoutait encore et les ondes bougeaient). La piste du micro réel est éteinte (rien n'est
     capté : ni Jarvis, ni le mot de réveil, ni les ondes), sans raccrocher ; un second toucher la rallume. */
  const directVu = useDirectVu();
  const { sourdine } = directVu;
  React.useEffect(() => {
    const entree = attente.entree;
    if (!entree) return;
    entree.piste.enabled = !sourdine;
    entree.sourdine(sourdine);
  }, [attente.entree, sourdine]);
  React.useEffect(() => {
    if (!conversationAllumee) publierLeDirect({ sourdine: false });
  }, [conversationAllumee]);

  /* L'ÉCOUTE DU MOT QUI NE DÉMARRE PAS (carte « Relier Beluga Pass dans les réglages », 16/11/2026) : « Chargement du
     détecteur… » restait affiché sans fin et ne disait rien. Au-delà de `CHARGEMENT_DU_MOT_MAX_MS`, ou sur une erreur, le
     module le dit en clair, avec ce qui marche encore. */
  /* …MAIS SEULEMENT QUAND ELLE EMPÊCHE DE PARLER (carte « Clavier qui se referme sur mobile », 18/11/2026, capture
     #e1c70) : ce message ne paraît QUE dans la bulle d'une conversation. Le micro ouvert (`attente.entree`), la
     conversation marche — Jarvis venait de saluer — et l'écoute du mot n'y sert à rien : en parler sous les ondes
     faisait croire à une panne. Il reste dit quand le micro lui-même manque (refus, son indisponible). La vraie raison
     d'un modèle qui ne charge pas part au journal des erreurs (`lib/mot-de-reveil.ts`). */
  const erreurMicro = attente.entree
    ? null
    : attente.erreur && attente.etat !== 'refuse'
      ? t('L’écoute de « {v0} » n’a pas pu démarrer. Touchez le bouton du micro pour parler à Jarvis.', { v0: motReveil })
      : attente.erreur ?? (chargementTropLong ? t('L’écoute de « {v0} » n’a pas pu démarrer. Touchez le bouton du micro pour parler à Jarvis.', { v0: motReveil }) : null);

  /* L'AGENT QUI PORTE LA CONVERSATION : dit par le démon, sinon la cible demandée, sinon l'assistant. Seul SON `Chat`
     montre les bulles et les ondes (`voix-du-champ.tsx`) ; la synthèse revient dans SON champ. */
  const agentDeLaVoix = direct.agentId ?? cible ?? assistant.agentId ?? null;
  React.useEffect(() => {
    publierLeDirect({
      // Allumée, la conversation se montre tout de suite (« Jarvis arrive… »), même avant que le micro soit prêt.
      etat: conversationAllumee ? (direct.etat === 'eteint' ? 'connexion' : direct.etat) : 'eteint',
      erreur: direct.erreur ?? (conversationAllumee ? erreurMicro : null),
      agentId: agentDeLaVoix,
      fil,
      redaction: direct.redaction,
      actionVivante: fil.some((tour) => tour.action && (tour.action.statut === 'en-cours' || tour.action.statut === 'arretee')),
      lecteur: conversationEcoute ? niveauxEtVoixDuDirect : null,
      sonBloque: conversationAllumee && direct.sonBloque,
    });
  }, [conversationAllumee, direct.etat, direct.erreur, direct.redaction, direct.sonBloque, erreurMicro, agentDeLaVoix, fil, conversationEcoute]);
  /*
   * JARVIS PRÊT À L'AVANCE (décision du 17/11/2026) : tant que la voix est activée et l'écran affiché, le démon garde
   * un Jarvis lancé, sa consigne prête (`voix.direct.preparer`, redit toutes les quatre minutes ; sans nouvelle, il le
   * referme). Seule la ligne vocale reste à ouvrir au geste : elle ne s'ouvre jamais à l'avance (abonnement).
   */
  const prepareJarvis = voixActive && pageVisible && (admin || visible);
  React.useEffect(() => {
    if (!prepareJarvis) return;
    const preparer = () => void client.call({ type: 'voix.direct.preparer' }).catch(() => undefined);
    preparer();
    const minuterie = window.setInterval(preparer, 4 * 60 * 1000);
    return () => window.clearInterval(minuterie);
  }, [prepareJarvis]);
  /* LA VOIX DE JARVIS BLOQUÉE PAR LE NAVIGATEUR : le bouton du pied vocal la fait entendre, d'un toucher. */
  React.useEffect(() => {
    poserLActivationDuSon(direct.activerLeSon);
    return () => poserLActivationDuSon(null);
  }, [direct.activerLeSon]);

  /* LE TOUCHER DU BOUTON DU BORD (17/11/2026) : il ouvre SEULEMENT la bulle vocale et Jarvis écoute ; pendant la
     conversation, il l'arrête. Volet ouvert sans conversation : il le referme. Voix désactivée : il ouvre le volet,
     l'accès TEXTE à l'assistant. Un compte sans assistant parle directement à Jarvis, comme avant. */
  const toucher = React.useCallback(() => {
    if (admin && !voixActiveRef.current) {
      assistantRef.current.basculer();
      return;
    }
    if (!voixActiveRef.current) return;
    if (conversationAllumeeRef.current) {
      if (admin) arreterJarvis();
      else setConversationAllumee(false);
      return;
    }
    /* Voix disponible : le bouton lance TOUJOURS la conversation vocale, jamais le volet (20/11/2026). */
    if (admin) parlerAJarvis(null);
    else {
      basculerMicro(true);
      setConversationAllumee(true);
    }
  }, [admin, basculerMicro, setConversationAllumee, ouvrirLeVolet]);

  /* La bulle vocale : la conversation de l'assistant (ou sa synthèse), volet replié. */
  const bulleVisible = admin && !cible && conversationAllumee;
  const travailEnVeille = useTravailEnVeille();

  /* Le bouton du bord est l'entrée de l'assistant : toujours posé pour qui a l'assistant ; sinon, seulement si
     « Réglages › Voix » l'affiche. Le module tourne de toute façon (écoute, conversation, voix haute). */
  if (!visible && !admin) return null;

  return createPortal(
    <>
      {/* LE CURSEUR DE JARVIS, pendant ses gestes à l'écran (porté lui-même par `document.body`, au-dessus de tout). */}
      <CurseurDeJarvis />
      {bulleVisible ? <BulleVocale nom={nomDeLAssistant(state.settings)} telephone={ancreMenu} /> : null}
      <JarvisNatif
        telephone={ancreMenu}
        onglet={ID_DE_L_ONGLET}
        etatReveil={attente.etat}
        microOuvert={microOuvert}
        voixActive={voixActive}
        etatDirect={direct.etat}
        conversation={conversationAllumee}
        voletOuvert={admin && !voixActive && assistant.retenu.ouvert}
        travaille={admin && (assistant.travaille || travailEnVeille)}
        questions={admin ? assistant.questions : 0}
        onToucher={toucher}
      />
    </>,
    document.body,
  );
}
