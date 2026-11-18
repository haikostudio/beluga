import * as React from 'react';
import { ArrowLeft, ArrowUp, ChevronUp, Layers, PencilLine } from '@/components/ui/icones';
import type { Attachment } from '@beluga/shared';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Input, TELEPHONE_SOUS_LA_BARRE, ZoneDefilement } from '@/components/ui';
import { t } from '@/lib/langue';
import { useTelephone } from '@/lib/telephone';
import { cn } from '@/lib/utils';
import { useEspace } from './contexte';

/**
 * TOUT S'OUVRE À LA PLACE DE LA LISTE (retours du 04/11/2026, deuxième passe) : une campagne, un média, une
 * publication, Marketing et Canaux sont des PAGES de la zone de travail, à droite du chat — plus aucun panneau qui
 * glisse ni ne « tombe ». Une page en place a :
 *   - un EN-TÊTE collé en haut : la flèche de retour (vers la liste, ou vers la campagne d'où l'on vient) et le titre ;
 *     sur téléphone, la flèche est celle de la barre d'en-tête (`[data-retour-du-fil]`), jamais une seconde ici ;
 *   - son contenu, en sections lues de haut en bas ;
 *   - une ZONE D'ÉCRITURE minimaliste collée en bas, qui envoie la demande au chef de la marque. Le chef sait déjà de
 *     quoi on parle : la page pose son « Vous parlez de… » (`useParlerDe`), transmis au chef par le démon ;
 *   - OU, sur une campagne, un média et une publication (`modifier`), le bouton « Faire des modifications » à sa place
 *     (carte du 04/11/2026) : il prépare la phrase de départ dans la conversation du chef, sans rien envoyer.
 */

