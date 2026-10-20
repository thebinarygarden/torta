import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { clearToken } from '../api/auth';
import { UNAUTHORIZED_EVENT } from '../api/http';

/**
 * A 401 on a device surface means the device was never paired or has been
 * removed, so send it back to `/pair`.
 */
export function useUnauthorizedRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    const go = () => {
      clearToken();
      navigate('/pair', { replace: true });
    };
    window.addEventListener(UNAUTHORIZED_EVENT, go);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, go);
  }, [navigate]);
}
