import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/* Les vignettes ne téléchargent pas l'original : une miniature se fabrique et se garde. */

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'miniatures-'));
process.env.BELUGA_DATA = DATA;
const { largeurDemandee, miniatureDe } = await import('../miniatures.js');

test('la largeur demandée est bornée et arrondie par paliers', () => {
  assert.equal(largeurDemandee(null), null);
  assert.equal(largeurDemandee('abc'), null);
  assert.equal(largeurDemandee('10'), null);
  assert.equal(largeurDemandee('5000'), null);
  assert.equal(largeurDemandee('480'), 480);
  assert.equal(largeurDemandee('300'), 320);
});

test('une grande image devient une miniature plus légère, gardée sur disque', async (t) => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    t.skip('ffmpeg absent');
    return;
  }
  const source = path.join(DATA, 'grande.png');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1200x2600', '-frames:v', '1', source]);
  const mini = await miniatureDe(source, 'image/png', 320);
  assert.ok(mini, 'une miniature est rendue');
  assert.ok(mini!.taille < fs.statSync(source).size, 'elle est plus légère que l’original');
  const taille = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width', '-of', 'csv=p=0', mini!.file]).toString().trim();
  assert.equal(taille, '320');
  const encore = await miniatureDe(source, 'image/png', 320);
  assert.equal(encore!.file, mini!.file, 'la seconde demande reprend le cache');
  assert.equal(await miniatureDe(source, 'image/gif', 320), null, 'un format inconnu sert l’original');
});

/** Un PDF d'une page, écrit à la main (table des renvois calculée). */
function petitPdf(): Buffer {
  const objets = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 4 0 R >>',
    '<< /Length 33 >>\nstream\n0 0 1 rg 50 50 500 700 re f\nendstream',
  ];
  let corps = '%PDF-1.4\n';
  const positions: number[] = [];
  objets.forEach((o, i) => {
    positions.push(Buffer.byteLength(corps));
    corps += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(corps);
  corps += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`;
  for (const p of positions) corps += `${String(p).padStart(10, '0')} 00000 n \n`;
  corps += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(corps);
}

test('un PDF a pour vignette sa première page, en PNG', async (t) => {
  try {
    execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' });
  } catch {
    t.skip('pdftoppm absent');
    return;
  }
  const source = path.join(DATA, 'rapport.pdf');
  fs.writeFileSync(source, petitPdf());
  const mini = await miniatureDe(source, 'application/pdf', 320);
  assert.ok(mini, 'une vignette est rendue');
  assert.equal(mini!.mime, 'image/png', 'elle se sert en PNG, pas sous le type du PDF');
  assert.equal(fs.readFileSync(mini!.file).subarray(1, 4).toString(), 'PNG');
  const encore = await miniatureDe(source, 'application/pdf', 320);
  assert.equal(encore!.file, mini!.file, 'la seconde demande reprend le cache');

  const casse = path.join(DATA, 'casse.pdf');
  fs.writeFileSync(casse, 'pas un pdf');
  assert.equal(await miniatureDe(casse, 'application/pdf', 320), null, 'un PDF illisible rend null, sans figer');
});
