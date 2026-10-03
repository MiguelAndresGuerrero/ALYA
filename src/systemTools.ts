import * as si from 'systeminformation';
import { exec } from 'child_process';
import * as os from 'os';
import { runPowerShell } from './powershell';
import type { SystemStatus, CpuStatus, RamStatus, ProcessInfo } from './types';

// Info estática del CPU (modelo, núcleos) — no cambia, la pedimos una sola vez.
let cachedCpuInfo: { model: string; cores: number } | null = null;

async function getCpuInfo() {
  if (!cachedCpuInfo) {
    const cpu = await si.cpu();
    cachedCpuInfo = { model: `${cpu.manufacturer} ${cpu.brand}`, cores: cpu.cores };
  }
  return cachedCpuInfo;
}

// Windows (Explorador, Administrador de tareas) muestra los tamaños en
// unidades de 1024: "31,4 GB" de RAM, no 33,7. Se usa la misma cuenta
// para que los números de ALYA coincidan con los que ves en Windows.
const GIB = 1024 ** 3;

// --- Uso de CPU ---
// Se mide como lo hace el Administrador de tareas: cuánto trabajó el
// procesador durante un rato (acá, ~1 segundo), comparando dos lecturas
// de los contadores de tiempo de cada núcleo. Una sola lectura "al
// instante" no sirve: da cualquier cosa, sobre todo si justo en ese
// momento la propia consulta está arrancando procesos.
interface CpuSample {
  idle: number;
  total: number;
  at: number;
}

function takeCpuSample(): CpuSample {
  let idle = 0;
  let total = 0;
  for (const core of os.cpus()) {
    const t = core.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total, at: Date.now() };
}

function loadBetween(from: CpuSample, to: CpuSample): number {
  const total = to.total - from.total;
  if (total <= 0) return 0;
  const busy = total - (to.idle - from.idle);
  return Math.max(0, Math.min(100, (busy / total) * 100));
}

const CPU_SAMPLE_MS = 1000;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
let lastCpuSample: CpuSample | null = null;

/**
 * Porcentaje de uso del CPU.
 * - fresh = true: espera 1 segundo y mide ese segundo exacto (para cuando
 *   se pregunta "¿cómo está mi PC?": conviene medir ANTES de lanzar el
 *   resto de las consultas, que también gastan CPU).
 * - fresh = false: si hay una lectura reciente (panel de estado, que
 *   consulta cada pocos segundos), mide desde esa lectura sin esperar.
 */
async function measureCpuLoad(fresh: boolean): Promise<number> {
  const now = takeCpuSample();
  const previous = lastCpuSample;
  const age = previous ? now.at - previous.at : Infinity;

  if (!fresh && previous && age >= 900 && age <= 15000) {
    lastCpuSample = now;
    return loadBetween(previous, now);
  }

  await sleep(CPU_SAMPLE_MS);
  const later = takeCpuSample();
  lastCpuSample = later;
  return loadBetween(now, later);
}

async function getRamStatus(): Promise<RamStatus> {
  const mem = await si.mem();
  // "En uso" = total menos disponible, igual que el Administrador de tareas
  // (la memoria en caché no cuenta como usada: Windows la libera si hace falta).
  const used = mem.total - mem.available;
  return {
    totalGB: (mem.total / GIB).toFixed(1),
    usedGB: (used / GIB).toFixed(1),
    usedPercent: ((used / mem.total) * 100).toFixed(1),
  };
}

/**
 * Datos BARATOS de pedir (CPU/RAM en vivo). Seguro de llamar seguido
 * (cada pocos segundos) sin preocuparse por el costo.
 */
export async function getQuickStatus(freshCpu = false): Promise<{ cpu: CpuStatus; ram: RamStatus }> {
  const cpuInfo = await getCpuInfo();
  const load = await measureCpuLoad(freshCpu);
  const ram = await getRamStatus();

  return {
    cpu: {
      model: cpuInfo.model,
      cores: cpuInfo.cores,
      loadPercent: load.toFixed(1),
    },
    ram,
  };
}

// Uso de la GPU según los contadores de rendimiento de Windows — los
// mismos que usa el Administrador de tareas. systeminformation solo sabe
// leer el uso en tarjetas NVIDIA; con gráficos AMD o Intel lo deja vacío.
// Se suma el uso de cada tipo de motor (3D, video, copia...) y se toma el
// mayor, que es lo que muestra el Administrador de tareas.
const GPU_LOAD_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$engines = Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine',
  '$byType = @{}',
  "foreach ($e in $engines) { $t = ($e.Name -split 'engtype_')[-1]; $byType[$t] = [double]$byType[$t] + [double]$e.UtilizationPercentage }",
  '$max = 0',
  'foreach ($v in $byType.Values) { if ($v -gt $max) { $max = $v } }',
  '[int][math]::Round([math]::Min($max, 100))',
].join('\n');

