import { priceParts } from '@/lib/format';

const SIZE = { sm: 'text-base', md: 'text-xl', lg: 'text-3xl' } as const;

/** Amazon-style price: small "AED", big whole number, small cents. */
export function Price({ value, size = 'md', className = '' }: { value: number; size?: keyof typeof SIZE; className?: string }) {
  const { whole, cents } = priceParts(value);
  return (
    <span className={`inline-flex items-baseline gap-0.5 font-bold ${className}`}>
      <span className="mr-0.5 text-xs font-semibold">AED</span>
      <span className={SIZE[size]}>{whole}</span>
      <span className="text-xs font-semibold">.{cents}</span>
    </span>
  );
}