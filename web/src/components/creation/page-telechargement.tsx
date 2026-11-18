import * as React from 'react';
import { Download, FolderDown, Loader2 } from '@/components/ui/icones';
import { LIBELLES_SECTIONS_DU_TELECHARGEMENT, SECTIONS_DU_TELECHARGEMENT, type FichierDuTelechargement, type SectionDuTelechargement } from '@beluga/shared';
import { Button, ZoneDefilement } from '@/components/ui';
import { AttachmentPreview } from '@/components/attachment-preview';
import { adresseDePiece } from '@/components/pastille-de-fichier';
import { Tableau, type ColonneDuTableauCommun } from '@/components/ui/tableau';
import { BoutonVue } from '@/components/ui/boutons-a-menu';
import { ApercuDeLigne, poidsDeLigne } from '@/components/ui/apercu-de-ligne';
import { CroixDuVolet } from '@/components/feuille-du-volet';
import { client } from '@/lib/client';
import { fermerLeDocument } from '@/lib/document-de-carte';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { useProduction } from '@/lib/production-de-carte';
import { useApp } from '@/lib/use-app';
import { useTelechargement } from '@/lib/telechargement';

type FichierLu = FichierDuTelechargement & { mime: string; taille: number | null };
type Sections = Record<SectionDuTelechargement, FichierLu[]>;

/**
 * LA PAGE TÉLÉCHARGEMENT D'UNE CRÉATION DE MÉDIA (décision de l'utilisateur du
 * 26/10/2026) : tout ce qui a été généré, rangé de haut en bas — les MÉDIAS
 * FINAUX (rendus des studios, exports du montage), puis les VALIDÉS, puis
 * TOUTES LES ESQUISSES — trois onglets à compteur sur un seul tableau (03/11/2026). Chaque fichier se télécharge seul ; « Tout
 * télécharger » donne UNE archive avec trois dossiers nommés d'après les étapes
 * (`/api/creation/telechargement`), en flux, sans rien coûter. « Terminer »,
 * au bout du parcours, reste le bouton du bas.
 *
 * `listeSeule` (le tiroir « Téléchargements » du Studio, 31/10/2026) : la seule liste des fichiers et « Tout
 * télécharger » — ni titre ni croix, que porte le tiroir, ni zone qui défile à elle : le tiroir défile.
 */
