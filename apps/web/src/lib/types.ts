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

export type NotificationType =
  | 'PRICE_DROP'
  | 'TARGET_REACHED'
  | 'BACK_IN_STOCK'
  | 'LOW_STOCK'
  | 'STORE_BACK_IN_STOCK'
  | 'SIMILAR_SUGGESTION'
  | 'DIGEST';

export interface AppNotification {
  id: string;
  type: NotificationType;
  productId: string | null;
  product: Product | null;
  payload: Record<string, unknown>;
  status: string;
  createdAt: string;
  readAt: string | null;
  clickedAt: string | null;
}

export interface Prediction {
  verdict: 'BUY_NOW' | 'WAIT' | 'INSUFFICIENT_DATA';
  reasons: string[];
  predictedSaleAt: string | null;
}

export interface Share {
  token: string;
  permission: 'view' | 'contribute';
  expiresAt: string | null;
}

export interface SharedWishlist {
  name: string;
  items: { id: string; product: Product }[];
}

export interface PriceHistory {
  currency: string;
  points: { at: string; price: number }[];
}

export interface MembershipEntry {
  productId: string;
  wishlistId: string;
  itemId: string;
}
export interface Preferences {
  channelInApp: boolean;
  channelEmail: boolean;
  channelPush: boolean;
  channelWhatsapp: boolean;
  deliveryMode: 'instant' | 'daily_digest';
  digestHourLocal: number;
  quietStart: string | null;
  quietEnd: string | null;
  minDropPercent: number;
  maxAlertsPerDay: number;
}

export interface Order {
  orderId: string;
  total: number;
  currency: string;
  items: { productId: string; name: string; quantity: number; unitPrice: number }[];
}

export interface AdminOverview {
  rangeDays: number;
  currency: string;
  alertsSent: number;
  alertsOpened: number;
  alertsClicked: number;
  wishlistAdds: number;
  cartAddsFromWishlist: number;
  cartAddsFromAlerts: number;
  revenueInfluenced: number;
  revenue: number;
  purchases: number;
  openRate: number;
  ctr: number;
  funnel: { label: string; value: number }[];
  byType: { type: string; sent: number; opened: number; clicked: number }[];
  daily: { day: string; sent: number; clicked: number }[];
  topWishlisted: { product: Product; adds: number }[];
}

export interface SystemHealth {
  db: boolean;
  redis: boolean;
  time: string;
  outbox: { pending: number; oldestSeconds: number | null } | null;
  deliveries: { pending: number; sent: number; failed: number; dead: number } | null;
  counts: { users: number; products: number; wishlistItems: number } | null;
}

export interface ActivityItem {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  readAt: string | null;
  clickedAt: string | null;
  userEmail: string;
  productId: string | null;
  productName: string | null;
  deliveries: string | null;
}