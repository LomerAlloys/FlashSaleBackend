// 🔍 ตรวจผลลัพธ์หลังยิง k6 ว่าสต็อกเหลือ 0 พอดี และมี order จาก 50 users ไม่ซ้ำกัน
// รัน: node loadtest/verify.js [productId]
require('dotenv').config();
const { Client } = require('pg');

const PRODUCT_ID = process.argv[2] || 'p-1001';

async function main() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'myuser',
    password: process.env.DB_PASSWORD || 'mypassword',
    database: process.env.DB_NAME || 'flash_sale_db',
  });
  await client.connect();

  const stockRes = await client.query(
    `SELECT "remainingStock" FROM products WHERE "productId" = $1`,
    [PRODUCT_ID],
  );
  const remainingStock = stockRes.rows[0] ? Number(stockRes.rows[0].remainingStock) : null;

  const ordersRes = await client.query(
    `SELECT COUNT(*) AS total_orders,
            COUNT(DISTINCT "userId") AS unique_users,
            COALESCE(MAX(cnt), 0) AS max_per_user
     FROM (
       SELECT "userId", COUNT(*) AS cnt
       FROM orders
       WHERE "productId" = $1
       GROUP BY "userId"
     ) t`,
    [PRODUCT_ID],
  );
  const totalOrders = Number(ordersRes.rows[0].total_orders);
  const uniqueUsers = Number(ordersRes.rows[0].unique_users);
  const maxPerUser = Number(ordersRes.rows[0].max_per_user);

  console.log(`=== Flash Sale Verification: ${PRODUCT_ID} ===`);
  console.log(`remainingStock : ${remainingStock}`);
  console.log(`total_orders   : ${totalOrders}`);
  console.log(`unique_users   : ${uniqueUsers}`);
  console.log(`max_per_user   : ${maxPerUser}`);

  const checks = [
    { label: 'remainingStock === 0 (ไม่ oversell, ไม่ติดลบ)', pass: remainingStock === 0 },
    { label: 'total_orders === unique_users (ไม่มีใครสั่งซ้ำหลุด)', pass: totalOrders === uniqueUsers },
    { label: 'max_per_user === 1', pass: maxPerUser === 1 },
  ];

  console.log('');
  let allPass = true;
  for (const c of checks) {
    console.log(`${c.pass ? '✅' : '❌'} ${c.label}`);
    if (!c.pass) allPass = false;
  }

  await client.end();
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('Verification script error:', err);
  process.exit(1);
});
