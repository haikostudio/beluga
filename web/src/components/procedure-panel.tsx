import * as React from 'react';
import { Loader2, Settings2, Sparkles, Check, X } from 'lucide-react';
import {
  CiblePublication,
  libelleInitier,
  libelleReglages,
  procedureDeLEtape,
  titreDeLaProcedure,
} from '@haikodev/shared';
import { Button, Drawer, Textarea, Tooltip, ZoneDefilement } from '@/components/ui';
import { Markdown } from '@/lib/markdown';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';

/**
 * LE TIROIR QUI DÉFINIT UNE PROCÉDURE DE MISE EN LIGNE.
 *
 * Il s'ouvre de deux endroits, et c'est le MÊME tiroir : le bouton « Initier
 * le… » posé en tête de la colonne tant qu'aucune procédure n'existe, et
 * l'icône de réglages du haut de la colonne une fois qu'il y en a une.
 *
 * Dedans, un agent : il ouvre en DEMANDANT comment cette étape doit se passer
 * pour ce projet, on lui répond en une phrase, il écrit la procédure et le
 * serveur l'enregistre — sur la cible de la colonne d'où l'on vient, jamais sur
 * l'autre. Chaque tour est un tour d'agent payant : rien ne part tout seul, ni
 * à l'ouverture d'un projet, ni en fond.
 */

type Bulle = { qui: 'agent' | 'moi'; texte: string };

