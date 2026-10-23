import * as React from 'react';
import { BookOpen, ClipboardList, Download, FileText, FileType, Loader2 } from 'lucide-react';
import { Card, LIBELLES_PHASES_DU_CAHIER, cheminDuCahier, nomDuCahierExporte, partiesDuCahier } from '@beluga/shared';
import { RondDEtape } from '@/components/barre-etapes';
import {
  Button,
  EnteteDeFeuille,
  Drawer,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ZoneDefilement,
  CLASSE_BLOC_DU_PIED,
} from '@/components/ui';
import { useTelechargement } from '@/lib/telechargement';
import { Silhouette } from '@/components/silhouettes';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { BoutonCopierDocument } from '@/components/bouton-copier-document';
import { Markdown } from '@/lib/markdown';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * LE DÉROULÉ DU CAHIER DES CHARGES (demande de l'utilisateur du 22/10/2026) :
 * même dessin que le chemin du tournage (`chemin-de-realisation.tsx`) — ronds
 * `RondDEtape`, nom à côté, trait plein jusqu'où l'on est, noir et blanc — pour
 * les phases du questionnaire, puis la phase en cours avec « Question n sur
 * total » et la suivante annoncée.
 *
 * COLLÉ AU-DESSUS DE LA RANGÉE D'ACTION, HORS DU FIL (`chat.tsx`) : toujours
 * visible quand on remonte lire. `reduit` (le fil n'est pas en bas) ne garde que
 * la ligne des ronds ; tout en bas, le compte et la suite se déplient. Ce n'est
 * PAS l'ancien bandeau fixe retiré le 21/10/2026 : ni jauge, ni pause.
 *
 * SEUL LE NOM DE LA PHASE EN COURS S'ÉCRIT, À TOUTES LES LARGEURS (demande du
 * 22/10/2026 : les noms tronqués des autres « juraient ») : faites et à venir ne
 * gardent que leur rond, et leur nom paraît en bulle au survol — le `title` du
 * rond, rendu par l'infobulle maison de l'application. Même règle que le
 * chemin du tournage, les deux bandes restent identiques.
 */
export function CheminDuCahier({
  carte,
  reduit = false,
  onDeplier,
}: {
  carte: Card;
  reduit?: boolean;
  /** Replié pour faire de la place (pied compact du téléphone) : un appui le rouvre. */
  onDeplier?: () => void;
}) {
  const cahier = carte.cahierDesCharges;
  if (!cahier || carte.archivedAt) return null;
  const chemin = cheminDuCahier(cahier);
  const enCours = Math.min(chemin.faites + 1, chemin.total);
  const compte = chemin.termine
    ? t('Toutes les questions ont leur réponse.')
    : chemin.total
      ? t('Question {n} sur {total}', { n: String(enCours), total: String(chemin.total) })
      : t('{n} question(s) tranchée(s)', { n: String(chemin.faites) });
  return (
    <section
      className={CLASSE_BLOC_DU_PIED}
      data-chemin-cahier
      data-chemin-reduit={reduit ? '' : undefined}
      data-phase={chemin.termine ? 'termine' : chemin.phase}
      data-questions={`${chemin.faites}/${chemin.total}`}
    >
      <div
        className={cn('rounded-xl bg-raised/60 px-3 py-2', onDeplier && 'cursor-pointer')}
        /* Replié par le pied compact : tout le bloc se rouvre d'un appui. */
        {...(onDeplier
          ? {
              role: 'button',
              tabIndex: 0,
              'aria-expanded': false,
              'data-deplier-bloc': '',
              onClick: onDeplier,
              onKeyDown: (event: React.KeyboardEvent) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onDeplier();
                }
              },
            }
          : {})}
      >
        <ol className="flex items-center gap-1.5 sm:gap-2" aria-label="Étapes du cahier des charges">
          {chemin.etapes.map((etape, rang) => {
            const ici = etape.etat === 'encours';
            const dernier = rang === chemin.etapes.length - 1;
            const nom = t(LIBELLES_PHASES_DU_CAHIER[etape.phase]);
            return (
              <li
                key={etape.phase}
                className={cn('flex min-w-0 items-center gap-1.5 sm:gap-2', dernier ? 'shrink-0' : 'flex-auto')}
                data-etape-cahier={etape.phase}
                data-etat={etape.etat}
                aria-current={ici ? 'step' : undefined}
              >
                <span className="flex min-w-0 items-center gap-1.5 py-1" title={etape.etat === 'avenir' ? `${nom} · ${t('à venir')}` : nom}>
                  <RondDEtape forme={etape.etat === 'fait' ? 'faite' : ici ? 'ici' : 'avenir'} />
                  <span
                    className={cn(
                      'min-w-0 truncate text-[12px] leading-normal sm:text-[13px]',
                      etape.etat === 'avenir' ? 'text-faint' : 'font-medium text-text',
                      /* Seule la phase en cours écrit son nom ; les autres le donnent au survol. */
                      !ici && 'hidden',
                      ici && 'shrink-0',
                    )}
                  >
                    {nom}
                  </span>
                </span>
                {/* Un trait qui porte une information : plein jusqu'où l'on est arrivé, pâle au-delà. */}
                {dernier ? null : <span aria-hidden className={cn('h-px min-w-2 flex-1', etape.etat === 'fait' ? 'bg-text/60' : 'bg-border')} />}
              </li>
            );
          })}
        </ol>

        <DetailDuChemin reduit={reduit}>
          <p className="pt-1.5 text-[13.5px] font-medium leading-snug text-text" data-compte-cahier>
            {chemin.termine ? null : (
              <>
                {t(LIBELLES_PHASES_DU_CAHIER[chemin.phase])}
                <span className="font-normal text-faint"> · </span>
              </>
            )}
            <span className={chemin.termine ? undefined : 'font-normal text-muted'}>{compte}</span>
          </p>
          {chemin.suivante ? (
            <p className="mt-1 text-[12px] leading-snug text-faint" data-cahier-suivante={chemin.suivante}>
              {t('Ensuite : {etape}', { etape: t(LIBELLES_PHASES_DU_CAHIER[chemin.suivante]) })}
            </p>
          ) : null}
        </DetailDuChemin>
      </div>
    </section>
  );
}

