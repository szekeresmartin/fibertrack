import { format } from 'date-fns';
import { normalizeDateToLocal } from './dateUtils';

export interface BowelMovement {
  id: string;
  userId: string;
  occurredAt: string;
  notes: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export function mapBowelMovementRow(row: Record<string, any>): BowelMovement {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    occurredAt: String(row.occurred_at),
    notes: row.notes ?? null,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  };
}

export function buildBowelMovementPayload(userId: string, occurredAt: string, notes?: string | null) {
  return {
    user_id: userId,
    occurred_at: occurredAt,
    notes: notes?.trim() ? notes.trim() : null,
  };
}

export function formatBowelMovementDate(occurredAt: string): string {
  return normalizeDateToLocal(occurredAt);
}

export function formatBowelMovementTime(occurredAt: string): string {
  return format(new Date(occurredAt), 'HH:mm');
}
