/*
 * LA TABLE DE L'ÉQUIPE (décision de l'utilisateur du 26/11/2026, maquette #1ff2 « la table ») : les agents qui agissent
 * s'assoient autour d'un rectangle arrondi, répartis à pas égal (`placesAutourDeLaTable`), chacun cerné de SA couleur,
 * son prénom et ce qu'il fait dessous ; deux agents qui ont échangé dans la journée sont reliés par une COURBE en
 * dégradé de l'un à l'autre, tirée vers le centre ; « Vous » au centre, relié en pointillé (`--important`) à ceux qui
 * vous attendent. Sous la table, le BANC : « Au repos · n » et leurs visages en gris.
 *
 * « + » AU SURVOL D'UN AGENT (comme n8n, décision du 26/11/2026) : un petit bouton relié à l'agent, côté extérieur de la
 * table, qui fait naître un agent relié à lui. Un clic sur un agent ouvre sa page.
 *
 * Vingt agents et plus : les portraits rapetissent (`tailleDesPortraits`), la table grandit en hauteur et défile ; un
 * libellé ne se coupe jamais en deux lignes (une ligne, tronquée au-delà de sa place).
 */
import * as React from 'react';
import {
  controleDeLaLiaison,
  liaisonsDeLEquipe,
  placesAutourDeLaTable,
  repartirLaTable,
  tailleDesPortraits,
  type EchangeDAgents,
} from '@beluga/shared';
import { Tooltip, ZoneDefilement } from '@/components/ui';
import { Loader2, Plus } from '@/components/ui/icones';
import { PortraitDAgent } from '@/components/equipe/portrait-d-agent';
import type { MembreLu } from '@/components/equipe/use-equipe';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

const HAUTEUR_DU_BANC = 58;

function useTaille(): [React.RefCallback<HTMLDivElement>, { w: number; h: number }] {
  const [el, setEl] = React.useState<HTMLDivElement | null>(null);
  const [taille, setTaille] = React.useState({ w: 0, h: 0 });
  React.useEffect(() => {
    if (!el) return;
    const mesurer = () => setTaille({ w: el.clientWidth, h: el.clientHeight });
    mesurer();
    const o = new ResizeObserver(mesurer);
    o.observe(el);
    return () => o.disconnect();
  }, [el]);
  return [setEl, taille];
}

/** Ce que fait un agent, en une ligne sous son prénom. */
export function activiteDuMembre(m: MembreLu): string {
  if (m.etat === 'vous-attend') return m.activite ?? t('Vous attend');
  if (m.etat === 'au-travail') return m.activite ?? t('Au travail');
  return t('Au repos');
}

