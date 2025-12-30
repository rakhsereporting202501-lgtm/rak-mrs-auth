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
  { code: 'UN', label: 'Unit' },
  { code: 'SET', label: 'Set' },
  { code: 'PR', label: 'Pair' },
  { code: 'DZ', label: 'Dozen' },
  { code: 'KG', label: 'Kilogram' },
  { code: 'G', label: 'Gram' },
  { code: 'MT', label: 'Metric Ton' },
  { code: 'LB', label: 'Pound' },
  { code: 'L', label: 'Liter' },
  { code: 'ML', label: 'Milliliter' },
  { code: 'CBM', label: 'Cubic Meter' },
  { code: 'GAL', label: 'Gallon' },
  { code: 'M', label: 'Meter' },
  { code: 'CM', label: 'Centimeter' },
  { code: 'FT', label: 'Foot' },
  { code: 'IN', label: 'Inch' },
  { code: 'BX', label: 'Box' },
  { code: 'CT', label: 'Carton' },
  { code: 'RO', label: 'Roll' },
  { code: 'BG', label: 'Bag' },
  { code: 'PLT', label: 'Pallet' },
  { code: 'STRIP', label: 'Strip' },
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