export default function PageTelechargement({ cardId, listeSeule = false }: { cardId: string; listeSeule?: boolean }) {
  /* La langue de la page, lue sur le document (la racine seule la pose) : les dossiers de l'archive la suivent. */
  const langue = (typeof document !== 'undefined' ? document.documentElement.lang : '').slice(0, 2) || 'fr';
  const production = useProduction(cardId);
  const [sections, setSections] = React.useState<Sections | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [ouverte, setOuverte] = React.useState<string | null>(null);
  const carte = useApp().cards[cardId];
  /* Relue à chaque changement de la production (un export qui finit, un média validé). */
  React.useEffect(() => {
    let vivant = true;
    client
      .call<Sections>({ type: 'realisation.telechargement.lire', cardId })
      .then((r) => vivant && setSections(r))
      .catch((err: any) => vivant && setErreur(err?.message ?? t('La page n’a pas pu être lue')));
    return () => {
      vivant = false;
    };
  }, [cardId, production, carte?.realisation?.finaux?.length]);

  const tous = sections ? SECTIONS_DU_TELECHARGEMENT.flatMap((s) => sections[s]) : [];
  const galerie = React.useMemo(
    () => tous.filter((f, i) => tous.findIndex((x) => x.piece === f.piece) === i).map((f) => ({ id: f.piece, projectId: carte?.projectId ?? '', name: f.nom, mime: f.mime, size: f.taille ?? 0, sha: f.piece, createdAt: 0 })),
    [sections],
  );
  const piece = ouverte ? galerie.find((p) => p.id === ouverte) ?? null : null;
  const archive = `/api/creation/telechargement?cardId=${encodeURIComponent(cardId)}&langue=${encodeURIComponent(langue)}`;
  /* L'ARCHIVE PASSE PAR LE GESTE DE L'APPLICATION (feuille de partage sur téléphone) : jamais une page qui remplace l'application. */
  const tout = useTelechargement([{ adresse: archive, nom: `${carte?.title?.trim() || 'creation'}.zip` }]);

  /* UN TABLEAU, TROIS SECTIONS À COMPTEUR, choisies par le bouton « Vue » (décision du 03/11/2026, revue le 04/11) :
     Médias finaux, Validés, Esquisses — l'onglet ouvert d'office est le premier qui a des fichiers. */
  const [section, setSection] = React.useState<SectionDuTelechargement | null>(null);
  const sectionOuverte: SectionDuTelechargement = section ?? (sections ? (SECTIONS_DU_TELECHARGEMENT.find((s) => sections[s].length) ?? 'finaux') : 'finaux');
  const colonnes: ColonneDuTableauCommun<FichierLu>[] = [
    { cle: 'apercu', libelle: t('Aperçu'), largeur: 64, rendu: (f) => <ApercuDeLigne piece={f.piece} genre={f.genre} taille={44} onOuvrir={() => setOuverte(f.piece)} /> },
    { cle: 'nom', libelle: t('Nom'), valeur: (f) => f.nom, filtre: 'texte', rendu: (f) => <span className="block truncate" title={f.nom}>{f.nom}</span> },
    { cle: 'genre', libelle: t('Genre'), largeur: 84, secondaire: true, valeur: (f) => f.genre, filtre: 'choix', libelleDuChoix: libelleDuGenre, rendu: (f) => <span className="text-muted">{libelleDuGenre(f.genre)}</span> },
    { cle: 'taille', libelle: t('Taille'), largeur: 84, droite: true, valeur: (f) => f.taille, rendu: (f) => <span className="text-muted">{poidsDeLigne(f.taille)}</span> },
    { cle: 'telecharger', libelle: '', largeur: 48, libre: true, rendu: (f) => <BoutonTelecharger fichier={f} /> },
  ];
  const sectionsListees = sections ? (
    <div className="flex min-w-0 flex-col gap-2">
      {/* LA SECTION SE CHOISIT PAR UN BOUTON « VUE » À MENU (04/11/2026, deuxième passe : plus de barre d'onglets). */}
      <div className="flex justify-end">
        <BoutonVue
          repere="telechargements"
          choix={SECTIONS_DU_TELECHARGEMENT.map((s) => ({ cle: s, libelle: t(LIBELLES_SECTIONS_DU_TELECHARGEMENT[s]), nombre: sections[s].length }))}
          valeur={sectionOuverte}
          onChoisir={setSection}
        />
      </div>
      <section className="min-w-0" data-section-telechargement={sectionOuverte} data-nombre={sections[sectionOuverte].length}>
        <Tableau
          repere={`telechargement-${sectionOuverte}`}
          colonnes={colonnes}
          lignes={sections[sectionOuverte]}
          cle={(f) => `${sectionOuverte}-${f.piece}`}
          vide={
            sectionOuverte === 'finaux'
              ? t('Aucun média final pour l’instant : exportez depuis le montage.')
              : sectionOuverte === 'valides'
                ? t('Aucun élément validé.')
                : t('Aucune esquisse.')
          }
          attributsLigne={(f) => ({ 'data-fichier-telechargement': f.piece })}
          taille={50}
        />
      </section>
    </div>
  ) : null;

  return (
    <div className={cn('flex min-h-0 flex-col', !listeSeule && 'h-full')} data-page-telechargement={cardId} data-liste-seule={listeSeule ? '' : undefined}>
      <div className={cn('flex shrink-0 flex-wrap items-center gap-2 px-4 pb-2', listeSeule ? 'justify-end' : 'pt-3')}>
        {listeSeule ? null : <span className="mr-auto min-w-0 truncate text-[14.5px] font-medium text-text">{t('Téléchargement')}</span>}
        <Button type="button" className="gap-1.5 bg-accent text-accent-fg hover:opacity-90" disabled={!tous.length || tout.etat === 'reception'} aria-busy={tout.etat === 'reception'} onClick={tout.lancer} data-tout-telecharger={archive}>
          {tout.etat === 'reception' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderDown className="h-3.5 w-3.5" />}
          {tout.etat === 'reception' ? t('Préparation de l’archive… {n} %', { n: tout.pourcent }) : t('Tout télécharger')}
        </Button>
        {listeSeule ? null : <CroixDuVolet genre="telechargement" onFermer={fermerLeDocument} className="-my-1 -mr-2" />}
      </div>
      {erreur ? <p className="px-4 text-[13px] text-danger">{erreur}</p> : null}
      {!sections && !erreur ? (
        <p className="flex items-center gap-2 px-4 py-2 text-[13px] text-faint">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('Chargement…')}
        </p>
      ) : null}
      {sections ? (
        listeSeule ? (
          <div className="flex flex-col gap-5 px-4 pb-6">{sectionsListees}</div>
        ) : (
          <ZoneDefilement className="min-h-0 flex-1 px-4 pb-6">
            <div className="flex flex-col gap-5">{sectionsListees}</div>
          </ZoneDefilement>
        )
      ) : null}
      <AttachmentPreview item={piece} galerie={galerie} onNaviguer={(p) => setOuverte(p.id)} onClose={() => setOuverte(null)} />
    </div>
  );
}

/** Le genre d'un fichier, dit dans la langue de l'écran. */
const libelleDuGenre = (g: string): string => (g === 'image' ? t('Image') : g === 'video' ? t('Vidéo') : g === 'son' ? t('Son') : g);

/** Le bouton de bout de ligne : le fichier seul, par le geste de l'application (feuille de partage sur téléphone). */
function BoutonTelecharger({ fichier }: { fichier: FichierLu }) {
  const extension = fichier.mime.split('/')[1]?.replace('mpeg', 'mp3').replace('quicktime', 'mov') ?? '';
  const { etat, lancer } = useTelechargement([{ adresse: adresseDePiece(fichier.piece, true), nom: `${fichier.nom}${extension ? `.${extension}` : ''}` }]);
  return (
    <button
      type="button"
      onClick={lancer}
      title={t('Télécharger')}
      aria-label="Télécharger"
      aria-busy={etat === 'reception'}
      className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-text"
      data-telecharger-fichier={fichier.piece}
    >
      {etat === 'reception' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
    </button>
  );
}
