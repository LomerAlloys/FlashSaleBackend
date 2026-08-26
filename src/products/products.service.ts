import { Injectable, OnModuleInit, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import Redis from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ProductsService implements OnModuleInit {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) {}

  async onModuleInit() {
    // 🟢 Automatic Seeding: ตรวจสอบและ Seed ข้อมูลจาก products-seed.json หากฐานข้อมูลยังว่าง
    const count = await this.productRepository.count();
    if (count === 0) {
      this.logger.log('🌱 Seeding initial products data...');
      try {
        const seedPath = path.resolve(__dirname, '../../../doc/products-seed.json');
        if (fs.existsSync(seedPath)) {
          const rawData = fs.readFileSync(seedPath, 'utf8');
          const seedProducts = JSON.parse(rawData);

          for (const item of seedProducts) {
            const product = this.productRepository.create({
              productId: item.productId,
              name: item.name,
              description: item.description,
              price: item.price,
              availableStock: item.availableStock,
              remainingStock: item.availableStock, // เริ่มต้น remainingStock เท่ากับ availableStock
              isFlashSaleActive: item.isFlashSaleActive ?? false,
            });
            await this.productRepository.save(product);
          }
          this.logger.log(`✅ Successfully seeded ${seedProducts.length} products!`);
        }
      } catch (err) {
        this.logger.error(`Failed to seed products: ${err.message}`);
      }
    }
  }

  // ⚡ Cache-Aside Pattern Implementation (Section 2.2 in Spec PDF)
  async findAll(page: number = 1, limit: number = 10) {
    const cacheKey = `products:page:${page}:limit:${limit}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        this.logger.log(`⚡ Cache HIT for ${cacheKey}`);
        return JSON.parse(cached);
      }
    } catch (err) {
      this.logger.error(`Redis read error: ${err.message}`);
    }

    // Cache Miss -> Query Database
    this.logger.log(`💾 Cache MISS for ${cacheKey} -> Querying PostgreSQL`);
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

    // Populate Redis Cache (TTL 300 seconds)
    try {
      await this.redis.set(cacheKey, JSON.stringify(result), 'EX', 300);
    } catch (err) {
      this.logger.error(`Redis set error: ${err.message}`);
    }

    return result;
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