/**
 * CE QUI SE REPLIE SOUS LA LIGNE DES RONDS d'un chemin collé en bas (cahier des
 * charges, tournage) : grille `0fr` ↔ `1fr`, hauteur et opacité en 200 ms, sans
 * saut. Le contenu reste dans la page (`inert` une fois replié).
 */
export function DetailDuChemin({ reduit, className, children, ...reste }: { reduit: boolean; className?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none',
        reduit ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100',
      )}
      aria-hidden={reduit || undefined}
      /* React 18 ne type pas encore `inert` : l'attribut passe tel quel. */
      {...(reduit ? ({ inert: '' } as React.HTMLAttributes<HTMLDivElement>) : {})}
      {...reste}
    >
      <div className={cn('min-h-0 min-w-0 overflow-hidden', className)}>{children}</div>
    </div>
  );
}

/** Le document du cahier existe-t-il déjà ? Sinon, aucun bouton de lecture. */
export function cahierALire(carte: Card): boolean {
  const cahier = carte.cahierDesCharges;
  return !!cahier && (!!cahier.majA || !!cahier.faites);
}

/**
 * « LIRE LE CAHIER DES CHARGES », PREMIER BOUTON DE LA RANGÉE D'ACTION du volet
 * du cahier (`parcours-carte.tsx`), ses réglages collés à droite (`groupe`).
 * Il remplace l'ancienne dernière ligne du fil, qui laissait sous elle une
 * rangée presque vide. Seule la carte née de la case « Démarrer par un cahier
 * des charges » la porte (`Card.cahierDesCharges`), et rien tant que le
 * document n'existe pas.
 */
export function BoutonLireLeCahier({ carte, groupe }: { carte: Card; groupe: boolean }) {
  const cahier = carte.cahierDesCharges;
  const [lecture, setLecture] = React.useState(false);
  if (!cahier || !cahierALire(carte)) return null;
  return (
    <div className="min-w-0 flex-1" data-lecture-du-cahier="cahier">
      <Button
        type="button"
        variant="ghost"
        className={cn(
          'h-9 w-full min-w-0 justify-center gap-2 rounded-lg bg-raised px-3 py-0 text-[13px] font-medium text-text hover:bg-border',
          groupe && 'rounded-r-none',
        )}
        onClick={() => setLecture(true)}
        data-cahier-lire
      >
        <BookOpen className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">{t('Lire le cahier des charges')}</span>
      </Button>
      <TiroirDuCahier projectId={carte.projectId} majA={cahier.majA} open={lecture} onClose={() => setLecture(false)} />
    </div>
  );
}

/**
 * LE DOCUMENT, LU SUR LE DISQUE À L'OUVERTURE puis à chaque réécriture (la date
 * `majA` de la carte change à chaque réponse enregistrée). Une partie encore à
 * trancher porte sa pastille « À voir ».
 */
