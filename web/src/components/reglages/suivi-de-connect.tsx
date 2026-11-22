/*
 * LE SUIVI DE BELUGA CONNECT DANS BELUGA (carte « Liaison Chrome automatique et suivie », 22/11/2026).
 *
 * Décisions de l'utilisateur :
 *  - PENDANT L'INSTALLATION SEULEMENT, la fenêtre de connexion (le parcours de Réglages › Ordinateurs) s'ouvre TOUTE
 *    SEULE, et UNIQUEMENT dans le navigateur de l'ordinateur concerné : celui où « Lier » (ligne « Ajouter cet ordinateur ») a été
 *    cliqué (marque locale posée au clic, `noterLaConnexionEnCours`), l'ordinateur étant reconnu par
 *    `ordinateurReconnu` (relié après le code émis au clic). Ses étapes se cochent en direct ; elle se referme seule
 *    quelques secondes après la dernière coche, reste ouverte sur un échec, et la marque s'efface (fermée à la main
 *    comme réussie) : elle ne se rouvre jamais à chaque rechargement. Déjà affiché dans la page : rien ne s'ouvre.
 *  - LES AUTRES TRAVAUX (mise à jour de l'extension, réparation, navigation privée) s'annoncent par un message passager
 *    d'INFORMATION, posé par `afficherMessage` (le juge des alertes tait « info » et « success » ; ce message-ci est
 *    voulu par l'utilisateur) — ni cloche, ni triangle, ni notification système (trois genres alertent). La fin
 *    d'une mise à jour est déjà dite par la bande neutre (`banniere-extension.tsx`) : pas de second message.
 */
import * as React from 'react';
import { ordinateurReconnu, type EtatDeLExtension, type RetardDExtension } from '@beluga/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { ordinateurPret, ParcoursDeConnexion, useNavigateurCourant, type DepartDuParcours } from './assistant-installation';

const CLE_DE_LA_MARQUE = 'beluga.connexion-en-cours';
/** Une installation commencée il y a plus de deux heures n'ouvre plus rien. */
const MARQUE_VALABLE_MS = 2 * 3600_000;
const FERMER_APRES_MS = 4_000;

/** Posée au clic « Lier » : CE navigateur est celui de l'ordinateur qu'on installe. */
export function noterLaConnexionEnCours(codeEmisLe: number): void {
  try {
    localStorage.setItem(CLE_DE_LA_MARQUE, JSON.stringify({ codeEmisLe }));
  } catch {
    /* navigation privée stricte : la fenêtre ne s'ouvrira pas seule, la page suffit */
  }
}

function lireLaMarque(): { codeEmisLe: number } | null {
  try {
    const m = JSON.parse(localStorage.getItem(CLE_DE_LA_MARQUE) ?? 'null') as { codeEmisLe?: unknown } | null;
    if (!m || typeof m.codeEmisLe !== 'number' || Date.now() - m.codeEmisLe > MARQUE_VALABLE_MS) return null;
    return { codeEmisLe: m.codeEmisLe };
  } catch {
    return null;
  }
}

function effacerLaMarque(): void {
  try {
    localStorage.removeItem(CLE_DE_LA_MARQUE);
  } catch {
    /* rien */
  }
}

type Retard = RetardDExtension & { enCours: boolean };

