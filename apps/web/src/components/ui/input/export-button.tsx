import type { JSX } from "@solidjs/web";
import { createSignal } from "solid-js";

import { saveSheet } from "~/browser/files/sheet";
import { useSnackBar } from "~/components/feedback/snack-bar-manager/use-snack-bar";
import { actionErrorMessage } from "~/contracts/errors";
import type { SheetFileView } from "~/contracts/sheets/views";

import { Button, type ButtonSize } from "./button";

/**
 * Saves the sheet `start` fetches as an .xlsx file. `start` is null while the
 * export's filters are incomplete. The button stays busy until the file is
 * written, which includes loading the xlsx library on first use.
 */
export function ExportButton(props: {
  start: (() => Promise<SheetFileView>) | null;
  size?: ButtonSize;
  children?: JSX.Element;
}) {
  const { enqueueErrorSnackBar } = useSnackBar();
  const [busy, setBusy] = createSignal(false);

  async function exportSheet() {
    const start = props.start;
    if (start === null || busy()) {
      return;
    }
    setBusy(true);
    try {
      await saveSheet(await start());
    } catch (error) {
      enqueueErrorSnackBar(actionErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size={props.size}
      loading={busy()}
      disabled={props.start === null}
      onClick={() => void exportSheet()}
    >
      {props.children ?? "Exportar"}
    </Button>
  );
}
