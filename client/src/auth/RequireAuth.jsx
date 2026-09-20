import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

// Route guard: booting renders nothing (no flashed login), unauthenticated
// redirects to /login. The login page itself is never wrapped — it performs
// no authenticated calls on mount, so no redirect cycle is possible.
export default function RequireAuth({ children }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'booting') return null;
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}
