import { useEffect, useMemo, useState } from 'react';
import { collection, getFirestore, onSnapshot } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { Search, Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { initFirebase } from '../lib/firebase';
import type { ItemUnit } from '../lib/inventoryV2Units';

type InventoryV2Item = {
  id: string;
  itemCode: string;
  nameEn: string;
  nameAr?: string;
  descriptionEn?: string;
  descriptionAr?: string;
  units?: ItemUnit[];
  stockBaseQty?: number;
  updatedAt?: any;
};

function formatDate(value: any) {
  if (!value) return '-';
  if (typeof value === 'number') return new Date(value).toLocaleString();
  if (typeof value === 'string') return new Date(value).toLocaleString();
  if (value?.toDate) return value.toDate().toLocaleString();
  return '-';
}

export default function InventoryV2Create() {
  const { role } = useAuth();
  const nav = useNavigate();
  const canInventory = !!role?.roles?.storeOfficer || !!role?.roles?.admin;
  const [items, setItems] = useState<InventoryV2Item[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!canInventory) return;
    const { app } = initFirebase();
    const db = getFirestore(app);
    const unsub = onSnapshot(collection(db, 'inventoryV2_items'), (snap) => {
      const next = snap.docs.map((doc) => {
        const data = doc.data() as any;
        return {
          id: doc.id,
          itemCode: data.itemCode || doc.id,
          nameEn: data.nameEn || '',
          nameAr: data.nameAr || '',
          descriptionEn: data.descriptionEn || '',
          descriptionAr: data.descriptionAr || '',
          units: Array.isArray(data.units) ? data.units : [],
          stockBaseQty: typeof data.stockBaseQty === 'number' ? data.stockBaseQty : 0,
          updatedAt: data.updatedAt,
        } as InventoryV2Item;
      });
      next.sort((a, b) => {
        const aTime = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : (a.updatedAt ? new Date(a.updatedAt).getTime() : 0);
        const bTime = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : (b.updatedAt ? new Date(b.updatedAt).getTime() : 0);
        return bTime - aTime;
      });
      setItems(next);
    });
    return () => unsub();
  }, [canInventory]);

  const filtered = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean);
    if (!tokens.length) return items;
    return items.filter((item) => {
      const units = (item.units || []).map((u) => `${u.code} ${u.label}`).join(' ').toLowerCase();
      const hay = [
        item.itemCode,
        item.nameEn,
        item.nameAr,
        item.descriptionEn,
        item.descriptionAr,
        units,
      ].join(' ').toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [items, query]);

  if (!canInventory) {
    return <div className="card p-4">Access denied.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="text-xl font-semibold">Inventory V2 - Create</div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          className="input w-full pl-9"
          placeholder="Search items by code, name, description, or unit"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <button
          type="button"
          className="card h-36 flex flex-col items-center justify-center gap-2 border-dashed border-2 border-blue-200 text-blue-700 hover:shadow-md"
          onClick={() => nav('/inventory-v2/create/new')}
        >
          <Plus className="h-6 w-6" />
          <div className="text-sm font-semibold">NEW</div>
        </button>

        {filtered.map((item) => {
          const baseUnit = item.units && item.units.length ? item.units[0].code : '-';
          const unitSummary = item.units && item.units.length
            ? item.units.map((u) => u.code).join(', ')
            : '-';
          return (
            <button
              key={item.id}
              type="button"
              className="card h-36 p-3 text-left hover:shadow-md flex flex-col justify-between"
              onClick={() => nav(`/inventory-v2/create/${item.id}`)}
            >
              <div>
                <div className="text-sm font-semibold truncate">{item.nameEn || item.itemCode}</div>
                <div className="text-xs text-gray-500">{item.descriptionEn || '-'}</div>
              </div>
              <div className="text-xs text-gray-500">
                <div>Units: {unitSummary}</div>
                <div>Stock: {item.stockBaseQty} {baseUnit}</div>
                <div>Updated: {formatDate(item.updatedAt)}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
