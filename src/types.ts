import type { Mood } from './expression';

export interface CpuStatus {
  model: string;
  cores: number;
  loadPercent: string;
}

export interface RamStatus {
  totalGB: string;
  usedGB: string;
  usedPercent: string;
}

export interface GpuStatus {
  model: string;
  vramMB: number | null;
  loadPercent: number | null;
}

export interface StorageStatus {
  mount: string;
  usePercent: string; // espacio OCUPADO (no actividad del disco)
  sizeGB: string;
  freeGB: string;
}

export interface ProcessInfo {
  name: string;
  cpu: string;
  memPercent: string;
}

export interface PendingConfirmation {
  tool: string;
  args: Record<string, unknown>;
  description: string;
}

/** Una imagen adjunta por el usuario en el chat (base64, sin el prefijo "data:"). */
export interface ChatImage {
  mimeType: string;
  data: string;
}

/**
 * Tarjeta con el resultado de una herramienta, ya ordenado para mostrarse
 * en el chat (ver cards.ts). Son solo datos; chat.html decide cómo dibujarla.
 */
export type ChatCard =
  | {
      type: 'system';
      cpu: number;
      cpuModel: string;
      ram: number;
      ramUsedGB: string;
      ramTotalGB: string;
      gpus: Array<{ name: string; load: number | null }>;
      disks: Array<{ mount: string; use: number; sizeGB: string; freeGB: string }>;
    }
  | { type: 'app'; name: string; ok: boolean; detail: string }
  | { type: 'files'; query: string; total: number; files: Array<{ name: string; path: string }> }
  | { type: 'song'; title: string; artist: string; album: string | null; source: string; label?: string }
  | {
      type: 'guide';
      title: string;
      intro: string;
      notes: string[];
      steps: Array<{ title: string; text: string; copy?: string; link?: { label: string; url: string } }>;
      problems: Array<{ problem: string; fix: string }>;
      actions: Array<{ label: string; action: 'settings' | 'link'; url?: string }>;
    };

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  imageUrl?: string;
  cards?: ChatCard[]; // tarjetas con resultados de herramientas usadas en esta respuesta
  mood?: Mood; // ánimo con el que ALYA dice esta respuesta (solo afecta la voz)
  pendingConfirmation?: PendingConfirmation;
}

export interface SystemStatus {
  cpu: CpuStatus;
  ram: RamStatus;
  gpu: GpuStatus[];
  storage: StorageStatus[];
}