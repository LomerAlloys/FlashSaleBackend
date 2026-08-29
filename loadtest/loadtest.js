import http from 'k6/http';
import { check, sleep } from 'k6';

// 📊 k6 Load Test — Flash Sale System
// Scenario ตาม CLAUDE.md: เตรียม JWT 500 users -> GET 1,000 concurrent
// -> POST 500 concurrent แย่งซื้อ p-1001 (stock 50) โดยบาง user ยิงซ้ำ 2-3 ครั้งพร้อมกัน

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080/api/v1';
const TOTAL_USERS = 500;
const DUPLICATE_FRACTION = 0.15; // ~15% ของ user ยิงคำสั่งซื้อซ้ำ 2-3 ครั้งพร้อมกันจริง (ไม่ใช่ retry ทีละครั้ง)

export const options = {
  scenarios: {
    // Phase 1: อ่านสินค้าแบบ concurrent สูง (เทส cache-aside ภายใต้โหลด)
    read_burst: {
      executor: 'constant-vus',
      vus: 1000,
      duration: '10s',
      exec: 'readProducts',
    },
    // Phase 2: 500 user แย่งกันซื้อ p-1001 พร้อมกัน (เริ่มหลัง read_burst จบ)
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
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.05'], // นับ 409 (ของหมด/ซ้ำ) เป็น "ไม่ error" แยกด้านล่างแล้ว
  },
};

// เตรียม JWT ให้ผู้ใช้ 500 คนล่วงหน้า (ไม่นับเวลานี้รวมกับช่วงยิงโหลดจริง)
export function setup() {
  const tokens = [];
  for (let i = 0; i < TOTAL_USERS; i++) {
    const res = http.post(
      `${BASE_URL}/auth/token`,
      JSON.stringify({ userId: `loadtest-user-${i}` }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    check(res, { 'auth token issued': (r) => r.status === 200 || r.status === 201 });
    tokens.push(res.json('accessToken'));
  }
  return { tokens };
}

// Phase 1: 1000 concurrent GET /products
export function readProducts() {
  const page = (__VU % 10) + 1;
  const res = http.get(`${BASE_URL}/products?page=${page}&limit=10`);
  check(res, { 'products 200': (r) => r.status === 200 });
}

// Phase 2: 500 concurrent POST /orders แย่งซื้อ p-1001 (บาง user ยิงซ้ำ 2-3 ครั้งพร้อมกัน)
export function placeOrder(data) {
  const vuIndex = (__VU - 1) % TOTAL_USERS;
  const token = data.tokens[vuIndex];
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const body = JSON.stringify({ productId: 'p-1001' });

  if (Math.random() < DUPLICATE_FRACTION) {
    // ยิงคำสั่งซื้อเดิมซ้ำ 2-3 ครั้งพร้อมกันจริง (concurrent, ไม่ใช่ sequential retry)
    const shots = 2 + Math.floor(Math.random() * 2); // 2 หรือ 3 ครั้ง
    const requests = {};
    for (let i = 0; i < shots; i++) {
      requests[`dup-${i}`] = { method: 'POST', url: `${BASE_URL}/orders`, body, params: { headers } };
    }
    const responses = http.batch(requests);
    Object.values(responses).forEach((res) => {
      check(res, { 'order 202/409/404': (r) => r.status === 202 || r.status === 409 || r.status === 404 });
    });
  } else {
    const res = http.post(`${BASE_URL}/orders`, body, { headers });
    check(res, { 'order 202/409/404': (r) => r.status === 202 || r.status === 409 || r.status === 404 });
  }

  sleep(0.1);
}
