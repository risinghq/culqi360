import { readPostgresSnapshot, type SourceRow } from "../shared/postgres";

// The CRM Entel tables the cutover reads. actividad (heartbeats and logins),
// notificaciones, intentos_login, venta_versiones and config are session and
// audit data with no work360 counterpart.
export const SOURCE_TABLES = [
  "usuarios",
  "clientes",
  "telefonos",
  "bases",
  "base_clientes",
  "asignaciones_ejecutivo",
  "gestiones",
  "ventas",
  "venta_lineas",
  "ventas_fija",
  "venta_fija_lineas",
] as const;

export type SourceTable = (typeof SOURCE_TABLES)[number];

export type CrmEntelSnapshot = Readonly<
  Record<SourceTable, readonly SourceRow[]>
>;

export function readCrmEntelSnapshot(url: string): Promise<CrmEntelSnapshot> {
  return readPostgresSnapshot(url, SOURCE_TABLES);
}
