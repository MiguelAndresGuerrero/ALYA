import * as http from 'http';
import * as fs from 'fs';
import { getResourcePath } from './resourcePaths';

let currentTitle: string | null = null;
let server: http.Server | null = null;

const PORT = 4287; // puerto local, solo accesible desde tu propia PC

/** Actualiza qué se está reproduciendo ahora — lo llama webBrowser.ts. */
export function setNowPlaying(title: string | null): void {
  currentTitle = title;
}

/**
 * Convierte el avatar a un data URI para embeberlo directo en el HTML
 * (así el overlay no depende de una segunda petición al servidor, ni de
 * rutas de archivo que OBS podría no resolver igual que un navegador).
 */
function getAvatarDataUri(): string {
  try {
    const buffer = fs.readFileSync(getResourcePath('build', 'avatar.png'));
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch {
    return ''; // si falla, el overlay sigue funcionando, solo sin el avatar
  }
}

function buildOverlayHtml(): string {
  const avatarDataUri = getAvatarDataUri();

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  :root {
    --pink: #ff5ea8;
    --cyan: #4fd1ff;
    --text: #e4edf5;
    --dim: #9db0c2;
  }
  body { margin: 0; background: transparent; font-family: 'Segoe UI', sans-serif; }

  #card {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    background: rgba(10, 14, 20, 0.82);
    color: var(--text);
    padding: 10px 20px 10px 10px;
    border-radius: 14px;
    border: 1px solid rgba(79, 209, 255, 0.35);
    box-shadow: 0 0 22px rgba(79, 209, 255, 0.18), 0 4px 18px rgba(0,0,0,0.4);
    font-size: 15px;
    max-width: 460px;
    position: fixed;
    bottom: 24px;
    left: 24px;
    opacity: 0;
    transform: translateY(6px);
    transition: opacity 0.4s ease, transform 0.4s ease;
  }
  #card.show { opacity: 1; transform: translateY(0); }

  /* Marcos de esquina tipo HUD, a juego con el resto de ALYA */
  #card::before, #card::after {
    content: '';
    position: absolute;
    width: 9px;
    height: 9px;
    pointer-events: none;
  }
  #card::before { top: -1px; left: -1px; border-top: 2px solid var(--cyan); border-left: 2px solid var(--cyan); }
  #card::after { bottom: -1px; right: -1px; border-bottom: 2px solid var(--pink); border-right: 2px solid var(--pink); }

  #avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    flex-shrink: 0;
    background: conic-gradient(from 200deg, var(--pink), var(--cyan), var(--pink));
    padding: 2px;
    box-shadow: 0 0 12px rgba(79,209,255,0.4);
  }
  #avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block; }

  #info { min-width: 0; }
  #label {
    font-size: 9px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--dim);
    font-family: 'Cascadia Code', 'Consolas', monospace;
    margin-bottom: 2px;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  #pulse {
    width: 5px; height: 5px; border-radius: 50%;
    background: #4fffa0; box-shadow: 0 0 6px #4fffa0;
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
  #title {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style></head>
<body>
  <div id="card">
    <div id="avatar"><img src="${avatarDataUri}" alt="ALYA" /></div>
    <div id="info">
      <div id="label"><span id="pulse"></span>ALYA · SONANDO AHORA</div>
      <div id="title"></div>
    </div>
  </div>
  <script>
    async function poll() {
      try {
        const res = await fetch('/api/now-playing');
        const data = await res.json();
        const card = document.getElementById('card');
        const title = document.getElementById('title');
        if (data.title) {
          title.textContent = data.title;
          card.classList.add('show');
        } else {
          card.classList.remove('show');
        }
      } catch (e) {
        // servidor no respondió esta vez, reintentamos en el próximo ciclo
      }
      setTimeout(poll, 3000);
    }
    poll();
  </script>
</body></html>`;
}

/**
 * Arranca el servidor del overlay (si no estaba corriendo ya) y devuelve
 * el puerto donde quedó escuchando, para armar la URL a pegar en OBS.
 */
export function startOverlayServer(): number {
  if (server) return PORT;

  // El HTML (con el avatar embebido) se arma una sola vez al arrancar,
  // no en cada petición — no cambia mientras la app sigue corriendo.
  const overlayHtml = buildOverlayHtml();

  server = http.createServer((req, res) => {
    if (req.url === '/api/now-playing') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ title: currentTitle }));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(overlayHtml);
    }
  });

  // Solo accesible desde esta misma PC (127.0.0.1) — no expuesto a la red.
  server.listen(PORT, '127.0.0.1');

  return PORT;
}