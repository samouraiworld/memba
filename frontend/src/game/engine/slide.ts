export function slideLineLeft(line: number[]): { line: number[]; gained: number } {
  const nonZero = line.filter((v) => v !== 0);
  const result: number[] = [];
  let gained = 0;
  let i = 0;
  while (i < nonZero.length) {
    if (i + 1 < nonZero.length && nonZero[i] === nonZero[i + 1]) {
      const merged = nonZero[i] * 2;
      result.push(merged);
      gained += merged;
      i += 2;
    } else {
      result.push(nonZero[i]);
      i += 1;
    }
  }
  while (result.length < 4) result.push(0);
  return { line: result, gained };
}
