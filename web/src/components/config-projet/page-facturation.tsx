import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { FormulaireEnColonnes, Input, LigneFormulaire, ListeDeroulante } from '@/components/ui';
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
        <FormulaireEnColonnes>
          <LigneFormulaire libelle={t('Client facturé')}>
            <ListeDeroulante
              valeur={ctx.clientId}
              titre={t('Client facturé')}
              repere="client-facture"
              onChoisir={ctx.setClientId}
              options={[
                { valeur: '', libelle: t('Aucun client relié') },
                ...ctx.clients.map((entree) => ({ valeur: entree.id, libelle: entree.name, ...(entree.companyName ? { detail: entree.companyName } : {}) })),
              ]}
            />
          </LigneFormulaire>

          <LigneFormulaire
            libelle={t('Tarif horaire')}
            note={t('Trois heures de travail seraient facturées {v0}.', { v0: money((Number(ctx.rate) || 0) * 3) })}
          >
            <Input value={ctx.rate} onChange={(event) => ctx.setRate(event.target.value.replace(',', '.'))} inputMode="decimal" />
          </LigneFormulaire>

          {ctx.clientId ? (
            <>
              <LigneFormulaire libelle={t('Document par défaut')}>
                <ListeDeroulante
                  valeur={ctx.documentType}
                  titre={t('Document par défaut')}
                  repere="type-document-defaut"
                  onChoisir={(valeur) => ctx.setDocumentType(valeur as 'offer' | 'invoice')}
                  options={[
                    { valeur: 'invoice', libelle: t('Facture') },
                    { valeur: 'offer', libelle: t('Offre') },
                  ]}
                />
              </LigneFormulaire>
              <LigneFormulaire libelle={t('Lequel')}>
                <ListeDeroulante
                  valeur={ctx.documentId}
                  titre={t('Lequel')}
                  repere="document-defaut"
                  onChoisir={ctx.setDocumentId}
                  options={[
                    { valeur: '', libelle: t('Nouveau à chaque fois') },
                    ...ctx.documents
                      .filter((doc) => doc.type === ctx.documentType)
                      .map((doc) => ({ valeur: doc.id, libelle: `${doc.number ?? doc.id} — ${doc.title ?? t('sans titre')}` })),
                  ]}
                />
              </LigneFormulaire>
            </>
          ) : null}
        </FormulaireEnColonnes>
      ) : (
        <p className="text-[13.5px] text-faint">
          {t('L\'outil de facturation n\'est pas joignable depuis ce serveur.')}
        </p>
      )}
    </div>
  );
}
