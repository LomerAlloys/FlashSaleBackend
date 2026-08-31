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

  // ⚡ Cache-Aside Pattern Implementation
  async findAll(page: number = 1, limit: number = 10) {
    const cacheKey = `products:page:${page}:limit:${limit}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        await this.redis.incr('cache:stats:hit').catch(() => {});
        return JSON.parse(cached);
      }
    } catch (err) {
      this.logger.error(`Redis read error: ${err.message}`);
    }

    await this.redis.incr('cache:stats:miss').catch(() => {});
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

    try {
      await this.redis.set(cacheKey, JSON.stringify(result), 'EX', 30);
    } catch (err) {
      this.logger.error(`Redis set error: ${err.message}`);
    }

    return result;
  }

  async exists(productId: string): Promise<boolean> {
    const cacheKey = `product:exists:${productId}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached === '1') return true;
      if (cached === '0') return false;
    } catch (err) {}

    const count = await this.productRepository.count({ where: { productId } });
    const exists = count > 0;
    try {
      await this.redis.set(cacheKey, exists ? '1' : '0', 'EX', 600);
    } catch (err) {}

    return exists;
  }

  async invalidateProductCache() {
    const pattern = 'products:page:*';
    let cursor = '0';
    try {
      do {
        const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch (err) {
      this.logger.error(`Failed to invalidate cache: ${err.message}`);
    }
  }

  // 📊 Cache Hit/Miss Stats
  async getCacheStats() {
    try {
      const hits = parseInt((await this.redis.get('cache:stats:hit')) || '0', 10);
      const misses = parseInt((await this.redis.get('cache:stats:miss')) || '0', 10);
      const total = hits + misses;
      const hitRate = total > 0 ? ((hits / total) * 100).toFixed(2) + '%' : '0%';
      return { status: 'success', hits, misses, total, hitRate };
    } catch {
      return { status: 'success', hits: 0, misses: 0, total: 0, hitRate: '0%' };
    }
  }
}
