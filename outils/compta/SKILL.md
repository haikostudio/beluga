---
name: compta
description: Créer, lire et modifier des offres (devis), factures, clients et paiements dans l'app de facturation Haiko (compta.haikostudio.cloud). Utiliser dès que l'utilisateur parle de facture, offre, devis, client à facturer, paiement reçu, ou de facturation en général — depuis le chat ou depuis une tâche.
---

# Facturation Haiko (compta.haikostudio.cloud)

App de facturation PocketBase auto-hébergée. Deux entreprises : **Haiko** (Christophe Badoux, FR, sans TVA → `vat_rate: 0`) et **Synergies** (Laurent Bailly, CH). La clé API est déjà en place dans `~/.config/compta/api-key`.

**Toujours passer par le script** — il calcule les montants (jamais à la main, jamais par le LLM), gère la numérotation automatique par entreprise (OF-XXXX / FA-XXXX), les dates d'échéance et le compte bancaire par défaut :

```bash
node ~/.claude/skills/compta/scripts/compta.mjs <commande> [args...]
```

## Commandes

| Commande | Rôle |
|---|---|
| `companies` | Lister les entreprises |
| `clients <entreprise>` | Lister les clients d'une entreprise (nom partiel accepté : `haiko`) |
| `client-create '<json>'` | Créer un client (`{"company":"haiko","type":"company","company_name":"…","email":"…"}`) |
| `list quote\|invoice [--company haiko] [--status draft] [--limit 20]` | Lister offres/factures |
| `get quote\|invoice <n°\|id>` | Document complet + lignes (`get invoice FA-0012`) |
| `create quote\|invoice '<spec-json>'` | Créer offre/facture + lignes (voir spec ci-dessous) |
| `update quote\|invoice <n°\|id> '<patch>'` | Modifier des champs (`'{"status":"sent"}'`) |
| `set-items quote\|invoice <n°\|id> '{"items":[…]}'` | Remplacer les lignes → totaux recalculés |
| `add-payment <n°\|id> '{"amount":500}'` | Enregistrer un paiement → statut/solde mis à jour (`payment_method` défaut `bank_transfer` — pas « virement ») |
| `convert <n° offre\|id> ['{"payment_terms":30}']` | Offre → facture : copie lignes/TVA, numérote FA-, marque l'offre `converted` |
| `relance <n° facture\|id> ['{"send":true,"note":"…"}']` | E-mail de rappel au client. **Sans `send:true` = aperçu seulement.** Envoi via SMTP (`~/.config/compta/smtp.env`), copie à l'expéditeur, trace dans `internal_notes` |
| `delete quote\|invoice <n°\|id>` | Supprimer (lignes comprises) — brouillons/tests uniquement |
| `goal [montant]` | Lire / fixer l'objectif mensuel CHF (fichier `~/.config/compta/goal`, affiché sur le dashboard) |
| `report [YYYY-MM]` | Bilan d'un mois (défaut : mois précédent) : facturé, encaissé, comparatif M-1, % objectif, impayés |
| `raw <METHOD> <path> ['<json>']` | Accès direct API (`raw GET /collections/payments/records`) |

Le spec accepte du JSON inline ou un chemin de fichier.

## Spec de création

```json
{
  "company": "haiko",
  "client": "nom partiel ou id",
  "title": "Refonte du site vitrine",
  "date": "2026-07-20",
  "currency": "CHF",
  "vat_rate": 0,
  "payment_terms": 30,
  "validity_days": 30,
  "introduction": "",
  "conclusion": "",
  "items": [
    { "title": "Développement", "description": "<p>Détail…</p>", "quantity": 4, "unit": "heure", "unit_price": 130 },
    { "title": "Option maintenance", "quantity": 1, "unit": "pc", "unit_price": 500, "is_optional": true },
    { "type": "text", "text_content": "Bloc de texte libre" }
  ]
}
```

- Ne fournir **que** `quantity` et `unit_price` : le script calcule totaux de ligne, sous-total, TVA, total, solde dû.
- Défauts automatiques : numéro suivant de l'entreprise, `date` = aujourd'hui, `status` = `draft`, devise du client, échéance (`payment_terms` du client sinon 30 j), compte bancaire de la dernière facture de l'entreprise.
- `description` des lignes = HTML (`<p>…</p>`). Unités usuelles : `pc`, `heure`.
- Lignes `is_optional: true` et blocs `text` exclus des totaux.

## Règles

- **Créer en `draft`** ; ne passer un document en `sent`/`paid`/`accepted` que sur demande explicite de l'utilisateur.
- **`relance` avec `send:true` UNIQUEMENT après validation explicite de l'utilisateur dans la conversation** (montrer l'aperçu d'abord). Config SMTP : `~/.config/compta/smtp.env` (SMTP_URL, SMTP_USER, SMTP_PASS, SMTP_FROM) — si absente, le dire à l'utilisateur (il manque un mot de passe d'application e-mail).
- Entreprise par défaut : **Haiko** si le contexte ne dit rien d'autre ; en cas de doute réel, demander.
- Statuts offres : `draft, sent, accepted, rejected, expired, converted, archived`. Factures : `draft, sent, partial, paid, overdue, cancelled, archived`.
- Ne jamais `delete` un document non-brouillon sans demande explicite.
- Après un travail facturable suivi dans Paseo, le taux habituel est **130 CHF/h**.

## Pièges API (si `raw`)

- Pas de colonnes `created`/`updated` → trier avec `sort=-id` ou `sort=-invoice_number`, jamais `sort=-created`.
- Les totaux ne sont **pas** recalculés par le serveur : tout PATCH de lignes à la main doit mettre à jour `subtotal`, `vat_amount`, `total`, `amount_due` (d'où : utiliser `set-items`).
- Relations = id de 15 caractères ; dates envoyées en `YYYY-MM-DD`.
- Doc API complète : https://compta.haikostudio.cloud/api-docs.html