export function PageEnPlace({
  titre,
  sousTitre,
  droite,
  retour,
  invite,
  modifier,
  pied,
  aligne = false,
  haut,
  plein = false,
  children,
  ...reste
}: {
  titre?: React.ReactNode;
  sousTitre?: React.ReactNode;
  droite?: React.ReactNode;
  /** Absent : une page de premier niveau (Marketing, Canaux), sans flèche. */
  retour?: { libelle: string; aller: () => void } | null;
  /** Le texte d'invite de la zone d'écriture ; `null` pour ne pas en poser. */
  invite?: string | null;
  /** Le bouton « Faire des modifications » à la place de la zone d'écriture : la phrase (et la pièce) du moment du clic. */
  modifier?: ModificationsDeLaPage | null;
  /** UN PIED À SOI, à la place du bouton ou de la zone d'écriture (la campagne y pose son calendrier éditorial, carte
      « Planification des publications » : « Faire des modifications » remonte alors au pied de sa base). */
  pied?: React.ReactNode;
  /** OPT-IN (Communication 2) : l'en-tête prend la largeur EXACTE du contenu (même conteneur `max-w-[920px]`), au
      lieu de toute la largeur de la zone. Par défaut absent : l'espace Communication garde son rendu. */
  aligne?: boolean;
  /** OPT-IN (Communication 2, l'assistant de campagne) : une RANGÉE posée dans l'en-tête collé, à la place du titre —
      la barre d'étapes de l'assistant, comme celle du chat d'un agent. Absent : l'en-tête d'avant, inchangé. */
  haut?: React.ReactNode;
  /** OPT-IN (Communication 2, la page d'une campagne, 10/11/2026) : le contenu prend TOUTE la place sous l'en-tête, en
      rangée — la conversation de la campagne et le volet de son plan, chacun avec son propre défilement. Absent : le
      contenu défile, centré à 920 px, comme avant. */
  plein?: boolean;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>) {
  const telephone = useTelephone();
  const avecEntete = !!titre || !!droite || (!!retour && !telephone) || (aligne && !!sousTitre) || !!haut;
  return (
    /* SANS FOND À ELLE (carte « Média du calendrier en aperçu ») : la page prend celui qui la porte — la zone, ou la
       feuille du bas d'une campagne —, pour qu'un tiroir n'ait qu'UN fond, de la poignée au pied. */
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-communication-page-en-place {...reste}>
      {avecEntete ? (
        <header className={cn('flex min-h-[52px] shrink-0 items-center gap-2 px-4 py-2 sm:px-6', TELEPHONE_SOUS_LA_BARRE)} data-communication-entete-en-place>
          <div className={cn('flex min-w-0 flex-1 items-center gap-2', aligne && 'mx-auto w-full max-w-[920px]')} data-entete-aligne={aligne ? '' : undefined}>
          {retour && !telephone ? (
            <Button variant="ghost" size="icon-barre" className="-ml-2 shrink-0 text-muted" aria-label={retour.libelle} title={retour.libelle} onClick={retour.aller} data-communication-retour-en-place>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          ) : null}
          {haut ? (
            <div className="min-w-0 flex-1" data-entete-haut>
              {haut}
            </div>
          ) : (
          <span className="min-w-0 flex-1">
            {titre ? (
              <h1 className="truncate text-[16px] font-semibold tracking-tight text-text" data-communication-titre-en-place>
                {titre}
              </h1>
            ) : null}
            {sousTitre ? <span className="block truncate text-[12px] text-muted">{sousTitre}</span> : null}
          </span>
          )}
          {droite ? <span className="flex shrink-0 items-center gap-1.5">{droite}</span> : null}
          </div>
        </header>
      ) : null}
      {plein ? (
        <div className={cn('flex min-h-0 min-w-0 flex-1', !avecEntete && TELEPHONE_SOUS_LA_BARRE)} data-contenu-en-place data-contenu-plein>
          {children}
        </div>
      ) : (
        <ZoneDefilement className={cn('px-4 pb-6 sm:px-6', avecEntete ? 'pt-1' : cn('pt-3', TELEPHONE_SOUS_LA_BARRE))}>
          <div className="mx-auto flex w-full min-w-0 max-w-[920px] flex-col gap-5 max-sm:gap-4" data-contenu-en-place>{children}</div>
        </ZoneDefilement>
      )}
      {pied ? (
        <div className="shrink-0 px-4 pb-3 pt-2 sm:px-6" data-communication-pied-en-place>
          <div className="mx-auto flex w-full max-w-[920px] min-w-0">{pied}</div>
        </div>
      ) : modifier ? (
        <BoutonDeModifications modifier={modifier} />
      ) : invite === null ? null : <ZoneDEcriture invite={invite ?? t('Demander quelque chose au chef…')} />}
    </div>
  );
}

/**
 * LA ZONE D'ÉCRITURE DU BAS : un champ et un bouton d'envoi, de la hauteur commune. Un envoi = un message au chef,
 * comme tapé dans son fil (le chef annonce le prix avant toute dépense, consigne du chef). Le bouton se grise
 * pendant l'envoi : un double appui n'envoie pas deux fois.
 *
 * AU CLAVIER DE L'IPHONE, ELLE RESTE POSÉE SUR LE CLAVIER (carte du 04/11/2026, capture #e16d : toucher le champ d'un
 * média faisait glisser toute la page, le champ sortait de la vue sur un écran noir). Safari ignore
 * `interactive-widget=resizes-content` : c'est l'application qui prend la hauteur visible (`--hauteur-visible`,
 * `app.tsx`) — et elle ne ramène la page glissée QUE pour un champ marqué `data-champ-d-ecriture`, comme celui des
 * conversations. Marquée ainsi, la zone est le dernier bloc de la colonne, donc juste au-dessus du clavier ; le menu du
 * bas du téléphone s'efface le temps de la frappe (`styles.css`). Police de 16 px sur téléphone : iOS ne zoome pas.
 */
export function ZoneDEcriture({ invite }: { invite: string }) {
  const { dire } = useEspace();
  const [texte, setTexte] = React.useState('');
  const [parti, setParti] = React.useState(false);
  const envoyer = (e?: React.FormEvent) => {
    e?.preventDefault();
    const propre = texte.trim();
    if (!propre || parti) return;
    setParti(true);
    dire(propre);
    setTexte('');
    window.setTimeout(() => setParti(false), 600);
  };
  return (
    <form onSubmit={envoyer} className="shrink-0 px-4 pb-3 pt-2 sm:px-6" data-communication-zone-ecriture data-champ-d-ecriture>
      <div className="mx-auto flex w-full max-w-[920px] items-center gap-1.5">
        <Input value={texte} onChange={(e) => setTexte(e.target.value)} placeholder={invite} aria-label={invite} className="min-w-0 flex-1 max-sm:text-[16px]" data-communication-champ-ecriture />
        <Button type="submit" size="icon-barre" variant="principal" disabled={!texte.trim() || parti} aria-label="Envoyer" title={t('Envoyer au chef')} data-communication-envoyer-ecriture>
          <ArrowUp className="h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}

/**
 * « FAIRE DES MODIFICATIONS » (carte du 04/11/2026) : remplace le champ du bas d'une campagne, d'un média et d'une
 * publication — il faisait doublon avec la conversation du chef, juste à gauche. Le clic AJOUTE au brouillon du chef
 * une phrase de départ (« Modifie l'image #ref : », « Modifie la campagne « … » : ») que la personne complète puis
 * envoie elle-même ; rien ne part sans elle. Pleine largeur, de la hauteur commune.
 */
/** Un choix du menu « Faire des modifications » : « Toutes les versions », ou le visuel d'un réseau. */
export interface ChoixDeModification {
  /** `tout`, ou le réseau (`instagram`, `tiktok`…) : le repère `data-communication-modifications-choix`. */
  cle: string;
  libelle: string;
  /** La miniature et le logo du réseau, posés avant le libellé. */
  icone?: React.ReactNode;
  phrase: () => string;
  pieces: () => Attachment[];
}

export interface ModificationsDeLaPage {
  phrase: () => string;
  piece?: () => Attachment | undefined;
  /**
   * UN POST DÉCLINÉ SUR PLUSIEURS RÉSEAUX (carte « Fiche publication et médias regroupés ») : le bouton ouvre un menu,
   * « Toutes les versions » en tête puis un visuel par réseau. Moins de deux choix : le bouton direct d'avant.
   */
  choix?: ChoixDeModification[];
}

/**
 * « FAIRE DES MODIFICATIONS ». Collé en bas de la page par défaut ; `dansLaPage`, il se pose là où on le met (au pied
 * de la base d'une campagne) — même phrase, mêmes pièces, même menu par réseau ouvert vers le haut.
 */
export function BoutonDeModifications({ modifier, dansLaPage = false }: { modifier: ModificationsDeLaPage; dansLaPage?: boolean }) {
  const { preparer } = useEspace();
  const choix = modifier.choix ?? [];
  const contenu = (
    <>
      <PencilLine className="h-4 w-4" />
      {t('Faire des modifications')}
    </>
  );
  return (
    <div className={dansLaPage ? 'min-w-0' : 'shrink-0 px-4 pb-3 pt-2 sm:px-6'}>
      <div className={dansLaPage ? 'flex w-full min-w-0' : 'mx-auto flex w-full max-w-[920px]'}>
        {choix.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="subtle" className="w-full" data-communication-faire-modifications="menu">
                {contenu}
                <ChevronUp className="h-4 w-4 text-muted" />
              </Button>
            </DropdownMenuTrigger>
            {/* OUVERT VERS LE HAUT : le bouton est collé en bas de la page, un menu dessous sortirait de l'écran. */}
            <DropdownMenuContent side="top" align="center" className="min-w-[280px]" titre={t('Que modifier ?')} data-communication-menu-modifications>
              {choix.map((c, i) => (
                <React.Fragment key={c.cle}>
                  {i === 1 && choix[0]!.cle === 'tout' ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuItem onSelect={() => preparer(c.phrase(), c.pieces())} data-communication-modifications-choix={c.cle}>
                    {c.icone ?? <Layers className="h-4 w-4" />}
                    <span className="min-w-0 flex-1 truncate">{c.libelle}</span>
                  </DropdownMenuItem>
                </React.Fragment>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            variant="subtle"
            className="w-full"
            onClick={() => (choix.length === 1 ? preparer(choix[0]!.phrase(), choix[0]!.pieces()) : preparer(modifier.phrase(), modifier.piece?.()))}
            data-communication-faire-modifications
          >
            {contenu}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Une SECTION d'une page en place : un titre, un détail gris, ses gestes à droite, puis son contenu. */
export function Section({
  titre,
  detail,
  fin,
  children,
  className,
  ...reste
}: { titre: React.ReactNode; detail?: React.ReactNode; fin?: React.ReactNode; children: React.ReactNode; className?: string } & Omit<React.HTMLAttributes<HTMLElement>, 'title'>) {
  return (
    <section className={cn('flex min-w-0 scroll-mt-4 flex-col gap-2', className)} {...reste}>
      <header className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <h2 className="text-[14.5px] font-semibold text-text">{titre}</h2>
        {detail ? <span className="min-w-0 truncate text-[12.5px] text-muted">{detail}</span> : null}
        {fin ? <span className="ml-auto flex shrink-0 items-center gap-1.5">{fin}</span> : null}
      </header>
      {children}
    </section>
  );
}

/* LES BOUTONS À MENU (Filtres, Vue, « … ») sont communs à toute l'application : `ui/boutons-a-menu.tsx`. */
export { BoutonFiltres, BoutonVue, MenuPlus, type GroupeDeFiltre } from '@/components/ui/boutons-a-menu';
