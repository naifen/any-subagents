export const buildWhereClause = <K extends string>(
  filter: Partial<Record<K, string | undefined>>,
  keys: readonly K[]
): { where: string; values: string[] } => {
  const clauses: string[] = [];
  const values: string[] = [];
  for (const key of keys) {
    const value = filter[key];
    if (value) {
      clauses.push(`${key} = ?`);
      values.push(value);
    }
  }
  return {
    where: clauses.length > 0 ? `where ${clauses.join(" and ")}` : "",
    values
  };
};