async function getGpuLoadFromWindows(): Promise<number | null> {
  const output = await runPowerShell(GPU_LOAD_SCRIPT, 7000);
  if (output === null) {
    console.warn('[ALYA] No se pudo leer el uso de la GPU desde Windows (la tarjeta de sistema sale sin GPU).');
    return null;
  }
  const value = parseInt(output.trim().split(/\s+/).pop() ?? '', 10);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
}

/**
 * Obtiene el estado del sistema: CPU, RAM, GPU y almacenamiento.
 *
 * detailed = false (por defecto): la versión barata, para el panel de
 * estado que consulta cada pocos segundos.
 * detailed = true: para cuando se le pregunta a ALYA por el PC. Mide el
 * CPU durante un segundo limpio ANTES de lanzar las demás consultas (que
 * arrancan procesos y lo inflarían) y, si la GPU no es NVIDIA, le
 * pregunta el uso a Windows.
 *
 * NO incluye "procesos con más consumo" — esa consulta (si.processes())
 * es cara en Windows (puede tardar 20+ segundos en máquinas con muchos
 * procesos corriendo). Para eso usar getTopProcesses() por separado,
 * solo cuando el usuario lo pida explícitamente.
 */
export async function getStatus(detailed = false): Promise<SystemStatus> {
  const quick = await getQuickStatus(detailed);
  const [graphics, fsSize] = await Promise.all([si.graphics(), si.fsSize()]);

  const storage = fsSize.map((d) => ({
    mount: d.mount,
    usePercent: d.use?.toFixed(0) ?? '0',
    sizeGB: (d.size / GIB).toFixed(0),
    freeGB: (Math.max(0, d.size - d.used) / GIB).toFixed(0),
  }));

  const gpu = graphics.controllers.map((g) => ({
    model: g.model,
    vramMB: g.vram ?? null,
    loadPercent: g.utilizationGpu ?? null,
  }));

  // Ninguna GPU con dato de uso (gráficos AMD / Intel): se le pregunta a
  // Windows y se anota en la primera. (No se exige que haya una sola:
  // Windows suele listar además adaptadores virtuales.)
  if (detailed && gpu.length > 0 && gpu.every((g) => g.loadPercent === null)) {
    gpu[0].loadPercent = await getGpuLoadFromWindows();
  }

  return { cpu: quick.cpu, ram: quick.ram, gpu, storage };
}

/**
 * Lista de procesos que más CPU/RAM consumen. CARA de pedir (puede
 * tardar varios segundos, según cuántos procesos tenga la PC corriendo).
 * Pedir solo bajo demanda (ej. el usuario aprieta un botón), nunca en
 * un intervalo automático.
 */
export async function getTopProcesses(): Promise<ProcessInfo[]> {
  const procs = await si.processes();

  return procs.list
    .sort((a, b) => (b.mem ?? 0) - (a.mem ?? 0))
    .slice(0, 5)
    .map((p) => ({
      name: p.name,
      cpu: p.cpu?.toFixed(1) ?? '0.0',
      memPercent: p.mem?.toFixed(1) ?? '0.0',
    }));
}

/**
 * Genera un resumen corto en texto, listo para mostrar o leer en voz alta.
 * (No incluye el proceso top a propósito, para no pagar el costo de
 * getTopProcesses() en algo que se puede pedir seguido, ej. por voz).
 */
export async function getStatusSummary(): Promise<string> {
  const s = await getStatus();
  return `CPU al ${s.cpu.loadPercent}%. RAM al ${s.ram.usedPercent}% (${s.ram.usedGB} de ${s.ram.totalGB} GB).`;
}

/**
 * Mide la latencia real de internet, pingueando un servidor confiable
 * (8.8.8.8, DNS de Google). Tarda ~1 segundo, así que se pide bajo
 * demanda (botón), no automático — igual que la lista de procesos.
 */
export function getNetworkLatency(): Promise<number | null> {
  return new Promise((resolve) => {
    // -n 1 (Windows) = un solo ping, para no demorar de más.
    exec('ping -n 1 8.8.8.8', { timeout: 5000 }, (error, stdout) => {
      if (error) return resolve(null); // sin internet, o el comando falló

      // Busca algo como "tiempo=21ms" o "time=21ms" (varía según idioma
      // de Windows) dentro de la salida del comando.
      const match = stdout.match(/(?:tiempo|time)[=<]\s*(\d+)\s*ms/i);
      resolve(match ? parseInt(match[1], 10) : null);
    });
  });
}