export function TiroirProcedure({
  projectId,
  cible,
  open,
  onClose,
}: {
  projectId: string;
  cible: CiblePublication | null;
  open: boolean;
  onClose: () => void;
}) {
  const state = useApp();
  const projet = state.projects.find((p) => p.id === projectId);
  const [bulles, setBulles] = React.useState<Bulle[]>([]);
  const [agentId, setAgentId] = React.useState<string | undefined>();
  const [saisie, setSaisie] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [erreur, setErreur] = React.useState<string | null>(null);
  /* La procédure écrite au dernier tour : elle est DÉJÀ enregistrée quand elle
     paraît ici — on la montre pour qu'on puisse la lire, pas pour la valider. */
  const [ecrite, setEcrite] = React.useState<string | null>(null);

  const actuelle = cible ? procedureDeLEtape(projet, cible) : '';

  /*
   * L'OUVERTURE lance le premier tour : l'agent lit le projet et pose sa
   * question. On repart de zéro à chaque ouverture — une session gardée d'une
   * fois sur l'autre relirait un projet qui a changé entre-temps.
   */
  React.useEffect(() => {
    if (!open || !cible) return;
    let vivant = true;
    setBulles([]);
    setAgentId(undefined);
    setEcrite(null);
    setErreur(null);
    setSaisie('');
    setBusy(true);
    client
      .call({ type: 'procedure.tour', projectId, cible })
      .then((res: any) => {
        if (!vivant) return;
        setAgentId(res?.agentId);
        if (res?.ok && res.question) setBulles([{ qui: 'agent', texte: res.question }]);
        else if (!res?.ok) setErreur(res?.raison ?? 'l’agent n’a pas répondu');
      })
      .catch((err: any) => {
        if (vivant) setErreur(err?.message ?? 'l’agent n’a pas répondu');
      })
      .finally(() => {
        if (vivant) setBusy(false);
      });
    return () => {
      vivant = false;
    };
  }, [open, cible, projectId]);

  if (!cible) return null;

  const envoyer = async () => {
    const message = saisie.trim();
    if (!message || busy) return;
    setBulles((prev) => [...prev, { qui: 'moi', texte: message }]);
    setSaisie('');
    setBusy(true);
    setErreur(null);
    try {
      const res: any = await client.call({ type: 'procedure.tour', projectId, cible, agentId, message });
      setAgentId(res?.agentId ?? agentId);
      if (!res?.ok) setErreur(res?.raison ?? 'l’agent n’a pas répondu');
      else if (res.procedure) {
        setEcrite(res.procedure);
        setBulles((prev) => [...prev, { qui: 'agent', texte: 'La procédure est écrite et enregistrée.' }]);
      } else if (res.question) setBulles((prev) => [...prev, { qui: 'agent', texte: res.question }]);
    } catch (err: any) {
      setErreur(err?.message ?? 'l’agent n’a pas répondu');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open={open} onClose={onClose}>
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4" data-tiroir-procedure={cible}>
        <h2 className="shrink-0 text-[15px] font-medium text-text">
          {titreDeLaProcedure(cible)} — {actuelle ? 'modifier la procédure' : 'définir la procédure'}
        </h2>
        <p className="mt-1 shrink-0 text-[12.5px] text-faint">
          Un agent lit le projet, demande comment cette étape doit se passer, puis écrit la procédure. Elle ne
          vaut que pour cette colonne.
        </p>

        <ZoneDefilement classeEnveloppe="mt-3 min-h-0 flex-1" className="space-y-2 pr-1">
          {/* La procédure DÉJÀ en place, quand on rouvre pour la modifier. */}
          {actuelle && !ecrite ? (
            <div className="rounded-md border border-border bg-raised p-2.5" data-procedure-actuelle>
              <p className="mb-1 text-[12px] uppercase tracking-wide text-faint">Procédure en place</p>
              <div className="whitespace-pre-wrap text-[13px] text-muted">{actuelle}</div>
            </div>
          ) : null}

          {bulles.map((bulle, i) => (
            <div
              key={i}
              className={
                bulle.qui === 'agent'
                  ? 'rounded-md border border-border bg-raised p-2.5 text-[13px] text-text'
                  : 'ml-8 rounded-md border border-border/60 bg-surface p-2.5 text-[13px] text-muted'
              }
              data-bulle-procedure={bulle.qui}
            >
              {bulle.qui === 'agent' ? <Markdown content={bulle.texte} /> : bulle.texte}
            </div>
          ))}

          {busy ? (
            <p className="flex items-center gap-1.5 text-[12.5px] text-faint" data-procedure-en-cours>
              <Loader2 className="h-3 w-3 animate-spin" /> L’agent travaille…
            </p>
          ) : null}

          {erreur ? (
            <p className="flex items-start gap-1.5 text-[12.5px] text-danger" data-erreur-procedure>
              <X className="mt-[3px] h-3 w-3 shrink-0" />
              <span>{erreur}</span>
            </p>
          ) : null}

          {ecrite ? (
            <div className="rounded-md border border-success/40 bg-raised p-2.5" data-procedure-ecrite>
              <p className="mb-1 flex items-center gap-1.5 text-[12px] uppercase tracking-wide text-success">
                <Check className="h-3 w-3" /> Enregistrée
              </p>
              <div className="whitespace-pre-wrap text-[13px] text-muted">{ecrite}</div>
            </div>
          ) : null}
        </ZoneDefilement>

        <div className="mt-3 shrink-0 space-y-2">
          <Textarea
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            rows={3}
            placeholder="Répondez à l’agent : comment cette mise en ligne doit-elle se passer ?"
            data-reponse-procedure
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void envoyer();
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Fermer
            </Button>
            <Button size="sm" disabled={busy || !saisie.trim()} onClick={() => void envoyer()} data-envoyer-procedure>
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Envoyer
            </Button>
          </div>
        </div>
      </div>
    </Drawer>
  );
}

/**
 * L'ICÔNE DE RÉGLAGES, en haut à DROITE de la colonne, une fois la procédure en
 * place. Elle rouvre le même tiroir pour la modifier — et ne paraît pas tant
 * qu'il n'y a rien à modifier : c'est le bouton « Initier… » qui tient alors sa
 * place, en tête de la colonne.
 */
export function BoutonReglagesProcedure({
  cible,
  onOuvrir,
}: {
  cible: CiblePublication;
  onOuvrir: () => void;
}) {
  return (
    <Tooltip label={libelleReglages(cible)}>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 shrink-0 px-1.5 text-faint"
        aria-label={libelleReglages(cible)}
        data-reglages-procedure={cible}
        onClick={onOuvrir}
      >
        <Settings2 className="h-4 w-4" />
      </Button>
    </Tooltip>
  );
}

/**
 * LE BOUTON « INITIER… », posé là où vit d'habitude le bouton d'action, tant
 * qu'aucune procédure n'existe pour cette étape. Il tient toute la largeur : à
 * cet endroit, il n'y a rien d'autre à faire dans cette colonne.
 */
export function BoutonInitierProcedure({
  cible,
  onOuvrir,
}: {
  cible: CiblePublication;
  onOuvrir: () => void;
}) {
  return (
    <Button size="sm" className="w-full" data-initier-procedure={cible} onClick={onOuvrir}>
      <Sparkles className="h-3 w-3 shrink-0" />
      <span className="truncate">{libelleInitier(cible)}</span>
    </Button>
  );
}
