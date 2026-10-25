// Assembles src/ into a single standalone index.html that opens in any browser.
//
// The upstream Claude Design export was one 4.3MB self-unpacking bundle whose
// bulk was 50 base64 woff2 faces. Here the fonts come from Google Fonts over
// the network (same @import the rest of design-export/ uses) and only the
// runtime is inlined, so the page stays diffable and hand-editable.
//
//   node design-export/shulchan/build.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, 'src', ...p), 'utf8');

const template = src('template.html');
const script = src('dc-script.js');
const props = JSON.parse(src('props.json'));

// Order matters: dc-runtime reads window.React / window.ReactDOM on load.
const vendor = [
  'react.production.min.js',
  'react-dom.production.min.js',
  'dc-runtime.js',
].map((f) => src('vendor', f));

const attr = (s) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const html = `<!DOCTYPE html>
<html lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>שולחן משפחתי</title>
${vendor.map((v) => `<script>\n${v}\n</script>`).join('\n')}
</head>
<body>
${template}
<script type="text/x-dc" data-dc-script data-props="${attr(JSON.stringify(props))}">
${script}
</script>
</body>
</html>
`;

const out = join(here, 'index.html');
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)}KB)`);
