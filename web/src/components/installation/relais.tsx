import * as React from 'react';
import { CheckCircle2, Loader2, MessageSquare, RefreshCw, Send } from 'lucide-react';
import type { TicketRendu } from '@beluga/shared';
import { Button, Input, Textarea } from '@/components/ui';
import { Champ } from '@/components/card-panel';
import { ChoixEnLignes, useIdentite } from '@/components/installation/sections';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * L'ÉQUIPE BELUGA, VUE D'UNE INSTALLATION (`server/src/relais-installations.ts`).
 *
 * Deux choses, décidées par l'utilisateur le 20/10/2026 :
 *  - L'ACCORD : chaque installation se signale une fois par jour (numéro,
 *    version, pays) ; l'adresse de l'administrateur n'y part QUE s'il dit oui.
 *  - LES TICKETS : « Contacter l'équipe Beluga » écrit à l'auteur, qui répond
 *    depuis sa messagerie ; les réponses se relisent ici.
 * Rien de cela n'existe sur la machine de l'auteur ni sur un démon d'essai sans
 * relais : l'état du relais (`/api/relais/etat`) le dit.
 */

export interface EtatDuRelais {
  joint: boolean;
  recepteur: boolean;
  hebergee: boolean;
  dernierSigne?: number;
  erreur?: string;
}

/** L'état du relais sur cette installation ; `null` tant qu'il n'est pas lu. */
export function useEtatDuRelais(): EtatDuRelais | null {
  const [etat, setEtat] = React.useState<EtatDuRelais | null>(null);
  React.useEffect(() => {
    let vivant = true;
    fetch('/api/relais/etat')
      .then((r) => (r.ok ? r.json() : null))
      .then((corps) => vivant && setEtat(corps))
      .catch(() => vivant && setEtat(null));
    return () => {
      vivant = false;
    };
  }, []);
  return etat;
}

/** Oui ou non : l'adresse de l'administrateur part-elle avec le signe de vie ? */
export function SectionPartage() {
  const { identite, enregistrer } = useIdentite();
  return (
    <div className="space-y-3" data-section-installation="partage">
      <p className="text-[13.5px] leading-relaxed text-muted">
        {t('Une fois par jour, cette installation dit à l’équipe Beluga qu’elle fonctionne : un numéro tiré au hasard, sa version et son pays. Rien de votre travail ne part, jamais.')}
      </p>
      <ChoixEnLignes<'oui' | 'non'>
        repere="partage-du-courriel"
        valeur={identite.partageDuCourriel}
        choix={[
          {
            id: 'oui',
            nom: t('Partager aussi mon adresse de courriel'),
            detail: t('L’équipe Beluga sait qui utilise son outil et peut vous prévenir d’une nouveauté importante.'),
          },
          {
            id: 'non',
            nom: t('Rester anonyme'),
            detail: t('Seuls le numéro, la version et le pays partent.'),
          },
        ]}
        onChoisir={(id) => enregistrer({ partageDuCourriel: id })}
      />
    </div>
  );
}

