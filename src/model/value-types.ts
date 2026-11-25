export const valueTypes = ['i32', 'u32', 'f64', 'bool', 'string', 'i32[]', 'u32[]', 'f64[]'] as const;
export type ValueType = typeof valueTypes[number];
export type ResultType = ValueType | 'void';
