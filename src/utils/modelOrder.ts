export function compareModelVersionsDescending(left: string, right: string): number {
  const leftNumbers = left.match(/\d+/g)?.map(Number) || [];
  const rightNumbers = right.match(/\d+/g)?.map(Number) || [];
  for (let index = 0; index < Math.max(leftNumbers.length, rightNumbers.length); index += 1) {
    const difference = (rightNumbers[index] ?? -1) - (leftNumbers[index] ?? -1);
    if (difference) return difference;
  }
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}
