/**
 * L'ESPACE CLIENT : UN KANBAN QU'ON GLISSE, UN TIROIR, UN FIL.
 *
 * Le MÊME écran sert deux personnes : le client, sur `my.haikostudio.cloud`, et
 * Haiko, depuis sa colonne de gauche. La seule différence tient à la SIGNATURE
 * des messages et à deux gestes réservés (annoncer une date de livraison,
 * transformer une demande en carte) — pas à deux interfaces à tenir à jour.
 *
 * CE QUE VOIT LE CLIENT : TOUT CE QUI TOUCHE À SES PROJETS, quel qu'en soit
 * l'auteur. C'est le serveur qui en décide (`peutVoirProjet`) ; l'écran ne
 * filtre plus rien sur l'auteur.
 *
 * CE FICHIER NE PORTE PLUS QUE L'ÉCRAN. La vignette, la colonne, l'entête, le
 * formulaire d'une demande neuve et la fiche vivent chacun dans leur fichier :
 * 1 300 lignes rendaient chaque fusion douloureuse et chaque retouche risquée.
 *
 * Les conventions de la maison s'appliquent telles quelles : orange pour ce qui
 * est en cours, bleu pour ce qui est terminé, silhouette de chargement plutôt
 * qu'un état vide, toute zone qui défile par `ZoneDefilement`, un trait porteur
 * d'information en `--faint`, et TOUT S'OUVRE DANS LE TIROIR DE L'APPLICATION.
 */
import * as React from 'react';
import { Send, X } from 'lucide-react';
import { Button, Drawer, Textarea, ZoneDefilement } from '@/components/ui';
import { SilhouetteDemandes } from '@/components/silhouettes';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import { useTelephone } from '@/lib/telephone';
import {
  COLONNES_DEMANDE,
  TITRES_COLONNES_DEMANDE,
  ecrireReglagesDesColonnes,
  etiquettesConnues,
  lireReglagesDesColonnes,
  nonLuesPourMoi,
  nonLusDuFil,
  vueDeLaColonne,
  type ColonneDemande,
  type DemandeAffichee,
  type EcranEspaceClient,
  type FiltreDeColonne,
  type MessageFil,
  type PieceDeGalerie,
  type ReglagesDesColonnes,
  type TriDemande,
} from '@beluga/shared';
import { canalEspace, type EtatCanalEspace } from './canal-espace';
import { BoutonJoindre, EnvoisEnCours, PiecesDeposees, PiecesDuMessage, Visionneuse, useEnvois } from './pieces';
import { usePointerDrag, type DragItem, type DropTarget } from '@/lib/dnd';
import { DELAI_APPUI_LONG, cibleDeDepot, type CibleDeDepot } from './depot-demande';
import { TiroirDemande } from './tiroir-demande';
import { NouvelleDemande } from './nouvelle-demande';
import { TiroirProfil } from './tiroir-profil';
import { EnteteEspace } from './entete-espace';
import { SilhouetteDiscussion } from '@/components/silhouettes';
import { ClocheEspace } from './cloche-espace';
import { MenuEspace } from './menu-espace';
import { OngletDiscussion } from './onglet-discussion';
import { ColonneDemandes } from './colonne-demandes';
import { heureCourte, jourDe } from './formats';
import { VoletBackups } from './volet-backups';
import { VoletAcces } from './volet-acces';
import type { GestesDeVignette } from './vignette-demande';

/** Qui regarde : cela décide de la signature et des gestes ouverts. */
export interface MoiDansLEspace {
  id: string;
  identifiant: string;
  nomAffiche: string;
  role: 'admin' | 'client';
  projets: { id: string; nom: string }[];
}

/* ------------------------------------------------------------------ */
/* Le volet de discussion                                               */
/* ------------------------------------------------------------------ */

