import * as React from 'react';
import { Loader2 } from '@/components/ui/icones';
import {
  MARQUES,
  choixParDefaut,
  choixEffectif,
  marqueEquipable,
  navigateurDeLaMarque,
  navigateurPret,
  navigateursAProposer,
  type MarqueDeNavigateur,
  type NavigateurInstalle,
  type Ordinateur,
} from '@beluga/shared';
import { Button } from '@/components/ui';
import { CaseACocher } from '@/components/ui/elements-maison';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * LES NAVIGATEURS AU CHOIX (carte « Navigateurs facultatifs à la liaison », 22/11/2026, maquette #c3802).
 *
 * Une ligne pleine largeur par navigateur trouvé sur l'ordinateur : pastille à l'initiale, nom, la pastille « Celui où
 * vous êtes », une phrase dessous, et la case à droite. Cochés d'office ceux que Beluga sait équiper (l'automatisme
 * reste le défaut) ; décoché, « Pas pour moi » et la ligne passe en gris ; jamais éprouvé sur ce système, « Bientôt »
 * en gris, sans case. Chrome absent (Windows, Linux) : « Pas installé » et le lien pour le télécharger.
 *
 * Deux usages : l'étape « Navigateurs » du parcours (le choix part au clic « Équiper N navigateurs », ou « Continuer
 * sans navigateur »), et la page de l'ordinateur (chaque case s'applique aussitôt : cocher équipe, décocher retire le
 * module de ce navigateur).
 */

const CONNECT = ['Beluga', 'Connect'].join(' ');
/** L'orange des liens et de ce qui attend la personne. */
const ORANGE = 'hsl(var(--cadre-question))';
const TELECHARGER_CHROME = 'https://www.google.com/chrome/';

