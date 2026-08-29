import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../entities/product.entity';
import Redis from 'ioredis';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) {}

  // ⚡ Cache-Aside Pattern Implementation (Section 2.2 in Spec PDF)
  async findAll(page: number = 1, limit: number = 10) {
    const cacheKey = `products:page:${page}:limit:${limit}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        this.logger.log(`⚡ Cache HIT for ${cacheKey}`);
        await this.redis.incr('cache:stats:hit').catch((err) => this.logger.error(`Redis incr error: ${err.message}`));
        return JSON.parse(cached);
      }
    } catch (err) {
      this.logger.error(`Redis read error: ${err.message}`);
    }

    // Cache Miss -> Query Database
    this.logger.log(`💾 Cache MISS for ${cacheKey} -> Querying PostgreSQL`);
    await this.redis.incr('cache:stats:miss').catch((err) => this.logger.error(`Redis incr error: ${err.message}`));
    const skip = (page - 1) * limit;

    const [products, total] = await this.productRepository.findAndCount({
      order: { productId: 'ASC' },
      skip,
      take: limit,
    });

    const totalPages = Math.ceil(total / limit);

    const result = {
      status: 'success',
      data: products.map((p) => ({
        productId: p.productId,
        name: p.name,
        price: Number(p.price),
        availableStock: p.availableStock,
        remainingStock: p.remainingStock,
        isFlashSaleActive: p.isFlashSaleActive,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages,
      },
    };

    // Populate Redis Cache (TTL 30 seconds)
    try {
      await this.redis.set(cacheKey, JSON.stringify(result), 'EX', 30);
    } catch (err) {
      this.logger.error(`Redis set error: ${err.message}`);
    }

    return result;
  }

  // 📊 Cache Hit/Miss Ratio — สำหรับ Dashboard/Report (Cache Performance)
  async getCacheStats() {
    let hit = 0;
    let miss = 0;
    try {
      const [hitVal, missVal] = await Promise.all([
        this.redis.get('cache:stats:hit'),
        this.redis.get('cache:stats:miss'),
      ]);
      hit = parseInt(hitVal || '0', 10);
      miss = parseInt(missVal || '0', 10);
    } catch (err) {
      this.logger.error(`Redis cache-stats read error: ${err.message}`);
    }

    const total = hit + miss;
    const hitRatio = total > 0 ? Number((hit / total).toFixed(4)) : 0;

    return {
      status: 'success',
      cache: {
        hit,
        miss,
        total,
        hitRatio,
      },
    };
  }

  // 🔎 อ่านอย่างเดียว (ไม่เขียน DB) เช็คว่ามี productId นี้จริงไหม ใช้ก่อน enqueue order
  // แคชแค่ "มี/ไม่มีสินค้า" — ห้ามแคช remainingStock ที่นี่
  async exists(productId: string): Promise<boolean> {
    const cacheKey = `product:exists:${productId}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached === '1') return true;
      if (cached === '0') return false;
    } catch (err) {
      this.logger.error(`Redis exists-cache read error: ${err.message}`);
    }

    const count = await this.productRepository.count({ where: { productId } });
    const exists = count > 0;

    try {
      await this.redis.set(cacheKey, exists ? '1' : '0', 'EX', 300);
    } catch (err) {
      this.logger.error(`Redis exists-cache write error: ${err.message}`);
    }

    return exists;
  }

  // 🧹 Cache Invalidation: ลบเฉพาะหน้าสินค้าหลังตัดสต็อก (SCAN ไม่บล็อก Redis เหมือน KEYS)
  async invalidateProductCache() {
    const pattern = 'products:page:*';
    let cursor = '0';
    let deleted = 0;

    try {
      do {
        const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.redis.del(...keys);
          deleted += keys.length;
        }
      } while (cursor !== '0');

      if (deleted > 0) {
        this.logger.log(`🗑️ Invalidated ${deleted} product cache keys`);
      }
    } catch (err) {
      this.logger.error(`Failed to invalidate cache: ${err.message}`);
    }
  }
}
