#!/usr/bin/env node
/**
 * rag-query.js — Interfaz simple para consultar el RAG local
 * Lo llama Viernes cuando necesita buscar en documentos indexados.
 *
 * Uso: node rag-query.js "consulta del usuario"
 *
 * Retorna JSON con los resultados.
 */

const path = require('path');
const fs = require('fs');
const INDEX_PATH = path.join(__dirname, '.rag-index.json');

// Stopwords
const SW = new Set(`
de la que el en y a los del se las un por con no una su para es al lo como
más o pero sus le ya este sí porque esta entre por qué todo esta sin era
han he ha haber habría habré habremos habrían habrás habrá habremos
tiene tenga tenían tenido teniendo tu tus te mi mis nuestro nuestros
voy vas va vamos van vaya vayas vayamos vayan
sea seas sean seré serás será seremos serán sería serías seríamos serían
estoy estás está estamos están estaba estabas estábamos estaban estuve
estuvo estuviste estuvimos estuvieron
hago hacer haces hace hacemos hacen hacía hacíamos hacían
digo dice dicen dijo dijeron
puedo puedes puede podemos pueden podía podías podíamos podían pude pudo
pudiste pudimos pudieron
sé sabes sabe sabemos saben sabía sabías sabíamos sabían supe supo supiste supimos supieron
voy vas va vamos van fui fue fuiste fuimos fueron
soy eres es somos son era eras éramos eran
este esta estos estas ese esa esos esa aquel aquella aquellos aquellas
todo toda todos todas mucho mucha muchos muchas poco poca pocos pocas
cierto cierta ciertos ciertas otro otra otros otras mismo misma mismos mismas
tan tanto tanta tantos tantas
aquí allí allá ahí ahora hoy mañana ayer
si no también ya casi siempre nunca jamás
muy bastante demasiado aproximadamente casi
entre hacia hasta mediante para por según sin sobre tras
ante bajo cabe con contra de desde durante en
excepto menos salvo
y e ni o u que
`.split(/\s+/).filter(Boolean));

function tok(t) {
  return t.toLowerCase()
    .replace(/[^a-záéíóúüñ0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !SW.has(w));
}

const query = process.argv.slice(2).join(' ');
if (!query) { process.stdout.write(JSON.stringify({ error: 'No query' })); process.exit(0); }

const tokens = tok(query);
if (!tokens.length) { process.stdout.write(JSON.stringify({ error: 'Query too short', results: [] })); process.exit(0); }

let idx;
try { idx = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8')); }
catch { process.stdout.write(JSON.stringify({ results: [] })); process.exit(0); }

const total = idx.docs.length;
if (!total) { process.stdout.write(JSON.stringify({ results: [] })); process.exit(0); }

const scores = {};
for (const term of tokens) {
  const docMap = idx.terms[term];
  if (!docMap) continue;
  const docsWithTerm = Object.keys(docMap).length;
  const idf = Math.log((total + 1) / (docsWithTerm + 1)) + 1;
  for (const [did, freq] of Object.entries(docMap)) {
    scores[did] = (scores[did] || 0) + (freq * idf);
  }
}

const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 5);
const results = [];

for (const [did, score] of sorted) {
  const doc = idx.docs.find(d => d.id === parseInt(did));
  if (!doc) continue;
  let s2 = score;
  if (doc.content.toLowerCase().includes(query.toLowerCase())) s2 *= 2;
  
  let snippet = doc.content.length > 300 ? doc.content.slice(0, 300) + '...' : doc.content;
  results.push({ filename: doc.fname, content: snippet, score: Math.round(s2) });
}

process.stdout.write(JSON.stringify({ results, query, tokens }));
