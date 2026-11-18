import { downloadWithToken } from "~/browser/files/client";
import { useSnackBar } from "~/components/feedback/snack-bar-manager/use-snack-bar";
import { Button } from "~/components/ui/input/button";
import { actionErrorMessage } from "~/contracts/errors";

/**
 * Downloads the workbook `start` builds on the server. `start` is null while
 * the report's filters are incomplete.
 */
export function ExportButton(props: {
  start: (() => Promise<{ token: string }>) | null;
  pending: boolean;
}) {
  const { enqueueErrorSnackBar } = useSnackBar();

  async function exportReport() {
    const start = props.start;
    if (start === null) {
      return;
    }
    try {
      const { token } = await start();
      downloadWithToken(token);
    } catch (error) {
      enqueueErrorSnackBar(actionErrorMessage(error));
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      loading={props.pending}
      disabled={props.start === null}
      onClick={() => void exportReport()}
    >
      Exportar
    </Button>
  );
}
