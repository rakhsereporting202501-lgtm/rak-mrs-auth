export type UnitOption = {
  code: string;
  label: string;
};

export type ItemUnit = {
  code: string;
  label: string;
  perBase: number;
};

export const UNIT_OPTIONS: UnitOption[] = [
  { code: 'PCS', label: 'Piece' },
  { code: 'EA', label: 'Each' },
  { code: 'PR', label: 'Pair' },
  { code: 'SET', label: 'Set' },
  { code: 'BOX', label: 'Box' },
  { code: 'PACK', label: 'Pack' },
  { code: 'KG', label: 'Kilogram' },
  { code: 'L', label: 'Liter' },
  { code: 'M', label: 'Meter' },
];

export function getUnitLabel(code: string): string {
  const found = UNIT_OPTIONS.find((u) => u.code === code);
  return found ? `${found.label} (${found.code})` : code;
}

export function getUnitOption(code: string): UnitOption | null {
  return UNIT_OPTIONS.find((u) => u.code === code) || null;
}

export function normalizeUnitCode(code: string): string {
  return code.trim().toUpperCase();
}

export function toBaseQty(qty: number, unitCode: string, units: ItemUnit[]): number {
  const found = units.find((u) => u.code === unitCode);
  if (!found || !found.perBase) return qty;
  return qty / found.perBase;
}

export function fromBaseQty(baseQty: number, unitCode: string, units: ItemUnit[]): number {
  const found = units.find((u) => u.code === unitCode);
  if (!found || !found.perBase) return baseQty;
  return baseQty * found.perBase;
}
