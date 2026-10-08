import * as React from 'react';
import { ArrowDown, ArrowUp, CornerDownLeft, Delete } from 'lucide-react';
import { Button, DialogFooter, Drawer, Input, ZoneDefilement } from '@/components/ui';
import { EnteteDeFenetre } from './champs';
import { client } from '@/lib/client';
import { useTelephone } from '@/lib/telephone';
import { t } from '@/lib/langue';

type Geste =
  | { genre: 'clic'; x: number; y: number }
  | { genre: 'molette'; x: number; y: number; dx: number; dy: number }
  | { genre: 'texte'; texte: string }
  | { genre: 'touche'; cle: string };

/**
 * LE VOLET « PASSER LA VÉRIFICATION » — un VRAI navigateur, ouvert sur le serveur
 * (`server/src/studio-navigateur.ts`), dont l'image arrive ici en direct. On y
 * passe soi-même la vérification anti-robot d'une source de styles : un appui
 * sur l'image est un clic dans la page, la molette (ou les flèches) la fait
 * défiler, le champ du bas y tape du texte. « C'est fait » lit alors la source
 * PAR CE NAVIGATEUR — le seul à qui le site a donné son laissez-passer.
 *
 * Plein écran au téléphone ; fermé, le navigateur s'éteint (et tout seul après
 * dix minutes sans geste). Le profil reste : la nuit le réutilise.
 */
