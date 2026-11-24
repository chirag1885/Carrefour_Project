import Link from 'next/link';

export function Footer() {
  return (
    <footer className="mt-12 bg-brand-dark text-sm text-white/80">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-2 md:grid-cols-4">
        <div>
          <p className="mb-2 text-lg font-extrabold text-white">
            Smart<span className="text-red-300">Wishlist</span>
          </p>
          <p>Save what you love. We watch the price and tell you the moment it drops.</p>
        </div>
        <div>
          <p className="mb-2 font-semibold text-white">Shop</p>
          <ul className="space-y-1">
            <li><Link href="/products" className="hover:underline">All products</Link></li>
            <li><Link href="/wishlist" className="hover:underline">Your wishlists</Link></li>
            <li><Link href="/cart" className="hover:underline">Your cart</Link></li>
          </ul>
        </div>
        <div>
          <p className="mb-2 font-semibold text-white">Alerts</p>
          <ul className="space-y-1">
            <li>Price drop alerts</li>
            <li>Back-in-stock alerts</li>
            <li>Low-stock warnings</li>
          </ul>
        </div>
        <div>
          <p className="mb-2 font-semibold text-white">About</p>
          <p>Internship demo project. All products and prices are mock data.</p>
        </div>
      </div>
      <div className="border-t border-white/10 py-4 text-center text-xs text-white/60">© 2026 Smart Wishlist · demo project</div>
    </footer>
  );
}