import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config.js';
import { dansLaFileLourde } from './file-lourde.js';
import { dureeDuFichier } from './voix-de-realisation.js';
import { log } from './logger.js';

/**
 * LES BRUITAGES ET LA MUSIQUE SYNTHÉTISÉS, SANS FRAIS (Tone.js, MIT, copie
 * locale épinglée) : le script de l'agent programme des synthés dans
 * `Tone.Offline`, joué HORS TEMPS RÉEL dans un vrai Chrome (Playwright,
 * `channel: 'chrome'`, sans réseau), puis le tampon est écrit en WAV 16 bits.
 * Un son joué en direct pendant un rendu vidéo n'est jamais capturé : il se
 * fabrique donc en fichier AVANT, et se pose dans la page en `<audio>`.
 */

const TONE = () => path.join(CONFIG.selfPath, 'outils', 'bibliotheques-de-composition', 'tone', 'Tone.js');

export async function fabriquerDesSons(script: string, duree: number, sortie: string): Promise<{ ok: true; duree: number } | { ok: false; raison: string }> {
  if (!fs.existsSync(TONE())) return { ok: false, raison: 'Tone.js n’est pas posé sur ce serveur (outils/bibliotheques-de-composition/tone)' };
  return dansLaFileLourde(async () => {
    const { chromium } = await import('playwright');
    const navigateur = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    try {
      const contexte = await navigateur.newContext({ offline: true });
      const page = await contexte.newPage();
      await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
      await page.addScriptTag({ path: TONE() });
      const resultat = (await page.evaluate(
        async ({ script, duree }) => {
          const T = (globalThis as any).Tone;
          // eslint-disable-next-line no-new-func
          const programme = new Function('Tone', 'transport', script) as (t: unknown, transport: unknown) => void;
          const tampon = await T.Offline(({ transport }: { transport: unknown }) => programme(T, transport), duree);
          const audio: any = tampon.get();
          const canaux = Math.min(2, audio.numberOfChannels);
          const n = audio.length;
          const octets = 44 + n * canaux * 2;
          const vue = new DataView(new ArrayBuffer(octets));
          const ecrire = (o: number, t: string) => [...t].forEach((c, i) => vue.setUint8(o + i, c.charCodeAt(0)));
          ecrire(0, 'RIFF');
          vue.setUint32(4, octets - 8, true);
          ecrire(8, 'WAVE');
          ecrire(12, 'fmt ');
          vue.setUint32(16, 16, true);
          vue.setUint16(20, 1, true);
          vue.setUint16(22, canaux, true);
          vue.setUint32(24, audio.sampleRate, true);
          vue.setUint32(28, audio.sampleRate * canaux * 2, true);
          vue.setUint16(32, canaux * 2, true);
          vue.setUint16(34, 16, true);
          ecrire(36, 'data');
          vue.setUint32(40, n * canaux * 2, true);
          const donnees: Float32Array[] = [...Array(canaux).keys()].map((c) => audio.getChannelData(c));
          let o = 44;
          for (let i = 0; i < n; i++) {
            for (let c = 0; c < canaux; c++) {
              const v = Math.max(-1, Math.min(1, donnees[c]![i]!));
              vue.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
              o += 2;
            }
          }
          let binaire = '';
          const brut = new Uint8Array(vue.buffer);
          for (let i = 0; i < brut.length; i += 0x8000) binaire += String.fromCharCode(...brut.subarray(i, i + 0x8000));
          return btoa(binaire);
        },
        { script, duree },
      )) as string;
      fs.mkdirSync(path.dirname(sortie), { recursive: true });
      fs.writeFileSync(sortie, Buffer.from(resultat, 'base64'));
      return { ok: true as const, duree: await dureeDuFichier(sortie) };
    } catch (err: any) {
      log.warn('réalisation : sons synthétisés impossibles', err?.message);
      return { ok: false as const, raison: String(err?.message ?? err).split('\n')[0]!.slice(0, 300) };
    } finally {
      await navigateur.close().catch(() => undefined);
    }
  });
}
