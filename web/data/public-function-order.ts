/**
 * CEO-editable order for public functions. Unlisted functions follow by name.
 */
export const publicFunctionOrder = [
  "company-mail",
  "product-ownership",
  "marketing-planning",
  "pricing-and-business-models",
] as const;

export function orderPublicFunctions<T extends { slug: string; name: string }>(functions: readonly T[]): T[] {
  const positions = new Map<string, number>(publicFunctionOrder.map((slug, index) => [slug, index]));
  return [...functions].sort((left, right) => {
    const leftPosition = positions.get(left.slug);
    const rightPosition = positions.get(right.slug);
    if (leftPosition !== undefined || rightPosition !== undefined) return (leftPosition ?? Number.MAX_SAFE_INTEGER) - (rightPosition ?? Number.MAX_SAFE_INTEGER);
    return left.name.localeCompare(right.name);
  });
}
