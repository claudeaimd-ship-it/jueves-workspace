#!/usr/bin/env node
/**
 * rag-local.js — RAG 100% local para Viernes v3
 * TF-IDF sobre archivo JSON. Cero deps externas, ultra-ligero.
 * Ideal para Raspberry Pi.
 *
 * Uso:
 *   node rag-local.js add <archivo>   — indexar
 *   node rag-local.js search <query>  — buscar
 *   node rag-local.js list            — listar
 *   node rag-local.js rm <archivo>    — eliminar
 */

const path = require('path');
const fs = require('fs');

const INDEX_PATH = path.join(__dirname, '.rag-index.json');

// === Stopwords español ===
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

function readIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8')); }
  catch { return { docs: [], terms: {} }; }
}

function writeIndex(idx) {
  fs.writeFileSync(INDEX_PATH, JSON.stringify(idx));
}

// Chunking por secciones ##, o párrafos agrupados
function chunkText(text) {
  const sections = text.split(/(?=^#{1,3}\s)/m).filter(s => s.trim());
  if (sections.length > 3) return sections;
  const paras = text.split(/\n\n+/).filter(p => p.trim());
  const chunks = [];
  let cur = [], curLen = 0;
  for (const p of paras) {
    const pLen = p.split(/\s+/).length;
    if (curLen + pLen > 200 && cur.length) {
      chunks.push(cur.join('\n\n'));
      cur = [p]; curLen = pLen;
    } else {
      cur.push(p); curLen += pLen;
    }
  }
  if (cur.length) chunks.push(cur.join('\n\n'));
  return chunks.length ? chunks : [text];
}

function addFile(fp) {
  const ap = path.resolve(fp);
  if (!fs.existsSync(ap)) { console.error(`❌ No encontrado: ${ap}`); process.exit(1); }
  const content = fs.readFileSync(ap, 'utf-8');
  if (!content.trim()) { console.error('❌ Vacío'); process.exit(1); }
  
  const fn = path.basename(fp);
  const chunks = chunkText(content);
  console.log(`📄 ${fn}: ${chunks.length} chunks`);
  
  const idx = readIndex();
  const oldIds = [];
  
  // Eliminar índice previo del mismo archivo
  for (const d of idx.docs) {
    if (d.fname === fn) oldIds.push(d.id);
  }
  for (const id of oldIds) {
    // Eliminar términos asociados
    for (const [term, entries] of Object.entries(idx.terms)) {
      delete entries[id];
      if (Object.keys(idx.terms[term]).length === 0) delete idx.terms[term];
    }
  }
  idx.docs = idx.docs.filter(d => d.fname !== fn);
  
  let nextId = idx.docs.length > 0 ? Math.max(...idx.docs.map(d => d.id)) + 1 : 1;
  
  for (let i = 0; i < chunks.length; i++) {
    const did = nextId++;
    idx.docs.push({ id: did, fname: fn, cidx: i, content: chunks[i] });
    const tokens = tok(chunks[i]);
    const freq = {};
    for (const t of tokens) freq[t] = (freq[t] || 0) + 1;
    const mf = Math.max(...Object.values(freq), 1);
    for (const [term, f] of Object.entries(freq)) {
      if (!idx.terms[term]) idx.terms[term] = {};
      idx.terms[term][did] = f / mf;
    }
  }
  
  writeIndex(idx);
  console.log(`✅ ${fn} indexado (${chunks.length} chunks)`);
}

function search(query, nR = 5) {
  const tokens = tok(query);
  if (!tokens.length) { console.log('⚠️ Búsqueda muy corta'); return []; }
  
  const idx = readIndex();
  const total = idx.docs.length;
  if (!total) { console.log('📭 No hay documentos indexados'); return []; }
  
  console.log(`🔍 Buscando: "${query}" → ${tokens.join(', ')}`);
  
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
  
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, nR);
  if (!sorted.length) { console.log('😕 Sin resultados'); return []; }
  
  console.log(`\n📊 Top ${sorted.length}:\n`);
  const results = [];
  
  for (const [did, score] of sorted) {
    const doc = idx.docs.find(d => d.id === parseInt(did));
    if (!doc) continue;
    
    let s2 = score;
    const qLower = query.toLowerCase();
    if (doc.content.toLowerCase().includes(qLower)) s2 *= 2;
    
    let snip = doc.content;
    const idxc = doc.content.toLowerCase().indexOf(qLower);
    if (idxc >= 0) {
      const st = Math.max(0, idxc - 80);
      const en = Math.min(doc.content.length, idxc + query.length + 180);
      snip = (st > 0 ? '...' : '') + doc.content.slice(st, en) + (en < doc.content.length ? '...' : '');
    } else {
      snip = doc.content.length > 250 ? doc.content.slice(0, 250) + '...' : doc.content;
    }
    
    console.log(`  📁 ${doc.fname} (#${doc.cidx}) — ${s2.toFixed(0)} pts`);
    console.log(`  📝 ${snip.replace(/\n/g, ' ')}\n`);
    results.push({ filename: doc.fname, chunk: doc.cidx, content: doc.content, score: s2 });
  }
  
  return results;
}

function listDocs() {
  const idx = readIndex();
  const groups = {};
  for (const d of idx.docs) {
    if (!groups[d.fname]) groups[d.fname] = 0;
    groups[d.fname]++;
  }
  const keys = Object.keys(groups);
  if (!keys.length) { console.log('📭 Vacío'); return; }
  console.log(`📚 Documentos (${keys.length}):\n`);
  for (const k of keys) console.log(`  📄 ${k} — ${groups[k]} chunks`);
  console.log(`\n📊 Total de términos indexados: ${Object.keys(idx.terms).length}`);
}

function rmFile(fp) {
  const fn = path.basename(fp);
  const idx = readIndex();
  const oldIds = idx.docs.filter(d => d.fname === fn).map(d => d.id);
  for (const id of oldIds) {
    for (const [term, entries] of Object.entries(idx.terms)) {
      delete entries[id];
      if (Object.keys(idx.terms[term]).length === 0) delete idx.terms[term];
    }
  }
  idx.docs = idx.docs.filter(d => d.fname !== fn);
  writeIndex(idx);
  console.log(`🗑️  ${fn} eliminado`);
}

// CLI
const cmd = process.argv[2];
if (!cmd) {
  console.log(`
📚 RAG Local v3 — TF-IDF sobre JSON, zero deps, para Pi

  node rag-local.js add <file>    Indexar archivo
  node rag-local.js search <q>    Buscar
  node rag-local.js list          Listar documentos
  node rag-local.js rm <file>     Eliminar del índice
  `);
  process.exit(0);
}
try {
  switch (cmd) {
    case 'add':
      if (!process.argv[3]) throw Error('Especifica un archivo');
      addFile(process.argv[3]);
      break;
    case 'search':
      if (!process.argv[3]) throw Error('Especifica búsqueda');
      search(process.argv.slice(3).join(' '));
      break;
    case 'list': listDocs(); break;
    case 'rm':
      if (!process.argv[3]) throw Error('Especifica un archivo');
      rmFile(process.argv[3]);
      break;
    default:
      console.error('Comando desconocido:', cmd);
      process.exit(1);
  }
} catch (e) {
  console.error('❌', e.message);
  process.exit(1);
}
