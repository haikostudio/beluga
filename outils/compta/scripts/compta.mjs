#!/usr/bin/env node
// CLI d'intégration avec l'app de facturation compta.haikostudio.cloud (PocketBase).
// Tous les montants (totaux de ligne, sous-total, TVA, total, solde dû) sont
// calculés ICI, jamais par le LLM appelant — garantie de factures justes au centime.
//
// Usage : node compta.mjs <commande> [args...]   (voir SKILL.md pour le détail)

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = "https://compta.haikostudio.cloud/api";

function apiKey() {
  if (process.env.COMPTA_API_KEY) return process.env.COMPTA_API_KEY.trim();
  try {
    return readFileSync(join(homedir(), ".config/compta/api-key"), "utf8").trim();
  } catch {
    fail("Clé API introuvable : définir COMPTA_API_KEY ou créer ~/.config/compta/api-key");
  }
}

function fail(msg) {
  console.error(`ERREUR: ${msg}`);
  process.exit(1);
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: apiKey(),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    fail(`${method} ${path} → HTTP ${res.status}\n${JSON.stringify(json, null, 2)}`);
  }
  return json;
}

const round2 = (n) => Math.round(n * 100) / 100;
const ID_RE = /^[a-z0-9]{15}$/;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addMonths(month, delta) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

// Valeur sûre pour un filtre PocketBase (chaîne entre quotes simples).
function q(value) {
  return `'${String(value).replaceAll("'", "\\'")}'`;
}

async function resolveCompany(ref) {
  const { items } = await api("GET", "/collections/companies/records?perPage=200");
  if (!ref) {
    if (items.length === 1) return items[0];
    fail(
      `Préciser l'entreprise ("company") parmi : ${items.map((c) => c.name).join(", ")}`,
    );
  }
  if (ID_RE.test(ref)) {
    const hit = items.find((c) => c.id === ref);
    if (hit) return hit;
  }
  const needle = ref.toLowerCase();
  const hits = items.filter((c) => c.name.toLowerCase().includes(needle));
  if (hits.length === 1) return hits[0];
  fail(
    `Entreprise "${ref}" ${hits.length === 0 ? "introuvable" : "ambiguë"}. Disponibles : ${items.map((c) => c.name).join(", ")}`,
  );
}

