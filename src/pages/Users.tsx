import { useNavigate } from 'react-router-dom';
import { UserPlus, Building2, Users as UsersIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

type CardProps = {
  title: string;
  Icon: any;
  onClick?: () => void;
  disabled?: boolean;
};

function ActionCard({ title, Icon, onClick, disabled }: CardProps) {
  const base = 'card flex flex-col items-center justify-center gap-2 p-4 text-center';
  const state = disabled ? 'opacity-60 cursor-not-allowed' : 'hover:shadow-md cursor-pointer';
  return (
    <button
      type="button"
      className={`${base} ${state}`}
      onClick={disabled ? undefined : onClick}
    >
      <Icon className="h-6 w-6 text-blue-600" />
      <div className="text-sm font-semibold">{title}</div>
      {disabled && <div className="text-[11px] text-gray-500">Coming soon</div>}
    </button>
  );
}

export default function Users() {
  const { role } = useAuth();
  const nav = useNavigate();

  if (!role?.roles?.admin) {
    return <div className="card p-4">Admin only.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="text-xl font-semibold">Users</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <ActionCard title="Create New User" Icon={UserPlus} onClick={() => nav('/users/new')} />
        <ActionCard title="Department" Icon={Building2} disabled />
        <ActionCard title="Users" Icon={UsersIcon} disabled />
      </div>
    </div>
  );
}
