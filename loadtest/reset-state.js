// รีเซ็ตสถานะระบบให้กลับไปเป็น "เพิ่งขึ้นใหม่ๆ" (stock เต็ม, orders ว่าง, lock/cache ล้าง)
// โดยไม่ต้อง `docker compose down -v && up --build` ใหม่ — container เดิมยังรันอยู่ต่อเนื่อง
// เลยไม่เจอ cold start (V8 JIT, DB/Redis connection pool) ซ้ำทุกรอบเหมือนที่ down -v ทำให้เกิด
//
// ใช้ตอนไหน: อยากยิง k6 ซ้ำหลายรอบติดกันเพื่อเช็ค consistency (แบบที่ทำตอน tune performance)
// โดยไม่อยากรอ warm-up ใหม่ทุกครั้ง แต่ยังอยากได้ stock=50 เป๊ะ + ไม่มี Redis lock ค้างจากรอบก่อน
// (lock `lock:order:{userId}:{productId}` มี TTL 60s — ถ้ายิงรอบใหม่เร็วกว่านั้นจะโดนบล็อกเป็น 409
// เต็มไปหมดทั้งที่ไม่ได้ตั้งใจทดสอบ duplicate-block)
//
// รัน: node loadtest/reset-state.js
require('dotenv').config();
const { Client } = require('pg');
const Redis = require('ioredis');

async function main() {
  const pg = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'myuser',
    password: process.env.DB_PASSWORD || 'mypassword',
    database: process.env.DB_NAME || 'flash_sale_db',
  });
  await pg.connect();

  const stockRes = await pg.query(`UPDATE products SET "remainingStock" = "availableStock"`);
  const ordersRes = await pg.query(`DELETE FROM orders`);
  await pg.end();

  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  });
  // FLUSHALL ล้างทั้ง lock:order:*, products:page:* cache, และ bull:order-queue:* คิวเก่า
  // ไปพร้อมกัน — ปลอดภัยตราบใดที่ไม่มี job ที่ยังค้างประมวลผลอยู่ตอนนี้ (เทสต์จบแล้วเท่านั้น)
  await redis.flushall();
  await redis.quit();

  console.log(`[reset-state] products reset: ${stockRes.rowCount} row(s) -> remainingStock = availableStock`);
  console.log(`[reset-state] orders cleared: ${ordersRes.rowCount} row(s) deleted`);
  console.log(`[reset-state] redis flushed: locks + cache + queue history cleared`);
  console.log(`[reset-state] done - containers were NOT restarted, no cold start, ready to test again`);
}

main().catch((err) => {
  console.error('[reset-state] error:', err.message);
  console.error('เช็คว่า DB_HOST/REDIS_HOST ใน .env ชี้ถูกที่ไหม (ค่า default คือ localhost — ใช้ได้');
  console.error('เฉพาะตอน docker-compose expose port 5432/6379 ออกมาที่ host แล้วเท่านั้น)');
  process.exit(1);
});
