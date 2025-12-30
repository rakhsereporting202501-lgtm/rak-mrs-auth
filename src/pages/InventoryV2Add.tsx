import { useAuth } from '../context/AuthContext';

export default function InventoryV2Add() {
  const { role } = useAuth();
  const canInventory = !!role?.roles?.storeOfficer || !!role?.roles?.admin;
  if (!canInventory) return <div className="card p-4">Access denied.</div>;
  return (
    <div className="card p-4">
      <div className="text-lg font-semibold">Inventory V2 - Add</div>
      <div className="text-sm text-gray-600 mt-2">Coming soon.</div>
    </div>
  );
}
