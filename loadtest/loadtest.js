import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * ============================================================================
 * 📊 k6 Load Test & Observability — Flash Sale System
 * ============================================================================
 * ข้อกำหนดการทดสอบ:
 * 1. Preparation Phase: วนลูปขอ JWT สำหรับ 500 users ไม่ซ้ำกัน (user-1 ถึง user-500)
 * 2. Read Load: ยิง GET /api/v1/products?page=X&limit=Y ด้วย 1,000 Concurrent VUs (10 วินาที)
 * 3. Write Load: ยิง POST /api/v1/orders ด้วย 500 Concurrent requests แย่งซื้อ p-1001 (สต็อก 50 ชิ้น)
 *    พร้อมจำลองให้ User บางคน (~15%) ยิง Request เบิ้ล 2-3 ครั้งพร้อมกัน (Atomic Duplicate Lock Test)
 * ============================================================================
 */

// 🌐 Base URL (สามารถรับผ่าน -e BASE_URL= ได้)
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080/api/v1';
const TOTAL_USERS = 500;
const DUPLICATE_FRACTION = 0.15; // 15% ของผู้ใช้จะยิงคำสั่งซื้อซ้ำ 2-3 ครั้งพร้อมกันในเสี้ยววินาที

export const options = {
  scenarios: {
    // 📖 Phase 1: Read Load (1,000 Concurrent VUs อ่านรายการสินค้า เทส Cache-Aside)
    read_burst: {
      executor: 'constant-vus',
      vus: 1000,
      duration: '10s',
      exec: 'readProducts',
    },
    // 🛍️ Phase 2: Write Load (500 Concurrent VUs แย่งซื้อ p-1001 พร้อมยิงซ้ำ)
    flash_sale_order: {
      executor: 'per-vu-iterations',
      vus: TOTAL_USERS,
      iterations: 1,
      startTime: '15s',
      maxDuration: '30s',
      exec: 'placeOrder',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% ของ Request ต้องตอบกลับภายใน 500ms
    http_req_failed: ['rate<0.05'],    // Error rate รวมต้องต่ำกว่า 5%
  },
};

// 🔑 1. Preparation Phase: ขอ JWT Token ให้ User 500 คนล่วงหน้า (ไม่นับเวลารวมกับช่วงยิงโหลด)
export function setup() {
  console.log(`🚀 [Preparation Phase] กำลังขอ JWT Tokens สำหรับผู้ใช้ 500 คน (${TOTAL_USERS} unique users)...`);
  const tokens = [];
  for (let i = 1; i <= TOTAL_USERS; i++) {
    const res = http.post(
      `${BASE_URL}/auth/token`,
      JSON.stringify({ userId: `user-${i}` }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    check(res, { 'auth token issued': (r) => r.status === 200 || r.status === 201 });
    tokens.push(res.json('accessToken'));
  }
  console.log(`✅ [Preparation Phase Complete] ได้รับ JWT Tokens ครบทั้ง 500 คนแล้ว เริ่มต้นการยิงโหลด!`);
  return { tokens };
}

// 📖 Phase 1: 1,000 Concurrent VUs อ่านสินค้า (Cache-Aside + Pagination)
export function readProducts() {
  const page = (__VU % 4) + 1;
  const limit = 10;
  const res = http.get(`${BASE_URL}/products?page=${page}&limit=${limit}`);
  check(res, {
    'products status 200': (r) => r.status === 200,
    'has data array': (r) => r.json('data') !== undefined,
  });
}

// 🛍️ Phase 2: 500 Concurrent Users แย่งซื้อ p-1001 (มีคนยิงเบิ้ล 2-3 ครั้งพร้อมกัน)
export function placeOrder(data) {
  const vuIndex = (__VU - 1) % TOTAL_USERS;
  const token = data.tokens[vuIndex];
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  const body = JSON.stringify({ productId: 'p-1001' });

  if (Math.random() < DUPLICATE_FRACTION) {
    // จำลอง User กดย้ำรวดเดียว 2-3 ครั้งพร้อมกัน (Concurrent duplicate via http.batch)
    const shots = 2 + Math.floor(Math.random() * 2);
    const batchReqs = {};
    for (let i = 0; i < shots; i++) {
      batchReqs[`shot_${i}`] = {
        method: 'POST',
        url: `${BASE_URL}/orders`,
        body,
        params: { headers },
      };
    }
    const responses = http.batch(batchReqs);
    Object.values(responses).forEach((res) => {
      check(res, {
        'order 202/409/400 accepted or duplicate blocked': (r) =>
          r.status === 202 || r.status === 409 || r.status === 400,
      });
    });
  } else {
    // สั่งซื้อตามปกติ 1 ครั้ง
    const res = http.post(`${BASE_URL}/orders`, body, { headers });
    check(res, {
      'order 202/409/400 accepted or blocked': (r) =>
        r.status === 202 || r.status === 409 || r.status === 400,
    });
  }

  sleep(0.1);
}
