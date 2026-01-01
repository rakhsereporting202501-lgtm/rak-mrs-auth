import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, getFirestore, onSnapshot, query, where } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { Search, Plus } from 'lucide-react';
import { initFirebase } from '../lib/firebase';
import type { ItemUnit } from '../lib/inventoryV2Units';
import { useAuth } from '../context/AuthContext';

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
  ownerDeptIds?: string[];
};

export default function InventoryV2Create() {
  const { role } = useAuth();
  const nav = useNavigate();
  const isAdmin = !!role?.roles?.admin;
  const isStoreOfficer = !!role?.roles?.storeOfficer;
  const inStoreDept = (role?.departmentIds || []).includes('Store' as any);
  const canInventory = isAdmin || isStoreOfficer || inStoreDept;
  const canSeeAll = isAdmin || inStoreDept;
  const myDepts = (role?.departmentIds || []).map((d) => (d || '').toString()).filter(Boolean);
  const [items, setItems] = useState<InventoryV2Item[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const queryResultsRef = useRef<Record<string, InventoryV2Item[]>>({});

  useEffect(() => {
    if (!canInventory) return;
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
        ownerDeptIds: Array.isArray(data.ownerDeptIds) ? data.ownerDeptIds : [],
      };
    });
    const unsubs: Array<() => void> = [];
    queryResultsRef.current = {};

    const mergeResults = () => {
      const merged = new Map<string, InventoryV2Item>();
      Object.values(queryResultsRef.current).forEach((list) => {
        list.forEach((item) => merged.set(item.id, item));
      });
      setItems(Array.from(merged.values()));
    };

    const onError = (label: string) => (err: any) => {
      console.error(`Inventory V2 listen failed (${label})`, err);
      setLoadError(`Inventory V2 read blocked (${label}): ${err?.code || 'unknown'}`);
    };

    if (canSeeAll) {
      unsubs.push(onSnapshot(baseRef, (snap) => {
        setLoadError(null);
        setItems(mapSnapshot(snap));
      }, onError('all')));
    } else {
      const queries: Array<{ key: string; q: any }> = [];
      if (myDepts.length) {
        myDepts.forEach((dept) => {
          queries.push({
            key: `deptIds_${dept}`,
            q: query(baseRef, where('ownerDeptIds', 'array-contains', dept)),
          });
        });
        const chunkSize = 10;
        for (let i = 0; i < myDepts.length; i += chunkSize) {
          const chunk = myDepts.slice(i, i + chunkSize);
          queries.push({
            key: `deptId_${i}`,
            q: query(baseRef, where('ownerDeptId', 'in', chunk)),
          });
        }
      }
      queries.push({
        key: 'unassignedNull',
        q: query(baseRef, where('ownerDeptId', '==', null), where('ownerDeptIds', '==', null)),
      });
      queries.push({
        key: 'unassignedEmpty',
        q: query(baseRef, where('ownerDeptId', '==', ''), where('ownerDeptIds', '==', null)),
      });
      queries.push({
        key: 'allDeptIds',
        q: query(baseRef, where('ownerDeptIds', 'array-contains', 'ALL')),
      });
      queries.push({
        key: 'allDeptId',
        q: query(baseRef, where('ownerDeptId', '==', 'ALL')),
      });

      queries.forEach(({ key, q }) => {
        unsubs.push(onSnapshot(q, (snap) => {
          setLoadError(null);
          queryResultsRef.current[key] = mapSnapshot(snap);
          mergeResults();
        }, onError(key)));
      });
    }

    return () => unsubs.forEach((unsub) => unsub());
  }, [canInventory, canSeeAll, myDepts.join('|')]);

  const sortedItems = useMemo(() => {
    const list = [...items];
    list.sort((a, b) => {
      const aTime = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : (a.updatedAt ? new Date(a.updatedAt).getTime() : 0);
      const bTime = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : (b.updatedAt ? new Date(b.updatedAt).getTime() : 0);
      return bTime - aTime;
    });
    return list;
  }, [items]);

  const filtered = useMemo(() => {
    const tokens = search.toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean);
    if (!tokens.length) return sortedItems;
    return sortedItems.filter((item) => {
      const units = (item.units || []).map((u) => `${u.code} ${u.label}`).join(' ').toLowerCase();
      const deptText = [
        ...(item.ownerDeptIds || []),
        item.ownerDeptId || '',
      ].join(' ');
      const hay = [
        item.itemCode,
        item.nameEn,
        item.nameAr,
        units,
        deptText,
      ].join(' ').toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [sortedItems, search]);

  if (!canInventory) {
    return <div className="card p-4">Access denied.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button type="button" className="btn-ghost text-sm" onClick={() => nav('/inventory-v2')}>
          Back
        </button>
        <div className="text-xl font-semibold">Inventory V2 - Create</div>
      </div>
      {loadError && <div className="text-sm text-red-600">{loadError}</div>}
      <div className="relative">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
        <input
          className="input w-full pl-16"
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
          const deptLabel = item.ownerDeptIds && item.ownerDeptIds.length
            ? item.ownerDeptIds.join(', ')
            : (item.ownerDeptId || 'All');
          return (
            <button
              key={item.id}
              type="button"
              className="card h-36 p-4 text-left hover:shadow-md flex flex-col justify-between"
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
              <div className="mt-2 flex items-end justify-between gap-2">
                <div className="text-[11px] text-gray-500">
                  {conversions.length > 0 ? conversions.join(' | ') : ''}
                </div>
                <div className="text-[11px] text-gray-400 text-right">{deptLabel}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
