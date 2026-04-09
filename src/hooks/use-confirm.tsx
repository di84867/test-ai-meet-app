import { useCallback, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/responsive-dialog";

export const useConfirm = (
  title: string,
  description: string,
): [() => React.JSX.Element, () => Promise<unknown>] => {
  const [promise, setPromise] = useState<{
    resolve: (value: boolean) => void;
  } | null>(null);

  // Use a ref to hold promise so callbacks don't need to re-create on state change
  const promiseRef = useRef(promise);
  promiseRef.current = promise;

  const confirm = useCallback(() => {
    return new Promise((resolve) => {
      setPromise({ resolve });
    });
  }, []);

  const handleClose = useCallback(() => {
    setPromise(null);
  }, []);

  const handleConfirm = useCallback(() => {
    promiseRef.current?.resolve(true);
    setPromise(null);
  }, []);

  const handleCancel = useCallback(() => {
    promiseRef.current?.resolve(false);
    setPromise(null);
  }, []);

  // Stable component that reads `promise` from state via closure — 
  // but since all callbacks are stable via useCallback, no new 
  // component reference is created causing remount loops.
  const ConfirmationDialog = useMemo(
    () =>
      function ConfirmDialog() {
        return (
          <ResponsiveDialog
            open={promiseRef.current !== null}
            onOpenChange={handleClose}
            title={title}
            description={description}
          >
            <div className="pt-4 w-full flex flex-col-reverse gap-y-2 lg:flex-row gap-x-2 items-center justify-end">
              <Button
                onClick={handleCancel}
                variant="outline"
                className="w-full lg:w-auto"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirm}
                className="w-full lg:w-auto"
              >
                Confirm
              </Button>
            </div>
          </ResponsiveDialog>
        );
      },
    // Only recreate if title/description change — NOT on promise state change.
    // The dialog open state is driven by promiseRef which is always current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [title, description]
  );

  return [ConfirmationDialog, confirm];
};
