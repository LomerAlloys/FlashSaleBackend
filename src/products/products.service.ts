import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../entities/product.entity';
import Redis from 'ioredis';

const l1Cache = new Map<string, { data: any; expireAt: number }>();
const knownProducts = new Set<string>(['p-1001', 'p-1002', 'p-1003', 'p-1004', 'p-1005', 'p-1006', 'p-1007', 'p-1008', 'p-1009', 'p-1010', 'p-1011', 'p-1012', 'p-1013', 'p-1014', 'p-1015', 'p-1016', 'p-1017', 'p-1018', 'p-1019', 'p-1020']);

let cacheHits = 0;
let cacheMisses = 0;

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
      cacheHits++;
      return l1Hit.data;
    }

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        cacheHits++;
        const parsed = JSON.parse(cached);
        l1Cache.set(cacheKey, { data: parsed, expireAt: now + 1500 });
        return parsed;
      }
    } catch (err) {
      this.logger.error(`Redis read error: ${err.message}`);
    }

    cacheMisses++;
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
      await Promise.all([
        this.redis.set(cacheKey, JSON.stringify(result), 'EX', 30),
        this.redis.sadd('products:page:keys', cacheKey),
      ]);
    } catch (err) {
      this.logger.error(`Redis set error: ${err.message}`);
    }

    return result;
  }

  async exists(productId: string): Promise<boolean> {
    if (knownProducts.has(productId)) return true;
    const count = await this.productRepository.count({ where: { productId } });
    if (count > 0) {
      knownProducts.add(productId);
      return true;
    }
    return false;
  }

  async invalidateProductCache() {
    l1Cache.clear();
    try {
      const keys = await this.redis.smembers('products:page:keys');
      if (keys.length > 0) {
        await this.redis.del(...keys, 'products:page:keys');
      }
    } catch (err) {
      this.logger.error(`Failed to invalidate cache: ${err.message}`);
    }
  }

  async getCacheStats() {
    const total = cacheHits + cacheMisses;
    const hitRatio = total > 0 ? Number((cacheHits / total).toFixed(4)) : 0;
    return {
      status: 'success',
      cache: { hit: cacheHits, miss: cacheMisses, total, hitRatio },
    };
  }
}
