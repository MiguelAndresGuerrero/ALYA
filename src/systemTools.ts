import * as si from 'systeminformation';
import { exec } from 'child_process';
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

/**
 * Datos BARATOS de pedir (CPU/RAM en vivo). Seguro de llamar seguido
 * (cada pocos segundos) sin preocuparse por el costo.
 */
export async function getQuickStatus(): Promise<{ cpu: CpuStatus; ram: RamStatus }> {
  const [cpuInfo, mem, load] = await Promise.all([getCpuInfo(), si.mem(), si.currentLoad()]);

  return {
    cpu: {
      model: cpuInfo.model,
      cores: cpuInfo.cores,
      loadPercent: load.currentLoad.toFixed(1),
    },
    ram: {
      totalGB: (mem.total / 1e9).toFixed(1),
      usedPercent: ((mem.active / mem.total) * 100).toFixed(1),
    },
  };
}

/**
 * Obtiene el estado del sistema: CPU, RAM, GPU y almacenamiento.
 * Todo esto es relativamente barato de pedir seguido.
 *
 * NO incluye "procesos con más consumo" — esa consulta (si.processes())
 * es cara en Windows (puede tardar 20+ segundos en máquinas con muchos
 * procesos corriendo). Para eso usar getTopProcesses() por separado,
 * solo cuando el usuario lo pida explícitamente.
 */
export async function getStatus(): Promise<SystemStatus> {
  const [quick, graphics, fsSize] = await Promise.all([
    getQuickStatus(),
    si.graphics(),
    si.fsSize(),
  ]);

  const storage = fsSize.map((d) => ({
    mount: d.mount,
    usePercent: d.use?.toFixed(0) ?? '0',
    sizeGB: (d.size / 1e9).toFixed(0),
  }));

  return {
    cpu: quick.cpu,
    ram: quick.ram,
    gpu: graphics.controllers.map((g) => ({
      model: g.model,
      vramMB: g.vram ?? null,
      loadPercent: g.utilizationGpu ?? null,
    })),
    storage,
  };
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
  return `CPU al ${s.cpu.loadPercent}%. RAM al ${s.ram.usedPercent}% de ${s.ram.totalGB} GB.`;
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