export function TableDeLEquipe({
  membres,
  echanges,
  onOuvrir,
  onNouveauRelie,
}: {
  membres: readonly MembreLu[];
  echanges: readonly EchangeDAgents[];
  onOuvrir: (m: MembreLu) => void;
  /** Le « + » au survol : un nouvel agent relié à celui-ci. */
  onNouveauRelie: (m: MembreLu) => Promise<void>;
}) {
  const [ref, { w, h }] = useTaille();
  const { aTable, auRepos } = React.useMemo(() => repartirLaTable(membres), [membres]);
  const [survol, setSurvol] = React.useState<string | null>(null);
  const [creation, setCreation] = React.useState<string | null>(null);
  const n = aTable.length;
  const s = tailleDesPortraits(n);
  const etroit = w < 420;
  /*
   * LA HAUTEUR DE LA TABLE : la place disponible, ou davantage quand beaucoup d'agents s'y serrent — la table grandit
   * alors et défile. Le PAS entre deux places (le contour divisé par le nombre d'agents) doit laisser au moins un
   * portrait et son libellé de deux lignes : sinon deux libellés se chevaucheraient sur les côtés.
   */
  const margeX = etroit ? 56 : 84;
  const rayon = etroit ? 60 : 90;
  const largeurDeLaTable = Math.max(80, w - 2 * margeX);
  const pasVoulu = s + 50;
  const hauteurDeLaTable = Math.max(140, (n * pasVoulu - 2 * largeurDeLaTable + 1.72 * rayon) / 2);
  const besoin = hauteurDeLaTable + s + 98;
  const hauteur = Math.max(Math.max(0, h - HAUTEUR_DU_BANC), besoin);
  const cadre = { x0: margeX, x1: margeX + largeurDeLaTable, y0: s / 2 + 46, y1: Math.max(s / 2 + 140, hauteur - s / 2 - 52), rayon };
  const places = React.useMemo(() => (w ? placesAutourDeLaTable(n, cadre) : []), [w, n, cadre.x0, cadre.x1, cadre.y0, cadre.y1, cadre.rayon]);
  const pos = new Map(aTable.map((m, i) => [m.id, places[i]]));
  const centre = { x: (cadre.x0 + cadre.x1) / 2, y: (cadre.y0 + cadre.y1) / 2 };
  const liaisons = React.useMemo(() => liaisonsDeLEquipe(echanges, new Set(aTable.map((m) => m.id)), Date.now()), [echanges, aTable]);
  const parId = new Map(aTable.map((m) => [m.id, m]));
  const attendent = aTable.filter((m) => m.etat === 'vous-attend');
  /* Un libellé tient dans le pas entre deux places (jamais moins de 84 px, jamais plus de 150). */
  const perimetre = 2 * (cadre.x1 - cadre.x0) + 2 * (cadre.y1 - cadre.y0) - 1.72 * rayon;
  const largeurLibelle = Math.min(150, Math.max(84, n ? perimetre / n - 6 : 150));

  const creerRelie = async (m: MembreLu) => {
    if (creation) return;
    setCreation(m.id);
    try {
      await onNouveauRelie(m);
    } finally {
      setCreation(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-table-de-l-equipe={n}>
      <div ref={ref} className="relative min-h-0 flex-1">
        <ZoneDefilement classeEnveloppe="absolute inset-0" className="" data-table-defile="">
          <div className="relative" style={{ height: hauteur }}>
            {w && n ? (
              <svg width={w} height={hauteur} className="pointer-events-none absolute left-0 top-0" aria-hidden data-liaisons={liaisons.length}>
                <defs>
                  {liaisons.map(([a, b], k) => {
                    const pa = pos.get(a);
                    const pb = pos.get(b);
                    if (!pa || !pb) return null;
                    return (
                      <linearGradient key={k} id={`liaison-${k}`} gradientUnits="userSpaceOnUse" x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}>
                        <stop offset="0" stopColor={parId.get(a)?.couleur} />
                        <stop offset="1" stopColor={parId.get(b)?.couleur} />
                      </linearGradient>
                    );
                  })}
                </defs>
                <rect
                  x={cadre.x0}
                  y={cadre.y0}
                  width={cadre.x1 - cadre.x0}
                  height={cadre.y1 - cadre.y0}
                  rx={cadre.rayon}
                  fill="none"
                  stroke="hsl(var(--raised))"
                  strokeWidth={1.5}
                />
                {liaisons.map(([a, b], k) => {
                  const pa = pos.get(a);
                  const pb = pos.get(b);
                  if (!pa || !pb) return null;
                  const q = controleDeLaLiaison(pa, pb, centre);
                  return (
                    <path
                      key={k}
                      d={`M${pa.x} ${pa.y} Q${q.x} ${q.y} ${pb.x} ${pb.y}`}
                      fill="none"
                      stroke={`url(#liaison-${k})`}
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      data-liaison={`${a}|${b}`}
                    />
                  );
                })}
                {attendent.map((m) => {
                  const p = pos.get(m.id);
                  if (!p) return null;
                  return (
                    <line
                      key={m.id}
                      x1={p.x}
                      y1={p.y}
                      x2={centre.x}
                      y2={centre.y}
                      stroke="hsl(var(--important))"
                      strokeWidth={1.5}
                      strokeDasharray="3 5"
                      data-ligne-vous-attend={m.id}
                    />
                  );
                })}
              </svg>
            ) : null}
            {w ? (
              <div
                className="absolute flex items-center justify-center rounded-full bg-raised text-[12.5px] font-medium text-text"
                style={{
                  left: centre.x - 25,
                  top: centre.y - 25,
                  width: 50,
                  height: 50,
                  boxShadow: attendent.length ? '0 0 0 2px hsl(var(--bg)), 0 0 0 3.5px hsl(var(--important))' : undefined,
                }}
                data-vous-au-centre={attendent.length}
              >
                {t('Vous')}
              </div>
            ) : null}
            {aTable.map((m) => {
              const p = pos.get(m.id);
              if (!p) return null;
              const enHaut = p.y <= cadre.y0 + 2;
              const dehors = { x: p.x - centre.x, y: p.y - centre.y };
              const longueur = Math.hypot(dehors.x, dehors.y) || 1;
              const plus = { x: p.x + (dehors.x / longueur) * (s / 2 + 24), y: p.y + (dehors.y / longueur) * (s / 2 + 24) };
              const vu = survol === m.id || creation === m.id;
              return (
                <React.Fragment key={m.id}>
                  <button
                    type="button"
                    onClick={() => onOuvrir(m)}
                    onMouseEnter={() => setSurvol(m.id)}
                    onMouseLeave={() => setSurvol((v) => (v === m.id ? null : v))}
                    onFocus={() => setSurvol(m.id)}
                    className="absolute rounded-full outline-none focus-visible:ring-2 focus-visible:ring-teinte"
                    style={{ left: p.x - s / 2, top: p.y - s / 2, width: s, height: s }}
                    aria-label={m.fiche.nom}
                    data-agent-a-table={m.id}
                    data-etat-du-membre={m.etat}
                  >
                    {/* À LA TABLE, CHACUN GARDE SES COULEURS ; l'anneau dit qui agit. Seul le banc passe en gris. */}
                    <PortraitDAgent portrait={m.portrait} couleur={m.couleur} nom={m.fiche.nom} taille={s} cerne={m.etat !== 'repos'} attend={m.etat === 'vous-attend'} />
                  </button>
                  <div
                    className="pointer-events-none absolute text-center"
                    style={{ left: p.x - largeurLibelle / 2, top: enHaut ? p.y - s / 2 - 40 : p.y + s / 2 + 6, width: largeurLibelle }}
                    data-libelle-a-table={m.id}
                  >
                    <span className="inline-flex max-w-full flex-col rounded-md bg-bg px-1.5 py-px">
                      <span className="truncate whitespace-nowrap text-[13px] font-semibold leading-tight text-text">{m.fiche.nom}</span>
                      <span className={cn('truncate whitespace-nowrap text-[11.5px] leading-tight', m.etat === 'vous-attend' ? 'text-important' : 'text-faint')}>
                        {activiteDuMembre(m)}
                      </span>
                    </span>
                  </div>
                  {/* LE « + » AU SURVOL, relié à l'agent par un petit trait, côté extérieur de la table. */}
                  <div
                    className={cn('absolute transition-opacity', vu ? 'opacity-100' : 'pointer-events-none opacity-0')}
                    style={{ left: plus.x - 14, top: plus.y - 14 }}
                    onMouseEnter={() => setSurvol(m.id)}
                    onMouseLeave={() => setSurvol((v) => (v === m.id ? null : v))}
                  >
                    <Tooltip label={t('Nouvel agent relié à {v0}', { v0: m.fiche.nom })}>
                      <button
                        type="button"
                        onClick={() => void creerRelie(m)}
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-raised text-text shadow-sm transition-colors hover:bg-controle-doux-survol"
                        aria-label={`Nouvel agent relié à ${m.fiche.nom}`}
                        data-plus-au-survol={m.id}
                        tabIndex={vu ? 0 : -1}
                      >
                        {creation === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                      </button>
                    </Tooltip>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </ZoneDefilement>
      </div>
      <BancDuRepos membres={auRepos} onOuvrir={onOuvrir} />
    </div>
  );
}

/** LE BANC : « Au repos · n » et les visages en gris ; un clic ouvre l'agent. */
function BancDuRepos({ membres, onOuvrir }: { membres: readonly MembreLu[]; onOuvrir: (m: MembreLu) => void }) {
  if (!membres.length) return null;
  return (
    <div className="flex shrink-0 items-center gap-3 px-5 pb-1 pt-3" style={{ minHeight: HAUTEUR_DU_BANC }} data-banc-du-repos={membres.length}>
      <span className="shrink-0 whitespace-nowrap text-[12.5px] text-faint">{t('Au repos · {v0}', { v0: membres.length })}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {membres.map((m) => (
          <Tooltip key={m.id} label={m.fiche.nom}>
            <button type="button" onClick={() => onOuvrir(m)} className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-teinte" aria-label={m.fiche.nom} data-agent-au-repos={m.id}>
              <PortraitDAgent portrait={m.portrait} couleur={m.couleur} nom={m.fiche.nom} taille={28} gris />
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
