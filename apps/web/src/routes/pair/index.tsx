import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button, Input } from '@binarygarden/flora/form';
import { Card } from '@binarygarden/flora/ui';
import { setSurface, setToken } from '../../api/auth';
import { post } from '../../api/http';
import { useHealth } from '../../components/health';
import { errorMessage, format, useT } from '../../i18n';

export function Pair() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { health } = useHealth();
  const t = useT();
  const [code, setCode] = useState(params.get('code') ?? '');
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const { token } = await post<{ token: string }>('/pair', { code, name });
      setToken(token);
      setSurface('order');
      navigate('/order', { replace: true });
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tt-center">
      <Card
        title={format(t.pair.title, { name: health.restaurantName ?? 'torta' })}
        description={t.pair.description}
      >
        <form className="tt-form" onSubmit={submit}>
          <Input
            label={t.pair.code}
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            autoFocus={!code}
            required
          />
          <Input
            label={t.pair.deviceName}
            placeholder={t.pair.devicePlaceholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus={!!code}
            error={error}
            required
          />
          <Button type="submit" loading={busy}>
            {t.pair.submit}
          </Button>
          <p className="tt-small tt-muted">{t.pair.ios}</p>
        </form>
      </Card>
    </div>
  );
}