export function VoletDiscussion({
  moi,
  filId,
  projectId,
  onFermer,
}: {
  moi: MoiDansLEspace;
  filId: string;
  projectId: string;
  onFermer?: () => void;
}) {
  const [messages, setMessages] = React.useState<MessageFil[]>([]);
  /*
   * LE FIL ARRIVE APRÈS L'OUVERTURE : sans cet état, la fenêtre restait vide un
   * instant — ou pour de bon si la lecture échouait. Une silhouette tant qu'il
   * n'est pas là, puis « aucun message » ou l'échec, dits en clair.
   */
  const [chargement, setChargement] = React.useState<'en-cours' | 'pret' | 'erreur'>('en-cours');
  /* LES PIÈCES DU FIL, avec leur nom et leur poids : le serveur les envoie avec
     les messages, qui ne portent que des identifiants. */
  const [pieces, setPieces] = React.useState<PieceDeGalerie[]>([]);
  const [visionneuse, setVisionneuse] = React.useState<number | null>(null);
  const [texte, setTexte] = React.useState('');
  const envois = useEnvois(projectId);
  const bas = React.useRef<HTMLDivElement | null>(null);
  const images = React.useMemo(() => pieces.filter((piece) => piece.genre === 'image'), [pieces]);

  const recharger = React.useCallback(() => {
    void canalEspace
      .demander({ type: 'espace.fil.lire', filId })
      .then((reponse: { messages: MessageFil[]; pieces?: PieceDeGalerie[] }) => {
        setMessages(reponse.messages);
        setPieces(reponse.pieces ?? []);
        setChargement('pret');
      })
      /* Un rattrapage qui échoue ne cache pas un fil déjà affiché. */
      .catch(() => setChargement((avant) => (avant === 'pret' ? avant : 'erreur')));
  }, [filId]);

  React.useEffect(() => {
    recharger();
    // Ouvrir le volet, c'est avoir lu : la pastille d'en face retombe.
    canalEspace.envoyer({ type: 'espace.fil.vu', filId });
  }, [recharger, filId]);

  /*
   * UN RATTRAPAGE À CHAQUE RECONNEXION. Les messages arrivés pendant une
   * coupure ne sont pas perdus : le fil est redemandé en entier dès que le
   * canal revient, plutôt que d'espérer que rien n'a manqué.
   */
  React.useEffect(() => canalEspace.surChangementDEtat((etat) => etat === 'en-ligne' && recharger()), [recharger]);

  React.useEffect(
    () =>
      canalEspace.ecouter((event) => {
        if (event.type === 'espace.fil' && (event as any).filId === filId) {
          setMessages((liste) => [...liste, (event as any).message]);
          /* UN MESSAGE QUI ARRIVE PEUT PORTER UN FICHIER INCONNU : on redemande
             le fil pour en avoir le nom et le poids, jamais un lien nu. */
          if (((event as any).message?.fichiers ?? []).length) recharger();
          canalEspace.envoyer({ type: 'espace.fil.vu', filId });
        }
      }),
    [filId],
  );

  React.useEffect(() => {
    bas.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const envoyer = async () => {
    if (!texte.trim() && !envois.pieces.length) return;
    await canalEspace.demander({
      type: 'espace.fil.envoyer',
      filId,
      texte,
      fichiers: envois.pieces.map((p) => p.id),
    });
    setTexte('');
    envois.vider();
    recharger();
  };

  const nonLus = nonLusDuFil(messages, moi.role);

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-volet-discussion
      data-non-lus={nonLus}
      data-discussion-chargement={chargement}
    >
      <div className="flex items-center justify-between border-b border-faint/40 px-3 py-2">
        <span className="text-[13px] font-medium text-text">{t('Discussion')}</span>
        {onFermer ? (
          <Button size="icon-sm" variant="ghost" onClick={onFermer} title={t('Fermer')} data-fermer-discussion>
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      {/* Le fil est collé EN BAS quand il ne remplit pas l'écran. */}
      <ZoneDefilement className="flex min-h-0 flex-1 flex-col justify-end gap-2 p-3">
        {!messages.length && chargement === 'en-cours' ? <SilhouetteDiscussion /> : null}
        {!messages.length && chargement === 'erreur' ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center text-[12.5px] text-faint" data-discussion-erreur>
            <span>{t('La discussion n’a pas pu se charger.')}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setChargement('en-cours');
                recharger();
              }}
            >
              {t('Réessayer')}
            </Button>
          </div>
        ) : null}
        {!messages.length && chargement === 'pret' ? (
          <div className="py-6 text-center text-[12.5px] text-faint" data-discussion-vide>
            {t('Aucun message pour le moment.')}
          </div>
        ) : null}
        {messages.map((message, i) => {
          const aMoi = message.auteurRole === moi.role;
          const jourAvant = i > 0 ? jourDe(messages[i - 1]!.creeLe) : null;
          const jour = jourDe(message.creeLe);
          return (
            <React.Fragment key={message.id}>
              {jour !== jourAvant ? <div className="my-1 text-center text-[11px] text-faint">{jour}</div> : null}
              <div className={cn('flex', aMoi ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    /*
                     * PLUS AUCUN LISERÉ : LE FOND SEUL DIT QUI PARLE. Deux
                     * niveaux de fond, tirés des jetons du thème — la bulle
                     * d'en face garde le gris des champs (`raised`), la mienne
                     * prend un voile d'accent. L'accent CONTRASTE toujours
                     * avec `surface`, dans les douze palettes : le voile reste
                     * donc lisible là où `--border` est effacé, et l'écart
                     * entre les deux camps ne disparaît sur aucune d'elles.
                     */
                    'max-w-[85%] rounded-lg px-3 py-2 text-text',
                    aMoi ? 'bg-accent/20' : 'bg-raised',
                  )}
                  data-message-fil={message.id}
                  data-bulle={aMoi ? 'moi' : 'autre'}
                >
                  {message.texte ? (
                    <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{message.texte}</p>
                  ) : null}
                  <PiecesDuMessage
                    fichiers={message.fichiers}
                    pieces={pieces}
                    images={images}
                    onOuvrirImage={setVisionneuse}
                    repere={message.id}
                  />
                  <div className="mt-0.5 text-right text-[10px] text-faint">{heureCourte(message.creeLe)}</div>
                </div>
              </div>
              {/* QUI PARLE SE LIT SOUS LA BULLE, ET SEULEMENT EN FACE. Le nom
                  de l'auteur voyage déjà avec le message ; l'écran ne montrait
                  que le texte et l'heure. Il se pose donc HORS de la bulle,
                  aligné de son côté, en ton effacé — mes propres bulles
                  restent nues, je sais qui les a écrites. Aucun liseré ajouté :
                  le ton suffit, dans les douze palettes. */}
              {aMoi || !message.auteurNom.trim() ? null : (
                <div className="-mt-1 flex justify-start">
                  <span className="px-1 text-[10.5px] text-faint" data-auteur-message={message.id}>
                    {message.auteurNom}
                  </span>
                </div>
              )}
            </React.Fragment>
          );
        })}
        <div ref={bas} />
      </ZoneDefilement>
      {/* PAS DE ZONE SÛRE ICI : la fenêtre de discussion flotte AU-DESSUS de
          la bande de l'onglet, jamais contre le bord bas de l'écran. */}
      <div className="flex shrink-0 flex-col gap-2 border-t border-faint/40 p-2" data-pied-discussion>
        <EnvoisEnCours envois={envois.envois} onReprendre={envois.reprendre} onOublier={envois.oublier} />
        <PiecesDeposees pieces={envois.pieces} onRetirer={envois.retirerPiece} />
        <div className="flex min-w-0 items-end gap-1.5">
          <Textarea
            className="min-w-0 flex-1"
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void envoyer();
              }
            }}
            placeholder={t('Votre message…')}
            rows={1}
            data-champ-message
          />
          <BoutonJoindre onFichiers={envois.ajouter} compact />
          <Button size="icon" onClick={envoyer} disabled={envois.occupe} data-envoyer-message>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {/* LES IMAGES DE LA DISCUSSION S'AGRANDISSENT, COMME CELLES D'UNE FICHE :
          la même visionneuse, les mêmes flèches, le même bouton de
          téléchargement sous l'image. */}
      <Visionneuse
        images={images.map((piece) => ({ id: piece.id, nom: piece.nom }))}
        index={visionneuse}
        onIndex={setVisionneuse}
        onFermer={() => setVisionneuse(null)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* L'écran entier                                                       */
/* ------------------------------------------------------------------ */

export function EspaceClient({
  moi,
  projectIdImpose,
  filImpose,
  projetInitial,
  demandeVisee,
  gestesHaiko,
  enteteAvant,
  enteteApres,
  navigation,
  onDeconnexion,
  monProfil,
  onEcranOuvert,
}: {
  /**
   * OÙ ALLER, DEMANDÉ DU DEHORS — un toast cliqué, une notification poussée
   * touchée. `n` change à chaque demande : cliquer deux fois la même fiche la
   * rouvre deux fois.
   */
  navigation?: {
    n: number;
    projectId?: string;
    demandeId?: string;
    discussion?: boolean;
    /** L'écran désigné par l'adresse : profil, accès, sauvegardes, création… */
    ecran?: EcranEspaceClient['ecran'];
  };
  moi: MoiDansLEspace;
  /** Vu comme Haiko : le projet du client regardé. */
  projectIdImpose?: string;
  /** Vu comme Haiko : le fil du client regardé. */
  filImpose?: string;
  /** Le projet sur lequel s'ouvrir — sans pour autant retirer le sélecteur. */
  projetInitial?: string;
  /**
   * LA FICHE DÉSIGNÉE PAR L'ADRESSE — celle du lien cliqué dans un courriel.
   * Le tiroir s'ouvre dessus dès l'arrivée, sans qu'on ait à la chercher.
   */
  demandeVisee?: string;
  /**
   * Vu comme Haiko : transformer une demande en carte, depuis sa vignette, et
   * gérer les comptes du client depuis le burger. Les comptes arrivent tout
   * rendus : la porte client n'a rien à charger de la gestion des accès.
   */
  gestesHaiko?: { onCarte: (id: string) => void; comptesDuClient?: (projectId: string) => React.ReactNode };
  /**
   * CE QUI SE POSE À GAUCHE DE L'ENTÊTE, SUR LA MÊME LIGNE. Vu comme Haiko,
   * c'est le sélecteur de client : il avait son propre rang au-dessus du
   * tableau, soit un tiers de l'entête d'un téléphone pour un seul nom.
   */
  enteteAvant?: React.ReactNode;
  /**
   * CE QUI SE POSE À DROITE DE L'ENTÊTE, AVANT LE BURGER. Vu depuis la porte
   * client, c'est le nom de la personne connectée, qui avait son propre rang.
   */
  enteteApres?: React.ReactNode;
  /** La porte client seulement : la déconnexion, rangée dans le burger. */
  onDeconnexion?: () => void;
  /**
   * LA PORTE CLIENT SEULEMENT : son PROFIL, rangé dans le burger. Vu comme
   * Haiko, la ligne n'apparaît pas — l'administration a ses propres réglages,
   * et son compte ne se change pas depuis l'écran d'un client.
   */
  monProfil?: boolean;
  /**
   * CE QUI EST OUVERT, DIT À CHAQUE CHANGEMENT — pour que l'adresse du
   * navigateur le suive. Seule la PORTE CLIENT s'en sert : l'administration a
   * déjà son propre fragment (« #espace/<client>/demande/<id> »), et deux
   * écritures concurrentes se battraient pour la même adresse.
   */
  onEcranOuvert?: (ecran: {
    projectId?: string;
    demandeId?: string;
    discussion: boolean;
    ecran: EcranEspaceClient['ecran'];
  }) => void;
}) {
  const [demandes, setDemandes] = React.useState<DemandeAffichee[] | null>(null);
  const [projectId, setProjectId] = React.useState(projectIdImpose ?? projetInitial ?? moi.projets[0]?.id ?? '');
  const [ouverte, setOuverte] = React.useState<string | null>(demandeVisee ?? null);
  /* L'ADRESSE VAUT DÈS LE PREMIER AFFICHAGE : coller un lien vers le profil ou
     les accès ouvre l'écran tout de suite, sans passer par le tableau. */
  const [creation, setCreation] = React.useState(navigation?.ecran === 'nouvelle-demande');
  const [profil, setProfil] = React.useState(navigation?.ecran === 'profil');
  /*
   * UN SEUL VOLET À LA FOIS : les backups du projet ou son espace « Accès », à
   * droite — ou la DISCUSSION, qui s'ouvre au-dessus de son onglet, en bas. En
   * ouvrir un referme l'autre : trois panneaux ensemble ne tiendraient pas sur
   * un téléphone.
   */
  const [volet, setVolet] = React.useState<'backups' | 'acces' | null>(
    navigation?.ecran === 'acces' ? 'acces' : navigation?.ecran === 'backups' ? 'backups' : null,
  );
  const [discussion, setDiscussion] = React.useState(navigation?.discussion ?? false);
  const voletOuvert = volet !== null;
  const basculerVolet = (quel: 'backups' | 'acces') => {
    setDiscussion(false);
    setVolet((v) => (v === quel ? null : quel));
  };
  const basculerDiscussion = () => {
    setVolet(null);
    setDiscussion((ouverte) => !ouverte);
  };
  const fermerDiscussion = React.useCallback(() => setDiscussion(false), []);
  const [erreur, setErreur] = React.useState<string | null>(null);
  /*
   * LE FILTRE ET LE TRI SONT PAR COLONNE, ET GARDÉS PAR PROJET. On trie « En
   * cours » par échéance et on filtre « À faire » sur une étiquette sans toucher
   * aux autres colonnes ; les deux reviennent d'une visite à l'autre. Une forme
   * ANCIENNE gardée dans le navigateur est ignorée, sans erreur
   * (`lireReglagesDesColonnes`).
   */
  const cleReglages = `beluga.espace.colonnes.${projectId}`;
  const [reglages, setReglages] = React.useState<ReglagesDesColonnes>(() =>
    lireReglagesDesColonnes(window.localStorage.getItem(cleReglages)),
  );
  React.useEffect(() => {
    setReglages(lireReglagesDesColonnes(window.localStorage.getItem(cleReglages)));
  }, [cleReglages]);
  /* On écrit DANS le changement, jamais dans un effet : un effet réécrirait les
     réglages du projet précédent sous la clé du nouveau, avant leur lecture. */
  const changerReglages = (suite: (avant: ReglagesDesColonnes) => ReglagesDesColonnes) =>
    setReglages((avant) => {
      const apres = suite(avant);
      window.localStorage.setItem(cleReglages, ecrireReglagesDesColonnes(apres));
      return apres;
    });
  /** La recherche de chaque colonne : jamais gardée, elle repart vide à chaque visite. */
  const [recherches, setRecherches] = React.useState<Partial<Record<ColonneDemande, string>>>({});
  const [nonLus, setNonLus] = React.useState({ messages: 0, commentaires: 0 });
  /** Les demandes qui ont du nouveau, projet par projet : la pastille du sélecteur. */
  const [nonLusParProjet, setNonLusParProjet] = React.useState<Record<string, number>>({});

  const filId = filImpose ?? moi.id;

  /**
   * ALLER À CE DONT PARLE UNE NOTIFICATION : la fiche d'une demande — sur son
   * projet, s'il n'est pas celui affiché —, ou la discussion.
   */
  const allerVers = React.useCallback(
    (cible: {
      projectId?: string;
      demandeId?: string;
      discussion?: boolean;
      ecran?: EcranEspaceClient['ecran'];
    }) => {
      if (cible.projectId && !projectIdImpose && moi.projets.some((p) => p.id === cible.projectId)) {
        setProjectId(cible.projectId);
      }
      /*
       * UN SEUL ÉCRAN À LA FOIS : l'adresse désigne un endroit, on referme donc
       * ce qui occupait la place avant d'ouvrir le nouveau. Sans cette remise à
       * plat, revenir en arrière laissait un volet ouvert par-dessus l'écran
       * que l'adresse demandait.
       */
      const vers = cible.ecran ?? (cible.discussion ? 'discussion' : cible.demandeId ? 'demande' : 'demandes');
      setDiscussion(vers === 'discussion');
      setVolet(vers === 'acces' ? 'acces' : vers === 'backups' ? 'backups' : null);
      setProfil(vers === 'profil');
      setCreation(vers === 'nouvelle-demande');
      setOuverte(vers === 'demande' ? cible.demandeId ?? null : null);
    },
    [projectIdImpose, moi.projets],
  );

  React.useEffect(() => {
    if (navigation && navigation.n > 0) allerVers(navigation);
    // Seul le numéro compte : un nouvel objet au même numéro n'est pas un nouveau clic.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation?.n]);

  /*
   * L'ADRESSE PEUT CHANGER SANS QUE L'ÉCRAN SOIT REMONTÉ — un second lien de
   * courriel ouvert dans le même onglet, un Précédent/Suivant. La fiche visée
   * rouvre alors le tiroir, au lieu de rester sans effet.
   */
  React.useEffect(() => {
    if (demandeVisee) setOuverte(demandeVisee);
  }, [demandeVisee]);

  /*
   * L'ADRESSE SUIT CE QU'ON REGARDE. Elle ne le faisait jamais : on pouvait
   * arriver sur une fiche par un lien de courriel, mais pas en partager une ni
   * la retrouver après un rechargement. Le porteur (la porte client) pose un
   * `replaceState` — aucun `hashchange` n'est émis, donc aucune boucle avec
   * l'écouteur qui relit l'adresse.
   */
  React.useEffect(() => {
    /*
     * L'ORDRE COMPTE : c'est celui de ce qui est VISIBLE DEVANT. La discussion
     * se pose au-dessus de tout, puis la fiche d'une demande, puis les volets
     * et tiroirs, et enfin le tableau. Un écran passager — un menu, une
     * confirmation — n'apparaît nulle part ici : il n'a pas d'adresse.
     */
    const ecran: EcranEspaceClient['ecran'] = discussion
      ? 'discussion'
      : ouverte
        ? 'demande'
        : profil
          ? 'profil'
          : volet === 'acces'
            ? 'acces'
            : volet === 'backups'
              ? 'backups'
              : creation
                ? 'nouvelle-demande'
                : 'demandes';
    onEcranOuvert?.({ projectId, demandeId: ouverte ?? undefined, discussion, ecran });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, ouverte, discussion, profil, volet, creation]);

  const recharger = React.useCallback(() => {
    void canalEspace
      /* Le FIL regardé part avec la demande : la pastille du bouton
         « Discussion » ne compte que celui-là, jamais tous les fils. */
      .demander({ type: 'espace.etat', projectId: projectId || undefined, filId })
      .then(
        (reponse: {
          projectId: string;
          demandes: DemandeAffichee[];
          nonLus?: { messages: number; commentaires: number };
          nonLusParProjet?: Record<string, number>;
        }) => {
          setProjectId(reponse.projectId);
          setDemandes(reponse.demandes);
          if (reponse.nonLus) setNonLus(reponse.nonLus);
          setNonLusParProjet(reponse.nonLusParProjet ?? {});
          setErreur(null);
        },
      )
      .catch((err) => {
        setDemandes([]);
        setErreur(err?.message ?? t('Impossible de charger vos demandes.'));
      });
  }, [projectId, filId]);

  React.useEffect(recharger, [recharger]);
  React.useEffect(() => canalEspace.surChangementDEtat((etat) => etat === 'en-ligne' && recharger()), [recharger]);
  React.useEffect(
    () =>
      canalEspace.ecouter((event) => {
        /*
         * LE DIRECT SUIT LE PROJET, PLUS L'AUTEUR. Sans cela, la correction de
         * visibilité ne vaudrait qu'au chargement : une demande déposée par
         * Haiko n'apparaîtrait qu'après un rechargement à la main.
         */
        if (event.type === 'espace.demande' || event.type === 'espace.message') recharger();
        /*
         * UN MESSAGE DU FIL REGARDÉ COMPTE, VOLET FERMÉ COMME OUVERT. Seul le
         * volet écoutait `espace.fil`, et il n'est monté que s'il est ouvert :
         * la pastille du bouton ne montait donc jamais sans un clic. L'écran,
         * lui, est toujours là — il redemande le compte au serveur, seule
         * source du chiffre.
         *
         * MON PROPRE MESSAGE NE REDEMANDE RIEN : il ne peut pas m'être non lu.
         */
        if (
          event.type === 'espace.fil' &&
          (event as any).filId === filId &&
          (event as any).message?.auteur?.id !== moi.id
        ) {
          recharger();
        }
        if (event.type === 'espace.nonLus') {
          /*
           * LE COMPTE DE MESSAGES N'EST REPRIS QUE S'IL PARLE DE MON FIL. Vu
           * comme Haiko, un compte SANS fil est la somme de TOUS les clients :
           * l'adopter ferait sauter la pastille de discussion du client regardé
           * au total général, jusqu'au rechargement qui suit. Un client, lui,
           * n'a qu'un fil — le sien est toujours nommé, donc toujours repris.
           * Les commentaires, eux, sont ceux du compte quoi qu'il arrive.
           */
          const surMonFil = (event as any).filId === filId;
          setNonLus((avant) => ({
            messages: surMonFil ? ((event as any).messages ?? 0) : avant.messages,
            commentaires: (event as any).commentaires ?? 0,
          }));
          /*
           * LIRE CHANGE LE TABLEAU, PAS SEULEMENT LE BANDEAU. Le compte d'une
           * tête de colonne se calcule sur le résumé de chaque demande : sans ce
           * rechargement, ouvrir une fiche éteignait la pastille du haut et
           * laissait celle de la colonne allumée — deux chiffres qui se
           * contredisent sur le même écran.
           */
          recharger();
        }
      }),
    [recharger, filId, moi.id],
  );

  /**
   * DÉPOSER UNE VIGNETTE : on bouge l'écran D'ABORD, on confirme ensuite. Si le
   * serveur refuse, l'état repart de ce qu'il dit — pas de l'espoir qu'on avait.
   */
  const deposer = React.useCallback(
    (id: string, cible: CibleDeDepot) => {
      setDemandes((liste) =>
        liste ? liste.map((d) => (d.id === id ? { ...d, colonne: cible.colonne } : d)) : liste,
      );
      void canalEspace
        .demander({
          type: 'espace.demande.deplacer',
          id,
          colonne: cible.colonne,
          avantId: cible.avantId,
          apresId: cible.apresId,
        })
        .then(recharger)
        .catch((err) => {
          setErreur(err?.message ?? t('Ce déplacement a été refusé.'));
          recharger();
        });
    },
    [recharger],
  );

  /*
   * LE GESTE VIENT DU TABLEAU DES CARTES. `usePointerDrag` est celui du kanban
   * de Beluga, mot pour mot : appui maintenu au doigt, prise immédiate à la
   * souris, seuil de quelques pixels avant qu'un clic ne devienne un
   * glissement, défilement du navigateur retenu tant qu'on porte. Ce qui reste
   * propre à l'espace tient en deux choses : la LECTURE de la cible — ici on
   * dépose ENTRE deux vignettes, pas seulement dans une colonne — et le rail
   * qui défile quand on porte une vignette contre un bord.
   *
   * PAS D'APPUI LONG QUI OUVRE UN MENU, contrairement au kanban : la vignette
   * porte déjà son « … » en clair, et un menu qui surgirait pendant l'appui
   * confisquerait le glisser à l'instant même où il s'arme.
   */
  const tenue = React.useRef<string | null>(null);
  const cibleTenue = React.useRef<CibleDeDepot | null>(null);
  const [colonneVisee, setColonneVisee] = React.useState<ColonneDemande | null>(null);

  const relireLaCible = React.useCallback((element: Element | null, y: number) => {
    const trouvee = element ? cibleDeDepot(element, y, tenue.current) : null;
    cibleTenue.current = trouvee;
    setColonneVisee(trouvee?.colonne ?? null);
    return trouvee;
  }, []);

  /*
   * `DropTarget` ne sait dire qu'un identifiant : on lui donne la COLONNE, qui
   * suffit à la surligner, et la place exacte entre voisines reste dans une
   * référence à nous. Les deux sont posées par le même appel — elles ne peuvent
   * pas se contredire.
   */
  const resolve = React.useCallback(
    (element: Element, y: number): DropTarget | null => {
      const trouvee = relireLaCible(element, y);
      return trouvee ? { id: trouvee.colonne, kind: 'colonne', position: 'inside' } : null;
    },
    [relireLaCible],
  );

  const auDepot = React.useCallback(
    (item: DragItem, cible: DropTarget | null) => {
      const place = cibleTenue.current;
      cibleTenue.current = null;
      tenue.current = null;
      setColonneVisee(null);
      if (cible && place) deposer(item.id, place);
    },
    [deposer],
  );

  const { dragging, pointer, start } = usePointerDrag({
    resolve,
    onDrop: auDepot,
    holdMs: DELAI_APPUI_LONG,
  });

  /**
   * Ce qu'on pose sur la vignette ENTIÈRE — un clic ordinaire l'ouvre encore.
   * L'étiquette portée est le TITRE de la demande : c'est lui que l'aperçu
   * affiche pendant le port. Un identifiant n'apprendrait rien à personne.
   */
  const prise = React.useCallback(
    (demande: DemandeAffichee) => ({
      onPointerDown: (event: React.PointerEvent) => {
        tenue.current = demande.id;
        start(event, { id: demande.id, kind: 'demande', label: demande.titre });
      },
    }),
    [start],
  );

  /** Les gestes rares d'une vignette, sous son « … ». */
  const gestes: GestesDeVignette = React.useMemo(
    () => ({
      onArchiver: (id, archivee) => {
        void canalEspace
          .demander({ type: 'espace.demande.archiver', id, archivee })
          .then(recharger)
          .catch((err) => setErreur(err?.message ?? t('Cette modification n’a pas pu être enregistrée.')));
      },
      onCarte: gestesHaiko?.onCarte,
    }),
    [recharger, gestesHaiko],
  );

  /* ---------------- Le rail des colonnes, sur téléphone ---------------- */

  const telephone = useTelephone();
  const rail = React.useRef<HTMLDivElement | null>(null);
  const [colonneVue, setColonneVue] = React.useState(0);

  /** La colonne sous les yeux se lit du défilement, jamais d'un état à part. */
  const suivreLeRail = React.useCallback(() => {
    const zone = rail.current;
    if (!zone) return;
    const wagon = zone.querySelector('[data-colonne-kanban]') as HTMLElement | null;
    const pas = wagon ? wagon.getBoundingClientRect().width + 12 : zone.clientWidth;
    const index = Math.min(COLONNES_DEMANDE.length - 1, Math.max(0, Math.round(zone.scrollLeft / pas)));
    setColonneVue(index);
  }, []);

  const allerALaColonne = React.useCallback((index: number) => {
    const zone = rail.current;
    const wagons = zone?.querySelectorAll('[data-colonne-kanban]');
    const vise = wagons?.[index] as HTMLElement | undefined;
    if (!zone || !vise) return;
    // On vise le CENTRE, comme le fait l'ancrage : sans cela le rail partirait
    // un peu à côté, et l'ancrage le rattraperait d'un sursaut.
    zone.scrollTo({ left: vise.offsetLeft - (zone.clientWidth - vise.offsetWidth) / 2, behavior: 'smooth' });
  }, []);

  /*
   * LE RAIL SUIT LE DOIGT. Porter une vignette contre un bord fait défiler les
   * colonnes toutes seules — l'effet est celui du tableau des cartes, à une
   * nuance près : ici le rail bouge sous un doigt IMMOBILE, et personne
   * n'émettra de `pointermove` pour le dire. On relit donc la cible à chaque
   * pas, sinon on lâcherait sur la colonne d'avant.
   */
  React.useEffect(() => {
    if (!dragging || !pointer) return;
    const bande = 70;
    const timer = window.setInterval(() => {
      const zone = rail.current;
      if (!zone) return;
      const boite = zone.getBoundingClientRect();
      const avant = zone.scrollLeft;
      if (pointer.x < boite.left + bande) zone.scrollLeft -= 14;
      else if (pointer.x > boite.right - bande) zone.scrollLeft += 14;
      if (zone.scrollLeft !== avant) {
        relireLaCible(document.elementFromPoint(pointer.x, pointer.y), pointer.y);
      }
    }, 16);
    return () => window.clearInterval(timer);
  }, [dragging, pointer, relireLaCible]);

  /*
   * ON RETOMBE SUR LA COLONNE QU'ON REGARDAIT. Revenir à un projet — ou à un
   * client, vu comme Haiko — ne renvoie plus en tête du rail : la dernière
   * colonne consultée est gardée par projet, dans le navigateur.
   */
  const clefColonne = `beluga.espace.colonne.${projectId}`;
  React.useEffect(() => {
    if (!telephone || demandes === null) return;
    const garde = Number(window.localStorage.getItem(clefColonne) ?? '0');
    const index = Number.isFinite(garde) ? Math.min(COLONNES_DEMANDE.length - 1, Math.max(0, garde)) : 0;
    setColonneVue(index);
    if (index) requestAnimationFrame(() => allerALaColonne(index));
    // Le rail n'existe qu'une fois les demandes arrivées : ce garde-fou suffit.
  }, [telephone, demandes === null, clefColonne, allerALaColonne]);

  React.useEffect(() => {
    if (telephone) window.localStorage.setItem(clefColonne, String(colonneVue));
  }, [telephone, clefColonne, colonneVue]);

  /** Refermer « Accès » ou « Backups » : le tiroir de l'application le fait seul. */
  const fermerLeVolet = React.useCallback(() => setVolet(null), []);

  /** Les personnes qu'une mention @ peut viser : celles qui voient le projet. */
  const mentions = React.useMemo(() => {
    const vus = new Map<string, string>();
    for (const demande of demandes ?? []) vus.set(demande.auteurId, demande.auteurNom);
    vus.set(moi.id, moi.nomAffiche);
    return [...vus].map(([id, nom]) => ({ id, nom }));
  }, [demandes, moi.id, moi.nomAffiche]);

  /*
   * L'ENTÊTE PARAÎT AVANT LES DEMANDES. Elle porte désormais, vu comme Haiko,
   * le SÉLECTEUR DE CLIENT : la retirer pendant le chargement enfermerait sur
   * le client en cours, puisque changer de client remonte cet écran à zéro.
   * Seul le tableau attend, et il montre sa silhouette.
   */
  const chargement = demandes === null;
  const listeDemandes = demandes ?? [];

  const etiquettes = etiquettesConnues(listeDemandes);
  const colonnes = COLONNES_DEMANDE.map((colonne) => {
    const vue = vueDeLaColonne(listeDemandes, colonne, {
      filtre: reglages.filtres[colonne],
      recherche: recherches[colonne],
      tri: reglages.tris[colonne],
    });
    return {
      colonne,
      cartes: vue.cartes,
      masquees: vue.masquees,
      // CE QUI M'ATTEND VRAIMENT dans cette colonne — des messages non lus, et
      // compté sur ce que la colonne MONTRE, filtres compris : un chiffre qui ne
      // correspond à aucune carte visible ne s'explique pas.
      nonLues: nonLuesPourMoi(vue.cartes),
    };
  });

  /** Ce que chaque colonne reçoit pour se filtrer, se trier, se chercher — et le « + » d'« À faire ». */
  const reglageDe = (colonne: ColonneDemande) => ({
    filtre: reglages.filtres[colonne],
    onFiltre: (filtre: FiltreDeColonne) =>
      changerReglages((avant) => ({ ...avant, filtres: { ...avant.filtres, [colonne]: filtre } })),
    tri: reglages.tris[colonne],
    onTri: (tri: TriDemande) => changerReglages((avant) => ({ ...avant, tris: { ...avant.tris, [colonne]: tri } })),
    recherche: recherches[colonne] ?? '',
    onRecherche: (texte: string) => setRecherches((avant) => ({ ...avant, [colonne]: texte })),
    etiquettes,
    /* ON NE CRÉE PAS UNE DEMANDE DANS UNE LISTE D'ARCHIVES : le « + » s'efface
       tant que « À faire » regarde ses demandes rangées. */
    onNouvelle:
      colonne === 'a-faire' && !reglages.filtres['a-faire']?.archivees ? () => setCreation(true) : undefined,
  });
  const totalNonLus = nonLus.messages + nonLus.commentaires;
  /*
   * LA PASTILLE DU BOUTON « DISCUSSION » NE COMPTE QUE LA DISCUSSION.
   *
   * Elle était alimentée par le compteur d'ENSEMBLE de l'espace — les messages
   * du fil ET les commentaires des demandes —, et disait donc « 3 » sur un fil
   * où rien n'attendait. Seuls les messages du fil comptent désormais ; elle
   * s'éteint dès la fenêtre ouverte (`espace.fil.vu`), qui renvoie le compte à
   * jour.
   *
   * FENÊTRE OUVERTE, ELLE RESTE ÉTEINTE. Le message reçu allume le compte au
   * serveur, et `espace.fil.vu` l'éteint juste après : sans cette garde, la
   * pastille clignoterait sur une fenêtre où on est justement en train de lire.
   */
  const nonLusDeLaDiscussion = discussion ? 0 : nonLus.messages;

  return (
    <div className="flex h-full min-h-0 min-w-0" data-espace-client data-role={moi.role} data-non-lus={totalNonLus}>
      {/*
       * `min-w-0` n'est pas un détail : sans lui, la largeur naturelle du rail
       * (quatre colonnes bout à bout) élargit toute la colonne, et le rail ne
       * défile plus — il pousse l'écran.
       */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <EnteteEspace
          avant={enteteAvant}
          projectId={projectId}
          projets={projectIdImpose ? moi.projets.filter((p) => p.id === projectId) : moi.projets}
          onProjet={setProjectId}
          apres={enteteApres}
          nonLusParProjet={nonLusParProjet}
          cloche={
            moi.role === 'client' ? (
              <ClocheEspace
                onAller={(notification) =>
                  allerVers({
                    projectId: notification.projectId,
                    demandeId: notification.demandeId,
                    discussion: notification.cible === 'discussion',
                  })
                }
              />
            ) : gestesHaiko && filImpose ? (
              /* VU COMME HAIKO : la cloche de CE client, et de lui seul. */
              <ClocheEspace
                clientId={filImpose}
                onAller={(notification) =>
                  allerVers({
                    demandeId: notification.demandeId,
                    discussion: notification.cible === 'discussion',
                  })
                }
              />
            ) : undefined
          }
          menu={
            <MenuEspace
              onBackups={() => basculerVolet('backups')}
              onAcces={() => basculerVolet('acces')}
              onProfil={monProfil ? () => setProfil(true) : undefined}
              onDeconnexion={onDeconnexion}
              comptesDuClient={moi.role === 'admin' ? gestesHaiko?.comptesDuClient?.(projectId) : undefined}
            />
          }
        />

        {erreur ? <div className="px-3 py-2 text-xs text-danger">{erreur}</div> : null}

        {chargement ? (
          <SilhouetteDemandes />
        ) : telephone ? (
          /*
           * LE RAIL : les QUATRE colonnes sont là ensemble, chacune ancrée
           * centrée, la suivante en amorce pour qu'on comprenne qu'il y en a
           * d'autres. Plus d'onglets, plus de colonne montée seule : on fait
           * glisser le pouce, et le rail s'arrête pilé sur une colonne.
           *
           * L'ANCRAGE SE COUPE PENDANT UN GLISSEMENT : sinon le défilement
           * automatique du bord se ferait ramener de force à chaque image.
           */
          <>
            <ZoneDefilement
              ref={rail}
              axe="horizontal"
              classeEnveloppe="min-h-0 flex-1"
              className={cn('flex gap-3 px-3 py-3', dragging ? 'snap-none' : 'snap-x snap-mandatory')}
              onScroll={suivreLeRail}
              data-rail-colonnes
              data-colonne-vue={colonnes[colonneVue]?.colonne}
            >
              {colonnes.map(({ colonne, cartes, nonLues, masquees }) => (
                <ColonneDemandes
                  key={colonne}
                  colonne={colonne}
                  cartes={cartes}
                  nonLues={nonLues}
                  masquees={masquees}
                  visee={colonneVisee === colonne}
                  glissee={dragging?.id ?? null}
                  prise={prise}
                  onOuvrir={setOuverte}
                  telephone
                  gestes={gestes}
                  {...reglageDe(colonne)}
                />
              ))}
            </ZoneDefilement>
            {/* OÙ SUIS-JE DANS LE RAIL : un point par colonne, cliquable. */}
            <div className="flex shrink-0 items-center justify-center gap-2 py-2" data-points-rail>
              {colonnes.map(({ colonne }, index) => (
                <button
                  key={colonne}
                  type="button"
                  onClick={() => allerALaColonne(index)}
                  className={cn(
                    'h-1.5 rounded-full transition-all',
                    index === colonneVue ? 'w-5 bg-accent' : 'w-1.5 bg-faint/60',
                  )}
                  data-point-rail={colonne}
                  data-point-actif={index === colonneVue ? '' : undefined}
                  title={t(TITRES_COLONNES_DEMANDE[colonne])}
                  aria-label={TITRES_COLONNES_DEMANDE[colonne]}
                />
              ))}
            </div>
          </>
        ) : (
          /*
           * QUATRE CONTENEURS PLEINE HAUTEUR, plus une grille dont les cases se
           * dimensionnent sur leur contenu. C'est CE QUI RÉPARE LE DÉPÔT : avec
           * la grille, une colonne peu remplie ne faisait que la hauteur de ses
           * vignettes, et tout ce qu'on lâchait plus bas ne rencontrait aucun
           * `[data-colonne-kanban]` — `cibleDeDepot` rendait `null` et le geste
           * mourait en silence. Chaque colonne défile désormais chez elle,
           * comme au tableau Beluga.
           */
          <div className="flex min-h-0 flex-1 gap-3 p-3" data-colonnes-espace>
            {colonnes.map(({ colonne, cartes, nonLues, masquees }) => (
              <ColonneDemandes
                key={colonne}
                colonne={colonne}
                cartes={cartes}
                nonLues={nonLues}
                masquees={masquees}
                visee={colonneVisee === colonne}
                glissee={dragging?.id ?? null}
                prise={prise}
                onOuvrir={setOuverte}
                telephone={false}
                gestes={gestes}
                {...reglageDe(colonne)}
              />
            ))}
          </div>
        )}

        {/*
         * LA DISCUSSION, EN BAS : un onglet glissable à l'horizontale, et sa
         * fenêtre flottante au-dessus de lui. Elle ne passe plus par le volet de
         * droite, qui repoussait les colonnes.
         */}
        <OngletDiscussion
          nonLus={nonLusDeLaDiscussion}
          ouverte={discussion}
          onBasculer={basculerDiscussion}
          onFermer={fermerDiscussion}
        >
          <VoletDiscussion moi={moi} filId={filId} projectId={projectId} onFermer={fermerDiscussion} />
        </OngletDiscussion>
      </div>

      {/*
       * L'APERÇU QUI SUIT LE CURSEUR — celui du tableau Beluga, mot pour mot :
       * un bloc `fixed` posé sur le pointeur, largeur d'une carte, ombre
       * franche, et `pointer-events-none` (sans quoi il se mettrait lui-même
       * sous le pointeur et le dépôt ne trouverait plus la colonne visée). La
       * vignette d'origine garde son voile d'opacité : on lit bien « la carte
       * se déplace », plus « rien ne se passe ».
       */}
      {dragging && pointer ? (
        <div
          className="pointer-events-none fixed z-[60] w-[254px] rounded-md border border-muted bg-raised px-2.5 py-2 text-[14px] font-medium leading-snug text-text shadow-2xl"
          style={{ left: pointer.x + 12, top: pointer.y - 18 }}
          data-apercu-glisse
        >
          {dragging.label}
        </div>
      ) : null}

      {/*
       * « ACCÈS » ET « BACKUPS » S'OUVRENT DANS LE TIROIR DE L'APPLICATION —
       * celui de la fiche d'une demande, de la nouvelle demande, de la cloche
       * et du menu. Ils avaient leur propre volet ancré à droite sur
       * ordinateur, et leur propre mécanique de tiroir montant sur téléphone :
       * un second geste à apprendre, une seconde mécanique à entretenir, pour
       * deux écrans. Le mode PLEIN sur téléphone est celui de la fiche.
       *
       * Le contenu n'est monté qu'une fois le tiroir OUVERT : les deux écrans
       * interrogent le serveur dès leur montage, et rien ne doit partir pour
       * un panneau que personne ne regarde.
       */}
      <Drawer open={voletOuvert} onClose={fermerLeVolet} plein={telephone}>
        <div
          className="flex min-h-0 flex-1 flex-col"
          data-volet-espace={volet ?? undefined}
        >
          {volet === 'backups' ? (
            <VoletBackups projectId={projectId} onFermer={fermerLeVolet} />
          ) : volet === 'acces' ? (
            <VoletAcces moi={moi} projectId={projectId} onFermer={fermerLeVolet} />
          ) : null}
        </div>
      </Drawer>

      {ouverte ? (
        <TiroirDemande
          demandeId={ouverte}
          moi={moi}
          projectId={projectId}
          mentions={mentions}
          onFermer={() => setOuverte(null)}
          onChangement={recharger}
          onDemanderCarte={gestesHaiko?.onCarte}
        />
      ) : null}
      {creation ? (
        <NouvelleDemande projectId={projectId} onFerme={() => setCreation(false)} onCreee={recharger} />
      ) : null}
      {profil ? <TiroirProfil onFermer={() => setProfil(false)} /> : null}
    </div>
  );
}

/** L'état du canal, pour le voile de connexion de la porte client. */
export function useEtatDuCanal(): EtatCanalEspace {
  const [etat, setEtat] = React.useState<EtatCanalEspace>(canalEspace.etat());
  React.useEffect(() => canalEspace.surChangementDEtat(setEtat), []);
  return etat;
}
