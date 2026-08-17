import ts from 'typescript';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const SOURCE='web/src';
const fichiers=[];(function m(d){for(const e of readdirSync(d)){const p=join(d,e);statSync(p).isDirectory()?m(p):/\.tsx?$/.test(p)&&fichiers.push(p);}})(SOURCE);
const cles=new Set();
for(const f of fichiers){
  const src=readFileSync(f,'utf8');
  const arbre=ts.createSourceFile(f,src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const visiter=(n)=>{
    if(ts.isCallExpression(n)&&n.expression.getText()==='t'&&n.arguments.length&&ts.isStringLiteral(n.arguments[0])){
      const v=n.arguments[0].text; if(v.trim()) cles.add(v);
    }
    ts.forEachChild(n,visiter);
  };
  ts.forEachChild(arbre,visiter);
}
// libellés venus des catalogues partagés, affichés tels quels par l'interface
const shared=readFileSync('shared/src/columns.ts','utf8');
for(const m of shared.matchAll(/^\s+\w+: '([^']+)',$/gm)) cles.add(m[1]);
const themes=readFileSync('shared/src/themes.ts','utf8');
for(const m of themes.matchAll(/libelle: '([^']+)'/g)) cles.add(m[1]);
for(const m of themes.matchAll(/description:\s*\n?\s*'((?:[^'\\]|\\.)*)'/g)) cles.add(m[1].replace(/\\'/g,"'"));
writeFileSync('/tmp/cles-finales.json',JSON.stringify([...cles].sort((a,b)=>a.localeCompare(b,'fr')),null,1));
console.log(cles.size);
