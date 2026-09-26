/**
 * LA FICHE D'UNE DEMANDE — DANS LE TIROIR DE L'APPLICATION.
 *
 * Il n'y a plus de panneau maison ancré au bord droit sur ordinateur et de
 * feuille montante sur téléphone : deux comportements à tenir à jour pour un
 * seul écran. La fiche emploie le `Drawer` de la maison — celui des réglages de
 * l'agent, du coffre-fort, du parcours d'une carte — et se comporte donc
 * EXACTEMENT pareil partout : elle monte du bas, se referme en tirant sa
 * poignée, en touchant le voile ou par la touche d'échappement.
 *
 * L'EN-TÊTE PORTE LE TITRE, LA DESCRIPTION, PUIS « AUTEUR · DATE », sur le même
 * bord gauche. La description y est REPLIABLE : elle se replie quand on avance
 * dans le fil et revient quand on remonte tout en haut (ou d'un toucher sur le
 * chevron), sans jamais se replier pendant qu'on l'écrit.
 *
 * LA FICHE EST UN FLUX CONTINU, SANS UN SEUL CADRE. Le « Todo » replié, puis
 * les messages ; les « Options » repliées se tiennent
 * HORS du défilement, juste au-dessus du champ de message : rien n'est
 * encadré ni séparé par un trait. La hiérarchie passe par les NIVEAUX DE FOND
 * du thème (`surface` pour la fiche, `raised` pour ce qui se pose dessus, un
 * voile d'accent pour ma propre bulle) — des traits partout hachaient un écran
 * qui n'a qu'une seule chose à montrer.
 *
 * LA DISCUSSION N'A PLUS DE TITRE. Elle n'était pas un bloc parmi d'autres :
 * c'est POUR ELLE qu'on ouvre une fiche. Un libellé « Discussion » et son
 * compteur ne faisaient qu'annoncer ce qui était déjà sous les yeux.
 *
 * LES PIÈCES JOINTES NE SONT PAS DANS LE CORPS. Elles vivent derrière un
 * bouton de l'ENTÊTE, qui porte leur compte et ouvre un tiroir EMPILÉ. Elles
 * poussaient la discussion vers le bas pour être consultées une fois sur dix.
 *
 * LES OPTIONS SONT FIXÉES AU-DESSUS DU CHAMP DE MESSAGE, EN ACCORDÉON.
 * Importance, dates et étiquettes se touchent une fois par demande, mais on
 * veut les VOIR sans ouvrir un menu : un bloc rétracté posé entre la
 * discussion et le composeur, qui déroule ses trois réglages EMPILÉS une fois
 * ouvert. Au pied de la zone qui défile, il laissait un vide sous les derniers
 * messages et ne se trouvait qu'en descendant tout en bas. Plus de pagination à
 * feuilleter : on ne cherche pas un réglage en tournant des pages.
 *
 * IL NE RESTE DONC AU MENU « ⋮ » QUE LES GESTES RARES : ranger, ouvrir la carte
 * Beluga — et l'HISTORIQUE, en dernier et replié, qu'on ne consulte qu'en cas
 * de doute. Une demande change de colonne en la glissant, nulle part ailleurs.
 */
