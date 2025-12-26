import {
  getFirestore,
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  where,
  type QueryConstraint,
} from 'firebase/firestore';
import type { DeptId, RequestDoc, ItemDoc } from './types';

function canon(x: any): string { return String(x||'').trim(); }

function normalizeDeptInputs(ids: DeptId[]): string[] {
  const set = new Set<string>();
  ids.forEach(id => {
    const val = canon(id);
    if (!val) return;
    set.add(val);
  });
  return Array.from(set);
}

function tsValue(v: any): number {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const parsed = Date.parse(v);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') {
    return (v.seconds * 1000) + Math.floor((v.nanoseconds || 0) / 1e6);
  }
  return 0;
}

export async function fetchVisibleRequests(
  deptIds: DeptId[],
  opts: { storeOfficer: boolean; inStoreDept: boolean; isAdmin: boolean; isDeptManager?: boolean; isRequester?: boolean },
  max = 50,
  uid?: string | null
): Promise<RequestDoc[]> {
  const db = getFirestore();
  const base = collection(db,'requests');
  const perQueryLimit = Math.max(max, 200);

  const queries: { constraints: QueryConstraint[]; ordered: boolean }[] = [];
  const seen = new Map<string, RequestDoc>();
  const runQuery = async (constraints: QueryConstraint[], ordered: boolean) => {
    try {
      const q = ordered
        ? query(base, ...constraints, orderBy('updatedAt','desc'), limit(perQueryLimit))
        : query(base, ...constraints);
      const snap = await getDocs(q);
      snap.docs.forEach(doc => {
        if (!seen.has(doc.id)) seen.set(doc.id, { id: doc.id, ...(doc.data() as any) } as RequestDoc);
      });
    } catch (err) {
      const code = (err as any)?.code;
      if (code !== 'permission-denied') {
        console.warn('fetchVisibleRequests query skipped', constraints, err);
      }
    }
  };

  if (opts.isAdmin || opts.inStoreDept) {
    queries.push({ constraints: [], ordered: true });
  } else {
    const normalizedDepts = normalizeDeptInputs(deptIds);

    const canSeeDeptMembership = opts.isAdmin || opts.inStoreDept || opts.storeOfficer || opts.isDeptManager || opts.isRequester;
    if (normalizedDepts.length && canSeeDeptMembership) {
      const membershipFields = ['deptIndex','lineDeptIds','departmentsInvolved','visibleDepts'] as const;
      membershipFields.forEach(field => {
        normalizedDepts.forEach(value => {
          queries.push({ constraints: [where(field, 'array-contains', value)], ordered: false });
        });
      });
    }

    if (uid) {
      queries.push({ constraints: [where('createdBy.uid','==', uid)], ordered: false });
    }
  }

  if (!queries.length) return [];
  await Promise.all(queries.map(plan => runQuery(plan.constraints, plan.ordered)));

  const sorted = Array.from(seen.values()).sort((a,b) => tsValue(b.updatedAt) - tsValue(a.updatedAt));
  return sorted.slice(0, max);
}

export async function fetchInventoryPage(max=25): Promise<ItemDoc[]> {
  const db = getFirestore();
  const q = query(collection(db,'items'), orderBy('itemCode','asc'), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map(d=>({ id:d.id, ...(d.data() as any) }));
}

