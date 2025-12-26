import { useAuth } from '../context/AuthContext';
import { getDisplayName } from '../lib/displayName';

export default function Profile(){
    const { user, role } = useAuth();
  const name = getDisplayName(role, user);
  const departments = (role?.departmentIds || []) as string[];
  const roles = role?.roles || {};
  return (
    <div className="space-y-4">
      <div className="text-xl font-semibold">Profile</div>
      <div className="hero-card">
        <div className="hero-title">{name}</div>
        <div className="hero-meta">{user?.email || '-'}</div>
        <div className="hero-meta">{departments.length ? departments.join(' - ') : '-'}</div>
        {roles && (
          <div className="hero-badges">
            {Object.entries(roles).filter(([_, v]) => v).map(([k]) => (
              <span key={k} className="badge-light">{k}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


