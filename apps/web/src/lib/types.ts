export type Role = 'customer' | 'admin';

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  locale: 'en' | 'ar';
  homeStoreId: number | null;
}

export interface Session {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: User;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Product {
  id: string;
  sku: string;
  nameEn: string;
  nameAr: string | null;
  category: string;
  subcategory: string | null;
  brand: string | null;
  imageUrl: string | null;
  currentPrice: number;
  listPrice: number | null;
  currency: string;
  totalStock: number;
}

export interface Offer {
  id: number;
  kind: 'POINTS_MULTIPLIER' | 'BANK_DISCOUNT_PCT';
  label: string;
  value: number;
  validFrom: string;
  validTo: string;
}

export interface ProductDetails extends Product {
  descriptionEn: string | null;
  attributes: Record<string, unknown>;
  badges: string[];
  offers: Offer[];
}

export interface Wishlist {
  id: string;
  name: string;
  isDefault: boolean;
  visibility: 'private' | 'shared';
  createdAt: string;
}

export interface WishlistItem {
  id: string;
  wishlistId: string;
  product: Product;
  addedPrice: number;
  addedAt: string;
  badges: string[];
  targetPrice: number | null;
  notifyOnDrop: boolean;
  notifyOnRestock: boolean;
  notifyOnLowStock: boolean;
  lowStockThreshold: number;
  storeId: number | null;
}

export interface Trends {
  currency: string;
  currentTotal: number;
  addedTotal: number;
  savings: number;
  points: { at: string; total: number }[];
}

export interface CartItem {
  product: Product;
  quantity: number;
  priceAtAdd: number;
  source: 'direct' | 'wishlist' | 'notification';
  sourceNotificationId: string | null;
}

export interface Cart {
  id: string;
  status: string;
  items: CartItem[];
  currency: string;
  subtotal: number;
}

export interface MoveResult {
  cart: Cart;
  movedItemIds: string[];
  skippedItemIds: string[];
}