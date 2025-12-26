export type DeptId = string;
export type RequestStatus = 'DRAFT'|'SUBMITTED'|'DEPT_REVIEW'|'PARTIALLY_APPROVED'|'FULLY_APPROVED'|'STORE_PREPARING'|'READY'|'CLOSED'|'REJECTED'|'CANCELED';

export interface RequestLine {
  key: string;
  itemId: string;
  itemName?: string; // optional legacy display-only data; UI should prefer lookup by itemId
  ownerDeptId: DeptId;
  unit: string;
  qty: number;
  status?: string;
  ownerApprovedBy?: { uid:string; fullName:string; deptId:DeptId; atMs:number } | null;
  note?: string;
}

export interface RequestDoc {
  id: string;
  rqCode?: string;
  status: RequestStatus;
  stage?: string;
  createdAt: any;
  updatedAt?: any;
  urgent?: boolean;
  note?: string;
  projectId?: string;
  engineerId?: string;
  createdBy?: { uid:string; email?:string; fullName?:string; departmentId:DeptId };
  lines?: RequestLine[];
  lineDeptIds?: DeptId[]; // union of owner departments derived from lines
  // legacy fields for backwards compatibility
  departmentsInvolved?: DeptId[];
  visibleDepts?: DeptId[];
  fromDept?: DeptId;
  readBy?: Record<string, any>;
}

export interface ItemDoc { id:string; itemCode:string; nameAr?:string; nameEn?:string; unit:string; ownerDeptId:DeptId; qty:number; }
