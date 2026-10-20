import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@binarygarden/flora/form';
import { Card } from '@binarygarden/flora/ui';
import { del, get, post } from '../api/http';
import { useT } from '../i18n';

export type BgStatus = {
  linked: boolean;
  userId: string | null;
  email: string | null;
  linkedAt: string | null;
};

export function useBgLink(onLinked?: () => void) {
  const [status, setStatus] = useState<BgStatus | null>(null);
  const [waiting, setWaiting] = useState(false);
  const linked = useRef(onLinked);
  useEffect(() => {
    linked.current = onLinked;
  });

  const refresh = useCallback(
    () =>
      get<BgStatus>('/admin/bg')
        .then((s) => {
          setStatus((prev) => {
            if (s.linked && prev && !prev.linked) {
              setWaiting(false);
              linked.current?.();
            }
            return s;
          });
          return s;
        })
        .catch(() => null),
    []
  );
  useEffect(() => {
    refresh();
  }, [refresh]);

  // While the owner signs in through the system browser, poll until the
  // callback has stored the link.
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [waiting, refresh]);

  const start = async () => {
    const { url } = await post<{ url: string }>('/admin/bg/link/start');
    setWaiting(true);
    // In the Electron window this hands the URL to the system browser.
    window.open(url, '_blank', 'noopener');
  };

  const unlink = () => del<BgStatus>('/admin/bg/link').then(setStatus);

  return { status, waiting, start, unlink, cancel: () => setWaiting(false) };
}

/** The same card is used in onboarding and in settings. */
export function BgLinkCard({
  onSkip,
  onLinked,
}: {
  onSkip?: () => void;
  onLinked?: () => void;
}) {
  const { status, waiting, start, unlink, cancel } = useBgLink(onLinked);
  const t = useT();

  if (!status) return null;

  if (status.linked) {
    const [before, after] = t.bg.linkedAs.split('{who}');
    return (
      <Card title={t.bg.title} padding="md">
        <div className="tt-stack" data-gap="sm">
          <p>
            {before}
            <strong>{status.email ?? status.userId}</strong>
            {after}
          </p>
          <p className="tt-small tt-muted">{t.bg.supportOnly}</p>
          <div>
            <Button variant="ghost" size="sm" onClick={unlink}>
              {t.bg.unlink}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title={t.bg.linkTitle}
      description={t.bg.linkDescription}
      padding="md"
    >
      <div className="tt-row tt-actions">
        {waiting ? (
          <>
            <span className="tt-muted">{t.bg.waiting}</span>
            <Button variant="ghost" size="sm" onClick={cancel}>
              {t.cancel}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={start}>{t.bg.link}</Button>
            {onSkip && (
              <Button variant="ghost" onClick={onSkip}>
                {t.bg.skip}
              </Button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
