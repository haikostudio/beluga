/**
 * LE PLAN D'UNE CARTE, À EMPORTER : en PDF (mis en page par le Chrome du
 * système, comme le cahier des charges) ou en texte Markdown. Le bouton vit
 * dans l'entête du volet du plan (`web/src/components/gestes-du-plan.tsx`).
 */
import { htmlDuCahier, nomDuPlanExporte, planAEmporter } from '@beluga/shared';
import * as store from './store.js';

export async function exporterLePlan(
  cardId: string,
  numero: number,
  format: 'pdf' | 'md',
): Promise<{ nom: string; type: string; contenu: Buffer } | null> {
  const carte = store.getCard(cardId);
  const plan = carte?.parcours?.plans?.find((p) => p.numero === numero);
  if (!carte || !plan?.texte?.trim()) return null;
  const texte = planAEmporter(plan.texte);
  const nom = nomDuPlanExporte(plan.numero, carte.title, format);
  if (format === 'md') return { nom, type: 'text/markdown; charset=utf-8', contenu: Buffer.from(texte, 'utf8') };
  const { chromium } = await import('playwright');
  const navigateur = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await navigateur.newPage();
    await page.setContent(htmlDuCahier(texte, nom.replace(/\.pdf$/, '')), { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
    });
    return { nom, type: 'application/pdf', contenu: Buffer.from(pdf) };
  } finally {
    await navigateur.close().catch(() => {});
  }
}
