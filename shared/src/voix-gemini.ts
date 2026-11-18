/**
 * LES VOIX GEMINI DU STUDIO (voix off des vidéos). La voix parlante de Beluga, qui pouvait aussi passer par Gemini,
 * a été retirée le 17/11/2026 : ne restent ici que le modèle, l'accent imposé et la mise en WAV du son rendu.
 */

/** Le modèle de synthèse, vérifié ouvert par la clé du coffre le 28/09/2026. */
export const MODELE_TTS_GEMINI = 'gemini-3.8-flash-tts';


/**
 * L'ACCENT DE LA VOIX FINALE DU STUDIO : une balise entre crochets en tête
 * d'appel. Gemini TTS la suit sans la PRONONCER (vérifié le 07/10/2026 : la
 * transcription Whisper de la prise commence par le texte, pas par la balise) ;
 * une consigne en toutes lettres, elle, serait lue. Les paramètres de langue
 * d'OpenRouter (`language`, `language_code`) sont acceptés puis ignorés. La
 * balise n'est qu'une ceinture : la vraie garde contre un accent qui change
 * d'une phrase à l'autre, c'est la PRISE UNIQUE (un seul appel pour toute la
 * vidéo, voir `produireVoixFinales`), car chaque appel tire son propre timbre.
 */
export const BALISE_ACCENT_FRANCE = '[French from France]';

export function texteDeVoixFinale(texte: string): string {
  return `${BALISE_ACCENT_FRANCE} ${texte}`;
}

/**
 * Le son rendu par Google, toujours en WAV. Il arrive soit déjà en WAV
 * (« audio/wav »), soit en PCM brut (« audio/L16;codec=pcm;rate=24000 ») : ce
 * dernier reçoit son entête WAV, mono 16 bits, à la fréquence annoncée.
 */
export function sonGeminiEnWav(donnees: Uint8Array, typeMime: string): Uint8Array {
  const riff = donnees.length >= 12 && String.fromCharCode(...donnees.subarray(0, 4)) === 'RIFF';
  if (riff) return donnees;
  const frequence = Number(/rate=(\d+)/i.exec(typeMime)?.[1] ?? 24000) || 24000;
  const entete = new DataView(new ArrayBuffer(44));
  const ecrire = (position: number, texte: string) => {
    for (let i = 0; i < texte.length; i++) entete.setUint8(position + i, texte.charCodeAt(i));
  };
  ecrire(0, 'RIFF');
  entete.setUint32(4, 36 + donnees.length, true);
  ecrire(8, 'WAVE');
  ecrire(12, 'fmt ');
  entete.setUint32(16, 16, true);
  entete.setUint16(20, 1, true); // PCM
  entete.setUint16(22, 1, true); // mono
  entete.setUint32(24, frequence, true);
  entete.setUint32(28, frequence * 2, true);
  entete.setUint16(32, 2, true);
  entete.setUint16(34, 16, true);
  ecrire(36, 'data');
  entete.setUint32(40, donnees.length, true);
  const sortie = new Uint8Array(44 + donnees.length);
  sortie.set(new Uint8Array(entete.buffer), 0);
  sortie.set(donnees, 44);
  return sortie;
}
