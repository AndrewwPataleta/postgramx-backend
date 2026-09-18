export function mapEnumValue<Code extends string | number, Value>(
  code: Code,
  mapping: Partial<Record<Code, Value>>,
  defaultValue: Value,
): Value {
  return mapping[code] ?? defaultValue;
}
