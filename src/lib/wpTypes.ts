import employeeSeed from '../data/wpEmployeesSeed.json';

export type WpPlanStatus = 'DRAFT' | 'SUBMITTED';

export type WpEmployee = {
  id: string;
  memberCode: string;
  fullName: string;
  position?: string;
  department?: string;
  assignmentPosition?: string;
  originalPosition?: string;
  manual?: boolean;
};

export type WpAssignmentGroup = {
  id: string;
  projectCode: string;
  projectName?: string;
  engineerNames: string[];
  engineerSnapshots?: WpEmployee[];
  employeeIds: string[];
  employeeSnapshots: WpEmployee[];
  collapsed?: boolean;
};

export type WpPlanDoc = {
  id: string;
  planCode?: string;
  sequenceNo?: number;
  workDate: string;
  status: WpPlanStatus;
  groups: WpAssignmentGroup[];
  sourcePlanId?: string | null;
  coordinatorNameEn?: string;
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
export const WP_WORK_PLANS_COLLECTION = 'rakWp_workPlans';
export const WP_COUNTERS_COLLECTION = 'rakWp_counters';

export function makeWpGroup(): WpAssignmentGroup {
  return {
    id: `grp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    projectCode: '',
    projectName: '',
    engineerNames: [],
    engineerSnapshots: [],
    employeeIds: [],
    employeeSnapshots: [],
    collapsed: false,
  };
}

export function dateOffsetYmd(days = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function todayYmd() {
  return dateOffsetYmd(0);
}

export function tomorrowYmd() {
  return dateOffsetYmd(1);
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