async function resolveClient(companyId, ref) {
  if (ID_RE.test(ref)) {
    return api("GET", `/collections/clients/records/${ref}`);
  }
  const filter = encodeURIComponent(`(company=${q(companyId)})`);
  const { items } = await api(
    "GET",
    `/collections/clients/records?perPage=500&filter=${filter}`,
  );
  const needle = ref.toLowerCase();
  const label = (c) =>
    c.type === "individual"
      ? `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim()
      : (c.company_name ?? "");
  const hits = items.filter(
    (c) =>
      label(c).toLowerCase().includes(needle) ||
      (c.email ?? "").toLowerCase().includes(needle),
  );
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) {
    fail(
      `Client "${ref}" introuvable dans cette entreprise. Clients existants : ${items.map(label).filter(Boolean).join(" | ") || "(aucun)"}. Créer avec la commande client-create si besoin.`,
    );
  }
  fail(`Client "${ref}" ambigu : ${hits.map((c) => `${label(c)} (${c.id})`).join(" | ")}`);
}

async function resolveBankAccount(companyId, ref, currency) {
  const filter = encodeURIComponent(`(company=${q(companyId)})`);
  const { items } = await api(
    "GET",
    `/collections/bank_accounts/records?perPage=200&filter=${filter}`,
  );
  if (ref) {
    if (ID_RE.test(ref)) {
      const hit = items.find((a) => a.id === ref);
      if (hit) return hit.id;
    }
    const needle = ref.toLowerCase();
    const hits = items.filter(
      (a) =>
        a.name.toLowerCase().includes(needle) ||
        (a.bank_name ?? "").toLowerCase().includes(needle),
    );
    if (hits.length === 1) return hits[0].id;
    fail(
      `Compte bancaire "${ref}" ${hits.length === 0 ? "introuvable" : "ambigu"}. Disponibles : ${items.map((a) => a.name).join(" | ")}`,
    );
  }
  // Par défaut : le compte de la dernière facture de l'entreprise (mêmes habitudes),
  // sinon le compte marqué par défaut, sinon un compte dans la bonne devise.
  const last = await api(
    "GET",
    `/collections/invoices/records?perPage=1&sort=-invoice_number&filter=${filter}&fields=bank_account`,
  );
  const lastId = last.items[0]?.bank_account;
  if (lastId && items.some((a) => a.id === lastId)) return lastId;
  const byDefault = items.find((a) => a.is_default);
  if (byDefault) return byDefault.id;
  const byCurrency = items.find((a) => a.currency === currency);
  return (byCurrency ?? items[0])?.id ?? "";
}

const KINDS = {
  quote: { collection: "quotes", numberField: "quote_number", prefix: "OF-", itemRel: "quote" },
  invoice: { collection: "invoices", numberField: "invoice_number", prefix: "FA-", itemRel: "invoice" },
};

function kindOf(arg) {
  const k = { quote: "quote", offre: "quote", devis: "quote", invoice: "invoice", facture: "invoice" }[arg];
  if (!k) fail(`Type de document inconnu "${arg}" (attendu : quote | invoice)`);
  return KINDS[k];
}

// Numérotation par entreprise : reprend le plus grand numéro existant et incrémente.
async function nextNumber(kind, companyId) {
  const filter = encodeURIComponent(`(company=${q(companyId)})`);
  const { items } = await api(
    "GET",
    `/collections/${kind.collection}/records?perPage=1&sort=-${kind.numberField}&filter=${filter}&fields=${kind.numberField}`,
  );
  const current = items[0]?.[kind.numberField];
  const m = current?.match(/^([A-Za-z]+-)(\d+)$/);
  if (!m) return `${kind.prefix}0001`;
  return `${m[1]}${String(Number(m[2]) + 1).padStart(m[2].length, "0")}`;
}

// Construit les lignes + calcule les totaux. Les lignes optionnelles (is_optional)
// et les blocs texte n'entrent pas dans le sous-total.
function buildItems(items) {
  if (!Array.isArray(items) || items.length === 0) fail("Le spec doit contenir un tableau items non vide");
  let subtotal = 0;
  const rows = items.map((it, i) => {
    if (it.type === "text") {
      return {
        type: "text",
        position: i,
        item_id: String(i + 1),
        title: it.title ?? "",
        text_content: it.text_content ?? it.description ?? "",
        text_style: it.text_style ?? "normal",
        quantity: 0,
        unit_price: 0,
        total: 0,
      };
    }
    const quantity = Number(it.quantity ?? 1);
    const unit_price = Number(it.unit_price ?? 0);
    if (!Number.isFinite(quantity) || !Number.isFinite(unit_price)) {
      fail(`Ligne ${i + 1} ("${it.title}") : quantity/unit_price invalides`);
    }
    const total = round2(quantity * unit_price);
    if (!it.is_optional) subtotal = round2(subtotal + total);
    return {
      type: "article",
      position: i,
      item_id: String(i + 1),
      title: it.title ?? "",
      description: it.description ?? "",
      quantity,
      unit: it.unit ?? "pc",
      unit_price,
      total,
      is_optional: Boolean(it.is_optional),
    };
  });
  return { rows, subtotal };
}

function totalsFrom(subtotal, vatRate) {
  const vat_amount = round2((subtotal * Number(vatRate || 0)) / 100);
  return { subtotal, vat_amount, total: round2(subtotal + vat_amount) };
}

function readSpec(arg) {
  if (!arg) fail("Spec manquant : passer un JSON inline ou un chemin de fichier");
  const text = arg.trim().startsWith("{") ? arg : readFileSync(arg, "utf8");
  try {
    return JSON.parse(text);
  } catch (e) {
    fail(`Spec JSON invalide : ${e.message}`);
  }
}

async function findDoc(kind, ref, opts = "") {
  if (ID_RE.test(ref)) {
    return api("GET", `/collections/${kind.collection}/records/${ref}${opts}`);
  }
  const filter = encodeURIComponent(`(${kind.numberField}=${q(ref)})`);
  const { items } = await api(
    "GET",
    `/collections/${kind.collection}/records?filter=${filter}${opts ? `&${opts.slice(1)}` : ""}`,
  );
  if (items.length === 1) return items[0];
  fail(
    items.length === 0
      ? `Document "${ref}" introuvable`
      : `Numéro "${ref}" présent dans plusieurs entreprises — utiliser l'id`,
  );
}

