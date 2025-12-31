import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { initFirebase } from '../lib/firebase';
import { UNIT_OPTIONS, getUnitOption, type ItemUnit } from '../lib/inventoryV2Units';

type ItemDoc = {
  itemCode: string;
  nameAr?: string;
  nameEn: string;
  descriptionAr?: string;
  descriptionEn?: string;
  ownerDeptId?: string;
  ownerDeptIds?: string[];
  snEnabled?: boolean;
  units?: ItemUnit[];
  stockBaseQty?: number;
  createdAt?: any;
  updatedAt?: any;
};

type UnitState = ItemUnit & {
  perPrev: number;
};

export default function InventoryV2Item() {
  const { role, user } = useAuth();
  const nav = useNavigate();
  const { id } = useParams();
  const isEdit = !!id && id !== 'new';
  const { app } = initFirebase();
  const db = getFirestore(app);
  const myDepts = (role?.departmentIds || []).map((d) => (d || '').toString()).filter(Boolean);
  const defaultDepts = ['HSE', 'TRP', 'VRP', 'Store'];
  const deptOptions = useMemo(() => {
    return Array.from(new Set([...defaultDepts, ...myDepts]));
  }, [myDepts.join('|')]);
  const deptChoices = useMemo(() => ['ALL', ...deptOptions.filter((d) => d !== 'ALL')], [deptOptions.join('|')]);

  const [itemCode, setItemCode] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [descriptionAr, setDescriptionAr] = useState('');
  const [descriptionEn, setDescriptionEn] = useState('');
  const [ownerDeptIds, setOwnerDeptIds] = useState<string[]>([]);
  const [snEnabled, setSnEnabled] = useState(false);
  const [units, setUnits] = useState<UnitState[]>([
    { code: 'PCS', label: 'Piece', perBase: 1, perPrev: 1 },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!isEdit || !id) return;
    const load = async () => {
      setBusy(true);
      setError(null);
      try {
        const snap = await getDoc(doc(db, 'inventoryV2_items', id));
        if (!snap.exists()) {
          setError('Item not found.');
          return;
        }
        const data = snap.data() as ItemDoc;
        setItemCode(data.itemCode || id);
        setNameAr(data.nameAr || '');
        setNameEn(data.nameEn || '');
        setDescriptionAr(data.descriptionAr || '');
        setDescriptionEn(data.descriptionEn || '');
        const deptIds = Array.isArray(data.ownerDeptIds) && data.ownerDeptIds.length
          ? data.ownerDeptIds
          : (data.ownerDeptId ? [data.ownerDeptId] : ['ALL']);
        setOwnerDeptIds(deptIds);
        setSnEnabled(!!data.snEnabled);
        const loaded = Array.isArray(data.units) && data.units.length ? data.units : [{ code: 'PCS', label: 'Piece', perBase: 1 }];
        const normalized: UnitState[] = [];
        loaded.forEach((u, idx) => {
          if (idx === 0) {
            normalized.push({ ...u, perBase: 1, perPrev: 1 });
          } else {
            const prevBase = normalized[idx - 1]?.perBase || 1;
            const perPrev = prevBase ? (Number(u.perBase) || 1) / prevBase : 1;
            normalized.push({ ...u, perBase: Number(u.perBase) || 1, perPrev });
          }
        });
        setUnits(normalized.length ? normalized : [{ code: 'PCS', label: 'Piece', perBase: 1, perPrev: 1 }]);
      } catch (err: any) {
        setError(err?.message || 'Failed to load item.');
      } finally {
        setBusy(false);
      }
    };
    load();
  }, [db, id, isEdit]);

  useEffect(() => {
    if (ownerDeptIds.length) return;
    if (!deptOptions.length) return;
    setOwnerDeptIds([deptOptions[0]]);
  }, [deptOptions.join('|'), ownerDeptIds.length]);

  const usedUnitCodes = useMemo(() => new Set(units.map((u) => u.code)), [units]);
  const availableUnits = UNIT_OPTIONS.filter((u) => !usedUnitCodes.has(u.code));

  const recalcFrom = (list: UnitState[], startIdx: number) => {
    const next = list.map((u) => ({ ...u }));
    for (let i = Math.max(0, startIdx); i < next.length; i += 1) {
      if (i === 0) {
        next[i].perPrev = 1;
        next[i].perBase = 1;
      } else {
        const prevBase = next[i - 1].perBase || 1;
        const perPrev = Number(next[i].perPrev) || 1;
        next[i].perPrev = perPrev;
        next[i].perBase = prevBase * perPrev;
      }
    }
    return next;
  };

  const updateUnitCode = (idx: number, code: string) => {
    const opt = getUnitOption(code);
    setUnits((prev) => {
      const next = prev.map((u, i) => (i === idx ? { ...u, code, label: opt?.label || code } : u));
      return recalcFrom(next, idx);
    });
  };

  const updateUnitValue = (idx: number, value: number) => {
    setUnits((prev) => {
      const next = prev.map((u, i) => (i === idx ? { ...u, perPrev: value } : u));
      return recalcFrom(next, idx);
    });
  };

  const addUnitRow = () => {
    if (!availableUnits.length) return;
    const next = availableUnits[0];
    setUnits((prev) => {
      const perPrev = 1;
      const nextList = [...prev, { code: next.code, label: next.label, perBase: 1, perPrev }];
      return recalcFrom(nextList, prev.length);
    });
  };

  const removeUnitRow = (idx: number) => {
    if (idx === 0) return;
    setUnits((prev) => recalcFrom(prev.filter((_, i) => i !== idx), idx - 1));
  };

  const onSave = async () => {
    setError(null);
    setSuccess(null);
    const cleanCode = itemCode.trim().toUpperCase();
    if (!cleanCode) return setError('Item code is required.');
    if (!nameEn.trim()) return setError('English name is required.');
    if (ownerDeptIds.length === 0) return setError('Select at least one department.');
    if (!units.length) return setError('At least one unit is required.');
    if (units[0].perBase !== 1) {
      return setError('Base unit must have a value of 1.');
    }
    const duplicate = new Set(units.map((u) => u.code)).size !== units.length;
    if (duplicate) return setError('Units cannot be duplicated.');

    setBusy(true);
    try {
      const ref = doc(db, 'inventoryV2_items', cleanCode);
      if (!isEdit) {
        const exists = await getDoc(ref);
        if (exists.exists()) {
          setError('Item code already exists.');
          return;
        }
      }
      const cleanedDeptIds = ownerDeptIds.includes('ALL')
        ? []
        : ownerDeptIds.filter((dept) => dept && dept !== 'ALL');
      const payload = {
        itemCode: cleanCode,
        nameAr: nameAr.trim(),
        nameEn: nameEn.trim(),
        descriptionAr: descriptionAr.trim(),
        descriptionEn: descriptionEn.trim(),
        ownerDeptIds: cleanedDeptIds.length ? cleanedDeptIds : null,
        ownerDeptId: cleanedDeptIds[0] || null,
        snEnabled: !!snEnabled,
        units: units.map((u) => ({ code: u.code, label: u.label, perBase: Number(u.perBase) || 1 })),
        updatedAt: serverTimestamp(),
      };
      console.info('Inventory V2 save payload', {
        uid: user?.uid,
        isStoreOfficer: !!role?.roles?.storeOfficer,
        ownerDeptIds: payload.ownerDeptIds,
      });
      if (!isEdit) {
        await setDoc(ref, {
          ...payload,
          stockBaseQty: 0,
          createdAt: serverTimestamp(),
          createdBy: {
            uid: user?.uid || '',
            email: user?.email || '',
            fullName: role?.fullName || '',
          },
        });
      } else {
        await setDoc(ref, payload, { merge: true });
      }
      setSuccess(isEdit ? 'Item updated successfully.' : 'Item created successfully.');
      if (!isEdit) {
        nav('/inventory-v2/create');
      }
    } catch (err: any) {
      if (err?.code === 'permission-denied') {
        setError('Permission denied.');
      } else {
        setError(err?.message || 'Failed to save item.');
      }
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!isEdit || !id) return;
    setBusy(true);
    setError(null);
    try {
      await deleteDoc(doc(db, 'inventoryV2_items', id));
      nav('/inventory-v2/create');
    } catch (err: any) {
      if (err?.code === 'permission-denied') {
        setError('Permission denied.');
      } else {
        setError(err?.message || 'Failed to delete item.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xl font-semibold">{isEdit ? 'Edit Item' : 'Create Item'}</div>
        <button type="button" className="btn-ghost text-sm" onClick={() => nav('/inventory-v2/create')}>Back</button>
      </div>

      <div className="card p-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Item code</label>
            <input
              className="input w-full"
              value={itemCode}
              onChange={(e) => setItemCode(e.target.value)}
              disabled={isEdit}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Serial number (SN)</label>
            <button
              type="button"
              className={`h-7 w-12 rounded-full p-1 transition ${snEnabled ? 'bg-blue-600 border border-blue-600' : 'bg-gray-200'}`}
              onClick={() => setSnEnabled((v) => !v)}
            >
              <div className={`h-5 w-5 rounded-full transition transform ${snEnabled ? 'bg-white translate-x-5' : 'bg-gray-400 translate-x-0'}`} />
            </button>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Name (English)</label>
            <input className="input w-full" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Name (Arabic)</label>
            <input className="input w-full" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Description (English)</label>
            <textarea className="input w-full min-h-[90px]" value={descriptionEn} onChange={(e) => setDescriptionEn(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Description (Arabic)</label>
            <textarea className="input w-full min-h-[90px]" value={descriptionAr} onChange={(e) => setDescriptionAr(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Departments</label>
          <div className="grid gap-2 sm:grid-cols-3">
            {deptChoices.map((dept) => {
              const checked = ownerDeptIds.includes(dept);
              return (
                <label
                  key={dept}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                    checked ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-700'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-blue-600"
                    checked={checked}
                    onChange={() => {
                      setOwnerDeptIds((prev) => {
                        if (dept === 'ALL') {
                          return prev.includes('ALL') ? prev : ['ALL'];
                        }
                        const next = prev.filter((d) => d !== 'ALL');
                        if (next.includes(dept)) {
                          const reduced = next.filter((d) => d !== dept);
                          return reduced.length ? reduced : next;
                        }
                        return [...next, dept];
                      });
                    }}
                  />
                  <span>{dept === 'ALL' ? 'All' : dept}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-semibold">Units</div>
          <div className="text-xs text-gray-500">Define the base unit first. Base unit value must be 1.</div>
          <div className="space-y-2">
            {units.map((unit, idx) => {
              const isBase = idx === 0;
              return (
                <div key={`${unit.code}-${idx}`} className="grid grid-cols-6 gap-2 items-center">
                  <div className="col-span-3">
                    <select
                      className="input w-full"
                      value={unit.code}
                      onChange={(e) => updateUnitCode(idx, e.target.value)}
                    >
                      {UNIT_OPTIONS.map((u) => {
                        const usedElsewhere = usedUnitCodes.has(u.code) && u.code !== unit.code;
                        return (
                          <option key={u.code} value={u.code} disabled={usedElsewhere}>
                            ({u.label} - {u.code})
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number"
                      min={1}
                      step={1}
                      className="input w-full"
                      value={unit.perPrev}
                      onChange={(e) => updateUnitValue(idx, Number(e.target.value))}
                      disabled={isBase}
                    />
                  </div>
                  <div className="col-span-1 text-xs text-gray-500">
                    {isBase ? 'Base' : (
                      <button type="button" className="text-red-600" onClick={() => removeUnitRow(idx)}>Remove</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost" onClick={addUnitRow} disabled={!availableUnits.length}>
              Add unit
            </button>
            {!availableUnits.length && <span className="text-xs text-gray-500">All units added.</span>}
          </div>
          {units.length > 1 && (
            <div className="text-xs text-gray-500">
              {units.slice(1).map((u, idx) => (
                <div key={u.code}>
                  1 {units[idx].code} = {u.perPrev} {u.code}
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <div className="text-sm text-red-600">{error}</div>}
        {success && <div className="text-sm text-green-600">{success}</div>}

        <div className="flex flex-col sm:flex-row gap-2">
          <button type="button" className="btn-primary w-full" onClick={onSave} disabled={busy}>
            {busy ? 'Saving...' : 'Save'}
          </button>
          {isEdit && (
            <button type="button" className="btn-ghost w-full border border-red-200 text-red-600" onClick={onDelete} disabled={busy}>
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
