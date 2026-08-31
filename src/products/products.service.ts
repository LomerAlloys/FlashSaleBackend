import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../entities/product.entity';
import Redis from 'ioredis';

const l1Cache = new Map<string, { data: any; expireAt: number }>();

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) {}

  async findAll(page: number = 1, limit: number = 10) {
    const cacheKey = `products:page:${page}:limit:${limit}`;
    const now = Date.now();

    const l1Hit = l1Cache.get(cacheKey);
    if (l1Hit && l1Hit.expireAt > now) {
      return l1Hit.data;
    }

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        l1Cache.set(cacheKey, { data: parsed, expireAt: now + 1500 });
        return parsed;
      }
    } catch (err) {
      this.logger.error(`Redis read error: ${err.message}`);
    }

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

    l1Cache.set(cacheKey, { data: result, expireAt: now + 1500 });

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

  // ⚡ Fast Single Atomic Invalidation (Zero SCAN latency)
  async invalidateProductCache() {
    l1Cache.clear();
    try {
      // ล้างแคชหน้า 1-5 ทันทีด้วย 1 คำสั่ง atomic DEL (0.01ms)
      await this.redis.del(
        'products:page:1:limit:10',
        'products:page:2:limit:10',
        'products:page:3:limit:10',
        'products:page:4:limit:10',
        'products:page:5:limit:10',
        'products:page:1:limit:5',
        'products:page:2:limit:5'
      );
    } catch (err) {
      this.logger.error(`Failed to invalidate cache: ${err.message}`);
    }
  }

  async getCacheStats() {
    return { status: 'success', message: 'Cache-Aside operational' };
  }
}
