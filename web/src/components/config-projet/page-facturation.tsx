import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Input, Label } from '@/components/ui';
import { money } from '@/lib/utils';
import { t } from '@/lib/langue';
import { TeteDeRubrique, type ContexteConfig } from './communs';

/**
 * LE LIEN VERS LE CLIENT (PLAN §7) : une fois posé, les lignes de facture
 * partent en un clic depuis chaque carte. Les montants restent calculés par
 * l'outil de facturation, jamais ici.
 */
export function RubriqueFacturation({ ctx }: { ctx: ContexteConfig }) {

  return (
    <div data-rubrique-contenu="facturation" data-facturation-projet className="space-y-3">
      <TeteDeRubrique
        titre={t('Client et tarif')}
        resume={t('Le client facturé, son tarif horaire, le document par défaut.')}
        aide={t('Une fois le client relié, chaque carte propose d\'ajouter sa ligne au document en un clic. Les montants restent calculés par l\'outil de facturation, jamais ici.')}
      />

      {ctx.ecartChiffrage ? (
        <p className="text-[12.5px] leading-snug text-faint">
          {t('Sur les {v0} dernières cartes mesurées, le travail réel a pris en moyenne{v1} {v2} % du temps annoncé au chiffrage.', {
            v0: ctx.ecartChiffrage.count,
            v1: ' ',
            v2: Math.round(ctx.ecartChiffrage.ratioMoyen * 100),
          })}
        </p>
      ) : null}

      {ctx.clientsEnCours ? (
        <p className="flex items-center gap-1.5 text-[13.5px] text-faint">
          <Loader2 className="h-3 w-3 animate-spin" /> {t('Lecture des clients…')}
        </p>
      ) : ctx.facturationJoignable ? (
        <>
          <div>
            <Label>{t('Client facturé')}</Label>
            <select
              value={ctx.clientId}
              onChange={(event) => ctx.setClientId(event.target.value)}
              className="mt-1 h-8 w-full rounded-md border border-border bg-raised px-2 text-[14.5px] text-text"
            >
              <option value="">{t('Aucun client relié')}</option>
              {ctx.clients.map((entree) => (
                <option key={entree.id} value={entree.id}>
                  {entree.name} {entree.companyName ? `— ${entree.companyName}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label className="block">{t('Tarif horaire')}</Label>
            <Input
              value={ctx.rate}
              onChange={(event) => ctx.setRate(event.target.value.replace(',', '.'))}
              className="mt-1.5"
              inputMode="decimal"
            />
            <p className="mt-1 text-[12.5px] text-faint">
              {t('Trois heures de travail seraient facturées {v0}.', { v0: money((Number(ctx.rate) || 0) * 3) })}
            </p>
          </div>

          {ctx.clientId ? (
            <div className="space-y-3">
              <div>
                <Label className="block">{t('Document par défaut')}</Label>
                <select
                  value={ctx.documentType}
                  onChange={(event) => ctx.setDocumentType(event.target.value as 'offer' | 'invoice')}
                  className="mt-1.5 h-9 w-full rounded-md border border-border bg-raised px-2 text-[14.5px] text-text"
                >
                  <option value="invoice">{t('Facture')}</option>
                  <option value="offer">{t('Offre')}</option>
                </select>
              </div>
              <div>
                <Label className="block">{t('Lequel')}</Label>
                <select
                  value={ctx.documentId}
                  onChange={(event) => ctx.setDocumentId(event.target.value)}
                  className="mt-1.5 h-9 w-full rounded-md border border-border bg-raised px-2 text-[14.5px] text-text"
                >
                  <option value="">{t('Nouveau à chaque fois')}</option>
                  {ctx.documents
                    .filter((doc) => doc.type === ctx.documentType)
                    .map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        {doc.number ?? doc.id} — {doc.title ?? t('sans titre')}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          ) : null}

        </>
      ) : (
        <p className="text-[13.5px] text-faint">
          {t('L\'outil de facturation n\'est pas joignable depuis ce serveur.')}
        </p>
      )}
    </div>
  );
}
