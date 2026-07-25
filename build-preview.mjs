/* Builds dist/preview.html — ONE self-contained HTML file for QA / sharing.
   The shipped game (index.html) stays modern ES modules; this bundle exists because
   sandboxed iframes and file:// block both ES-module imports and data: URLs.
   Strategy: emit a single CLASSIC <script> — maximum compatibility, zero CSP issues.
   The SAME js/main.js source is reused; only its import lines are stripped. */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* dependency order matters */
const ADDONS = [
  'lib/jsm/shaders/CopyShader.js',
  'lib/jsm/shaders/LuminosityHighPassShader.js',
  'lib/jsm/shaders/OutputShader.js',
  'lib/jsm/postprocessing/Pass.js',
  'lib/jsm/postprocessing/ShaderPass.js',
  'lib/jsm/postprocessing/MaskPass.js',
  'lib/jsm/postprocessing/RenderPass.js',
  'lib/jsm/postprocessing/UnrealBloomPass.js',
  'lib/jsm/postprocessing/EffectComposer.js',
  'lib/jsm/postprocessing/OutputPass.js',
  'lib/jsm/utils/BufferGeometryUtils.js'
];

/* Each addon becomes its own IIFE:
   - names imported from 'three' are injected as locals from the THREE namespace
   - names imported from sibling addons are read off the shared NH registry
   - its own exports are published back onto NH
   This isolation is required: several addons import the same three.js names, so a
   flat concatenation produces duplicate `const` declarations. */
function moduleToClassic(src) {
  const threeLocals = new Set();
  const addonLocals = new Set();
  src.replace(/import\s*\{([^}]*)\}\s*from\s*['"]three['"];?/g, (m, names) => {
    names.split(',').forEach(n => {
      const t = n.trim(); if (!t) return;
      const as = t.split(/\s+as\s+/);
      threeLocals.add(as.length === 2 ? `${as[1].trim()} = THREE.${as[0].trim()}` : `${t} = THREE.${t}`);
    });
    return '';
  });
  src.replace(/import\s*\{([^}]*)\}\s*from\s*['"]\.[^'"]*['"];?/g, (m, names) => {
    names.split(',').forEach(n => {
      const t = n.trim(); if (!t) return;
      const as = t.split(/\s+as\s+/);
      addonLocals.add(as.length === 2 ? `${as[1].trim()} = NH.${as[0].trim()}` : `${t} = NH.${t}`);
    });
    return '';
  });
  /* collect exported names so we can publish them */
  const exported = new Set();
  src.replace(/^\s*export\s*\{([^}]*)\};?\s*$/gm, (m, names) => {
    names.split(',').forEach(n => {
      const t = n.trim(); if (!t) return;
      exported.add(t.split(/\s+as\s+/).pop().trim());
    });
    return '';
  });
  const body = src
    .replace(/import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];?/g, '')   // brace imports (multiline safe)
    .replace(/^\s*import\s+[^{\n]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '')
    .replace(/^(\s*)export\s+(default\s+)?/gm, '$1');
  let out = '(function(){\n';
  if (threeLocals.size) out += `const ${[...threeLocals].join(', ')};\n`;
  if (addonLocals.size) out += `const ${[...addonLocals].join(', ')};\n`;
  out += body + '\n';
  for (const e of exported) out += `NH.${e} = ${e};\n`;
  out += '})();\n';
  return out;
}

/* the game module: strip its imports (THREE + addons become globals in the IIFE scope) */
function gameToClassic(src) {
  return src
    .replace(/^\s*import\s+\*\s+as\s+THREE\s+from\s*['"]three['"];?\s*$/gm, '')
    .replace(/^\s*import\s+\{[^}]*\}\s*from\s*['"]three\/addons\/[^'"]*['"];?\s*$/gm, '');
}

let js = '/* ===== Three.js r185 (CommonJS build, self-contained) ===== */\n';
js += '(function(){\nconst exports = {}; const module = { exports };\n';
js += read('lib/three.cjs.js') + '\n';
js += 'window.THREE = module.exports;\n})();\n';
js += 'const THREE = window.THREE;\n';
js += '/* ===== official post-processing addons ===== */\n';
js += 'const NH = {};\n';
for (const a of ADDONS) js += `\n/* --- ${a} --- */\n` + moduleToClassic(read(a)) + '\n';
/* expose the addon classes the game imports by name */
js += 'const { EffectComposer, RenderPass, UnrealBloomPass, ShaderPass, OutputPass, mergeGeometries } = NH;\n';
js += '\n/* ===== game ===== */\n' + gameToClassic(read('js/main.js')) + '\n';

let html = read('index.html');
html = html.replace(/<link rel="stylesheet" href="style\.css"\/>/, '<style>\n' + read('style.css') + '\n</style>');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, '');
html = html.replace(/<script type="module" src="js\/main\.js"><\/script>/,
  () => '<script>\n' + js + '\n</script>');

if (/(?:src|href)="(?:lib|js|style)/.test(html)) throw new Error('inline failed — external refs remain');
if (/\bimport\s|\bexport\s\{/.test(js.slice(js.indexOf('/* ===== official')))) {
  console.warn('warning: residual module syntax detected in addon/game section');
}
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist/preview.html'), html);
console.log('preview built:', (fs.statSync(path.join(ROOT, 'dist/preview.html')).size / 1024).toFixed(0) + ' KB');
