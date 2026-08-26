import { Injectable, OnModuleInit, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import Redis from 'ioredis';

const INITIAL_SEED_PRODUCTS = [
  { productId: "p-1001", name: "Limited Edition Sneaker", description: "รองเท้ารุ่นลิมิเต็ด ยอดฮิตสำหรับนักสะสม", price: 2990.0, availableStock: 50, isFlashSaleActive: true },
  { productId: "p-1002", name: "Pro Wireless Gaming Mouse", description: "เมาส์เกมมิ่งไร้สาย น้ำหนักเบาพิเศษ เซนเซอร์แม่นยำ", price: 4590.0, availableStock: 20, isFlashSaleActive: true },
  { productId: "p-1003", name: "Mechanical Keyboard (Blue Switch)", description: "คีย์บอร์ดแมคคานิคอลสัมผัส 경쾌 พิมพ์สนุก", price: 1290.0, availableStock: 500, isFlashSaleActive: false },
  { productId: "p-1004", name: "Smart Watch Series X", description: "นาฬิกาอัจฉริยะหน้าจอ OLED วัดอัตราการเต้นของหัวใจได้แม่นยำ", price: 8900.0, availableStock: 10, isFlashSaleActive: true },
  { productId: "p-1005", name: "Ergonomic Office Chair", description: "เก้าอี้ทำงานเพื่อสุขภาพ ลดอาการปวดหลัง", price: 5500.0, availableStock: 150, isFlashSaleActive: false },
  { productId: "p-1006", name: "Wireless Noise-Cancelling Earbuds", description: "หูฟังไร้สายตัดเสียงรบกวน แบตเตอรี่ทนทาน", price: 3200.0, availableStock: 30, isFlashSaleActive: true },
  { productId: "p-1007", name: "Ultrawide 4K Monitor", description: "จอมอนิเตอร์ 4K มุมมองกว้าง เหมาะสำหรับสายคริเอเตอร์", price: 14500.0, availableStock: 15, isFlashSaleActive: true },
  { productId: "p-1008", name: "7-in-1 USB-C Hub", description: "พอร์ตเชื่อมต่ออเนกประสงค์ รองรับ PD 100W", price: 850.0, availableStock: 200, isFlashSaleActive: false },
  { productId: "p-1009", name: "Power Bank 20000mAh Fast Charge", description: "แบตเตอรี่สำรองความจุสูง รองรับการชาร์จเร็ว", price: 990.0, availableStock: 100, isFlashSaleActive: true },
  { productId: "p-1010", name: "Webcam 1080p 60fps", description: "กล้องเว็บแคมความละเอียดสูง สำหรับสตรีมมิ่งและประชุม", price: 1590.0, availableStock: 120, isFlashSaleActive: false },
  { productId: "p-1011", name: "Portable SSD 1TB", description: "ฮาร์ดดิสก์พกพาความเร็วสูง อ่านเขียนระดับ 1000MB/s", price: 3890.0, availableStock: 25, isFlashSaleActive: true },
  { productId: "p-1012", name: "Portable Bluetooth Speaker", description: "ลำโพงบลูทูธพกพา กันน้ำ IPX7 เบสหนัก", price: 1490.0, availableStock: 80, isFlashSaleActive: false },
  { productId: "p-1013", name: "Premium Leather Desk Mat", description: "แผ่นรองโต๊ะทำงานหนังพรีเมียม กันน้ำและรอยขีดข่วน", price: 450.0, availableStock: 300, isFlashSaleActive: false },
  { productId: "p-1014", name: "Smartphone Gimbal Stabilizer", description: "ไม้กันสั่นมือถือ 3 แกน ถ่ายวีดีโอสมูท", price: 2790.0, availableStock: 40, isFlashSaleActive: true },
  { productId: "p-1015", name: "Adjustable Aluminum Tablet Stand", description: "แท่นวางแท็บเล็ตอลูมิเนียม ปรับระดับได้", price: 350.0, availableStock: 250, isFlashSaleActive: false },
  { productId: "p-1016", name: "Over-Ear Studio Headphones", description: "หูฟังครอบหูระดับสตูดิโอ ให้เสียงเที่ยงตรง", price: 4900.0, availableStock: 12, isFlashSaleActive: true },
  { productId: "p-1017", name: "Electric Standing Desk", description: "โต๊ะปรับระดับไฟฟ้า มอเตอร์คู่ ทนทาน", price: 9500.0, availableStock: 5, isFlashSaleActive: true },
  { productId: "p-1018", name: "Dual Monitor Arm", description: "ขาตั้งจอคอมพิวเตอร์แบบแขนคู่ รองรับจอ 32 นิ้ว", price: 1890.0, availableStock: 90, isFlashSaleActive: false },
  { productId: "p-1019", name: "Game Capture Card 4K", description: "การ์ดแคปเจอร์สำหรับเกมเมอร์ รองรับ passthrough 4K", price: 4200.0, availableStock: 20, isFlashSaleActive: true },
  { productId: "p-1020", name: "LED Ring Light with Tripod", description: "ไฟวงแหวน LED พร้อมขาตั้ง สำหรับถ่ายภาพและไลฟ์", price: 690.0, availableStock: 180, isFlashSaleActive: false }
];

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
    await this.seedIfNeeded();
  }

  private async seedIfNeeded() {
    try {
      const count = await this.productRepository.count();
      if (count === 0) {
        this.logger.log('🌱 Seeding initial products data...');
        for (const item of INITIAL_SEED_PRODUCTS) {
          const product = this.productRepository.create({
            productId: item.productId,
            name: item.name,
            description: item.description,
            price: item.price,
            availableStock: item.availableStock,
            remainingStock: item.availableStock,
            isFlashSaleActive: item.isFlashSaleActive,
          });
          await this.productRepository.save(product);
        }
        this.logger.log(`✅ Successfully seeded ${INITIAL_SEED_PRODUCTS.length} products!`);
      }
    } catch (err) {
      this.logger.error(`Failed to seed products: ${err.message}`);
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

    // หากฐานข้อมูลยังไม่มีข้อมูล สั่ง seed ทันที
    await this.seedIfNeeded();

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
