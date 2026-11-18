import * as React from 'react';
import {
  AUCUN_RACCOURCI,
  RACCOURCI_PAR_DEFAUT,
  creerReconnaisseur,
  libelleDeRaccourci,
  nomDeLAssistant,
  phraseDAppel,
  raccourciEffectif,
  raisonRaccourciRefuse,
} from '@beluga/shared';
import { plateformeDuClavier } from '@/lib/raccourci-de-jarvis';
import { BulleInfo, Button, Switch } from '@/components/ui';
import { CLE_VOIX_VISIBLE } from '@/components/voix-assistant';
import { useVoixDisponible } from '@/lib/voix-disponible';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { usePref } from '@/lib/prefs';
import { CLE_JARVIS_DOS, plateformeNative } from '@/lib/natif';
import { setMicroOuvertGlobal, useEtatVocalGlobal } from '@/lib/etat-vocal';
import { cn } from '@/lib/utils';
import { CerveauDeLaVoix, VoixDuDirect } from '@/components/reglages/voix-du-direct';
import { SectionVotreAssistant } from '@/components/installation/votre-assistant';
import { t } from '@/lib/langue';

/**
 * RÉGLAGES › VOIX (17/11/2026) : une seule voix, la conversation en direct avec Codex. Les anciennes voix du serveur
 * (point du jour lu, annonces, lecture d'un message, choix et vitesse des voix Piper/Kokoro/Gemini) ont été RETIRÉES
 * à la demande de l'utilisateur, jugées trop mécaniques. Restent : « Votre assistant » (prénom, nom, phrase d'appel),
 * la voix de Codex et son essai, les interrupteurs Voix / Micro, le raccourci clavier.
 */
