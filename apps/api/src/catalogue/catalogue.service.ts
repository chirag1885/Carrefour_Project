import { Injectable } from '@nestjs/common';
import { decodeCursor, encodeCursor } from '../common/cursor';
import { notFound } from '../common/errors';
import { money } from '../common/money';
import { DbService } from '../db/db.service';
import { ListProductsDto, ProductCursor } from './catalogue.schemas';
import { ProductCacheService } from './product-cache.service';
import type { ProductDetailsRow } from './product-cache.service';
import { PRODUCT_COLS, ProductRow, toProduct } from './product.mapper';

const ID_RE = /^[1-9][0-9]{0,17}$/;

@Injectable()
export class CatalogueService {
  constructor(
    private readonly db: DbService,
    private readonly productCache: ProductCacheService,
  ) {}

  async list(dto: ListProductsDto) {
    const cursor = decodeCursor(dto.cursor, ProductCursor);
    // escape LIKE wildcards so a search for "50%" matches the literal text
    const q = dto.query ? dto.query.replace(/[\\%_]/g, '\\$&') : null;

    const r = await this.db.query<ProductRow>(
      `SELECT ${PRODUCT_COLS}
         FROM products
        WHERE is_active
          AND ($1::text IS NULL OR name_en ILIKE '%' || $1 || '%')
          AND ($2::text IS NULL OR category = $2)
          AND ($3::bigint IS NULL OR id > $3)
        ORDER BY id
        LIMIT $4`,
      [q, dto.category ?? null, cursor?.id ?? null, dto.limit + 1],
    );

    const hasMore = r.rows.length > dto.limit;
    const page = hasMore ? r.rows.slice(0, dto.limit) : r.rows;
    return {
      items: page.map(toProduct),
      nextCursor: hasMore ? encodeCursor({ id: page[page.length - 1].id }) : null,
    };
  }

  async getDetails(id: string) {
    if (!ID_RE.test(id)) throw notFound('PRODUCT_NOT_FOUND', 'Product not found');

    const row = await this.productCache.get(id, async () => {
      const r = await this.db.query<ProductDetailsRow>(
        `SELECT ${PRODUCT_COLS}, description_en, attributes FROM products WHERE id = $1 AND is_active`,
        [id],
      );
      return r.rows[0] ?? null;
    });
    if (!row) throw notFound('PRODUCT_NOT_FOUND', 'Product not found');

    const [offers, badges] = await Promise.all([this.offers(row.id, row.category), this.badges(row.id, row.current_price)]);
    return { ...toProduct(row), descriptionEn: row.description_en, attributes: row.attributes ?? {}, badges, offers };
  }

  private async offers(productId: string, category: string) {
    const r = await this.db.query<{ id: number; kind: string; label: string; value: string; valid_from: Date; valid_to: Date }>(
      `SELECT id, kind, label, value, valid_from, valid_to
         FROM offers
        WHERE (product_id = $1 OR (product_id IS NULL AND category = $2))
          AND now() BETWEEN valid_from AND valid_to
        ORDER BY id`,
      [productId, category],
    );
    return r.rows.map((o) => ({
      id: o.id,
      kind: o.kind,
      label: o.label,
      value: money(o.value) as number,
      validFrom: o.valid_from.toISOString(),
      validTo: o.valid_to.toISOString(),
    }));
  }

  /** "Lowest in 90 days" needs at least a week of daily data so brand-new products don't get the badge. */
  private async badges(productId: string, currentPrice: string): Promise<string[]> {
    const r = await this.db.query<{ low: string | null; n: string }>(
      `SELECT min(min_price) AS low, count(*) AS n
         FROM price_daily
        WHERE product_id = $1 AND day >= now() - interval '90 days'`,
      [productId],
    );
    const { low, n } = r.rows[0];
    return Number(n) >= 7 && low !== null && Number(currentPrice) <= Number(low) ? ['Lowest in 90 days'] : [];
  }
}
