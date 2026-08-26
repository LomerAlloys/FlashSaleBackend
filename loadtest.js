import http from 'k6/http';
import { check, sleep } from 'k6';

// 📊 k6 Load Test Configuration (Flash Sale System)
export const options = {
  scenarios: {
    // 1. Preparation Phase: ดึง Token ให้ครบ 500 Users
    auth_phase: {
      executor: 'shared-iterations',
      vus: 10,
      iterations: 500,
      maxDuration: '30s',
    },
    // 2. Read Load: ทดสอบยิงอ่านรายการสินค้า
    read_load: {
      executor: 'constant-vus',
      vus: 50,
      duration: '30s',
      startTime: '30s',
    },
    // 3. Write Load: 500 Concurrent Users แย่งกันกดสั่งซื้อสินค้า p-1001 พร้อมกัน
    flash_sale_order: {
      executor: 'per-vu-iterations',
      vus: 500,
      iterations: 1,
      maxDuration: '30s',
      startTime: '1m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% ของ Request ต้องเร็วกว่า 500ms
    http_req_failed: ['rate<0.01'],    // Error rate ต้องต่ำกว่า 1%
  },
};

const BASE_URL = 'http://localhost/api/v1'; // หรือ http://localhost:3000/api/v1 หากยิงตรง

export default function () {
  const vuId = __VU;

  // 🔑 Step 1: ขอ JWT Token
  const tokenRes = http.post(
    `${BASE_URL}/auth/token`,
    JSON.stringify({ userId: `user-${vuId}` }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(tokenRes, {
    'auth token success': (r) => r.status === 200 && r.json('accessToken') !== undefined,
  });

  const token = tokenRes.json('accessToken');
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  // 📖 Step 2: อ่านรายการสินค้า (Read-Heavy Cache-Aside)
  const productsRes = http.get(`${BASE_URL}/products?page=1&limit=10`);
  check(productsRes, {
    'get products success': (r) => r.status === 200,
  });

  sleep(1);

  // 🛍️ Step 3: สั่งซื้อสินค้า Flash Sale (p-1001) แย่งกันซื้อ
  const orderRes = http.post(
    `${BASE_URL}/orders`,
    JSON.stringify({ productId: 'p-1001' }),
    { headers: authHeaders }
  );

  check(orderRes, {
    'order status 202 accepted or 409 duplicate': (r) => r.status === 202 || r.status === 409 || r.status === 400,
  });
}
