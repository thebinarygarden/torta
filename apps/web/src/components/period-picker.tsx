import { Button, IconButton } from '@binarygarden/flora/form';
import { IconArrow } from '@binarygarden/flora/icons';
import { Tabs } from '@binarygarden/flora/navigation';
import { isoDate, periodLabel, step, type Period } from './dates';
import { useT } from '../i18n';

/** Day, week or month, and the arrows to move through them. */
export function PeriodPicker({
  period,
  anchor,
  days,
  today,
  onChange,
}: {
  period: Period;
  anchor: Date;
  days: Date[];
  /** Today as YYYY-MM-DD; the picker never moves past it. */
  today: string;
  onChange: (period: Period, anchor: Date) => void;
}) {
  const t = useT();
  const atEnd = isoDate(days.at(-1)!) >= today;
  return (
    <div className="tt-row">
      <Tabs
        variant="pill"
        value={period}
        onChange={(v) => onChange(v as Period, anchor)}
        items={[
          { value: 'day', label: t.period.day },
          { value: 'week', label: t.period.week },
          { value: 'month', label: t.period.month },
        ]}
      />
      <div className="tt-pager">
        <IconButton
          size="sm"
          label={t.period.previous}
          onClick={() => onChange(period, step(period, anchor, -1))}
        >
          <IconArrow orientation="left" size={14} />
        </IconButton>
        <span className="tt-period">{periodLabel(period, days)}</span>
        <IconButton
          size="sm"
          label={t.period.next}
          disabled={atEnd}
          onClick={() => onChange(period, step(period, anchor, 1))}
        >
          <IconArrow orientation="right" size={14} />
        </IconButton>
        <span className="tt-pager-divider" aria-hidden="true" />
        <Button
          size="sm"
          variant="ghost"
          disabled={atEnd}
          onClick={() => onChange(period, new Date())}
        >
          {t.period.today}
        </Button>
      </div>
    </div>
  );
}