/** Le ticket et ses réponses, tels que l'installation les relit. */
function UnTicket({ ticket }: { ticket: TicketRendu }) {
  return (
    <li data-ticket={ticket.id} data-ticket-etat={ticket.etat} className="space-y-2 rounded-lg bg-raised px-3 py-2.5">
      <p className="flex items-center gap-2 text-[14px] font-medium text-text">
        <span className="min-w-0 flex-1 truncate">{ticket.titre}</span>
        {ticket.etat === 'traite' ? (
          <span className="flex shrink-0 items-center gap-1 text-[12.5px] font-normal text-termine">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t('Traité')}
          </span>
        ) : null}
      </p>
      <ul className="space-y-1.5">
        {ticket.messages.map((m, rang) => (
          <li key={rang} data-ticket-message={m.de} className={cn('rounded-md px-2.5 py-1.5 text-[13px] leading-relaxed', m.de === 'equipe' ? 'bg-bg text-text' : 'text-muted')}>
            <span className="mb-0.5 block text-[12px] text-faint">
              {m.de === 'equipe' ? t('L’équipe Beluga') : t('Vous')} · {new Date(m.creeLe).toLocaleDateString()}
            </span>
            <span className="whitespace-pre-wrap break-words">{m.texte}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}

/** « Contacter l'équipe Beluga » : un titre, un message, puis la liste des tickets. */
export function SectionContacterLEquipe() {
  const [titre, setTitre] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [envoi, setEnvoi] = React.useState<'repos' | 'envoi' | 'envoye'>('repos');
  const [refus, setRefus] = React.useState<string | null>(null);
  const [tickets, setTickets] = React.useState<TicketRendu[] | null>(null);
  const [lecture, setLecture] = React.useState(false);

  const relire = React.useCallback(async () => {
    setLecture(true);
    try {
      const r = await fetch('/api/relais/mes-tickets');
      const corps = (await r.json()) as { tickets?: TicketRendu[] };
      setTickets(corps.tickets ?? []);
    } catch {
      setTickets((avant) => avant ?? []);
    } finally {
      setLecture(false);
    }
  }, []);
  React.useEffect(() => {
    void relire();
  }, [relire]);

  const envoyer = async () => {
    setEnvoi('envoi');
    setRefus(null);
    try {
      const r = await fetch('/api/relais/ticket', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ titre, message }),
      });
      const corps = (await r.json()) as { ok?: boolean; raison?: string };
      if (!corps.ok) {
        setRefus(corps.raison ?? t('Le message n’est pas parti.'));
        setEnvoi('repos');
        return;
      }
      setTitre('');
      setMessage('');
      setEnvoi('envoye');
      void relire();
    } catch {
      setRefus(t('Le message n’est pas parti.'));
      setEnvoi('repos');
    }
  };

  return (
    <div className="space-y-3" data-section-installation="contacter-l-equipe">
      <p className="text-[13.5px] leading-relaxed text-muted">
        {t('Une question, un souci, une idée ? Écrivez à l’équipe Beluga : elle vous répond ici.')}
      </p>
      <Champ label={t('Sujet')}>
        <Input value={titre} maxLength={140} onChange={(e) => setTitre(e.target.value)} data-ticket-titre />
      </Champ>
      <Champ label={t('Message')}>
        <Textarea value={message} maxLength={8000} rows={5} onChange={(e) => setMessage(e.target.value)} data-ticket-texte />
      </Champ>
      {refus ? (
        <p data-refus-ticket className="text-[13px] leading-relaxed text-danger">
          {refus}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button size="sm" disabled={!titre.trim() || !message.trim() || envoi === 'envoi'} onClick={() => void envoyer()} data-ticket-envoyer>
          {envoi === 'envoi' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {t('Envoyer à l’équipe Beluga')}
        </Button>
        {envoi === 'envoye' ? <span className="text-[13px] text-termine" data-ticket-envoye>{t('Message envoyé.')}</span> : null}
      </div>

      <div className="flex items-center gap-2 pt-2">
        <MessageSquare className="h-3.5 w-3.5 text-faint" />
        <p className="min-w-0 flex-1 text-[13.5px] font-medium text-text">{t('Mes tickets')}</p>
        <Button variant="ghost" size="sm" disabled={lecture} onClick={() => void relire()} data-tickets-relire>
          {lecture ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {t('Relire')}
        </Button>
      </div>
      {tickets === null ? (
        <div className="h-14 animate-pulse rounded-lg bg-raised" />
      ) : tickets.length ? (
        <ul className="space-y-2" data-mes-tickets>
          {tickets.map((ticket) => (
            <UnTicket key={ticket.id} ticket={ticket} />
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-faint" data-aucun-ticket>
          {t('Aucun ticket pour l’instant.')}
        </p>
      )}
    </div>
  );
}