export function TiroirDuCahier({
  projectId,
  majA,
  open,
  onClose,
}: {
  projectId: string;
  /** La dernière écriture, quand une carte du cahier existe : le tiroir se relit à chaque réponse. */
  majA?: number;
  open: boolean;
  onClose: () => void;
}) {
  const texte = useDocumentDuCahier(projectId, open, majA);

  const parties = texte ? partiesDuCahier(texte) : [];
  return (
    <Drawer adresse="cahier-des-charges" open={open} onClose={onClose} empile plein feuille>
      <div className="flex min-h-0 flex-1 flex-col gap-3 pb-5" data-tiroir-cahier={projectId}>
        <EnteteDeFeuille
          titre={t('Cahier des charges')}
          className="pb-0"
          droite={
            texte ? (
              <>
                <BoutonCopierDocument texte={texte} repere="data-cahier-copier" />
                <MenuExportDuCahier projectId={projectId} />
              </>
            ) : null
          }
        />
        <ZoneDefilement className="min-h-0 flex-1 px-4">
          {texte === undefined ? (
            <div aria-busy className="flex flex-col gap-2" data-silhouette>
              <Silhouette className="h-5 w-1/2" />
              <Silhouette className="h-3 w-full" />
              <Silhouette className="h-3 w-5/6" />
              <Silhouette className="h-5 w-1/3" />
              <Silhouette className="h-3 w-full" />
            </div>
          ) : texte === null ? (
            <p className="text-[13.5px] text-faint">
              {t('Le document n’est pas encore écrit : il apparaît dès la première réponse.')}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {parties.map((partie, index) => (
                <section key={`${partie.titre}-${index}`} data-cahier-partie={partie.aVoir ? 'a-voir' : 'tranchee'}>
                  {partie.titre ? (
                    <h3 className="mb-1 flex items-center gap-2 text-[14px] font-semibold text-text">
                      {partie.titre}
                      {partie.aVoir ? (
                        <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-warning">
                          {t('À voir')}
                        </span>
                      ) : null}
                    </h3>
                  ) : null}
                  {partie.texte ? (
                    <Markdown className={cn('texte-du-fil', partie.aVoir && 'text-muted')} content={partie.texte} />
                  ) : null}
                </section>
              ))}
            </div>
          )}
        </ZoneDefilement>
      </div>
    </Drawer>
  );
}

/**
 * LE DOCUMENT DU PROJET, lu sur le disque quand `actif` (et relu quand `majA`
 * change). `undefined` : en route ; `null` : pas de document.
 */
export function useDocumentDuCahier(projectId: string, actif: boolean, majA?: number): string | null | undefined {
  const [texte, setTexte] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    if (!actif) return;
    let vivant = true;
    client
      .call<{ texte: string | null }>({ type: 'project.cahierDocument', projectId })
      .then((data) => vivant && setTexte(data.texte ?? null))
      .catch(() => vivant && setTexte(null));
    return () => {
      vivant = false;
    };
  }, [actif, projectId, majA]);
  return texte;
}

/**
 * EXPORTER LE CAHIER DES CHARGES : un petit menu, « PDF » ou « Texte ». Le
 * fichier est fabriqué par le démon (`/api/projets/cahier-des-charges`) puis
 * téléchargé par le chemin commun (`useTelechargement`) — feuille de partage
 * sur téléphone, téléchargement ordinaire ailleurs.
 */
export function MenuExportDuCahier({ projectId, avecLibelle = false }: { projectId: string; avecLibelle?: boolean }) {
  const projet = useApp().projects.find((p) => p.id === projectId);
  const nom = projet?.name ?? 'projet';
  const adresse = (format: 'pdf' | 'md') =>
    `/api/projets/cahier-des-charges?projet=${encodeURIComponent(projectId)}&format=${format}`;
  const pdf = useTelechargement([{ adresse: adresse('pdf'), nom: nomDuCahierExporte(nom, 'pdf') }]);
  const md = useTelechargement([{ adresse: adresse('md'), nom: nomDuCahierExporte(nom, 'md') }]);
  const enRoute = pdf.etat === 'reception' || md.etat === 'reception';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size={avecLibelle ? 'sm' : 'icon'}
          variant={avecLibelle ? 'outline' : 'ghost'}
          className="shrink-0"
          title={t('Exporter le cahier des charges')}
          aria-label="Exporter le cahier des charges"
          data-cahier-exporter
        >
          {enRoute ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {avecLibelle ? t('Exporter') : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => pdf.lancer()} data-cahier-export="pdf">
          <FileType className="h-4 w-4" />
          {t('PDF')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => md.lancer()} data-cahier-export="md">
          <FileText className="h-4 w-4" />
          {t('Texte (Markdown)')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * LE BOUTON « CAHIER DES CHARGES » DE LA CONFIGURATION DU PROJET. Il ne paraît
 * que si le projet a un document ; il ouvre le même tiroir de lecture, avec son
 * menu d'export.
 */
export function BoutonCahierDuProjet({ projectId }: { projectId: string }) {
  const texte = useDocumentDuCahier(projectId, true);
  const [ouvert, setOuvert] = React.useState(false);
  if (!texte) return null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOuvert(true)} data-cahier-du-projet={projectId}>
        <ClipboardList className="h-3.5 w-3.5" />
        {t('Cahier des charges')}
      </Button>
      <TiroirDuCahier projectId={projectId} open={ouvert} onClose={() => setOuvert(false)} />
    </>
  );
}