import * as React from 'react';
import {
  ArrowRightLeft,
  CheckSquare,
  ChevronDown,
  Inbox,
  ListChecks,
  Paperclip,
  Plus,
  SlidersHorizontal,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  ActionTiroir,
  BlocRepliable,
  Button,
  DialogTitle,
  Drawer,
  GroupeTiroir,
  MenuActions,
  ZoneDefilement,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import {
  TITRES_IMPORTANCE,
  champsModifiables,
  echeanceDeDemandeDepassee,
  estArchivee,
  jaugeDesTaches,
  type ActiviteDemande,
  type Demande,
  type MessageDemande,
  type PieceDeGalerie,
  type TacheDemande,
} from '@beluga/shared';
import { SilhouetteFicheDemande } from '@/components/silhouettes';
import { useTelephone } from '@/lib/telephone';
import { canalEspace } from './canal-espace';
import { Galerie, PiecesDuMessage, Visionneuse, useEnvois } from './pieces';
import { ComposeurEspace, type MentionPossible } from './composeur-espace';
import { OptionsDemande, type PatchDOptions } from './options-demande';
import { BlocDeFiche } from './bloc-de-fiche';
import { TexteEditable } from './texte-editable';
import { heureCourte, jourCourt, jourDe } from './formats';
import type { MoiDansLEspace } from './espace-client';

/*
 * LE REPLI DE LA DESCRIPTION, AVEC UNE MARGE DE TOLÉRANCE. Replier change la
 * hauteur de l'en-tête, donc celle du fil, donc sa position de défilement : sans
 * seuils écartés et sans ignorer les défilements pendant l'animation, la fiche
 * oscillerait entre replié et déplié.
 */
const SEUIL_REPLI_PX = 24;
const SEUIL_DEPLI_PX = 4;
const DUREE_REPLI_MS = 200;

/** Une ligne de l'historique, déjà rédigée côté serveur. */
function LigneDActivite({ activite }: { activite: ActiviteDemande }) {
  return (
    <li
      className="flex gap-2 text-[12px] leading-relaxed"
      data-activite={activite.genre}
      data-activite-importance={
        activite.importanceAvant && activite.importanceApres
          ? `${activite.importanceAvant}>${activite.importanceApres}`
          : undefined
      }
    >
      {/* Un trait qui porte une information suit `--faint`, jamais `--border`. */}
      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-faint" aria-hidden />
      <span className="min-w-0">
        <span className="text-text">{activite.auteurNom}</span>{' '}
        <span className="text-muted">{phraseDActivite(activite)}</span>{' '}
        <span className="whitespace-nowrap text-faint">
          {jourDe(activite.creeLe)} · {heureCourte(activite.creeLe)}
        </span>
      </span>
    </li>
  );
}

function phraseDActivite(activite: ActiviteDemande): string {
  /*
   * UN CHANGEMENT D'IMPORTANCE SE LIT AVEC SES DEUX BOUTS, TRADUITS. La phrase
   * du serveur ne disait que la nouvelle valeur, sous son nom technique, et
   * restait en français dans les cinq langues : un client qui remonte une
   * priorité doit se voir d'un coup d'œil.
   */
  if (activite.genre === 'modification' && activite.importanceAvant && activite.importanceApres) {
    return t('a changé l’importance : {avant} → {apres}', {
      avant: t(TITRES_IMPORTANCE[activite.importanceAvant]),
      apres: t(TITRES_IMPORTANCE[activite.importanceApres]),
    });
  }
  switch (activite.genre) {
    case 'creation':
      return t('a déposé la demande');
    case 'deplacement':
      return t('a déplacé la demande');
    case 'commentaire':
      return t('a commenté');
    case 'archivage':
      return t('a rangé la demande');
    case 'desarchivage':
      return t('a ressorti la demande');
    case 'carte':
      return t('en a fait une carte');
    // L'étape de la carte liée, et rien du travail de l'agent.
    case 'avancement':
      return activite.detail === 'en-ligne'
        ? t('a mis la demande en ligne')
        : activite.detail === 'terminee'
          ? t('a terminé le travail')
          : t('a commencé le travail');
    default:
      return activite.detail || t('a modifié la fiche');
  }
}

export function TiroirDemande({
  demandeId,
  moi,
  projectId,
  mentions,
  onFermer,
  onChangement,
  onDemanderCarte,
}: {
  demandeId: string;
  moi: MoiDansLEspace;
  projectId: string;
  mentions: MentionPossible[];
  onFermer: () => void;
  onChangement: () => void;
  /**
   * VU COMME HAIKO : la conversion lui est rendue, pour qu'il choisisse le
   * moteur, le modèle et le niveau de réflexion avant que la tâche ne naisse.
   * Absent (vu comme client, ou carte déjà créée) : rien ne change.
   */
  onDemanderCarte?: (demandeId: string) => void;
}) {
  const [demande, setDemande] = React.useState<Demande | null>(null);
  const [messages, setMessages] = React.useState<MessageDemande[]>([]);
  const [pieces, setPieces] = React.useState<PieceDeGalerie[]>([]);
  const [activite, setActivite] = React.useState<ActiviteDemande[]>([]);
  const [texte, setTexte] = React.useState('');
  const [tacheNeuve, setTacheNeuve] = React.useState('');
  /** Le tiroir des pièces jointes, empilé par-dessus la fiche. */
  const [piecesOuvertes, setPiecesOuvertes] = React.useState(false);
  /** L'image montrée en grand, parmi TOUTES les images de la demande ; `null` : fermée. */
  const [visionneuse, setVisionneuse] = React.useState<number | null>(null);
  const images = React.useMemo(() => pieces.filter((piece) => piece.genre === 'image'), [pieces]);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const envois = useEnvois(projectId);
  /*
   * SUR TÉLÉPHONE, LA FICHE PREND TOUTE LA HAUTEUR : une conversation dans une
   * feuille à 92 % laisse une bande morte en haut pour rien.
   */
  const telephone = useTelephone();

  /** La description repliée dans l'en-tête — par le défilement du fil ou d'un toucher. */
  const [replie, setReplie] = React.useState(false);
  const [descriptionEnEdition, setDescriptionEnEdition] = React.useState(false);
  const dernierDefilement = React.useRef(0);
  /** Jusqu'à quand les défilements sont ignorés : ceux que l'animation provoque elle-même. */
  const repliEnMouvement = React.useRef(0);
  const basculerLeRepli = (suite: boolean) => {
    setReplie(suite);
    repliEnMouvement.current = Date.now() + DUREE_REPLI_MS + 80;
  };
  /*
   * UNE DESCRIPTION REPLIÉE RESTE TOUJOURS ATTEIGNABLE.
   *
   * Le repli se déclenche en descendant dans le fil, et se défait en
   * remontant. Sur une conversation COURTE, replier rendait au fil la hauteur
   * que la description occupait : le fil cessait alors de déborder, le
   * navigateur ramenait son défilement à zéro SANS émettre d'événement, et
   * plus aucun geste de remontée n'existait — la description restait cachée
   * pour de bon.
   *
   * On vérifie donc, une fois l'animation finie, que le fil déborde ENCORE
   * assez pour qu'on puisse y remonter. Sinon le repli n'avait rien à gagner :
   * on le défait. Le chevron de l'entête reste par ailleurs rendu et cliquable
   * dans les deux états — c'est le second chemin, celui qui ne dépend d'aucun
   * défilement.
   */
  React.useEffect(() => {
    if (!replie) return;
    const verifier = () => {
      const zone = fil.current;
      if (!zone) return;
      if (zone.scrollHeight - zone.clientHeight <= SEUIL_REPLI_PX) basculerLeRepli(false);
    };
    const minuteur = window.setTimeout(verifier, DUREE_REPLI_MS + 100);
    return () => window.clearTimeout(minuteur);
  }, [replie, messages]);
  React.useEffect(() => {
    if (descriptionEnEdition) setReplie(false);
  }, [descriptionEnEdition]);
  /*
   * LE FIL S'OUVRE SUR SES DERNIERS MESSAGES. À la première arrivée des
   * messages d'une demande, la zone descend tout en bas ; ensuite elle ne suit
   * un nouveau message que si l'on y était déjà (à moins de 80 px du bas) — un
   * lecteur remonté dans le fil ne saute pas. Ces défilements-là sont IGNORÉS
   * par le repli : descendre ne replie pas la description par erreur.
   */
  const fil = React.useRef<HTMLDivElement | null>(null);
  const auBas = React.useRef(true);
  const filPosePour = React.useRef<string | null>(null);
  const descendreLeFil = React.useCallback(() => {
    const zone = fil.current;
    if (!zone) return;
    repliEnMouvement.current = Math.max(repliEnMouvement.current, Date.now() + 150);
    zone.scrollTop = zone.scrollHeight;
    dernierDefilement.current = zone.scrollTop;
  }, []);
  const surDefilementDuFil = (event: React.UIEvent<HTMLDivElement>) => {
    const zoneDuFil = event.currentTarget;
    auBas.current = zoneDuFil.scrollHeight - zoneDuFil.scrollTop - zoneDuFil.clientHeight < 80;
    const haut = zoneDuFil.scrollTop;
    const avant = dernierDefilement.current;
    dernierDefilement.current = haut;
    if (descriptionEnEdition || Date.now() < repliEnMouvement.current) return;
    if (!replie && haut > SEUIL_REPLI_PX && haut > avant) basculerLeRepli(true);
    else if (replie && haut <= SEUIL_DEPLI_PX) basculerLeRepli(false);
  };

  React.useLayoutEffect(() => {
    if (!demande || !fil.current) return;
    const premiere = filPosePour.current !== demandeId;
    if (!premiere && !auBas.current) return;
    filPosePour.current = demandeId;
    auBas.current = true;
    descendreLeFil();
    // Les images et les pièces changent la hauteur après le premier rendu.
    const image = requestAnimationFrame(descendreLeFil);
    const rattrapage = premiere ? window.setTimeout(() => auBas.current && descendreLeFil(), 350) : undefined;
    return () => {
      cancelAnimationFrame(image);
      if (rattrapage !== undefined) window.clearTimeout(rattrapage);
    };
  }, [demandeId, demande, messages, descendreLeFil]);

  const estAdmin = moi.role === 'admin';
  const estLAuteur = demande?.auteurId === moi.id;
  /** VOIR N'EST PAS RÉÉCRIRE : le serveur tamise, l'écran ne propose même pas. */
  const peutToutEcrire = estAdmin || estLAuteur;
  /*
   * LES OPTIONS SUIVENT LA MÊME RÈGLE QUE LE SERVEUR, CHAMP PAR CHAMP : un client
   * change l'importance, l'échéance et les étiquettes de TOUTES les demandes de
   * son projet, y compris celles de Haiko.
   */
  const permis = new Set(champsModifiables(moi.role, estLAuteur));
  const droitsDOptions = {
    importance: permis.has('importance'),
    echeance: permis.has('echeance'),
    etiquettes: permis.has('etiquettes'),
  };

  const recharger = React.useCallback(() => {
    void canalEspace
      .demander({ type: 'espace.demande.lire', id: demandeId })
      .then(
        (reponse: {
          demande: Demande;
          messages: MessageDemande[];
          galerie: PieceDeGalerie[];
          activite: ActiviteDemande[];
        }) => {
          setDemande(reponse.demande);
          setMessages(reponse.messages);
          setPieces(reponse.galerie);
          setActivite(reponse.activite ?? []);
        },
      )
      .catch((err) => setErreur(err?.message ?? t('Cette demande ne peut pas être ouverte.')));
  }, [demandeId]);

  React.useEffect(recharger, [recharger]);

  React.useEffect(
    () =>
      canalEspace.ecouter((event) => {
        const type = event.type;
        if (type === 'espace.message' && (event as any).demandeId === demandeId) recharger();
        if (type === 'espace.demande' && (event as any).demande?.id === demandeId) recharger();
      }),
    [demandeId, recharger],
  );

  /** Un patch part au serveur, l'écran suit sa réponse — jamais l'inverse. */
  const enregistrer = async (patch: Record<string, unknown> | PatchDOptions) => {
    setErreur(null);
    try {
      const reponse: { demande: Demande } = await canalEspace.demander({
        type: 'espace.demande.modifier',
        id: demandeId,
        ...patch,
      });
      setDemande(reponse.demande);
      onChangement();
    } catch (err: any) {
      setErreur(err?.message ?? t('Cette modification n’a pas pu être enregistrée.'));
    }
  };

  const commenter = async () => {
    await canalEspace.demander({
      type: 'espace.demande.commenter',
      id: demandeId,
      texte,
      fichiers: envois.pieces.map((p) => p.id),
    });
    setTexte('');
    envois.vider();
    // Mon propre commentaire se voit : le fil redescend à son arrivée.
    auBas.current = true;
    recharger();
    onChangement();
  };

  const archiver = async (archivee: boolean) => {
    await canalEspace.demander({ type: 'espace.demande.archiver', id: demandeId, archivee });
    onChangement();
    onFermer();
  };

  /*
   * TRANSFORMER UNE DEMANDE EN TÂCHE PASSE PAR HAIKO, JAMAIS PAR LA FICHE.
   *
   * La fiche appelait la commande directement, sans laisser le choix du moteur,
   * du modèle ni du niveau de réflexion : la tâche naissait avec les valeurs
   * par défaut du projet. Quand l'écran qui porte cette fiche sait proposer ces
   * réglages (`onDemanderCarte`, vu comme Haiko), c'est LUI qui mène la
   * conversion. Sans lui — une carte déjà créée, qu'on veut seulement rouvrir —
   * la commande reste appelée telle quelle, et le serveur rend la carte
   * existante.
   */
  const enCarte = async () => {
    if (onDemanderCarte && !demande?.carteId) {
      onDemanderCarte(demandeId);
      return;
    }
    await canalEspace.demander({ type: 'espace.demande.enCarte', id: demandeId });
    recharger();
    onChangement();
  };

  const cocher = (tache: TacheDemande) => {
    if (!demande) return;
    void enregistrer({
      taches: demande.taches.map((t_) => (t_.id === tache.id ? { ...t_, faite: !t_.faite } : t_)),
    });
  };

  const ajouterUneTache = () => {
    if (!demande || !tacheNeuve.trim()) return;
    void enregistrer({
      taches: [
        ...demande.taches,
        { id: `t${Date.now()}${Math.random().toString(36).slice(2, 6)}`, texte: tacheNeuve.trim(), faite: false },
      ],
    });
    setTacheNeuve('');
  };

  const jauge = demande ? jaugeDesTaches(demande.taches) : { faites: 0, total: 0, part: 0 };
  const enRetard = demande ? echeanceDeDemandeDepassee(demande.echeance, Date.now()) : false;
  const rangee = demande ? estArchivee(demande) : false;

  return (
    <Drawer open onClose={onFermer} plein={telephone}>
      {/*
       * LE REPÈRE DE LA FICHE CHARGÉE. Le tiroir paraît AVANT la réponse du
       * serveur — il montre alors sa silhouette. Ce qui dit « les données sont
       * là » est ce marqueur, plus la présence d'un champ : les champs vivent
       * maintenant sous le « ⋮ », donc hors de l'écran tant qu'on ne l'ouvre pas.
       */}
      <div
        className="flex min-h-0 flex-1 flex-col"
        data-tiroir-demande={demandeId}
        data-fiche-chargee={demande ? '' : undefined}
      >
        {/* L'ENTÊTE : le titre, la description, qui l'a déposée, et le « … ». */}
        <header
          className="flex shrink-0 flex-wrap items-start gap-x-1.5 px-3 pb-2"
          data-entete-fiche
          data-entete-fiche-replie={replie ? '' : undefined}
        >
          <div className="min-w-0 flex-1">
            {/*
             * LE TITRE SE LIT, ET S'ÉDITE À SA PLACE D'UN TOUCHER. C'était un
             * champ de saisie toujours ouvert : on regardait un formulaire au
             * lieu de lire une fiche, et un clic distrait renommait la demande.
             */}
            {demande ? (
              <>
                <TexteEditable
                  valeur={demande.titre}
                  onValider={(titre) => {
                    setDemande({ ...demande, titre });
                    void enregistrer({ titre });
                  }}
                  editable={peutToutEcrire}
                  classeTexte="text-[15.5px] font-semibold leading-snug text-text"
                  repere="titre"
                  libelle={t('Modifier le titre')}
                />
                {/* Le titre lu à voix haute, puisque le texte visible n'est plus un titre. */}
                <DialogTitle className="sr-only">{demande.titre}</DialogTitle>
              </>
            ) : (
              <DialogTitle className="truncate">{t('Demande')}</DialogTitle>
            )}
          </div>

          {/*
           * LES PIÈCES JOINTES QUITTENT LE CORPS DE LA FICHE. Elles n'y
           * poussaient la discussion vers le bas que pour être consultées une
           * fois sur dix. Un bouton dans l'entête, à côté du « ⋮ » et de la
           * croix, portant son compteur ; au clic, un `Drawer` EMPILÉ par-dessus
           * la fiche — le composant sait déjà se poser sur un tiroir ouvert, il
           * n'y a aucune mécanique neuve. Refermer rend la fiche telle quelle.
           */}
          {demande ? (
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setPiecesOuvertes(true)}
              title={t('Pièces jointes')}
              aria-label="Pièces jointes"
              className="relative shrink-0"
              data-ouvrir-pieces={pieces.length}
            >
              <Paperclip className="h-4 w-4" />
              {pieces.length ? (
                <span className="absolute -right-0.5 -top-0.5 min-w-[14px] rounded-full bg-accent px-1 text-[9px] font-medium leading-[14px] text-accent-fg">
                  {pieces.length}
                </span>
              ) : null}
            </Button>
          ) : null}

          {demande ? (
            <MenuActions titre={t('Actions')} repere="fiche" empile>
              {(fermer) => (
                <>
                  {/*
                   * LES OPTIONS ONT QUITTÉ CE MENU : elles vivent au pied de la
                   * fiche, dans leur accordéon. Il ne reste ici que les gestes
                   * RARES — ranger — et l'historique, en dernier. Changer de
                   * colonne se fait en glissant la vignette.
                   */}
                  <GroupeTiroir titre={t('Ranger')}>
                    <ActionTiroir
                      icone={<Inbox className="h-3.5 w-3.5" />}
                      onClick={() => {
                        void archiver(!rangee);
                        fermer();
                      }}
                      data-archiver-demande
                    >
                      {rangee ? t('Ressortir') : t('Archiver')}
                    </ActionTiroir>
                    {/*
                     * « EN FAIRE UNE CARTE » RESTE UN GESTE D'ADMIN. La commande
                     * n'est pas dans la liste blanche du client — la ligne ne se
                     * dessine donc même pas de son côté, plutôt que de refuser
                     * après le clic.
                     */}
                    {estAdmin ? (
                      <ActionTiroir
                        icone={<ArrowRightLeft className="h-3.5 w-3.5" />}
                        onClick={() => {
                          void enCarte();
                          fermer();
                        }}
                        data-en-carte
                      >
                        {demande.carteId ? t('Voir la carte Beluga') : t('En faire une carte Beluga')}
                      </ActionTiroir>
                    ) : null}
                  </GroupeTiroir>
                  {/*
                   * L'HISTORIQUE EN DERNIER, ET REPLIÉ. On ne le consulte qu'en
                   * cas de doute : déplié en permanence, il repoussait « Ranger »
                   * hors de l'écran. Sa ligne de titre porte son nombre de
                   * lignes, ce qui suffit à savoir s'il vaut la peine d'être
                   * ouvert.
                   */}
                  <BlocRepliable
                    titre={t('Historique')}
                    repere="historique"
                    defautOuvert={false}
                    compte={activite.length}
                    className="px-3"
                  >
                    <div data-historique={activite.length}>
                      <ul className="flex flex-col gap-1.5 pl-1" data-historique-liste>
                        {activite.map((ligne) => (
                          <LigneDActivite key={ligne.id} activite={ligne} />
                        ))}
                        {!activite.length ? (
                          <li className="py-1 text-[12px] text-faint">{t('Rien ici pour le moment.')}</li>
                        ) : null}
                      </ul>
                    </div>
                  </BlocRepliable>
                </>
              )}
            </MenuActions>
          ) : null}
          <Button size="icon-sm" variant="ghost" onClick={onFermer} title={t('Fermer')} data-fermer-tiroir>
            <X className="h-4 w-4" />
          </Button>
          {/*
           * LA DESCRIPTION ET « AUTEUR · DATE » PRENNENT TOUTE LA LARGEUR. Rangées
           * dans la colonne du titre, elles s'arrêtaient au pied des boutons de
           * l'entête : le champ d'édition se tassait à gauche en laissant un vide
           * à droite. Elles passent sur leur propre ligne (`basis-full`).
           */}
          <div className="min-w-0 basis-full" data-corps-entete-fiche>
              {demande ? (
                /*
                 * LA DESCRIPTION, SOUS LE TITRE ET REPLIABLE. La grille passe de
                 * `1fr` à `0fr` : la hauteur s'anime sans la connaître. Dépliée,
                 * elle est plafonnée et défile chez elle — une longue description
                 * ne mange pas l'écran.
                 */
                <div
                  className={cn(
                    'grid transition-[grid-template-rows,opacity,visibility] ease-out motion-reduce:transition-none',
                    replie ? 'invisible opacity-0' : 'opacity-100',
                  )}
                  style={{ gridTemplateRows: replie ? '0fr' : '1fr', transitionDuration: `${DUREE_REPLI_MS}ms` }}
                  data-description-entete={replie ? 'repliee' : 'depliee'}
                >
                  <div className="min-h-0 overflow-hidden">
                    <ZoneDefilement fond="hsl(var(--surface))" hauteur={24} className="max-h-[35dvh]">
                      <TexteEditable
                        valeur={demande.description}
                        onValider={(description) => {
                          setDemande({ ...demande, description });
                          void enregistrer({ description });
                        }}
                        editable={peutToutEcrire}
                        multiligne
                        classeTexte="text-[13.5px] leading-relaxed text-text"
                        placeholder={t('Décrivez ce dont vous avez besoin…')}
                        repere="description"
                        libelle={t('Modifier la description')}
                        onEdition={setDescriptionEnEdition}
                      />
                    </ZoneDefilement>
                  </div>
                </div>
              ) : null}
              {demande ? (
                <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-faint">
                  <span className="min-w-0 truncate" data-ligne-auteur>
                    {demande.auteurNom} · {jourDe(demande.creeeLe)}
                    {rangee ? ` · ${t('Archivée')}` : ''}
                  </span>
                  {/* L'OUVERTURE ET LA FERMETURE À LA MAIN, d'un toucher. */}
                  {/* LE SECOND CHEMIN VERS LA DESCRIPTION, celui qui ne dépend
                      d'aucun défilement. Replié, il porte son LIBELLÉ : un
                      chevron nu de 12 px ne se lit pas comme « il y a un texte
                      caché ici ». */}
                  <button
                    type="button"
                    onClick={() => basculerLeRepli(!replie)}
                    className="-my-1 flex shrink-0 items-center gap-1 rounded p-1 hover:text-text"
                    aria-expanded={!replie}
                    aria-label={replie ? t('Afficher la description') : t('Masquer la description')}
                    title={replie ? t('Afficher la description') : t('Masquer la description')}
                    data-basculer-description
                  >
                    {replie && demande.description.trim() ? (
                      <span className="text-[11px]">{t('Description')}</span>
                    ) : null}
                    <ChevronDown
                      className={cn('h-3 w-3 transition-transform motion-reduce:transition-none', replie ? null : 'rotate-180')}
                      aria-hidden
                    />
                  </button>
                </div>
              ) : null}
          </div>
        </header>

        {erreur ? <div className="shrink-0 px-3 pb-1.5 text-xs text-danger">{erreur}</div> : null}

        {!demande ? (
          <div className="min-h-0 flex-1 overflow-hidden px-3" data-silhouette="tiroir">
            {/* LA SILHOUETTE PREND TOUTE LA HAUTEUR : sinon le champ de commentaire
                remontait au milieu de l'écran puis redescendait à l'arrivée de la fiche. */}
            <SilhouetteFicheDemande />
          </div>
        ) : (
          /*
             * UN BLOC EMPILÉ, PAS UNE COLONNE FLEX. Dans une zone qui défile,
             * les enfants d'une colonne flex se COMPRIMENT sous leur contenu :
             * la description tombait à une ligne coupée. Empilés en flux
             * ordinaire, ils gardent leur hauteur naturelle.
             */
          <ZoneDefilement
            fond="hsl(var(--surface))"
            className="min-h-0 flex-1 space-y-1 px-3 pb-2"
            ref={fil}
            onScroll={surDefilementDuFil}
            data-fil-fiche
          >
            {/* LA DESCRIPTION A QUITTÉ CE FIL : elle vit dans l'en-tête, repliable. */}

            {/*
             * 1. LE BLOC « TODO », REPLIÉ AU DÉPART.
             *
             * C'est le seul endroit de la fiche où l'on AGIT (cocher, ajouter,
             * retirer) : il se pose donc sur un fond plus haut que la fiche
             * (`raised`), et SANS CADRE — le fond suffit à le détacher, dans les
             * douze palettes. Il s'ouvre à la demande : sa ligne de titre porte
             * la jauge « faites / total », qui dit ce qu'il contient sans qu'on
             * ait à le dérouler. Il se pose JUSTE SOUS LA DEMANDE, avant les messages :
             * ce qui reste à faire se lit d'un coup d'œil en ouvrant la fiche, sans
             * dérouler un fil de discussion qui s'allonge de jour en jour.
             */}
            <BlocDeFiche
              repere="todo"
              icone={<ListChecks className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />}
              titre={t('Todo')}
              indice={jauge.total ? `${jauge.faites}/${jauge.total}` : undefined}
              attributs={{ 'data-bloc-todo': '', 'data-champ-taches': jauge.total }}
              indiceAttribut={jauge.total ? { 'data-jauge-taches': `${jauge.faites}/${jauge.total}` } : undefined}
            >
              <div className="flex flex-col gap-1">
                {demande.taches.map((tache) => (
                  <div key={tache.id} className="flex items-center gap-2" data-tache={tache.id}>
                    <button
                      type="button"
                      onClick={() => cocher(tache)}
                      className="shrink-0 text-muted hover:text-text"
                      data-tache-cochee={tache.faite ? '' : undefined}
                      title={t('Todo')}
                    >
                      {tache.faite ? (
                        <CheckSquare className="h-4 w-4 text-success" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </button>
                    <span className={cn('flex-1 text-[13px]', tache.faite ? 'text-faint line-through' : 'text-text')}>
                      {tache.texte}
                    </span>
                    <button
                      type="button"
                      onClick={() => enregistrer({ taches: demande.taches.filter((x) => x.id !== tache.id) })}
                      className="shrink-0 text-faint hover:text-danger"
                      title={t('Retirer')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {/* LE CHAMP D'AJOUT VIT DANS LE CADRE, pas sous lui : c'est ce
                    qui fait du bloc un composant et non trois lignes posées. */}
                <div className="flex items-center gap-1.5 rounded-md bg-surface px-1.5">
                  <Plus className="h-3.5 w-3.5 shrink-0 text-faint" />
                  <input
                    value={tacheNeuve}
                    onChange={(event) => setTacheNeuve(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      ajouterUneTache();
                    }}
                    placeholder={t('Ajouter une étape…')}
                    className="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-faint"
                    data-champ-tache-neuve
                  />
                </div>
              </div>
            </BlocDeFiche>

            {/*
             * 2. LA DISCUSSION, SANS TITRE NI COMPTEUR. C'est pour elle qu'on
             * ouvre une fiche : elle n'a pas à s'annoncer, ni à se replier
             * derrière un libellé. Les messages suivent la description, et
             * c'est tout.
             */}
            <div className="mt-1.5 flex flex-col gap-2" data-commentaires={messages.length}>
              {!messages.length ? (
                <p className="py-2 text-[12.5px] text-faint">{t('Rien ici pour le moment.')}</p>
              ) : null}
              {messages.map((message, i) => {
                  // Le CÔTÉ d'une bulle suit le RÔLE, jamais l'identifiant.
                  const aMoi = message.auteurRole === moi.role;
                  const jourAvant = i > 0 ? jourDe(messages[i - 1]!.creeLe) : null;
                  const jour = jourDe(message.creeLe);
                  return (
                    <React.Fragment key={message.id}>
                      {jour !== jourAvant ? (
                        <div className="my-1 text-center text-[11px] text-faint">{jour}</div>
                      ) : null}
                      <div className={cn('flex', aMoi ? 'justify-end' : 'justify-start')}>
                        <div
                          className={cn(
                            /*
                             * AUCUN LISERÉ : LE FOND SEUL DIT QUI PARLE. La
                             * bulle d'en face garde le gris des champs de
                             * saisie (`raised`), la mienne prend un voile
                             * d'accent. L'accent contraste avec `surface` dans
                             * les douze palettes : l'écart tient donc partout,
                             * y compris sur les onze plates où `--border` est
                             * effacé — ce qui portait l'information ne se perd
                             * pas avec le cadre.
                             */
                            'max-w-[85%] rounded-lg px-3 py-2 text-text',
                            aMoi ? 'bg-accent/20' : 'bg-raised',
                          )}
                          data-message={message.id}
                          data-bulle={aMoi ? 'moi' : 'autre'}
                        >
                          <div className="text-[11px] text-faint">{message.auteurNom}</div>
                          {message.texte ? (
                            <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{message.texte}</p>
                          ) : null}
                          {/*
                           * UNE IMAGE JOINTE SE VOIT DANS LE MESSAGE. La fiche
                           * connaît déjà le type de chaque pièce (sa galerie) :
                           * une image s'affiche en aperçu et s'ouvre dans la
                           * visionneuse ; un autre fichier garde un lien, qui
                           * porte enfin son nom au lieu de « Pièce jointe ».
                           */}
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
                    </React.Fragment>
                  );
              })}
            </div>

          </ZoneDefilement>
        )}

        {demande ? (
          /*
           * 3. LES OPTIONS, JUSTE AU-DESSUS DU CHAMP DE MESSAGE.
           *
           * Hors de la zone qui défile : elles restent sous la main quelle que
           * soit la longueur du fil, et la discussion ne défile plus sous elles.
           * Repliées, elles ne coûtent qu'une ligne, qui dit l'importance et
           * l'échéance sans s'ouvrir ; ouvertes, leur contenu est BORNÉ et
           * défile chez lui — sur téléphone, l'accordéon déroulé n'écrase pas
           * la discussion. Aucun trait ne les sépare du composeur : le fond
           * `raised` du bloc suffit.
           */
          <div className="shrink-0 px-3" data-options-fixees>
            <BlocDeFiche
              repere="options"
              icone={<SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />}
              titre={t('Options')}
              indice={[
                t(TITRES_IMPORTANCE[demande.importance]),
                demande.echeance ? jourCourt(demande.echeance) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              attributs={{ 'data-bloc-options': '' }}
            >
              <ZoneDefilement fond="hsl(var(--raised))" hauteur={24} className="max-h-[45dvh]">
                <OptionsDemande
                  valeurs={{
                    importance: demande.importance,
                    echeance: demande.echeance ?? null,
                    livraisonAnnoncee: demande.livraisonAnnoncee ?? null,
                    etiquettes: demande.etiquettes,
                  }}
                  onChanger={(patch) => void enregistrer(patch)}
                  droits={droitsDOptions}
                  estAdmin={estAdmin}
                  enRetard={enRetard}
                  repere="fiche"
                />
              </ZoneDefilement>
            </BlocDeFiche>
          </div>
        ) : null}

        <ComposeurEspace
          valeur={texte}
          onValeur={setTexte}
          onEnvoyer={commenter}
          envois={envois}
          mentions={mentions}
          placeholder={t('Écrire un commentaire…')}
          repere="commentaire"
        />
      </div>

      {/* LA VISIONNEUSE DES IMAGES DE LA DEMANDE, dans l'ordre des messages. */}
      <Visionneuse
        images={images}
        index={visionneuse}
        onIndex={setVisionneuse}
        onFermer={() => setVisionneuse(null)}
      />

      {/* LE TIROIR DES PIÈCES JOINTES, posé PAR-DESSUS la fiche. */}
      <Drawer
        open={piecesOuvertes}
        onClose={() => setPiecesOuvertes(false)}
        empile
        className="max-h-[80dvh]"
      >
        <div className="flex min-h-0 flex-1 flex-col" data-tiroir-pieces={pieces.length}>
          <header className="flex shrink-0 items-center gap-1.5 px-3 pb-2">
            <DialogTitle className="min-w-0 flex-1 truncate">{t('Pièces jointes')}</DialogTitle>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setPiecesOuvertes(false)}
              title={t('Fermer')}
              data-fermer-pieces
            >
              <X className="h-4 w-4" />
            </Button>
          </header>
          <ZoneDefilement fond="hsl(var(--surface))" className="min-h-0 flex-1 px-3 pb-3">
            <Galerie pieces={pieces} sansTitre />
          </ZoneDefilement>
        </div>
      </Drawer>
    </Drawer>
  );
}
