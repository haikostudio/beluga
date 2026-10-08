import * as React from 'react';

/**
 * LA FORME D'ONDE RÉELLE D'UN FICHIER (son, voix, piste son d'une vidéo),
 * commune à la fenêtre d'édition d'un élément et aux blocs de la ligne de temps.
 *
 * Le fichier est décodé DANS LE NAVIGATEUR, à 8 000 Hz (assez pour une onde,
 * huit fois plus léger qu'à 44,1 kHz : une musique de cinq minutes tient en une
 * vingtaine de mégaoctets le temps du calcul), réduit à des pics réguliers
 * (50 par seconde, 12 000 au plus), puis gardé par adresse le temps de la
 * session : chaque bloc qui montre le même fichier réutilise le même calcul.
 * Les pics sont ramenés au plus fort du fichier ENTIER : deux morceaux d'un même
 * son se comparent à l'œil.
 */

export interface Onde {
  /** Pics de 0 à 1, à intervalle régulier sur le fichier. */
  pics: Float32Array;
  /** Durée du fichier, en secondes. */
  duree: number;
}

const ONDES = new Map<string, Promise<Onde>>();
const PICS_PAR_SECONDE = 50;
const PICS_MAX = 12_000;
/** Au-delà, le fichier n'est pas téléchargé pour son onde (une longue vidéo). */
const OCTETS_MAX = 150 * 1024 * 1024;

/** Le fichier n'a pas de piste son (une vidéo muette) : l'écran le dit, sans parler de panne. */
export class SansSon extends Error {}

export function chargerOnde(url: string): Promise<Onde> {
  const deja = ONDES.get(url);
  if (deja) return deja;
  const travail = (async () => {
    const reponse = await fetch(url);
    if (!reponse.ok) throw new Error(String(reponse.status));
    if (Number(reponse.headers.get('content-length') ?? 0) > OCTETS_MAX) throw new Error('fichier trop lourd');
    const octets = await reponse.arrayBuffer();
    const contexte = new OfflineAudioContext(1, 1, 8000);
    let son: AudioBuffer;
    try {
      son = await contexte.decodeAudioData(octets);
    } catch {
      throw new SansSon();
    }
    const canal = son.getChannelData(0);
    const nombre = Math.max(1, Math.min(PICS_MAX, Math.round(son.duration * PICS_PAR_SECONDE)));
    const pas = canal.length / nombre;
    const pics = new Float32Array(nombre);
    let max = 0;
    for (let i = 0; i < nombre; i++) {
      let p = 0;
      const fin = Math.min(canal.length, Math.round((i + 1) * pas));
      for (let k = Math.round(i * pas); k < fin; k++) {
        const v = Math.abs(canal[k]!);
        if (v > p) p = v;
      }
      pics[i] = p;
      if (p > max) max = p;
    }
    if (max > 0) for (let i = 0; i < nombre; i++) pics[i] = pics[i]! / max;
    return { pics, duree: son.duration };
  })();
  ONDES.set(url, travail);
  travail.catch(() => ONDES.delete(url));
  return travail;
}

/** L'onde d'une adresse, chargée à la demande (rien tant que `actif` est faux). */
export function useOnde(url: string | undefined, actif = true): { onde: Onde | null; panne: 'sans-son' | 'illisible' | null } {
  const [etat, setEtat] = React.useState<{ url?: string; onde: Onde | null; panne: 'sans-son' | 'illisible' | null }>({ onde: null, panne: null });
  React.useEffect(() => {
    if (!url || !actif) return;
    let vivant = true;
    chargerOnde(url)
      .then((onde) => vivant && setEtat({ url, onde, panne: null }))
      .catch((err) => vivant && setEtat({ url, onde: null, panne: err instanceof SansSon ? 'sans-son' : 'illisible' }));
    return () => {
      vivant = false;
    };
  }, [url, actif]);
  return etat.url === url ? { onde: etat.onde, panne: etat.panne } : { onde: null, panne: null };
}

/**
 * LE DESSIN d'un passage [de, a] (secondes du fichier) en `colonnes` barres
 * verticales symétriques, en UN seul tracé SVG (un bloc de la ligne de temps
 * peut en compter des centaines : jamais un élément par barre).
 */
export function FormeDOnde({
  onde,
  de,
  a,
  colonnes,
  className,
}: {
  onde: Onde;
  de: number;
  a: number;
  colonnes: number;
  className?: string;
}) {
  const n = Math.max(1, Math.min(4000, Math.round(colonnes)));
  const chemin = React.useMemo(() => {
    const { pics, duree } = onde;
    const parSeconde = pics.length / Math.max(0.001, duree);
    const morceaux: string[] = [];
    for (let i = 0; i < n; i++) {
      const t0 = de + ((a - de) * i) / n;
      const t1 = de + ((a - de) * (i + 1)) / n;
      const k0 = Math.max(0, Math.floor(t0 * parSeconde));
      const k1 = Math.min(pics.length, Math.max(k0 + 1, Math.ceil(t1 * parSeconde)));
      let p = 0;
      for (let k = k0; k < k1; k++) if (pics[k]! > p) p = pics[k]!;
      if (k0 >= pics.length) p = 0;
      const h = Math.max(2, p * 92);
      morceaux.push(`M${i + 0.1} ${(50 - h / 2).toFixed(1)}h0.8v${h.toFixed(1)}h-0.8z`);
    }
    return morceaux.join('');
  }, [onde, de, a, n]);
  return (
    <svg className={className} viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden data-studio-onde={n}>
      <path d={chemin} fill="currentColor" />
    </svg>
  );
}
