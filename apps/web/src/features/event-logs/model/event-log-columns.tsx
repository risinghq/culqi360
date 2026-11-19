import type { JSX } from "@solidjs/web";

import Activity from "~/components/icons/activity";
import CalendarDays from "~/components/icons/calendar-days";
import CircleQuestionMark from "~/components/icons/circle-question-mark";
import UserRound from "~/components/icons/user-round";
import type { EventLogRecord } from "~/contracts/event-logs/event-log";
import { summarizeFieldChanges } from "~/contracts/events";
import { formatAppDateTime } from "~/domain/time/app-time";
import type { DataGridIcon } from "~/features/data-grid/model/types";

import { EventLogJsonCell } from "../components/event-log-json-cell";

export type EventLogColumn = {
  id: string;
  label: string;
  icon: DataGridIcon;
  minWidth: number;
  defaultWidth: number;
  renderCell: (record: EventLogRecord) => JSX.Element;
};

export const EVENT_LOG_COLUMNS: readonly EventLogColumn[] = [
  {
    id: "timestamp",
    label: "Hora",
    icon: CalendarDays,
    minWidth: 120,
    defaultWidth: 180,
    renderCell: (record) => formatAppDateTime(record.timestamp),
  },
  {
    id: "event",
    label: "Acción",
    icon: Activity,
    minWidth: 160,
    defaultWidth: 220,
    renderCell: (record) => record.event,
  },
  {
    id: "entity",
    label: "Entidad",
    icon: CircleQuestionMark,
    minWidth: 120,
    defaultWidth: 180,
    renderCell: (record) => `${record.entity.type}#${record.entity.id}`,
  },
  {
    id: "actor",
    label: "Actor",
    icon: UserRound,
    minWidth: 100,
    defaultWidth: 150,
    renderCell: (record) => record.actorUserId ?? "Sistema",
  },
  {
    id: "changes",
    label: "Cambios",
    icon: CircleQuestionMark,
    minWidth: 200,
    defaultWidth: 320,
    renderCell: (record) =>
      record.changes.length > 0 ? summarizeFieldChanges(record.changes) : null,
  },
  {
    id: "properties",
    label: "Detalles",
    icon: CircleQuestionMark,
    minWidth: 200,
    defaultWidth: 360,
    renderCell: (record) => <EventLogJsonCell value={record.properties} />,
  },
];
