import * as http from 'http';

let currentTitle: string | null = null;
let server: http.Server | null = null;

const PORT = 4287; // puerto local, solo accesible desde tu propia PC

/** Actualiza qué se está reproduciendo ahora — lo llama webBrowser.ts. */
export function setNowPlaying(title: string | null): void {
    currentTitle = title;
}

const OVERLAY_HTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body { margin: 0; background: transparent; font-family: 'Segoe UI', sans-serif; }
  #box {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    background: rgba(10, 14, 20, 0.78);
    color: #e4edf5;
    padding: 10px 18px;
    border-radius: 20px;
    border: 1px solid rgba(79, 209, 255, 0.4);
    font-size: 16px;
    max-width: 480px;
    position: fixed;
    bottom: 24px;
    left: 24px;
    opacity: 0;
    transition: opacity 0.4s ease;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  #box.show { opacity: 1; }
  #icon { color: #4fd1ff; flex-shrink: 0; }
  #text { overflow: hidden; text-overflow: ellipsis; }
</style></head>
<body>
  <div id="box"><span id="icon">&#9835;</span><span id="text"></span></div>
  <script>
    async function poll() {
      try {
        const res = await fetch('/api/now-playing');
        const data = await res.json();
        const box = document.getElementById('box');
        const text = document.getElementById('text');
        if (data.title) {
          text.textContent = 'Sonando ahora: ' + data.title;
          box.classList.add('show');
        } else {
          box.classList.remove('show');
        }
      } catch (e) {
        // servidor no respondió esta vez, reintentamos en el próximo ciclo
      }
      setTimeout(poll, 3000);
    }
    poll();
  </script>
</body></html>`;

/**
 * Arranca el servidor del overlay (si no estaba corriendo ya) y devuelve
 * el puerto donde quedó escuchando, para armar la URL a pegar en OBS.
 */
export function startOverlayServer(): number {
    if (server) return PORT;

    server = http.createServer((req, res) => {
        if (req.url === '/api/now-playing') {
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            });
            res.end(JSON.stringify({ title: currentTitle }));
        } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(OVERLAY_HTML);
        }
    });

    // Solo accesible desde esta misma PC (127.0.0.1) — no expuesto a la red.
    server.listen(PORT, '127.0.0.1');

    return PORT;
}