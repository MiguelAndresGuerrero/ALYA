export interface CpuStatus {
  model: string;
  cores: number;
  loadPercent: string;
}

export interface RamStatus {
  totalGB: string;
  usedPercent: string;
}

export interface GpuStatus {
  model: string;
  vramMB: number | null;
  loadPercent: number | null;
}

export interface StorageStatus {
  mount: string;
  usePercent: string;
  sizeGB: string;
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

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  imageUrl?: string;
  pendingConfirmation?: PendingConfirmation;
}

export interface SystemStatus {
  cpu: CpuStatus;
  ram: RamStatus;
  gpu: GpuStatus[];
  storage: StorageStatus[];
}