export function SuiviDeConnect() {
  const [etat, setEtat] = React.useState<EtatDeLExtension | null>(null);
  const [retards, setRetards] = React.useState<Retard[]>([]);
  const [ouverte, setOuverte] = React.useState<string | null>(null);
  const navigateurId = useNavigateurCourant();
  const lire = React.useCallback(async () => {
    try {
      const [e, r] = await Promise.all([
        client.call<EtatDeLExtension>({ type: 'extension.etat' }),
        client.call<{ retards: Retard[] }>({ type: 'extension.retards' }).catch(() => ({ retards: [] as Retard[] })),
      ]);
      setEtat(e);
      setRetards(r.retards ?? []);
    } catch {
      /* compte sans ordinateur, ou hors ligne : rien à suivre */
    }
  }, []);
  React.useEffect(() => {
    void lire();
    return client.onExtension(() => void lire());
  }, [lire]);

  /* LA FENÊTRE DE L'INSTALLATION : seulement avec la marque de CE navigateur, sur l'ordinateur qu'elle désigne. */
  const marque = lireLaMarque();
  const vise = etat && marque ? ordinateurReconnu(etat.ordinateurs, { navigateurId, codeEmisLe: marque.codeEmisLe }) : null;
  const pret = !!vise && ordinateurPret(vise);
  React.useEffect(() => {
    if (!vise || ouverte === vise.id || pret) return;
    /* Le parcours est déjà sous les yeux (Réglages › Ordinateurs) : pas de seconde fenêtre par-dessus. */
    if (document.querySelector('[data-parcours-installation]:not([data-suivi-de-connect] *)')) return;
    setOuverte(vise.id);
  }, [vise, ouverte, pret]);
  React.useEffect(() => {
    if (!ouverte || !pret) return;
    const minuteur = window.setTimeout(() => {
      effacerLaMarque();
      setOuverte(null);
    }, FERMER_APRES_MS);
    return () => window.clearTimeout(minuteur);
  }, [ouverte, pret]);
  const fermer = () => {
    effacerLaMarque();
    setOuverte(null);
  };
  const depart = React.useMemo<DepartDuParcours>(() => ({ n: 0, mode: 'attendre' }), []);

  /* LES AUTRES TRAVAUX : un message d'information au début et à la fin, jamais au premier chargement. */
  const precedents = React.useRef<Map<string, string> | null>(null);
  React.useEffect(() => {
    if (!etat) return;
    const maintenant = new Map<string, string>();
    for (const o of etat.ordinateurs) {
      const p = o.programme?.preparation;
      if (p && p.travail && p.travail !== 'installation') maintenant.set(`prep:${o.id}`, `${p.travail}:${p.etat}`);
    }
    for (const r of retards) if (r.enCours) maintenant.set(`maj:${r.chromeId}`, 'mise-a-jour:en-cours');
    const avant = precedents.current;
    precedents.current = maintenant;
    if (!avant) return;
    for (const o of etat.ordinateurs) {
      if (o.id === ouverte) continue;
      const cle = `prep:${o.id}`;
      const v = maintenant.get(cle);
      if (!v || v === avant.get(cle)) continue;
      const [travail, issue] = v.split(':');
      const nom = o.nom;
      if (issue === 'en-cours') {
        client.afficherMessage(
          'info',
          travail === 'prive'
            ? t('Beluga Connect autorise l’extension en navigation privée sur « {nom} »…', { nom })
            : t('Beluga Connect répare Chrome sur « {nom} »…', { nom }),
        );
      } else if (avant.get(cle)?.endsWith(':en-cours')) {
        if (issue === 'fait') client.afficherMessage('success', t('Beluga Connect a terminé sur « {nom} » : Chrome est prêt.', { nom }));
        else client.afficherMessage('info', t('Beluga Connect n’a pas tout fait sur « {nom} » : voyez Réglages › Ordinateurs.', { nom }));
      }
    }
    for (const r of retards) {
      if (!r.enCours || avant.has(`maj:${r.chromeId}`)) continue;
      const nom = etat.ordinateurs.find((o) => o.id === r.ordinateurId)?.nom ?? r.nom;
      client.afficherMessage('info', t('Beluga Connect met à jour l’extension Chrome sur « {nom} »…', { nom }));
    }
  }, [etat, retards, ouverte]);

  const cible = etat?.ordinateurs.find((o) => o.id === ouverte) ?? null;
  if (!etat || !cible) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && fermer()}>
      {/* Aucun focus d'office : il encadrait la première étape et faisait glisser le contenu sous le titre, coupé en
          haut (capture #a2a1, carte « Beluga Connect : liaison et suivi »). */}
      <DialogContent adresse="connexion-en-cours" className="sm:w-[min(620px,100%)]" data-suivi-de-connect={cible.id} onOpenAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('Connexion de « {nom} »', { nom: cible.nom })}</DialogTitle>
        </DialogHeader>
        <div className="pb-1">
          <ParcoursDeConnexion etat={etat} depart={depart} ordinateurVise={cible.id} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
