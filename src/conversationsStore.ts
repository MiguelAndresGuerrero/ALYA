import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { ChatCard } from './types';

// --- Historial de conversaciones ---
// Cada conversación del chat se guarda en la carpeta de datos de la app
// (igual que memoria.json), para poder verla y retomarla después desde
// la barra lateral. Vive solo en este PC.
const CONVERSATIONS_FILE = path.join(app.getPath('userData'), 'conversaciones.json');

const MAX_CONVERSATIONS = 100; // al pasarse, se van las más viejas que no sean favoritas
const MAX_TITLE_LENGTH = 48;

export interface StoredMessage {
    role: 'user' | 'assistant';
    text: string;
    at: number; // cuándo se mandó (ms)
    imageUrl?: string; // imagen generada por ALYA
    imageCount?: number; // cuántas imágenes adjuntó el usuario (las imágenes en sí no se guardan)
    cards?: ChatCard[];
}

export interface Conversation {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    favorite: boolean;
    messages: StoredMessage[];
}

/** Lo que necesita la barra lateral para listar (sin los mensajes). */
export interface ConversationSummary {
    id: string;
    title: string;
    updatedAt: number;
    favorite: boolean;
    messageCount: number;
}

function loadAll(): Conversation[] {
    try {
        const parsed = JSON.parse(fs.readFileSync(CONVERSATIONS_FILE, 'utf8'));
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (c): c is Conversation => !!c && typeof c.id === 'string' && Array.isArray(c.messages)
        );
    } catch {
        return []; // no existe todavía, o está corrupto — empezamos de cero
    }
}

function saveAll(conversations: Conversation[]): void {
    try {
        fs.mkdirSync(path.dirname(CONVERSATIONS_FILE), { recursive: true });
        fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify(conversations), 'utf8');
    } catch (err) {
        // El historial es un extra: si no se puede guardar, el chat sigue igual.
        console.warn('[ALYA] No se pudo guardar el historial:', (err as Error).message);
    }
}

function makeTitle(text: string): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return 'Conversación';
    return clean.length > MAX_TITLE_LENGTH ? `${clean.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…` : clean;
}

export function listConversations(): ConversationSummary[] {
    return loadAll()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((c) => ({
            id: c.id,
            title: c.title,
            updatedAt: c.updatedAt,
            favorite: c.favorite === true,
            messageCount: c.messages.length,
        }));
}

export function getConversation(id: string): Conversation | null {
    return loadAll().find((c) => c.id === id) ?? null;
}

/**
 * Agrega mensajes a una conversación. Con id null crea una nueva (el
 * título sale del primer mensaje del usuario). Devuelve el id.
 */
export function appendMessages(id: string | null, messages: StoredMessage[]): string {
    const conversations = loadAll();
    let conversation = id ? conversations.find((c) => c.id === id) : undefined;

    if (!conversation) {
        const now = Date.now();
        const firstUserText = messages.find((m) => m.role === 'user' && m.text.trim())?.text ?? '';
        const firstAnyText = messages.find((m) => m.text.trim())?.text ?? '';
        conversation = {
            id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            title: makeTitle(firstUserText || firstAnyText),
            createdAt: now,
            updatedAt: now,
            favorite: false,
            messages: [],
        };
        conversations.push(conversation);
    }

    conversation.messages.push(...messages);
    conversation.updatedAt = Date.now();

    // Tope de conversaciones: se descartan las más viejas que no sean favoritas.
    if (conversations.length > MAX_CONVERSATIONS) {
        const removable = conversations
            .filter((c) => !c.favorite && c.id !== conversation!.id)
            .sort((a, b) => a.updatedAt - b.updatedAt);
        const toRemove = new Set(removable.slice(0, conversations.length - MAX_CONVERSATIONS).map((c) => c.id));
        saveAll(conversations.filter((c) => !toRemove.has(c.id)));
    } else {
        saveAll(conversations);
    }

    return conversation.id;
}

export function deleteConversation(id: string): void {
    saveAll(loadAll().filter((c) => c.id !== id));
}

export function setFavorite(id: string, favorite: boolean): void {
    const conversations = loadAll();
    const conversation = conversations.find((c) => c.id === id);
    if (!conversation) return;
    conversation.favorite = favorite;
    saveAll(conversations);
}