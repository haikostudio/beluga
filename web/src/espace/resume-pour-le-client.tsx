/**
 * « CE QUI A CHANGÉ — PRÊT À ENVOYER » : LE RÉSUMÉ D'UNE DEMANDE, VU PAR HAIKO SEUL.
 *
 * Décision de l'utilisateur (cadrage du 24/11/2026, maquette #93cf) : à la fin du travail de la carte liée, un résumé
 * en mots simples est PRÉPARÉ (`server/src/resume-client.ts`) ; Haiko le relit dans la fiche, le modifie sur place,
 * puis l'envoie d'un clic — il s'ajoute alors à la discussion de la demande comme un message de Haiko. Il peut aussi
 * l'écarter. Le client ne reçoit jamais ce brouillon : il n'est joint qu'à la lecture d'un administrateur, et ses
 * commandes lui sont fermées.
 *
 * DANS LE FLUX DE LA FICHE, SANS CADRE (MEM-0764) : un fond `raised`, comme le bloc des cases à cocher. Le bouton
 * d'envoi est LE geste marqué (`principal`) ; il dit dès le clic qu'il part.
 */
import * as React from 'react';
import { Loader2, Pencil, Send, Sparkles, X } from '@/components/ui/icones';
import { Button } from '@/components/ui';
import { t } from '@/lib/langue';
import type { ResumeClient } from '@beluga/shared';
import { canalEspace } from './canal-espace';
import { TexteEditable } from './texte-editable';

export function ResumePourLeClient({
  demandeId,
  resume,
  onResume,
  onEnvoye,
}: {
  demandeId: string;
  resume: ResumeClient;
  /** Le brouillon tel que le serveur l'a enregistré (ou `null` : envoyé, écarté). */
  onResume: (suite: ResumeClient | null) => void;
  /** Le résumé est parti : la fiche relit son fil, où il vient d'apparaître. */
  onEnvoye: () => void;
}) {
  const [geste, setGeste] = React.useState<'envoi' | 'ecart' | 'ecriture' | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [texte, setTexte] = React.useState(resume.texte);
  const ouvrir = React.useRef<(() => void) | null>(null);

  /* Le brouillon peut changer du dehors (un autre écran de Haiko, le texte de l'agent qui arrive) : l'écran le suit. */
  React.useEffect(() => setTexte(resume.texte), [resume.texte]);

  const vide = !texte.trim();

  const enregistrer = async (suite: string) => {
    setTexte(suite);
    setGeste('ecriture');
    setErreur(null);
    try {
      const reponse: { resumeClient: ResumeClient } = await canalEspace.demander({
        type: 'espace.demande.resume.modifier',
        id: demandeId,
        texte: suite,
      });
      onResume(reponse.resumeClient);
    } catch (err: any) {
      setErreur(err?.message ?? t('Cette modification n’a pas pu être enregistrée.'));
    } finally {
      setGeste(null);
    }
  };

  const envoyer = async () => {
    if (vide || geste) return;
    setGeste('envoi');
    setErreur(null);
    try {
      await canalEspace.demander({ type: 'espace.demande.resume.envoyer', id: demandeId, texte });
      onResume(null);
      onEnvoye();
    } catch (err: any) {
      setErreur(err?.message ?? t('Le résumé n’a pas pu être envoyé.'));
      setGeste(null);
    }
  };

  const ecarter = async () => {
    if (geste) return;
    setGeste('ecart');
    setErreur(null);
    try {
      await canalEspace.demander({ type: 'espace.demande.resume.ecarter', id: demandeId });
      onResume(null);
    } catch (err: any) {
      setErreur(err?.message ?? t('Cette modification n’a pas pu être enregistrée.'));
      setGeste(null);
    }
  };

  return (
    <section className="mt-2 rounded-lg bg-raised px-3.5 py-3" data-resume-client={resume.id} data-resume-vide={vide ? '' : undefined}>
      <div className="flex min-w-0 items-center gap-2">
        <Sparkles className="h-4 w-4 shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-text">{t('Ce qui a changé — prêt à envoyer')}</span>
        <span className="shrink-0 text-[12px] text-faint max-sm:hidden">{t('Visible par vous seul')}</span>
      </div>
      <div className="mt-1.5">
        <TexteEditable
          valeur={texte}
          onValider={(suite) => void enregistrer(suite)}
          editable={!geste || geste === 'ecriture'}
          multiligne
          classeTexte="text-[13.5px] leading-relaxed text-text"
          placeholder={t('Écrivez en quelques phrases ce qui a changé pour le client, et comment le vérifier.')}
          repere="resume-client"
          libelle={t('Modifier le résumé')}
          ouverture={ouvrir}
        />
      </div>
      <p className="mt-0.5 text-[12px] text-faint sm:hidden">{t('Visible par vous seul')}</p>
      {erreur ? <p className="mt-1 text-[12px] text-danger">{erreur}</p> : null}
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void ecarter()}
          disabled={Boolean(geste)}
          className="gap-1.5"
          data-ecarter-resume
        >
          {geste === 'ecart' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
          {t('Écarter')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => ouvrir.current?.()}
          disabled={Boolean(geste)}
          className="gap-1.5"
          data-modifier-resume
        >
          <Pencil className="h-3.5 w-3.5" />
          {t('Modifier')}
        </Button>
        <Button
          variant="principal"
          size="sm"
          onClick={() => void envoyer()}
          disabled={vide || Boolean(geste)}
          title={vide ? t('Écrivez d’abord ce qui a changé.') : undefined}
          className="gap-1.5"
          data-envoyer-resume
          data-envoi-part={geste === 'envoi' ? '' : undefined}
        >
          {geste === 'envoi' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {t('Envoyer au client')}
        </Button>
      </div>
    </section>
  );
}
