# Reports

The Reportes page (`/reports`) answers two questions for a supervisor: how many
cases each person produced this month, and what calls and visits they logged.
Each tab exports its view as an xlsx sheet. The code is in
[`apps/web/src/server/reports`](../apps/web/src/server/reports).

## Reach

`report:read` opens the page. The reach permissions decide whose rows it shows:

| Permission           | Rows                             |
| -------------------- | -------------------------------- |
| `report:read` only   | the viewer's own                 |
| `report:view:branch` | the users of the viewer's branch |
| `report:view:all`    | every user in the workspace      |

The widest permission wins. A user filter outside the reach returns no rows,
because the reach is applied to every query, not to the filter list.

Production follows the holder's branch now, so a case counts where its holder
works today. Activity follows the branch the activity was logged in, so a call
stays with the branch that made it after the user moves.

## Producción

One row per case holder, for one case type, one stage and one month.

- **Month.** A case counts in the month it was opened, in the app's time zone,
  Lima (UTC-5).
- **Columns.** One column per status of the chosen stage, in the order the case
  type lists them. A status the stage no longer lists but some case still holds
  follows them. "Sin iniciar" counts cases whose stage has not opened yet.
- **Sum.** A case type with number fields can add the sum of one of them. A case
  that leaves the field empty adds nothing.
- **Order.** Rows sort by total, largest first, then by name. The last row is
  the total of each column.

## Actividad

Calls and visits in an inclusive range of app days, newest first, filtered by
user, channel and outcome. The range is at most a year; a longer or reversed
range is refused with `report_range_invalid`, and the page says so under Hasta
without asking the server.

The screen shows the newest 200 rows and says so when it hits the cap. The
export holds every row in the range, with the phone and notes the screen leaves
out.
