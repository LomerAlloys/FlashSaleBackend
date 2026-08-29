-- Flash Sale schema + seed data.
--
-- This file is a plain-SQL reference mirror of this repo's TypeORM migrations
-- (src/migrations/*-InitSchema.ts, *-SeedProducts.ts), kept for other groups
-- doing cross-group load testing without this repo's Node/TypeORM toolchain.
-- For THIS repo's own docker-compose flow, the TypeORM migrations
-- (`npm run migration:run`) are the actual source of truth — keep this file
-- in sync with them manually if the schema changes.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE "orders" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "userId" character varying NOT NULL,
    "productId" character varying NOT NULL,
    "status" character varying NOT NULL DEFAULT 'processing',
    "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT "UQ_orders_userId_productId" UNIQUE ("userId", "productId"),
    CONSTRAINT "PK_orders_id" PRIMARY KEY ("id")
);

CREATE TABLE "products" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "productId" character varying NOT NULL,
    "name" character varying NOT NULL,
    "description" text,
    "price" numeric(10,2) NOT NULL,
    "availableStock" integer NOT NULL,
    "remainingStock" integer NOT NULL,
    "isFlashSaleActive" boolean NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT "UQ_products_productId" UNIQUE ("productId"),
    CONSTRAINT "CHK_products_remainingStock" CHECK ("remainingStock" >= 0),
    CONSTRAINT "PK_products_id" PRIMARY KEY ("id")
);

INSERT INTO "products" ("productId", "name", "description", "price", "availableStock", "remainingStock", "isFlashSaleActive") VALUES
('p-1001', 'Limited Edition Sneaker', 'รองเท้ารุ่นลิมิเต็ด ยอดฮิตสำหรับนักสะสม', 2990.0, 50, 50, true),
('p-1002', 'Pro Wireless Gaming Mouse', 'เมาส์เกมมิ่งไร้สาย น้ำหนักเบาพิเศษ เซนเซอร์แม่นยำ', 4590.0, 20, 20, true),
('p-1003', 'Mechanical Keyboard (Blue Switch)', 'คีย์บอร์ดแมคคานิคอลสัมผัส เพลิดเพลิน พิมพ์สนุก', 1290.0, 500, 500, false),
('p-1004', 'Smart Watch Series X', 'นาฬิกาอัจฉริยะหน้าจอ OLED วัดอัตราการเต้นของหัวใจได้แม่นยำ', 8900.0, 10, 10, true),
('p-1005', 'Ergonomic Office Chair', 'เก้าอี้ทำงานเพื่อสุขภาพ ลดอาการปวดหลัง', 5500.0, 150, 150, false),
('p-1006', 'Wireless Noise-Cancelling Earbuds', 'หูฟังไร้สายตัดเสียงรบกวน แบตเตอรี่ทนทาน', 3200.0, 30, 30, true),
('p-1007', 'Ultrawide 4K Monitor', 'จอมอนิเตอร์ 4K มุมมองกว้าง เหมาะสำหรับสายคริเอเตอร์', 14500.0, 15, 15, true),
('p-1008', '7-in-1 USB-C Hub', 'พอร์ตเชื่อมต่ออเนกประสงค์ รองรับ PD 100W', 850.0, 200, 200, false),
('p-1009', 'Power Bank 20000mAh Fast Charge', 'แบตเตอรี่สำรองความจุสูง รองรับการชาร์จเร็ว', 990.0, 100, 100, true),
('p-1010', 'Webcam 1080p 60fps', 'กล้องเว็บแคมความละเอียดสูง สำหรับสตรีมมิ่งและประชุม', 1590.0, 120, 120, false),
('p-1011', 'Portable SSD 1TB', 'ฮาร์ดดิสก์พกพาความเร็วสูง อ่านเขียนระดับ 1000MB/s', 3890.0, 25, 25, true),
('p-1012', 'Portable Bluetooth Speaker', 'ลำโพงบลูทูธพกพา กันน้ำ IPX7 เบสหนัก', 1490.0, 80, 80, false),
('p-1013', 'Premium Leather Desk Mat', 'แผ่นรองโต๊ะทำงานหนังพรีเมียม กันน้ำและรอยขีดข่วน', 450.0, 300, 300, false),
('p-1014', 'Smartphone Gimbal Stabilizer', 'ไม้กันสั่นมือถือ 3 แกน ถ่ายวีดีโอสมูท', 2790.0, 40, 40, true),
('p-1015', 'Adjustable Aluminum Tablet Stand', 'แท่นวางแท็บเล็ตอลูมิเนียม ปรับระดับได้', 350.0, 250, 250, false),
('p-1016', 'Over-Ear Studio Headphones', 'หูฟังครอบหูระดับสตูดิโอ ให้เสียงเที่ยงตรง', 4900.0, 12, 12, true),
('p-1017', 'Electric Standing Desk', 'โต๊ะปรับระดับไฟฟ้า มอเตอร์คู่ ทนทาน', 9500.0, 5, 5, true),
('p-1018', 'Dual Monitor Arm', 'ขาตั้งจอคอมพิวเตอร์แบบแขนคู่ รองรับจอ 32 นิ้ว', 1890.0, 90, 90, false),
('p-1019', 'Game Capture Card 4K', 'การ์ดแคปเจอร์สำหรับเกมเมอร์ รองรับ passthrough 4K', 4200.0, 20, 20, true),
('p-1020', 'LED Ring Light with Tripod', 'ไฟวงแหวน LED พร้อมขาตั้ง สำหรับถ่ายภาพและไลฟ์', 690.0, 180, 180, false);
