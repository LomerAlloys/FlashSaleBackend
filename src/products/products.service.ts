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

  // 🔎 อ่านอย่างเดียว (ไม่เขียน DB) เช็คว่ามี productId นี้จริงไหม ใช้ก่อน enqueue order
  async exists(productId: string): Promise<boolean> {
    const count = await this.productRepository.count({ where: { productId } });
    return count > 0;
  }

  // 🧹 Cache Invalidation Method: ลบแคชรายการสินค้าทั้งหมดเมื่อมีการตัดสต็อก
  async invalidateProductCache() {
    try {
      const keys = await this.redis.keys('products:*');
      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.logger.log(`🗑️ Invalidated ${keys.length} product cache keys`);
      }
    } catch (err) {
      this.logger.error(`Failed to invalidate cache: ${err.message}`);
    }
  }
}
