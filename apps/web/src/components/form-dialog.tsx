import { Button } from '@binarygarden/flora/form';
import { Dialog } from '@binarygarden/flora/overlay';
import { useT } from '../i18n';

/** A form dialog with cancel and save, and room on the left for `extra`. */
export function FormDialog({
  title,
  onClose,
  onSubmit,
  children,
  extra,
}: {
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  children: React.ReactNode;
  extra?: React.ReactNode;
}) {
  const t = useT();
  return (
    <Dialog
      open
      title={title}
      onClose={onClose}
      onSubmit={onSubmit}
      footer={
        <>
          {extra && <span className="tt-grow">{extra}</span>}
          <Button variant="ghost" type="button" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button type="submit">{t.save}</Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
