import { useNavigate } from 'react-router-dom';
import { PackagePlus, PlusCircle, Layers } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

type CardProps = {
  title: string;
  Icon: any;
  onClick: () => void;
};

function ActionCard({ title, Icon, onClick }: CardProps) {
  return (
    <button
      type="button"
      className="card flex flex-col items-center justify-center gap-2 p-6 text-center hover:shadow-md"
      onClick={onClick}
    >
      <Icon className="h-6 w-6 text-blue-600" />
      <div className="text-sm font-semibold">{title}</div>
    </button>
  );
}

export default function InventoryV2() {
  const { role } = useAuth();
  const nav = useNavigate();
  const canInventory = !!role?.roles?.storeOfficer || !!role?.roles?.admin;

  if (!canInventory) {
    return <div className="card p-4">Access denied.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="text-xl font-semibold">Inventory V2</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <ActionCard title="Create" Icon={PackagePlus} onClick={() => nav('/inventory-v2/create')} />
        <ActionCard title="Add" Icon={PlusCircle} onClick={() => nav('/inventory-v2/add')} />
        <ActionCard title="Stock" Icon={Layers} onClick={() => nav('/inventory-v2/stock')} />
      </div>
    </div>
  );
}