/** La marque du navigateur où l'on est, si c'est bien cet ordinateur-ci. */
export function marqueDeCetAppareil(): MarqueDeNavigateur | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  const marques = ((navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands ?? []).map((b) => b.brand);
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Edg\//.test(ua)) return 'edge';
  if (marques.some((b) => /Brave/.test(b))) return 'brave';
  if (/OPR\//.test(ua)) return 'opera';
  if (/Chrome\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return null;
}

/** L'état d'un navigateur choisi, en quelques mots (page de l'ordinateur). */
function etatDuNavigateur(o: Ordinateur, m: MarqueDeNavigateur): { texte: string; ton: 'doux' | 'attend' | 'echec' } {
  const p = o.programme;
  const prep = m === 'chrome' ? p?.preparation : m === 'safari' ? p?.safari : p?.autres?.[m];
  if (navigateurPret(o, m)) {
    const n = navigateurDeLaMarque(o, m);
    return { texte: n?.version ? t('Relié · version {v}', { v: n.version }) : t('Relié'), ton: 'doux' };
  }
  if (prep?.etat === 'en-cours') return { texte: t('{v0} l’installe…', { v0: CONNECT }), ton: 'attend' };
  if (prep?.etat === 'echec') return { texte: prep.message || t('À réparer'), ton: 'echec' };
  if (navigateurDeLaMarque(o, m)) return { texte: t('Fermé'), ton: 'doux' };
  return { texte: t('{v0} va l’équiper', { v0: CONNECT }), ton: 'doux' };
}

function phraseDe(n: NavigateurInstalle, systeme: string): string {
  if (n.marque === 'chrome') return t('Les agents y travaillent le mieux');
  if (n.marque === 'safari' && systeme === 'mac') return t('Installé avec macOS');
  if (n.version) return t('Version {v}', { v: n.version.split('.')[0] ?? n.version });
  if (n.parDefaut) return t('Navigateur par défaut');
  return t('Installé');
}

/** LA LISTE À COCHER, commune au parcours et à la page de l'ordinateur. */
function ListeDesNavigateurs({
  ordinateur,
  choisis,
  onBasculer,
  ici,
  occupe,
  avecEtat,
  fond = 'surface',
}: {
  ordinateur: Ordinateur;
  choisis: MarqueDeNavigateur[];
  onBasculer: (m: MarqueDeNavigateur, coche: boolean) => void;
  /** La marque du navigateur où l'on est, si l'on est sur cet ordinateur. */
  ici: MarqueDeNavigateur | null;
  /** Une marque dont le changement part au démon (page de l'ordinateur). */
  occupe?: MarqueDeNavigateur | null;
  /** Page de l'ordinateur : la phrase dit l'état du navigateur choisi. */
  avecEtat?: boolean;
  /** Le fond des lignes : `surface` dans un volet (`bg-raised`), `raised` dans un groupe de réglages (`bg-surface`). */
  fond?: 'surface' | 'raised';
}) {
  const ligne = cn('flex min-h-14 items-center gap-3 rounded-xl px-3 py-2.5', fond === 'raised' ? 'bg-raised' : 'bg-surface');
  const systeme = ordinateur.programme?.systeme ?? 'mac';
  const proposes = navigateursAProposer(ordinateur);
  const detection = !!ordinateur.programme?.installes;
  const chromeAbsent = detection && systeme !== 'mac' && !proposes.some((n) => n.marque === 'chrome');
  return (
    <div className="flex flex-col gap-1.5" data-liste-des-navigateurs>
      {proposes.map((n) => {
        const equipable = marqueEquipable(n.marque, systeme) || choisis.includes(n.marque);
        const coche = equipable && choisis.includes(n.marque);
        const etat = avecEtat && coche ? etatDuNavigateur(ordinateur, n.marque) : null;
        const phrase = !equipable ? t('Beluga ne sait pas encore l’équiper') : !coche ? t('Pas pour moi') : etat ? etat.texte : phraseDe(n, systeme);
        const eteint = !coche;
        return (
          <div
            key={n.marque}
            className={ligne}
            data-navigateur-propose={n.marque}
            data-etat={!equipable ? 'bientot' : coche ? 'coche' : 'decoche'}
          >
            <span
              className={cn('flex size-9 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold', eteint ? 'bg-faint/40 text-muted' : 'bg-text text-surface')}
              aria-hidden
            >
              {MARQUES[n.marque].nom.charAt(0)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex min-w-0 items-center gap-2">
                <span className={cn('shrink-0 text-[14px] font-semibold', eteint ? 'text-muted' : 'text-text')}>{MARQUES[n.marque].nom}</span>
                {ici === n.marque ? (
                  <span className={cn('min-w-0 truncate rounded-full px-2 py-0.5 text-[11.5px] text-muted', fond === 'raised' ? 'bg-surface' : 'bg-raised')} data-celui-ou-vous-etes>
                    {t('Celui où vous êtes')}
                  </span>
                ) : null}
              </span>
              <span
                className={cn('text-[12.5px] leading-snug [overflow-wrap:anywhere]', etat?.ton === 'echec' ? 'text-danger' : 'text-muted')}
                style={etat?.ton === 'attend' ? { color: ORANGE } : undefined}
                title={phrase}
              >
                {phrase}
              </span>
            </span>
            {equipable ? (
              occupe === n.marque ? (
                <Loader2 className="size-[18px] shrink-0 animate-spin text-muted" aria-hidden />
              ) : (
                <CaseACocher
                  checked={coche}
                  onCheckedChange={(v) => onBasculer(n.marque, v)}
                  disabled={!!occupe}
                  aria-label={MARQUES[n.marque].nom}
                  data-cocher-navigateur={n.marque}
                />
              )
            ) : (
              <span className="shrink-0 text-[12.5px] text-muted" data-bientot>
                {t('Bientôt')}
              </span>
            )}
          </div>
        );
      })}
      {chromeAbsent ? (
        <div className={ligne} data-navigateur-propose="chrome" data-etat="absent">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-faint/40 text-[14px] font-semibold text-muted" aria-hidden>
            C
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[14px] font-semibold text-muted">Chrome</span>
            <span className="truncate text-[12.5px] text-muted">
              {t('Pas installé')} ·{' '}
              <a href={TELECHARGER_CHROME} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: ORANGE }} data-telecharger-chrome>
                {t('Télécharger Chrome')}
              </a>
            </span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * L'ÉTAPE « NAVIGATEURS » DU PARCOURS : la phrase, la liste, « Équiper N navigateurs » et « Continuer sans navigateur ».
 * Le choix part au démon d'un clic ; l'étape se coche quand l'ordinateur revient avec son choix.
 */
export function EtapeNavigateurs({ ordinateur, ici }: { ordinateur: Ordinateur; ici: MarqueDeNavigateur | null }) {
  const [choisis, setChoisis] = React.useState<MarqueDeNavigateur[]>(() => ordinateur.navigateursChoisis ?? choixParDefaut(ordinateur));
  const [envoi, setEnvoi] = React.useState<'equiper' | 'sans' | null>(null);
  /* La détection arrive après l'ouverture de l'étape : les nouveaux navigateurs équipables se cochent d'office. */
  const vus = React.useRef(new Set(navigateursAProposer(ordinateur).map((n) => n.marque)));
  const installes = ordinateur.programme?.installes;
  React.useEffect(() => {
    const neufs = navigateursAProposer(ordinateur).filter((n) => !vus.current.has(n.marque));
    if (!neufs.length) return;
    for (const n of neufs) vus.current.add(n.marque);
    const aCocher = neufs.map((n) => n.marque).filter((m) => choixParDefaut(ordinateur).includes(m));
    if (aCocher.length) setChoisis((c) => [...c, ...aCocher.filter((m) => !c.includes(m))]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installes]);
  const systeme = ordinateur.programme?.systeme ?? 'mac';
  const nb = navigateursAProposer(ordinateur).length;
  const envoyer = async (liste: MarqueDeNavigateur[], quoi: 'equiper' | 'sans') => {
    setEnvoi(quoi);
    try {
      await client.call({ type: 'ordinateur.navigateurs', id: ordinateur.id, choisis: liste });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le geste n’a pas abouti.'));
      setEnvoi(null);
    }
  };
  const lieu = systeme === 'mac' ? t('sur ce Mac') : t('sur cet ordinateur');
  return (
    <div className="flex flex-col gap-3" data-etape-navigateurs>
      <p className="text-[13.5px] leading-relaxed text-text">
        {nb === 1
          ? t('Beluga a trouvé 1 navigateur {lieu}. Gardez-le si les agents doivent y travailler : {v0} y pose son module et le relie, tout seul.', { lieu, v0: CONNECT })
          : t('Beluga a trouvé {n} navigateurs {lieu}. Gardez ceux où les agents pourront travailler : {v0} y pose son module et le relie, tout seul.', { n: nb, lieu, v0: CONNECT })}
      </p>
      <ListeDesNavigateurs
        ordinateur={ordinateur}
        choisis={choisis}
        ici={ici}
        onBasculer={(m, v) => setChoisis((c) => (v ? [...c, m] : c.filter((x) => x !== m)))}
      />
      <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:gap-4">
        <Button variant="default" size="md" className="max-sm:w-full" onClick={() => void envoyer(choisis, 'equiper')} disabled={!!envoi || !choisis.length} data-equiper-navigateurs={choisis.length}>
          {envoi === 'equiper' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {choisis.length === 1 ? t('Équiper 1 navigateur') : t('Équiper {n} navigateurs', { n: choisis.length })}
        </Button>
        <button
          type="button"
          className="text-[13.5px] hover:underline disabled:opacity-50 max-sm:py-2"
          style={{ color: ORANGE }}
          onClick={() => void envoyer([], 'sans')}
          disabled={!!envoi}
          data-sans-navigateur
        >
          {envoi === 'sans' ? <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" /> : null}
          {t('Continuer sans navigateur')}
        </button>
      </div>
    </div>
  );
}

/**
 * LA MÊME LISTE SUR LA PAGE DE L'ORDINATEUR : chaque case s'applique aussitôt — cocher équipe ce navigateur, décocher
 * retire son module (et délie sa fiche). L'état affiché d'abord, le démon le confirme ; un refus le rétablit.
 */
export function ChoixDesNavigateursDeLaPage({ ordinateur, ici }: { ordinateur: Ordinateur; ici: MarqueDeNavigateur | null }) {
  const effectif = choixEffectif(ordinateur.navigateursChoisis, ordinateur.navigateurs) ?? [];
  const [local, setLocal] = React.useState<MarqueDeNavigateur[] | null>(null);
  const [occupe, setOccupe] = React.useState<MarqueDeNavigateur | null>(null);
  React.useEffect(() => {
    setLocal(null);
  }, [ordinateur.id, JSON.stringify(ordinateur.navigateursChoisis ?? null)]);
  const choisis = local ?? effectif;
  const basculer = async (m: MarqueDeNavigateur, v: boolean) => {
    const liste = v ? [...choisis, m] : choisis.filter((x) => x !== m);
    setLocal(liste);
    setOccupe(m);
    try {
      await client.call({ type: 'ordinateur.navigateurs', id: ordinateur.id, choisis: liste });
      client.afficherMessage(
        'info',
        v ? t('{v0} équipe {nav} : cela se suit ici.', { v0: CONNECT, nav: MARQUES[m].nom }) : t('Le module de Beluga est retiré de {nav}.', { nav: MARQUES[m].nom }),
      );
    } catch (err: any) {
      setLocal(null);
      client.pushToast('error', err?.message ?? t('Le geste n’a pas abouti.'));
    } finally {
      setOccupe(null);
    }
  };
  return (
    <div className="flex flex-col gap-2" data-choix-des-navigateurs>
      {ordinateur.navigateursChoisis === null && !effectif.length ? (
        <p className="text-[13px] leading-relaxed text-muted">{t('Aucun navigateur choisi : cochez ceux où les agents pourront travailler.')}</p>
      ) : null}
      <ListeDesNavigateurs ordinateur={ordinateur} choisis={choisis} ici={ici} occupe={occupe} avecEtat fond="raised" onBasculer={(m, v) => void basculer(m, v)} />
    </div>
  );
}
