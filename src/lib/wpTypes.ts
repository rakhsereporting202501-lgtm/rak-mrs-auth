import employeeSeed from '../data/wpEmployeesSeed.json';

export type WpPlanStatus = 'DRAFT' | 'SUBMITTED';

export type WpEmployee = {
  id: string;
  memberCode: string;
  fullName: string;
  position?: string;
  department?: string;
};

export type WpAssignmentGroup = {
  id: string;
  projectCode: string;
  projectName?: string;
  engineerNames: string;
  employeeIds: string[];
  employeeSnapshots: WpEmployee[];
};

export type WpPlanDoc = {
  id: string;
  workDate: string;
  status: WpPlanStatus;
  groups: WpAssignmentGroup[];
  sourcePlanId?: string | null;
  createdByUid?: string;
  createdBy?: {
    uid?: string;
    email?: string | null;
    fullName?: string | null;
  };
  createdAt?: any;
  updatedAt?: any;
  submittedAt?: any;
};

export const WP_EMPLOYEE_SEED = employeeSeed as WpEmployee[];

export function makeWpGroup(): WpAssignmentGroup {
  return {
    id: `grp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    projectCode: '',
    projectName: '',
    engineerNames: '',
    employeeIds: [],
    employeeSnapshots: [],
  };
}

export function todayYmd() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function timestampMs(value: any): number {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') {
    return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1e6);
  }
  return 0;
}

