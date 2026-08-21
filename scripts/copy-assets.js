// tsc solo compila archivos .ts — este script copia a mano lo que no es
// código TypeScript (por ahora, solo status.html) a la carpeta compilada.
const fs = require('fs');
const path = require('path');

const files = ['status.html', 'chat.html', 'settings.html', 'setup.html'];

for (const file of files) {
  const src = path.join(__dirname, '..', 'src', file);
  const dest = path.join(__dirname, '..', 'out', file);
  fs.copyFileSync(src, dest);
  console.log(`Copiado: ${file} -> out/${file}`);
}