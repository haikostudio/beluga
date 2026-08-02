import * as React from 'react';
import { Check, Loader2, Mic, Trash2 } from 'lucide-react';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';

/**
 * La dictée (PLAN §21). Au repos : un simple bouton micro, juste à gauche du
 * bouton d'envoi. Pendant l'enregistrement : un bandeau bleu pleine largeur,
 * animé par ce que capte le micro, avec valider et jeter à droite.
 * Le texte est DÉPOSÉ dans le champ — rien n'est jamais envoyé tout seul.
 */

const BARRES = 28;

export function useRecorder(onText: (text: string) => void) {
  const [recording, setRecording] = React.useState(false);
  const [working, setWorking] = React.useState(false);
  const [levels, setLevels] = React.useState<number[]>(() => new Array(BARRES).fill(0));
  const [seconds, setSeconds] = React.useState(0);

  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const audioRef = React.useRef<{ context: AudioContext; raf: number } | null>(null);
  const timerRef = React.useRef<number | null>(null);

  const stopMeter = React.useCallback(() => {
    if (audioRef.current) {
      cancelAnimationFrame(audioRef.current.raf);
      void audioRef.current.context.close();
      audioRef.current = null;
    }
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setLevels(new Array(BARRES).fill(0));
    setSeconds(0);
  }, []);

  const start = React.useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => event.data.size && chunksRef.current.push(event.data);
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setSeconds(0);
      timerRef.current = window.setInterval(() => setSeconds((value) => value + 1), 1000);

      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const loop = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const value of data) peak = Math.max(peak, Math.abs(value - 128) / 128);
        // Les barres défilent : la plus récente entre à droite.
        setLevels((current) => [...current.slice(1), Math.min(1, peak * 2.4)]);
        const raf = requestAnimationFrame(loop);
        if (audioRef.current) audioRef.current.raf = raf;
      };
      audioRef.current = { context, raf: requestAnimationFrame(loop) };
    } catch {
      client.pushToast('error', 'Micro indisponible dans ce navigateur');
    }
  }, []);

  const finish = React.useCallback(
    async (keep: boolean) => {
      const recorder = recorderRef.current;
      if (!recorder) return;
      const stream = recorder.stream;
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
      stream.getTracks().forEach((track) => track.stop());
      stopMeter();
      setRecording(false);
      recorderRef.current = null;

      if (!keep) {
        chunksRef.current = [];
        return;
      }

      setWorking(true);
      try {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const response = await fetch('/api/transcribe', {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream', 'x-audio-ext': 'webm' },
          body: blob,
        });
        const data = await response.json();
        if (data.ok && data.text) onText(data.text);
        else client.pushToast('warning', data.error ?? 'transcription vide');
      } catch {
        client.pushToast('error', 'transcription impossible');
      } finally {
        setWorking(false);
        chunksRef.current = [];
      }
    },
    [onText, stopMeter],
  );

  return { recording, working, levels, seconds, start, finish };
}

/** Le bouton au repos, à placer juste à gauche du bouton d'envoi. */
export function MicButton({
  onStart,
  working,
  disabled,
}: {
  onStart: () => void;
  working: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onStart}
      disabled={working || disabled}
      title="Dicter"
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-text disabled:opacity-40"
    >
      {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mic className="h-3.5 w-3.5" />}
    </button>
  );
}

/** Le bandeau d'enregistrement : pleine largeur, bleu, contenu en blanc. */
export function RecordingBar({
  levels,
  seconds,
  onValidate,
  onDiscard,
}: {
  levels: number[];
  seconds: number;
  onValidate: () => void;
  onDiscard: () => void;
}) {
  const minutes = Math.floor(seconds / 60);
  const reste = seconds % 60;

  return (
    <div className="flex w-full items-center gap-2 rounded-lg bg-record px-2.5 py-2 text-record-fg animate-slide-up">
      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-record-fg/25 animate-pulse-soft" />
        <Mic className="relative h-3 w-3" />
      </span>

      <span className="shrink-0 font-mono text-[13px] tabular-nums">
        {minutes}:{String(reste).padStart(2, '0')}
      </span>

      {/* L'onde occupe toute la largeur disponible et suit la voix captée. */}
      <div className="flex h-6 min-w-0 flex-1 items-center gap-[2px]" aria-hidden>
        {levels.map((level, index) => (
          <span
            key={index}
            className="flex-1 rounded-full bg-record-fg/80 transition-[height] duration-75"
            style={{ height: `${Math.max(10, Math.round(level * 100))}%` }}
          />
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onValidate}
          title="Valider et transcrire"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-record-fg/15 transition-colors hover:bg-record-fg/30"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onDiscard}
          title="Jeter l'enregistrement"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-record-fg/20"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
