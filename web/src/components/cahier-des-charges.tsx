import * as React from 'react';
import { BookOpen, ClipboardList, Download, FileText, FileType, Loader2 } from 'lucide-react';
import { Card, nomDuCahierExporte, partiesDuCahier } from '@beluga/shared';
import {
  Button,
  EnteteDeFeuille,
  Drawer,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ZoneDefilement,
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
 * « LIRE LE CAHIER DES CHARGES », DERNIÈRE LIGNE DU FIL du volet du cahier
 * (`chat.tsx`). Elle remplace l'ancien bandeau (phase, compteur, jauge,
 * pause) : l'avancement se lit sur la jauge de suivi. Seule la carte née de
 * la case « Démarrer par un cahier des charges » la porte
 * (`Card.cahierDesCharges`), et rien tant que le document n'existe pas.
 */
export function LectureDuCahierDesCharges({ carte }: { carte: Card }) {
  const cahier = carte.cahierDesCharges;
  const [lecture, setLecture] = React.useState(false);
  if (!cahier || (!cahier.majA && !cahier.faites)) return null;
  return (
    <div className="px-4 pb-3 pt-1" data-lecture-du-cahier="cahier">
      <Button
        type="button"
        variant="ghost"
        className="h-9 w-full min-w-0 justify-center gap-2 rounded-lg bg-raised px-3 text-[13px] font-medium text-text hover:bg-border"
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