async function docItems(kind, docId) {
  const filter = encodeURIComponent(`(${kind.itemRel}=${q(docId)})`);
  const { items } = await api(
    "GET",
    `/collections/document_items/records?perPage=500&sort=position&filter=${filter}`,
  );
  return items;
}

function out(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function createDocument(kind, spec) {
  const company = await resolveCompany(spec.company);
  const client = await resolveClient(company.id, spec.client ?? fail("Champ client requis dans le spec"));
  const currency = spec.currency ?? client.default_currency ?? "CHF";
  const vat_rate = Number(spec.vat_rate ?? 0);
  const { rows, subtotal } = buildItems(spec.items);
  const totals = totalsFrom(subtotal, vat_rate);
  const date = (spec.date ?? today()).slice(0, 10);
  const number = spec.number ?? (await nextNumber(kind, company.id));

  const base = {
    company: company.id,
    client: client.id,
    [kind.numberField]: number,
    title: spec.title ?? "",
    status: spec.status ?? "draft",
    currency,
    vat_rate,
    ...totals,
    introduction: spec.introduction ?? "",
    conclusion: spec.conclusion ?? "",
    internal_notes: spec.internal_notes ?? "",
  };

  let payload;
  if (kind === KINDS.quote) {
    const validity_days = Number(spec.validity_days ?? 30);
    payload = {
      ...base,
      quote_date: date,
      validity_days,
      expiry_date: spec.expiry_date ?? addDays(date, validity_days),
    };
  } else {
    const payment_terms = Number(spec.payment_terms ?? client.default_payment_terms ?? 30);
    payload = {
      ...base,
      type: spec.type ?? "standard",
      invoice_date: date,
      payment_terms,
      due_date: spec.due_date ?? addDays(date, payment_terms),
      amount_paid: 0,
      amount_due: totals.total,
      bank_account: await resolveBankAccount(company.id, spec.bank_account, currency),
    };
  }

  const doc = await api("POST", `/collections/${kind.collection}/records`, payload);
  const created = [];
  for (const row of rows) {
    created.push(
      await api("POST", "/collections/document_items/records", { ...row, [kind.itemRel]: doc.id }),
    );
  }
  out({
    ok: true,
    kind: kind.collection,
    id: doc.id,
    number: doc[kind.numberField],
    company: company.name,
    client: client.company_name || `${client.first_name ?? ""} ${client.last_name ?? ""}`.trim(),
    status: doc.status,
    currency: doc.currency,
    subtotal: doc.subtotal,
    vat_amount: doc.vat_amount,
    total: doc.total,
    items: created.map((i) => ({ position: i.position, title: i.title, quantity: i.quantity, unit_price: i.unit_price, total: i.total })),
  });
}

async function recomputeTotals(kind, doc) {
  const items = await docItems(kind, doc.id);
  const subtotal = items.reduce(
    (acc, it) => (it.type === "article" && !it.is_optional ? round2(acc + it.total) : acc),
    0,
  );
  const totals = totalsFrom(subtotal, doc.vat_rate);
  const patch = { ...totals };
  if (kind === KINDS.invoice) {
    patch.amount_due = round2(totals.total - (doc.amount_paid ?? 0));
  }
  return api("PATCH", `/collections/${kind.collection}/records/${doc.id}`, patch);
}

const [, , cmd, ...args] = process.argv;

switch (cmd) {
  case "companies": {
    const { items } = await api("GET", "/collections/companies/records?perPage=200");
    out(items.map(({ id, name, country, email }) => ({ id, name, country, email })));
    break;
  }

  case "clients": {
    const company = await resolveCompany(args[0]);
    const filter = encodeURIComponent(`(company=${q(company.id)})`);
    const { items } = await api("GET", `/collections/clients/records?perPage=500&filter=${filter}`);
    out(
      items.map((c) => ({
        id: c.id,
        type: c.type,
        name: c.type === "individual" ? `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() : c.company_name,
        email: c.email,
        city: c.city,
        default_currency: c.default_currency,
      })),
    );
    break;
  }

  case "client-create": {
    const spec = readSpec(args[0]);
    const company = await resolveCompany(spec.company);
    const created = await api("POST", "/collections/clients/records", {
      ...spec,
      company: company.id,
    });
    out({ ok: true, id: created.id, company: company.name });
    break;
  }

  case "create": {
    await createDocument(kindOf(args[0]), readSpec(args[1]));
    break;
  }

  case "list": {
    const kind = kindOf(args[0]);
    const flags = Object.fromEntries(
      args.slice(1).map((a, i, arr) => (a.startsWith("--") ? [a.slice(2), arr[i + 1]] : null)).filter(Boolean),
    );
    const parts = [];
    if (flags.company) parts.push(`company=${q((await resolveCompany(flags.company)).id)}`);
    if (flags.status) parts.push(`status=${q(flags.status)}`);
    const filter = parts.length ? `&filter=${encodeURIComponent(`(${parts.join(" && ")})`)}` : "";
    const { items, totalItems } = await api(
      "GET",
      `/collections/${kind.collection}/records?perPage=${flags.limit ?? 20}&sort=-${kind.numberField}${filter}&expand=client`,
    );
    out({
      totalItems,
      items: items.map((d) => ({
        id: d.id,
        number: d[kind.numberField],
        date: (d.quote_date ?? d.invoice_date ?? "").slice(0, 10),
        title: d.title,
        status: d.status,
        total: d.total,
        amount_due: d.amount_due,
        currency: d.currency,
        client: d.expand?.client
          ? d.expand.client.company_name || `${d.expand.client.first_name ?? ""} ${d.expand.client.last_name ?? ""}`.trim()
          : d.client,
      })),
    });
    break;
  }

  case "get": {
    const kind = kindOf(args[0]);
    const doc = await findDoc(kind, args[1], "?expand=client,company,bank_account");
    const items = await docItems(kind, doc.id);
    out({ document: doc, items });
    break;
  }

  case "update": {
    const kind = kindOf(args[0]);
    const patch = readSpec(args[2]);
    if (patch.items) fail("Pour modifier les lignes, utiliser set-items (recalcule les totaux)");
    const doc = await findDoc(kind, args[1]);
    let updated = await api("PATCH", `/collections/${kind.collection}/records/${doc.id}`, patch);
    // Si la TVA change sans totaux explicites, recalculer depuis les lignes.
    if ("vat_rate" in patch && !("total" in patch)) {
      updated = await recomputeTotals(kind, updated);
    }
    out({ ok: true, id: updated.id, number: updated[kind.numberField], status: updated.status, total: updated.total });
    break;
  }

  case "set-items": {
    const kind = kindOf(args[0]);
    const spec = readSpec(args[2]);
    const doc = await findDoc(kind, args[1]);
    const { rows } = buildItems(spec.items ?? spec);
    for (const old of await docItems(kind, doc.id)) {
      await api("DELETE", `/collections/document_items/records/${old.id}`);
    }
    for (const row of rows) {
      await api("POST", "/collections/document_items/records", { ...row, [kind.itemRel]: doc.id });
    }
    const updated = await recomputeTotals(kind, doc);
    out({ ok: true, id: updated.id, number: updated[kind.numberField], subtotal: updated.subtotal, vat_amount: updated.vat_amount, total: updated.total });
    break;
  }

  // Append lines to a document without touching existing ones (safer than
  // set-items for adding a single billable line), then recompute totals.
  case "add-items": {
    const kind = kindOf(args[0]);
    const spec = readSpec(args[2]);
    const doc = await findDoc(kind, args[1]);
    const existing = await docItems(kind, doc.id);
    let pos = existing.reduce((m, it) => Math.max(m, Number(it.position ?? 0) + 1), existing.length);
    const { rows } = buildItems(spec.items ?? spec);
    for (const row of rows) {
      await api("POST", "/collections/document_items/records", {
        ...row,
        position: pos,
        item_id: String(pos + 1),
        [kind.itemRel]: doc.id,
      });
      pos += 1;
    }
    const updated = await recomputeTotals(kind, doc);
    out({ ok: true, id: updated.id, number: updated[kind.numberField], subtotal: updated.subtotal, vat_amount: updated.vat_amount, total: updated.total });
    break;
  }

  case "add-payment": {
    const spec = readSpec(args[1]);
    const doc = await findDoc(KINDS.invoice, args[0]);
    const amount = Number(spec.amount ?? fail("Champ amount requis"));
    await api("POST", "/collections/payments/records", {
      invoice: doc.id,
      amount,
      payment_date: (spec.payment_date ?? today()).slice(0, 10),
      payment_method: spec.payment_method ?? "bank_transfer",
      reference: spec.reference ?? `Paiement ${doc.invoice_number}`,
    });
    const amount_paid = round2((doc.amount_paid ?? 0) + amount);
    const amount_due = round2(doc.total - amount_paid);
    const patch = {
      amount_paid,
      amount_due,
      status: amount_due <= 0 ? "paid" : "partial",
      ...(amount_due <= 0 ? { paid_date: (spec.payment_date ?? today()).slice(0, 10) } : {}),
    };
    const updated = await api("PATCH", `/collections/invoices/records/${doc.id}`, patch);
    out({ ok: true, number: updated.invoice_number, amount_paid: updated.amount_paid, amount_due: updated.amount_due, status: updated.status });
    break;
  }

  case "convert": {
    // Offre → facture : copie client/devise/TVA/lignes, numérote FA-, lie la facture
    // à l'offre et marque l'offre "converted".
    const quote = await findDoc(KINDS.quote, args[0]);
    const items = await docItems(KINDS.quote, quote.id);
    if (items.length === 0) fail("L'offre n'a aucune ligne");
    const spec = args[1] ? readSpec(args[1]) : {};
    const client = await api("GET", `/collections/clients/records/${quote.client}`);
    const currency = quote.currency ?? "CHF";
    const payment_terms = Number(spec.payment_terms ?? client.default_payment_terms ?? 30);
    const date = (spec.date ?? today()).slice(0, 10);
    const subtotal = items.reduce(
      (acc, it) => (it.type === "article" && !it.is_optional ? round2(acc + it.total) : acc),
      0,
    );
    const totals = totalsFrom(subtotal, quote.vat_rate);
    const invoice = await api("POST", "/collections/invoices/records", {
      company: quote.company,
      client: quote.client,
      quote: quote.id,
      invoice_number: spec.number ?? (await nextNumber(KINDS.invoice, quote.company)),
      title: spec.title ?? quote.title,
      type: "standard",
      status: "draft",
      currency,
      vat_rate: quote.vat_rate,
      ...totals,
      amount_paid: 0,
      amount_due: totals.total,
      invoice_date: date,
      payment_terms,
      due_date: spec.due_date ?? addDays(date, payment_terms),
      introduction: quote.introduction ?? "",
      conclusion: quote.conclusion ?? "",
      bank_account: await resolveBankAccount(quote.company, spec.bank_account, currency),
    });
    for (const it of items) {
      const { id, collectionId, collectionName, quote: _q, ...rest } = it;
      await api("POST", "/collections/document_items/records", { ...rest, invoice: invoice.id });
    }
    await api("PATCH", `/collections/quotes/records/${quote.id}`, { status: "converted" });
    out({
      ok: true,
      quote: quote.quote_number,
      quote_status: "converted",
      invoice: invoice.invoice_number,
      id: invoice.id,
      total: invoice.total,
      currency: invoice.currency,
      due_date: invoice.due_date?.slice(0, 10),
      items: items.length,
    });
    break;
  }

  case "relance": {
    // relance <n°|id> ['{"send":true,"to":"…","note":"…"}']
    // Sans "send": true → aperçu seulement. L'envoi réel exige la validation
    // explicite de l'utilisateur dans la conversation.
    const spec = args[1] ? readSpec(args[1]) : {};
    const doc = await findDoc(KINDS.invoice, args[0]);
    if (doc.status === "draft" || doc.status === "paid" || !(doc.amount_due > 0)) {
      fail(`La facture ${doc.invoice_number} (statut ${doc.status}, solde ${doc.amount_due}) n'est pas relançable`);
    }
    const client = await api("GET", `/collections/clients/records/${doc.client}`);
    const company = await api("GET", `/collections/companies/records/${doc.company}`);
    let bank = null;
    if (doc.bank_account) {
      bank = await api("GET", `/collections/bank_accounts/records/${doc.bank_account}`);
    }
    const to = spec.to ?? client.email;
    if (!to) {
      fail(
        `Le client "${client.company_name || `${client.first_name ?? ""} ${client.last_name ?? ""}`.trim()}" n'a pas d'adresse e-mail — la renseigner (PATCH clients) ou passer {"to":"…"} dans le spec`,
      );
    }
    const due = (doc.due_date ?? "").slice(0, 10);
    const lateDays = due ? Math.max(0, Math.round((Date.parse(today()) - Date.parse(due)) / 86400000)) : 0;
    const subject = `Rappel de paiement — Facture ${doc.invoice_number} (${company.name})`;
    const clientLabel =
      client.type === "individual"
        ? `${client.first_name ?? ""} ${client.last_name ?? ""}`.trim()
        : client.company_name;
    const body = [
      `Bonjour,`,
      ``,
      `Sauf erreur de notre part, la facture ${doc.invoice_number} « ${doc.title} », émise le ${(doc.invoice_date ?? "").slice(0, 10)}${due ? ` et échue le ${due}` : ""}${lateDays > 0 ? ` (${lateDays} jour${lateDays > 1 ? "s" : ""} de retard)` : ""}, reste en attente de règlement.`,
      ``,
      `Solde dû : ${doc.amount_due} ${doc.currency}`,
      ...(spec.note ? [``, spec.note] : []),
      ...(bank?.iban
        ? [``, `Coordonnées pour le paiement :`, `IBAN : ${bank.iban}`, `Bénéficiaire : ${bank.account_holder || company.name}`]
        : []),
      ``,
      `Si votre règlement est déjà en route, merci de ne pas tenir compte de ce message.`,
      ``,
      `Avec nos meilleures salutations,`,
      company.owner_name || company.name,
      company.name,
    ].join("\n");

    if (!spec.send) {
      out({ ok: true, preview: true, to, subject, body, hint: 'Pour envoyer réellement : relancer avec {"send":true} (après validation de l\'utilisateur)' });
      break;
    }

    // Config SMTP : ~/.config/compta/smtp.env (SMTP_URL, SMTP_USER, SMTP_PASS, SMTP_FROM)
    const smtpPath = join(homedir(), ".config/compta/smtp.env");
    let smtpRaw;
    try {
      smtpRaw = readFileSync(smtpPath, "utf8");
    } catch {
      fail(
        `Config SMTP absente (${smtpPath}). Créer le fichier avec :\nSMTP_URL=smtps://smtp.gmail.com:465\nSMTP_USER=adresse@gmail.com\nSMTP_PASS=mot_de_passe_application\nSMTP_FROM=Haiko <adresse@gmail.com>`,
      );
    }
    const smtp = Object.fromEntries(
      smtpRaw
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
    for (const key of ["SMTP_URL", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"]) {
      if (!smtp[key]) fail(`Config SMTP incomplète : ${key} manquant dans ${smtpPath}`);
    }
    const envelopeFrom = smtp.SMTP_FROM.match(/<([^>]+)>/)?.[1] ?? smtp.SMTP_FROM;
    const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
    const mail = [
      `From: ${smtp.SMTP_FROM}`,
      `To: ${to}`,
      `Subject: ${encodedSubject}`,
      `Date: ${new Date().toUTCString()}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=utf-8`,
      `Content-Transfer-Encoding: 8bit`,
      ``,
      body,
    ].join("\r\n");
    const { execFileSync } = await import("node:child_process");
    const { writeFileSync, unlinkSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const mailFile = join(tmpdir(), `relance-${doc.invoice_number}-${Date.now()}.eml`);
    writeFileSync(mailFile, mail);
    try {
      execFileSync(
        "curl",
        [
          "--silent", "--show-error", "--ssl-reqd",
          "--url", smtp.SMTP_URL,
          "--mail-from", envelopeFrom,
          "--mail-rcpt", to,
          "--mail-rcpt", envelopeFrom, // copie pour archive
          "--upload-file", mailFile,
          "--user", `${smtp.SMTP_USER}:${smtp.SMTP_PASS}`,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (e) {
      fail(`Envoi SMTP échoué : ${e.stderr?.toString() || e.message}`);
    } finally {
      unlinkSync(mailFile);
    }
    const stamp = `Relance envoyée le ${today()} à ${to}`;
    await api("PATCH", `/collections/invoices/records/${doc.id}`, {
      internal_notes: doc.internal_notes ? `${doc.internal_notes}\n${stamp}` : stamp,
    });
    out({ ok: true, sent: true, to, invoice: doc.invoice_number, subject, client: clientLabel });
    break;
  }

  case "delete": {
    const kind = kindOf(args[0]);
    const doc = await findDoc(kind, args[1]);
    for (const it of await docItems(kind, doc.id)) {
      await api("DELETE", `/collections/document_items/records/${it.id}`);
    }
    await api("DELETE", `/collections/${kind.collection}/records/${doc.id}`);
    out({ ok: true, deleted: doc[kind.numberField] ?? doc.id });
    break;
  }

  case "goal": {
    // goal            → afficher l'objectif mensuel (CHF)
    // goal 3500       → le modifier (fichier ~/.config/compta/goal)
    const goalPath = join(homedir(), ".config/compta/goal");
    if (args[0]) {
      const value = Number(args[0]);
      if (!Number.isFinite(value) || value < 0) fail(`Objectif invalide "${args[0]}"`);
      const { writeFileSync } = await import("node:fs");
      writeFileSync(goalPath, String(value));
      out({ ok: true, goal: value });
      break;
    }
    try {
      out({ ok: true, goal: Number(readFileSync(goalPath, "utf8").trim()) });
    } catch {
      out({ ok: true, goal: null, hint: "Aucun objectif défini — `goal 3000` pour en fixer un" });
    }
    break;
  }

  case "report": {
    // report [YYYY-MM] — bilan d'un mois (défaut : mois précédent) + comparatif
    // avec le mois d'avant. Montants en CHF (devise dominante), calculés ici.
    const now = today();
    const targetMonth = args[0] ?? addMonths(now.slice(0, 7), -1);
    const previousMonth = addMonths(targetMonth, -1);
    const { items: allInvoices } = await api(
      "GET",
      `/collections/invoices/records?perPage=500&fields=company,client,currency,status,total,amount_due,invoice_date,due_date,invoice_number,title`,
    );
    const paymentsFilter = encodeURIComponent(`(payment_date>='${previousMonth}-01')`);
    const { items: allPayments } = await api(
      "GET",
      `/collections/payments/records?perPage=500&fields=invoice,amount,payment_date&filter=${paymentsFilter}`,
    );
    const { items: companies } = await api(
      "GET",
      "/collections/companies/records?perPage=200&fields=id,name",
    );
    const companyName = new Map(companies.map((c) => [c.id, c.name]));
    const invoiceById = new Map();
    // Pas d'id dans fields ci-dessus : re-fetch minimal pour lier paiements → factures.
    const { items: invoiceIds } = await api(
      "GET",
      `/collections/invoices/records?perPage=500&fields=id,company,currency`,
    );
    for (const inv of invoiceIds) invoiceById.set(inv.id, inv);

    const monthStats = (month) => {
      const stats = { invoiced: 0, invoiceCount: 0, paid: 0, byCompany: {} };
      for (const inv of allInvoices) {
        if (["draft", "cancelled"].includes(inv.status)) continue;
        if ((inv.invoice_date ?? "").slice(0, 7) !== month) continue;
        stats.invoiced = Math.round((stats.invoiced + inv.total) * 100) / 100;
        stats.invoiceCount += 1;
        const name = companyName.get(inv.company) ?? inv.company;
        stats.byCompany[name] = Math.round(((stats.byCompany[name] ?? 0) + inv.total) * 100) / 100;
      }
      for (const p of allPayments) {
        if ((p.payment_date ?? "").slice(0, 7) !== month) continue;
        stats.paid = Math.round((stats.paid + p.amount) * 100) / 100;
      }
      return stats;
    };

    const current = monthStats(targetMonth);
    const previous = monthStats(previousMonth);
    const outstanding = allInvoices
      .filter((inv) => ["sent", "partial", "overdue"].includes(inv.status) && inv.amount_due > 0)
      .map((inv) => ({
        number: inv.invoice_number,
        company: companyName.get(inv.company) ?? inv.company,
        title: inv.title,
        amountDue: inv.amount_due,
        dueDate: (inv.due_date ?? "").slice(0, 10),
        overdue: Boolean(inv.due_date && inv.due_date.slice(0, 10) < now),
      }));
    let goal = null;
    try {
      goal = Number(readFileSync(join(homedir(), ".config/compta/goal"), "utf8").trim());
    } catch {}
    const delta = Math.round((current.invoiced - previous.invoiced) * 100) / 100;
    out({
      month: targetMonth,
      invoiced: current.invoiced,
      invoiceCount: current.invoiceCount,
      paid: current.paid,
      byCompany: current.byCompany,
      previousMonth,
      previousInvoiced: previous.invoiced,
      delta,
      deltaPct: previous.invoiced > 0 ? Math.round((delta / previous.invoiced) * 1000) / 10 : null,
      goal,
      goalPct: goal ? Math.round((current.invoiced / goal) * 1000) / 10 : null,
      outstanding,
      outstandingTotal: Math.round(outstanding.reduce((a, i) => a + i.amountDue, 0) * 100) / 100,
    });
    break;
  }

  case "raw": {
    const [method, path, body] = args;
    out(await api(method.toUpperCase(), path, body ? JSON.parse(body) : undefined));
    break;
  }

  default:
    fail(
      `Commande inconnue "${cmd ?? ""}". Commandes : companies | clients <entreprise> | client-create <spec> | list quote|invoice [--company X --status s --limit n] | get quote|invoice <n°|id> | create quote|invoice <spec> | update quote|invoice <n°|id> <patch> | set-items quote|invoice <n°|id> <spec> | add-payment <n°|id> <spec> | delete quote|invoice <n°|id> | raw <METHOD> <path> [json]`,
    );
}