export function VoiceSection({ open: _open }: { open: boolean }) {
  const state = useApp();
  /* LA CAPTURE DU RACCOURCI DE JARVIS (17/11/2026) : tant qu'elle est active, les appuis ET les relâchements passent
     par le même reconnaisseur que l'écoute globale (`shared/src/raccourci-clavier.ts`) — une combinaison se prend à
     l'appui de sa touche, des modificateurs seuls à leur relâchement, un double appui au second relâchement. */
  const [captureRaccourci, setCaptureRaccourci] = React.useState(false);
  const [refusRaccourci, setRefusRaccourci] = React.useState<string | null>(null);
  const reconnaisseur = React.useRef(creerReconnaisseur());
  const rangee = state.settings?.voixRaccourci ?? '';
  const raccourci = raccourciEffectif(rangee);
  const plateforme = plateformeDuClavier();
  const enregistrerRaccourci = (valeur: string) =>
    void client.geste({ type: 'settings.update', patch: { voixRaccourci: valeur } }, t('Enregistrement du réglage'));

  const surToucheRaccourci = (event: React.KeyboardEvent, type: 'down' | 'up') => {
    if (!captureRaccourci) return;
    event.preventDefault();
    event.stopPropagation();
    if (type === 'down' && event.key === 'Escape') {
      setCaptureRaccourci(false);
      setRefusRaccourci(null);
      return;
    }
    const forme = reconnaisseur.current.recevoir({
      type,
      code: event.code,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      meta: event.metaKey,
      t: event.timeStamp,
      repeat: event.repeat,
    });
    // Rien d'accompli encore (un modificateur tenu, un premier appui) : on attend la suite.
    if (!forme) return;
    const raison = raisonRaccourciRefuse(forme);
    if (raison) {
      setRefusRaccourci(raison);
      return;
    }
    // Le défaut se range VIDE : un réglage resté au défaut suit le défaut s'il change un jour.
    enregistrerRaccourci(forme === RACCOURCI_PAR_DEFAUT ? '' : forme);
    setRefusRaccourci(null);
    setCaptureRaccourci(false);
  };

  // Micro du module (attente du mot) et conversation vocale : ÉTEINTS à chaque ouverture de l'app, jamais retenus —
  // voir `lib/etat-vocal.ts`. Le seul module à l'écran est Jarvis au bord (`jarvis-natif.tsx`).
  const etatVocal = useEtatVocalGlobal();
  const [voixVisible, setVoixVisible] = usePref<boolean>(CLE_VOIX_VISIBLE, false);
  const { disponible: voixActive } = useVoixDisponible();
  const motReveil = phraseDAppel(nomDeLAssistant(state.settings));
  const appNative = plateformeNative() === 'ios';
  const [jarvisDos, setJarvisDos] = usePref<boolean>(CLE_JARVIS_DOS, true);

  return (
    <section>
      <div className="mb-6" data-reglages-votre-assistant>
        <SectionVotreAssistant />
      </div>
      <VoixDuDirect />
      <CerveauDeLaVoix />

      <div className="mb-3 space-y-2">
        {/* LE BOUTON DU BORD EST L'ENTRÉE DE L'ASSISTANT (16/11/2026) : toujours là pour qui a l'assistant ; ce choix ne
            reste qu'aux comptes sans assistant, pour qui il n'ouvre que la voix. */}
        {state.monRole !== 'admin' ? (
          <label className="flex items-center gap-2 text-[14px] text-muted">
            <Switch checked={voixVisible} onCheckedChange={setVoixVisible} />
            {t('Afficher Jarvis au bord de l’écran')}
          </label>
        ) : null}
        {/* L'INTERRUPTEUR « VOIX » EST DÉSORMAIS CELUI DU BLOC « ASSISTANT VOCAL », juste au-dessus (17/11/2026) : la
            même préférence (`CLE_VOIX_ACTIVE`), avec le compte ChatGPT qu'elle exige. Désactivée, TOUT se coupe. */}
        <label className="flex items-center gap-2 text-[14px] text-muted">
          <Switch checked={voixActive && etatVocal.microOuvert} disabled={!voixActive} onCheckedChange={setMicroOuvertGlobal} data-interrupteur-micro aria-pressed={voixActive && etatVocal.microOuvert} />
          {t('Micro ouvert : attendre « {v0} » sur cet appareil', { v0: motReveil })}
        </label>
        {/* L'ancien interrupteur « Conversation en direct avec Codex » est retiré (17/11/2026) : il ne faisait que refléter
            la conversation en cours et en lancer une, comme le bouton du bord — ce n'était pas un réglage. */}
        {/* DANS L'APPLICATION IPHONE SEULEMENT (16/11/2026) : le double toucher au dos lance Jarvis — à choisir une fois
            dans Réglages › Accessibilité › Toucher › Toucher le dos de l'iPhone (raccourci « Parler à Jarvis »). */}
        {appNative ? (
          <label className="flex items-center gap-2 text-[14px] text-muted" data-reglage-jarvis-dos>
            <Switch checked={jarvisDos} onCheckedChange={setJarvisDos} />
            {t('Toucher deux fois le dos de l’iPhone lance Jarvis')}
          </label>
        ) : null}
      </div>

      <div className="mb-3">
        <div className="mb-1 flex items-center gap-1">
          <label className="text-[12.5px] text-muted">{t('Le raccourci clavier qui ouvre {v0}', { v0: nomDeLAssistant(state.settings) })}</label>
          <BulleInfo cote="start">
            {t('Il ouvre la bulle vocale et lance la conversation, où que vous soyez, même dans un champ ; un second appui l’arrête. Trois formes au choix : des touches de contrôle seules (Ctrl + Maj), avec une lettre (Cmd + Maj + K), ou un double appui (Maj Maj, le réglage de départ). La touche Fn n’est jamais transmise aux pages web : elle ne peut pas servir.')}
          </BulleInfo>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-raccourci-ecoute
            data-raccourci={raccourci ?? AUCUN_RACCOURCI}
            onClick={() => {
              reconnaisseur.current.oublier();
              setCaptureRaccourci(true);
              setRefusRaccourci(null);
            }}
            onBlur={() => {
              setCaptureRaccourci(false);
              setRefusRaccourci(null);
            }}
            onKeyDown={(event) => surToucheRaccourci(event, 'down')}
            onKeyUp={(event) => surToucheRaccourci(event, 'up')}
            className={cn(
              'flex-1 rounded-md px-2.5 sm:px-2 py-2 sm:py-1.5 text-left text-[13.5px] transition-colors',
              captureRaccourci ? 'bg-border text-text' : 'bg-raised text-text hover:bg-fond-survol',
            )}
          >
            {captureRaccourci
              ? t('Appuyez sur les touches… (Échap pour annuler)')
              : raccourci
                ? libelleDeRaccourci(raccourci, plateforme)
                : t('Aucun — cliquer pour régler')}
          </button>
          {rangee && !captureRaccourci ? (
            <Button variant="outline" size="sm" data-raccourci-defaut onClick={() => enregistrerRaccourci('')}>
              {t('Réinitialiser')}
            </Button>
          ) : null}
          {raccourci && !captureRaccourci ? (
            <Button variant="outline" size="sm" data-raccourci-retirer onClick={() => enregistrerRaccourci(AUCUN_RACCOURCI)}>
              {t('Retirer')}
            </Button>
          ) : null}
        </div>
        {refusRaccourci ? <p className="mt-1 text-[11.5px] text-danger">{refusRaccourci}</p> : null}
        {!refusRaccourci ? (
          <p className="mt-1 text-[11.5px] text-muted">
            {t('Ctrl + Maj, Cmd + Maj + K ou Maj Maj : touches seules, avec une lettre, ou double appui. Fn ne peut pas servir.')}
          </p>
        ) : null}
      </div>
    </section>
  );
}
