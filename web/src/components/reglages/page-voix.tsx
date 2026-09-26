import * as React from 'react';
import {
  Loader2,
  Play,
  Volume2,
} from 'lucide-react';
import {
  CRANS_DE_VITESSE,
  formeDepuisEvenement,
  libelleDeRaccourci,
  raisonRaccourciRefuse,
} from '@beluga/shared';
import {
  BulleInfo,
  Button,
  Input,
  Switch,
} from '@/components/ui';
import { CLE_VOIX_MUETTE, CLE_VOIX_VISIBLE } from '@/components/voix-assistant';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { usePref } from '@/lib/prefs';
import { setConversationAllumeeGlobale, setEcouteAllumeeGlobale, useEtatVocalGlobal } from '@/lib/etat-vocal';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';


/**
 * Le choix de la voix qui lit le point du jour. Une voix ne se juge pas sur son
 * nom : chaque ligne porte donc son propre bouton d'écoute, et l'extrait est
 * fabriqué par le serveur avec CETTE voix-là, avant tout enregistrement.
 */
export function VoiceSection({ open }: { open: boolean }) {
  const state = useApp();
  const [voices, setVoices] = React.useState<{ id: string; label: string; description: string }[]>([]);
  const [playing, setPlaying] = React.useState<string | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  // La capture du raccourci d'écoute : tant qu'elle est active, le prochain appui
  // devient le raccourci (s'il convient), sinon on dit pourquoi on le refuse.
  const [captureRaccourci, setCaptureRaccourci] = React.useState(false);
  const [refusRaccourci, setRefusRaccourci] = React.useState<string | null>(null);
  const raccourci = state.settings?.voixRaccourci ?? '';

  const surToucheRaccourci = (event: React.KeyboardEvent) => {
    if (!captureRaccourci) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      setCaptureRaccourci(false);
      setRefusRaccourci(null);
      return;
    }
    const forme = formeDepuisEvenement({
      code: event.code,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      meta: event.metaKey,
    });
    // Un modificateur seul : on attend encore la vraie touche.
    if (!forme) return;
    const raison = raisonRaccourciRefuse(forme);
    if (raison) {
      setRefusRaccourci(raison);
      return;
    }
    void client.geste({ type: 'settings.update', patch: { voixRaccourci: forme } }, t('Enregistrement du réglage'));
    setRefusRaccourci(null);
    setCaptureRaccourci(false);
  };

  React.useEffect(() => {
    if (!open) return;
    client
      .call<{ voices: typeof voices }>({ type: 'voice.list' })
      .then((data) => setVoices(data.voices ?? []))
      .catch(() => setVoices([]));
  }, [open]);

  // On ne laisse jamais un extrait continuer après la fermeture des réglages.
  React.useEffect(() => {
    if (open) return;
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(null);
  }, [open]);

  // Un seul lecteur pour tous les extraits : `cle` distingue ce qui joue (une
  // voix « voix:… », une vitesse « vitesse:… »). L'extrait de vitesse est dit
  // avec la voix RETENUE, pour n'entendre que le débit changer.
  const jouer = (cle: string, params: Record<string, string>) => {
    audioRef.current?.pause();
    const query = new URLSearchParams(params).toString();
    const audio = new Audio(`/api/voice-sample?${query}`);
    audioRef.current = audio;
    setPlaying(cle);
    const fini = () => setPlaying((courant) => (courant === cle ? null : courant));
    audio.addEventListener('ended', fini);
    audio.addEventListener('error', () => {
      fini();
      client.pushToast('error', t('Extrait impossible à jouer.'));
    });
    void audio.play().catch(fini);
  };

  const ecouter = (id: string) => jouer(`voix:${id}`, { voice: id });

  const choisie = state.settings?.ttsVoice;
  const vitesse = state.settings?.voixVitesse ?? 'normale';

  // Écoute permanente et conversation vocale : ÉTEINTES à chaque ouverture de
  // l'app, jamais retenues — voir `lib/etat-vocal.ts`. Le rond du menu du bas
  // qui les pilotait a cédé sa place au bouton Robo ; elles se règlent ici.
  const etatVocal = useEtatVocalGlobal();
  const [muet, setMuet] = usePref<boolean>(CLE_VOIX_MUETTE, false);
  const [voixVisible, setVoixVisible] = usePref<boolean>(CLE_VOIX_VISIBLE, false);

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
        <Volume2 className="h-3.5 w-3.5 text-faint" />  {t('La voix du point du jour')}
        <BulleInfo cote="start">
          {t('L\'écoute et la conversation s\'éteignent à chaque fermeture de l\'application — jamais de micro ouvert tout seul.')}
          {'\n\n'}
          {t('L\'extrait est dit avec la voix de la ligne, sans rien changer à votre choix. Touchez le nom pour l\'adopter : c\'est cette voix qui lira le point du jour et le bouton haut-parleur.')}
        </BulleInfo>
      </h3>

      <div className="mb-3 space-y-2">
        <label className="flex items-center gap-2 text-[14px] text-muted">
          <Switch checked={voixVisible} onCheckedChange={setVoixVisible} />
          {t('Afficher le module vocal flottant')}
        </label>
        <label className="flex items-center gap-2 text-[14px] text-muted">
          <Switch checked={etatVocal.ecouteAllumee} onCheckedChange={setEcouteAllumeeGlobale} />
          {t('Écoute permanente (mot de réveil)')}
        </label>
        <label className="flex items-center gap-2 text-[14px] text-muted">
          <Switch checked={etatVocal.conversationAllumee} onCheckedChange={setConversationAllumeeGlobale} />
          {t('Mode conversation vocale')}
        </label>
        <label className="flex items-center gap-2 text-[14px] text-muted">
          <Switch checked={!muet} onCheckedChange={(checked) => setMuet(!checked)} />
          {t('Lire les réponses et notifications à voix haute')}
        </label>
      </div>

      <div className="mb-3">
        <div className="mb-1 flex items-center gap-1">
          <label className="text-[12.5px] text-muted">{t('Le prénom que la voix emploie')}</label>
          <BulleInfo cote="start">{t('La voix s\'adresse à vous par ce prénom (« Ça y est, {v0}, c\'est fait. »).', { v0: state.settings?.voixNom || 'Chris' })}</BulleInfo>
        </div>
        <Input
          defaultValue={state.settings?.voixNom ?? 'Chris'}
          placeholder="Chris"
          maxLength={40}
          // Un prénom vide retomberait sur « Chris » côté voix ; on n'envoie que
          // ce qui a du texte, une fois débarrassé de ses espaces.
          onBlur={(event) => {
            const nom = event.target.value.trim();
            if (nom) void client.geste({ type: 'settings.update', patch: { voixNom: nom } }, t('Enregistrement du réglage'));
          }}
        />
      </div>

      <div className="mb-3">
        <div className="mb-1 flex items-center gap-1">
          <label className="text-[12.5px] text-muted">{t('Le mot qui réveille l\'écoute')}</label>
          <BulleInfo cote="start">{t('Quand l\'écoute permanente est allumée, dites ce mot pour commencer à dicter (« {v0} range les cartes »).', { v0: state.settings?.voixReveil || 'Dis Haiko' })}</BulleInfo>
        </div>
        <Input
          defaultValue={state.settings?.voixReveil ?? 'Dis Haiko'}
          placeholder={t('Dis Haiko')}
          maxLength={40}
          // Un mot vide retomberait sur « Dis Haiko » côté écoute ; on n'envoie
          // que ce qui a du texte, une fois débarrassé de ses espaces.
          onBlur={(event) => {
            const mot = event.target.value.trim();
            if (mot) void client.geste({ type: 'settings.update', patch: { voixReveil: mot } }, t('Enregistrement du réglage'));
          }}
        />
      </div>

      <div className="mb-3">
        <div className="mb-1 flex items-center gap-1">
          <label className="text-[12.5px] text-muted">{t('Le raccourci clavier qui allume l\'écoute')}</label>
          <BulleInfo cote="start">
            {t('Cette combinaison allume et éteint l\'écoute permanente, où que vous soyez — jamais pendant que vous tapez dans un champ. Utilisez Alt ou Ctrl + Maj avec une lettre.')}
          </BulleInfo>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-raccourci-ecoute
            onClick={() => {
              setCaptureRaccourci(true);
              setRefusRaccourci(null);
            }}
            onBlur={() => {
              setCaptureRaccourci(false);
              setRefusRaccourci(null);
            }}
            onKeyDown={surToucheRaccourci}
            className={cn(
              'flex-1 rounded-md border px-2 py-1.5 text-left text-[13.5px] transition-colors',
              captureRaccourci
                ? 'border-text/40 bg-raised text-text'
                : 'border-border bg-surface text-text hover:bg-raised',
            )}
          >
            {captureRaccourci
              ? t('Appuyez sur la combinaison…')
              : raccourci
                ? libelleDeRaccourci(raccourci)
                : t('Aucun — cliquer pour régler')}
          </button>
          {raccourci && !captureRaccourci ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void client.geste({ type: 'settings.update', patch: { voixRaccourci: '' } }, t('Enregistrement du réglage'))}
            >
              {t('Retirer')}</Button>
          ) : null}
        </div>
        {refusRaccourci ? <p className="mt-1 text-[11.5px] text-danger">{refusRaccourci}</p> : null}
      </div>

      {!voices.length ? (
        <p className="text-[13px] text-faint">{t('Aucune voix installée sur le serveur.')}</p>
      ) : (
        <div className="space-y-1">
          {voices.map((voice) => {
            const active = choisie === voice.id;
            return (
              <div
                key={voice.id}
                className={cn(
                  'flex items-center gap-2 rounded-md border px-2 py-1.5',
                  active ? 'border-text/40 bg-raised' : 'border-border bg-surface',
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => void client.geste({ type: 'settings.update', patch: { ttsVoice: voice.id } }, t('Enregistrement du réglage'))}
                >
                  <p className="truncate text-[13.5px] text-text">
                    {voice.label}
                    {active ? <span className="ml-1.5 text-[12px] text-faint">{t('· choisie')}</span> : null}
                  </p>
                  <p className="truncate text-[11.5px] text-faint">{voice.description}</p>
                </button>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Écouter ${voice.label}`}
                  disabled={playing === `voix:${voice.id}`}
                  onClick={() => ecouter(voice.id)}
                >
                  {playing === `voix:${voice.id}` ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                  
{t('Écouter')}
</Button>
              </div>
            );
          })}
        </div>
      )}


      <div className="mt-4">
        <div className="mb-1.5 flex items-center gap-1">
          <label className="text-[12.5px] text-muted">{t('La vitesse de la voix')}</label>
          <BulleInfo cote="start">{t('La vitesse s\'applique à toutes les paroles — point du jour, annonces, réécoutes.')}</BulleInfo>
        </div>
        <div className="space-y-1">
          {CRANS_DE_VITESSE.map((cran) => {
            const active = vitesse === cran.id;
            return (
              <div
                key={cran.id}
                className={cn(
                  'flex items-center gap-2 rounded-md border px-2 py-1.5',
                  active ? 'border-text/40 bg-raised' : 'border-border bg-surface',
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => void client.geste({ type: 'settings.update', patch: { voixVitesse: cran.id } }, t('Enregistrement du réglage'))}
                >
                  <p className="truncate text-[13.5px] text-text">
                    {cran.label}
                    {active ? <span className="ml-1.5 text-[12px] text-faint">{t('· choisie')}</span> : null}
                  </p>
                  <p className="truncate text-[11.5px] text-faint">{cran.description}</p>
                </button>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Écouter la vitesse ${cran.label}`}
                  disabled={playing === `vitesse:${cran.id}`}
                  // L'essai est dit avec la voix retenue et CETTE vitesse : on
                  // l'entend avant de l'adopter en touchant le nom.
                  onClick={() =>
                    jouer(`vitesse:${cran.id}`, {
                      ...(choisie ? { voice: choisie } : {}),
                      vitesse: cran.id,
                    })
                  }
                >
                  {playing === `vitesse:${cran.id}` ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                  
{t('Écouter')}
</Button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
