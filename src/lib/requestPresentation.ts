import type { DeptId, RequestDoc, RequestLine } from './types';

type NamedEntity = { id: string; nameAr?: string; nameEn?: string; name?: string };
type ItemEntity = NamedEntity & { itemCode?: string };

function asLines(doc: RequestDoc | any): RequestLine[] {
  return Array.isArray(doc?.lines) ? (doc.lines as RequestLine[]) : [];
}

export function getFromDept(doc: RequestDoc | any): string {
  return (doc?.createdBy?.departmentId) || doc?.fromDept || '';
}

export function getLineDeptIds(doc: RequestDoc | any): DeptId[] {
  if (Array.isArray(doc?.lineDeptIds) && doc.lineDeptIds.length) return doc.lineDeptIds as DeptId[];
  if (Array.isArray(doc?.departmentsInvolved) && doc.departmentsInvolved.length) return doc.departmentsInvolved as DeptId[];
  return [];
}

export function resolveProjectName(doc: RequestDoc | any, index: Record<string, NamedEntity> = {}): string {
  const meta = doc?.projectId ? index[doc.projectId] : null;
  return (
    meta?.nameEn
    || meta?.nameAr
    || meta?.name
    || doc?.projectNameEn
    || doc?.projectNameAr
    || doc?.projectName
    || ''
  );
}

export function resolveEngineerName(doc: RequestDoc | any, index: Record<string, NamedEntity> = {}): string {
  const meta = doc?.engineerId ? index[doc.engineerId] : null;
  return (
    meta?.nameEn
    || meta?.nameAr
    || doc?.engineerNameEn
    || doc?.engineerNameAr
    || ''
  );
}

function renderLineName(line: RequestLine, items: Record<string, ItemEntity>): string {
  const meta = line?.itemId ? items[line.itemId] : null;
  return (
    meta?.nameEn
    || meta?.nameAr
    || meta?.name
    || line?.itemName
    || line?.itemId
    || ''
  );
}

export function summarizeLines(
  doc: RequestDoc | any,
  options: {
    items?: Record<string, ItemEntity>;
    dept?: DeptId | null;
    deptList?: DeptId[];
    limit?: number;
  } = {},
): string[] {
  const { items = {}, dept = null, deptList = [], limit } = options;
  const filteredList = dept ? [dept] : deptList.filter(Boolean);
  const allowed = filteredList.length ? new Set(filteredList) : null;
  const out: string[] = [];
  asLines(doc).forEach((line) => {
    if (allowed && !allowed.has(line.ownerDeptId as any)) return;
    const name = renderLineName(line, items);
    if (name) out.push(name);
  });
  if (typeof limit === 'number') return out.slice(0, limit);
  return out;
}
