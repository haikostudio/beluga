/**
 * LES VOIX GEMINI — troisième moteur de synthèse, À CÔTÉ de Piper et Kokoro.
 *
 * Piper reste la voix par défaut : il tourne sur le serveur, sans réseau ni
 * coût. Une voix Gemini se nomme « gemini:<voix> » et part chez Google avec la
 * clé « Google Gemini API » du coffre. Si Google refuse (clé absente, quota,
 * réseau), le serveur retombe sur Piper — jamais de silence.
 *
 * Tout ce qui se décide sans réseau vit ici : la liste des voix proposées, la
 * consigne de débit, et la mise en WAV du son rendu.
 */

export const PREFIXE_VOIX_GEMINI = 'gemini:';

/** Le modèle de synthèse, vérifié ouvert par la clé du coffre le 28/09/2026. */
export const MODELE_TTS_GEMINI = 'gemini-3.8-flash-tts';

export const URL_TTS_GEMINI = `https://generativelanguage.googleapis.com/v1beta/models/${MODELE_TTS_GEMINI}:generateContent`;

/**
 * Les voix proposées : quatre des voix préenregistrées de Google, deux de femme
 * et deux d'homme. Elles parlent français d'elles-mêmes — la langue suit le
 * texte. La liste est COURTE exprès : trente voix noieraient le réglage.
 */
export const VOIX_GEMINI: Readonly<Record<string, { label: string; description: string }>> = {
  Kore: { label: 'Kore', description: 'Voix de femme, ferme et claire. Moteur Gemini, chez Google.' },
  Aoede: { label: 'Aoede', description: 'Voix de femme, légère et aérée. Moteur Gemini, chez Google.' },
  Charon: { label: 'Charon', description: 'Voix d\'homme, posée et informative. Moteur Gemini, chez Google.' },
  Puck: { label: 'Puck', description: 'Voix d\'homme, enjouée. Moteur Gemini, chez Google.' },
};

/** Le nom de la voix Gemini d'un identifiant de réglage, ou null s'il n'en est pas une connue. */
export function voixGeminiDeLId(id: string): string | null {
  if (!id.startsWith(PREFIXE_VOIX_GEMINI)) return null;
  const voix = id.slice(PREFIXE_VOIX_GEMINI.length);
  return Object.prototype.hasOwnProperty.call(VOIX_GEMINI, voix) ? voix : null;
}

/**
 * Gemini n'a pas de réglage de débit : on le lui DIT, en tête du texte. Même
 * échelle que Piper (> 1 ralentit, < 1 accélère) ; au débit normal, le texte
 * part nu.
 */
export function texteGeminiAvecDebit(texte: string, echelle: number): string {
  if (echelle > 1.1) return `Lis lentement, en détachant chaque mot : ${texte}`;
  if (echelle < 0.9) return `Lis d'un débit rapide et enlevé : ${texte}`;
  return texte;
}

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

export function texteVoixFinaleStudio(texte: string): string {
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
