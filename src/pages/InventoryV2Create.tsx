import { useEffect, useMemo, useState } from 'react';
import { collection, getFirestore, onSnapshot, query as fsQuery, where } from 'firebase/firestore';
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
  ownerDeptId?: string;
};

export default function InventoryV2Create() {
  const { role } = useAuth();
  const nav = useNavigate();
  const isAdmin = !!role?.roles?.admin;
  const canManage = isAdmin || (!!role?.roles?.deptManager && !!role?.roles?.storeOfficer);
  const myDepts = (role?.departmentIds || []).map((d) => (d || '').toString()).filter(Boolean);
  const [deptItems, setDeptItems] = useState<InventoryV2Item[]>([]);
  const [unassignedItems, setUnassignedItems] = useState<InventoryV2Item[]>([]);
  const [emptyDeptItems, setEmptyDeptItems] = useState<InventoryV2Item[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!canManage) return;
    const { app } = initFirebase();
    const db = getFirestore(app);
    const baseRef = collection(db, 'inventoryV2_items');
    const mapSnapshot = (snap: any): InventoryV2Item[] => snap.docs.map((doc: any) => {
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
        updatedAt: data.updatedAt || null,
        ownerDeptId: data.ownerDeptId || null,
      };
    });
    const unsubs: Array<() => void> = [];

    if (isAdmin) {
      unsubs.push(onSnapshot(baseRef, (snap) => setDeptItems(mapSnapshot(snap))));
      setUnassignedItems([]);
      setEmptyDeptItems([]);
    } else {
      if (myDepts.length) {
        const deptRef = fsQuery(baseRef, where('ownerDeptId', 'in', myDepts.slice(0, 10)));
        unsubs.push(onSnapshot(deptRef, (snap) => setDeptItems(mapSnapshot(snap))));
      } else {
        setDeptItems([]);
      }
      const unassignedRef = fsQuery(baseRef, where('ownerDeptId', '==', null));
      unsubs.push(onSnapshot(unassignedRef, (snap) => setUnassignedItems(mapSnapshot(snap))));
      const emptyRef = fsQuery(baseRef, where('ownerDeptId', '==', ''));
      unsubs.push(onSnapshot(emptyRef, (snap) => setEmptyDeptItems(mapSnapshot(snap))));
    }

    return () => unsubs.forEach((unsub) => unsub());
  }, [canManage, isAdmin, myDepts.join('|')]);

  const items = useMemo(() => {
    const merged = new Map<string, InventoryV2Item>();
    [...deptItems, ...unassignedItems, ...emptyDeptItems].forEach((item) => {
      merged.set(item.id, item);
    });
    const list = Array.from(merged.values());
    list.sort((a, b) => {
      const aTime = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : (a.updatedAt ? new Date(a.updatedAt).getTime() : 0);
      const bTime = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : (b.updatedAt ? new Date(b.updatedAt).getTime() : 0);
      return bTime - aTime;
    });
    return list;
  }, [deptItems, unassignedItems, emptyDeptItems]);

  const filtered = useMemo(() => {
    const tokens = search.toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean);
    if (!tokens.length) return items;
    return items.filter((item) => {
      const units = (item.units || []).map((u) => `${u.code} ${u.label}`).join(' ').toLowerCase();
      const hay = [
        item.itemCode,
        item.nameEn,
        item.nameAr,
        units,
      ].join(' ').toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [items, search]);

  if (!canManage) {
    return <div className="card p-4">Access denied.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="text-xl font-semibold">Inventory V2 - Create</div>
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
        <input
          className="input w-full pl-14"
          placeholder="Search items by code, name, or unit"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
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
          const conversions = item.units && item.units.length > 1
            ? item.units.slice(1).map((u) => `1 ${u.code} = ${u.perBase} ${baseUnit}`)
            : [];
          return (
            <button
              key={item.id}
              type="button"
              className="card h-40 p-4 text-left hover:shadow-md flex flex-col justify-between"
              onClick={() => nav(`/inventory-v2/create/${item.id}`)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-gray-400">{item.itemCode}</div>
                  <div className="text-sm font-semibold truncate">{item.nameEn || item.itemCode}</div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-semibold text-blue-700">{item.stockBaseQty}</div>
                  <div className="text-[11px] text-gray-400">{baseUnit}</div>
                </div>
              </div>
              {conversions.length > 0 && (
                <div className="text-[11px] text-gray-500 mt-2">
                  {conversions.join(' | ')}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