export function VoletVerification({ sourceId, nom, onClose }: { sourceId: string; nom?: string; onClose: () => void }) {
  const telephone = useTelephone();
  const [image, setImage] = React.useState<{ src: string; largeur: number; hauteur: number } | null>(null);
  const [adresse, setAdresse] = React.useState('');
  const [etat, setEtat] = React.useState<'ouverture' | 'ouvert' | 'lecture' | 'ferme'>('ouverture');
  const [message, setMessage] = React.useState<{ texte: string; ok: boolean } | null>(null);
  const [texte, setTexte] = React.useState('');
  const [termine, setTermine] = React.useState(false);
  const cadre = React.useRef<HTMLImageElement | null>(null);
  const molette = React.useRef({ dy: 0, minuteur: 0 as unknown as ReturnType<typeof setTimeout> | 0 });

  React.useEffect(() => {
    const arreter = client.onNavigateur((e) => {
      if (e.sourceId !== sourceId) return;
      if (e.image) setImage({ src: `data:image/jpeg;base64,${e.image}`, largeur: e.largeur ?? 1280, hauteur: e.hauteur ?? 800 });
      if (e.adresse) setAdresse(e.adresse);
      if (e.etat === 'ouvert') setEtat('ouvert');
      else if (e.etat === 'lecture') setEtat('lecture');
      else if (e.etat === 'ferme') {
        setEtat('ferme');
        if (e.texte) setMessage({ texte: e.texte, ok: false });
      }
    });
    client
      .call({ type: 'studio.navigateur.ouvrir', sourceId })
      .catch((err: any) => {
        setEtat('ferme');
        setMessage({ texte: err?.message ?? String(err), ok: false });
      });
    return () => {
      arreter();
      void client.call({ type: 'studio.navigateur.fermer', sourceId }).catch(() => undefined);
    };
  }, [sourceId]);

  const geste = (g: Geste) => void client.call({ type: 'studio.navigateur.geste', sourceId, geste: g }).catch((err: any) => setMessage({ texte: err?.message ?? String(err), ok: false }));

  /** Un point de l'image → le même point dans la page du navigateur (pixels CSS). */
  const versLaPage = (clientX: number, clientY: number) => {
    const r = cadre.current?.getBoundingClientRect();
    if (!r || !image || !r.width) return { x: 0, y: 0 };
    return { x: Math.round(((clientX - r.left) / r.width) * image.largeur), y: Math.round(((clientY - r.top) / r.height) * image.hauteur) };
  };

  const terminer = async () => {
    setMessage(null);
    setTermine(true);
    try {
      const r = await client.call<{ ok: boolean; texte: string }>({ type: 'studio.navigateur.terminer', sourceId });
      setMessage({ texte: r.texte, ok: r.ok });
      if (!r.ok) setTermine(false);
    } catch (err: any) {
      setMessage({ texte: err?.message ?? String(err), ok: false });
      setTermine(false);
    }
  };

  const envoyerTexte = () => {
    if (!texte) return;
    geste({ genre: 'texte', texte });
    setTexte('');
  };

  return (
    <Drawer open onClose={onClose} empile plein={telephone}>
      <header className="shrink-0 px-3 pb-2">
        <EnteteDeFenetre titre={nom ? t('Passer la vérification — {nom}', { nom }) : t('Passer la vérification')} onRetour={onClose} />
      </header>
      <ZoneDefilement fond="hsl(var(--surface))" className="px-4 pb-4">
        <div className="flex flex-col gap-2" data-studio-verification={sourceId} data-etat={etat}>
          <p className="text-[12.5px] text-muted">
            {t('Ce navigateur tourne sur le serveur. Touchez l’image comme la page elle-même pour passer la vérification, puis appuyez sur « C’est fait » : la source sera lue par ce navigateur, et le restera chaque nuit.')}
          </p>
          {adresse ? <p className="truncate text-[11.5px] text-faint">{adresse}</p> : null}
          <div className="relative overflow-hidden rounded-md bg-bg" style={{ aspectRatio: image ? `${image.largeur} / ${image.hauteur}` : '16 / 10' }}>
            {image ? (
              <img
                ref={cadre}
                src={image.src}
                alt={t('Page du navigateur')}
                draggable={false}
                className="absolute inset-0 h-full w-full cursor-pointer select-none object-fill"
                onClick={(e) => geste({ genre: 'clic', ...versLaPage(e.clientX, e.clientY) })}
                onWheel={(e) => {
                  // Les crans de molette se regroupent : un geste toutes les 120 ms, pas un par cran.
                  const m = molette.current;
                  m.dy += e.deltaY;
                  if (m.minuteur) return;
                  const point = versLaPage(e.clientX, e.clientY);
                  m.minuteur = setTimeout(() => {
                    geste({ genre: 'molette', ...point, dx: 0, dy: Math.round(m.dy) });
                    m.dy = 0;
                    m.minuteur = 0;
                  }, 120);
                }}
                data-studio-verification-image
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-[12.5px] text-faint">
                {etat === 'ferme' ? t('Le navigateur est fermé.') : t('Ouverture du navigateur…')}
              </div>
            )}
            {etat === 'lecture' ? (
              <div className="absolute inset-0 flex items-center justify-center bg-bg/70 text-[13px] text-text">{t('Lecture de la source par ce navigateur…')}</div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Input
              value={texte}
              onChange={(e) => setTexte(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  envoyerTexte();
                }
              }}
              placeholder={t('Texte à taper dans la page')}
              className="h-8 min-w-[160px] flex-1 text-[13px]"
              disabled={etat !== 'ouvert'}
              data-studio-verification-texte
            />
            <Button size="sm" variant="outline" onClick={envoyerTexte} disabled={etat !== 'ouvert' || !texte}>
              {t('Taper')}
            </Button>
            <Button size="icon" variant="ghost" aria-label="Entrée" title={t('Touche Entrée')} onClick={() => geste({ genre: 'touche', cle: 'Enter' })} disabled={etat !== 'ouvert'}>
              <CornerDownLeft className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Effacer" title={t('Effacer un caractère')} onClick={() => geste({ genre: 'touche', cle: 'Backspace' })} disabled={etat !== 'ouvert'}>
              <Delete className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Monter" title={t('Faire défiler vers le haut')} onClick={() => geste({ genre: 'molette', x: 640, y: 400, dx: 0, dy: -400 })} disabled={etat !== 'ouvert'}>
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Descendre" title={t('Faire défiler vers le bas')} onClick={() => geste({ genre: 'molette', x: 640, y: 400, dx: 0, dy: 400 })} disabled={etat !== 'ouvert'}>
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
          </div>
          {message ? (
            <p className={message.ok ? 'text-[12.5px] text-termine' : 'text-[12.5px] text-danger'} role="status" data-studio-verification-message>
              {message.texte}
            </p>
          ) : null}
        </div>
      </ZoneDefilement>
      <DialogFooter pleineLargeur>
        <Button size="lg" onClick={terminer} disabled={etat !== 'ouvert' || termine} data-studio-verification-terminer>
          {termine && !message ? t('Lecture…') : t('C’est fait')}
        </Button>
      </DialogFooter>
    </Drawer>
  );
}
