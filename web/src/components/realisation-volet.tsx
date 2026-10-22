import * as React from 'react';
import { BookOpen, Download, FileText, FileType, Loader2 } from 'lucide-react';
import { Card, nomDeLaRealisationExportee, partiesDuCahier, realisationDeLaCarte } from '@beluga/shared';
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
import { BoutonCopierDocument } from '@/components/bouton-copier-document';
import { Markdown } from '@/lib/markdown';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * « LIRE LE CAHIER DE RÉALISATION », DERNIÈRE LIGNE DU FIL du volet de
 * réalisation (`chat.tsx`), sous le plan et les médias en fabrication. Elle
 * remplace l'ancien bandeau (types, phase, compteur, jauge, pause, caméra) :
 * l'avancement se lit sur la jauge de suivi, le lancement est le bouton de la
 * rangée d'action (`BarreDAction`). Rien tant que le document n'existe pas.
 */
export function LectureDuCahierDeRealisation({ carte }: { carte: Card }) {
  const [lecture, setLecture] = React.useState(false);
  const realisation = realisationDeLaCarte(carte);
  if (!realisation.majA && !realisation.faites) return null;
  return (
    <div className="px-4 pb-3 pt-1" data-lecture-du-cahier="realisation">
      <Button
        type="button"
        variant="ghost"
        className="h-9 w-full min-w-0 justify-center gap-2 rounded-lg bg-raised px-3 text-[13px] font-medium text-text hover:bg-border"
        onClick={() => setLecture(true)}
        data-realisation-lire
      >
        <BookOpen className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">{t('Lire le cahier de réalisation')}</span>
      </Button>
      <TiroirDeRealisation carte={carte} open={lecture} onClose={() => setLecture(false)} />
    </div>
  );
}

/**
 * LE DOCUMENT, LU SUR LE DISQUE À L'OUVERTURE puis à chaque réécriture (`majA`
 * change à chaque réponse enregistrée). Une rubrique encore à trancher porte sa
 * pastille « À voir ».
 */
function TiroirDeRealisation({ carte, open, onClose }: { carte: Card; open: boolean; onClose: () => void }) {
  const majA = carte.realisation?.majA;
  const [texte, setTexte] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    if (!open) return;
    let vivant = true;
    client
      .call<{ texte: string | null }>({ type: 'card.realisationDocument', id: carte.id })
      .then((data) => vivant && setTexte(data.texte ?? null))
      .catch(() => vivant && setTexte(null));
    return () => {
      vivant = false;
    };
  }, [open, carte.id, majA]);
  const parties = texte ? partiesDuCahier(texte) : [];
  return (
    <Drawer adresse="cahier-de-realisation" open={open} onClose={onClose} empile plein feuille>
      <div className="flex min-h-0 flex-1 flex-col gap-3 pb-5" data-tiroir-realisation={carte.id}>
        <EnteteDeFeuille
          titre={t('Cahier de réalisation')}
          className="pb-0"
          droite={
            texte ? (
              <>
                <BoutonCopierDocument texte={texte} repere="data-realisation-copier" />
                <MenuExportDeRealisation carte={carte} />
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
                <section key={`${partie.titre}-${index}`} data-realisation-partie={partie.aVoir ? 'a-voir' : 'tranchee'}>
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

/** EXPORTER LE CAHIER DE RÉALISATION : « PDF » ou « Texte », fabriqué par le démon (`/api/cartes/realisation`). */
function MenuExportDeRealisation({ carte }: { carte: Card }) {
  const adresse = (format: 'pdf' | 'md') => `/api/cartes/realisation?carte=${encodeURIComponent(carte.id)}&format=${format}`;
  const pdf = useTelechargement([{ adresse: adresse('pdf'), nom: nomDeLaRealisationExportee(carte.title, 'pdf') }]);
  const md = useTelechargement([{ adresse: adresse('md'), nom: nomDeLaRealisationExportee(carte.title, 'md') }]);
  const enRoute = pdf.etat === 'reception' || md.etat === 'reception';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="shrink-0"
          title={t('Exporter le cahier de réalisation')}
          aria-label="Exporter le cahier de réalisation"
          data-realisation-exporter
        >
          {enRoute ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => pdf.lancer()} data-realisation-export="pdf">
          <FileType className="h-4 w-4" />
          {t('PDF')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => md.lancer()} data-realisation-export="md">
          <FileText className="h-4 w-4" />
          {t('Texte (Markdown)')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
