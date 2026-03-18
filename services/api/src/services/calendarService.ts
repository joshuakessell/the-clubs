/**
 * Calendar service — CRUD operations for club calendar events.
 * Supports the dashboard calendar widget for weekend events,
 * special parties, holidays, etc.
 */
import { db } from '../db';
import { sql } from 'drizzle-orm';

/* ── Types ─────────────────────────────────────────────────────── */

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  eventType: string;
  highlight: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ── Helpers ───────────────────────────────────────────────────── */

function mapRow(row: Record<string, unknown>): CalendarEvent {
  return {
    id: String(row.id),
    title: String(row.title),
    description: row.description ? String(row.description) : null,
    eventDate: String(row.event_date).slice(0, 10),
    startTime: row.start_time ? String(row.start_time) : null,
    endTime: row.end_time ? String(row.end_time) : null,
    eventType: String(row.event_type),
    highlight: Boolean(row.highlight),
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/* ── Queries ───────────────────────────────────────────────────── */

export async function listCalendarEvents(month: string): Promise<CalendarEvent[]> {
  const firstDay = `${month}-01`;
  const result = await db.execute<Record<string, unknown>>(
    sql`SELECT * FROM club_calendar_events
        WHERE event_date >= ${firstDay}::date
          AND event_date < (${firstDay}::date + INTERVAL '1 month')
        ORDER BY event_date, start_time NULLS LAST`
  );
  return result.rows.map(mapRow);
}

export async function getUpcomingEvents(days: number = 14): Promise<CalendarEvent[]> {
  const result = await db.execute<Record<string, unknown>>(
    sql`SELECT * FROM club_calendar_events
        WHERE event_date >= CURRENT_DATE
          AND event_date <= CURRENT_DATE + ${days}::int
        ORDER BY event_date, start_time NULLS LAST
        LIMIT 10`
  );
  return result.rows.map(mapRow);
}

export async function createCalendarEvent(data: {
  title: string;
  description?: string;
  eventDate: string;
  startTime?: string;
  endTime?: string;
  eventType?: string;
  highlight?: boolean;
  createdBy?: string;
}): Promise<CalendarEvent> {
  const result = await db.execute<Record<string, unknown>>(
    sql`INSERT INTO club_calendar_events (title, description, event_date, start_time, end_time, event_type, highlight, created_by)
        VALUES (
          ${data.title},
          ${data.description ?? null},
          ${data.eventDate}::date,
          ${data.startTime ?? null}::time,
          ${data.endTime ?? null}::time,
          ${data.eventType ?? 'GENERAL'},
          ${data.highlight ?? false},
          ${data.createdBy ?? null}::uuid
        )
        RETURNING *`
  );
  return mapRow(result.rows[0]);
}

export async function updateCalendarEvent(
  id: string,
  data: Partial<{
    title: string;
    description: string;
    eventDate: string;
    startTime: string;
    endTime: string;
    eventType: string;
    highlight: boolean;
  }>
): Promise<CalendarEvent | null> {
  const result = await db.execute<Record<string, unknown>>(
    sql`UPDATE club_calendar_events
        SET title = COALESCE(${data.title ?? null}, title),
            description = COALESCE(${data.description ?? null}, description),
            event_date = COALESCE(${data.eventDate ?? null}::date, event_date),
            start_time = COALESCE(${data.startTime ?? null}::time, start_time),
            end_time = COALESCE(${data.endTime ?? null}::time, end_time),
            event_type = COALESCE(${data.eventType ?? null}, event_type),
            highlight = COALESCE(${data.highlight ?? null}, highlight),
            updated_at = NOW()
        WHERE id = ${id}
        RETURNING *`
  );

  return result.rows.length > 0 ? mapRow(result.rows[0]) : null;
}

export async function deleteCalendarEvent(id: string): Promise<boolean> {
  const result = await db.execute(
    sql`DELETE FROM club_calendar_events WHERE id = ${id}`
  );
  return (result.rowCount ?? 0) > 0;
}
