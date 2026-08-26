---
name: verify-flashsale
description: ตรวจรับระบบ Flash Sale แบบครบวงจร — สตาร์ท docker compose, เช็ค load balancing ข้าม 3 instances, ทดสอบ cache hit/miss, ยิง k6 แล้วพิสูจน์ว่าสต็อกเหลือ 0 พอดีและไม่มีใครได้สินค้าเกิน 1 ชิ้น ใช้เมื่อผู้ใช้บอกว่า "ตรวจระบบ" "verify" "เช็คว่าผ่านไหม" "รัน load test" หรือหลังแก้โค้ดส่วน orders/worker/cache เสร็จ
---

# ตรวจรับระบบ Flash Sale

ทำตามลำดับนี้ทุกขั้น **ห้ามข้าม** และหยุดทันทีที่ขั้นไหนไม่ผ่าน แล้วแก้ให้ผ่านก่อนไปต่อ
รายงานผลเป็นตาราง ✅/❌ ท้ายสุด

## 1. สตาร์ทระบบ

```bash
docker compose down -v && docker compose up -d --build
docker compose ps
```

ทุก service ต้อง `running` และตัวที่มี healthcheck ต้อง `healthy`
ถ้ามี container ตาย → `docker compose logs <service>` อ่าน error แล้วแก้

## 2. Load Balancing

ยิง `/api/v1/health` (หรือ `/status`) 9 ครั้ง แล้วนับชื่อ instance
**ต้องเห็นครบทั้ง 3 ตัว** ถ้าเห็นตัวเดียว = LB ไม่ทำงาน หรือมี instance ตายอยู่

## 3. Cache-Aside

1. ยิง `GET /api/v1/products?page=1&limit=10` ครั้งแรก → ต้องเป็น **MISS**
2. ยิงซ้ำทันที → ต้องเป็น **HIT** และเร็วกว่าครั้งแรกชัดเจน
3. `docker compose exec redis redis-cli KEYS "products:page:*"` ต้องเจอ key
4. เช็คว่า response มี `meta.total`, `meta.totalPages` ครบตามสเปค

## 4. Auth + กันกดซ้ำ

1. `POST /api/v1/auth/token` ด้วย `{"userId":"user-1"}` → เก็บ token
2. `POST /api/v1/orders` ไม่แนบ token → ต้องได้ **401**
3. แนบ token ยิง `{"productId":"p-1001"}` → ต้องได้ **202** พร้อม `orderJobId`
4. ยิงซ้ำด้วย user เดิม product เดิม → ต้องได้ **409** (ไม่ใช่ 202)
5. เช็คว่า controller ตอบกลับภายใน ~50ms (ต้องไม่รอ DB)

## 5. Load Test

```bash
k6 run loadtest/loadtest.js
```

บันทึก: Req/s, p95 latency, error rate, http_req_failed
หมายเหตุ: 409 กับ job failed ที่เกิดจาก "ของหมด" **ไม่ใช่ error ของระบบ** ให้แยกนับต่างหาก

## 6. Data Integrity — ข้อสำคัญที่สุด

```bash
docker compose exec postgres psql -U flashsale -d flashsale -c "
  SELECT remaining_stock FROM products WHERE product_id='p-1001';
  SELECT COUNT(*) AS total_orders,
         COUNT(DISTINCT user_id) AS unique_users,
         MAX(cnt) AS max_per_user
  FROM (SELECT user_id, COUNT(*) cnt FROM orders
        WHERE product_id='p-1001' GROUP BY user_id) t;
"
```

เกณฑ์ผ่าน — ต้องครบทุกข้อ:
- `remaining_stock` = **0 พอดี** (ติดลบ = race condition หลุด → ต้องแก้ทันที)
- `total_orders` = **50**
- `unique_users` = **50**
- `max_per_user` = **1**

## 7. Queue

เปิด `http://localhost:8080/admin/queues` (Bull-Board)
ต้องเห็น completed jobs (ถ้าว่างเปล่า แปลว่าตั้ง `removeOnComplete: true` อยู่ ต้องเปลี่ยนเป็น false
เพราะต้องแคปหน้าจอส่งอาจารย์) และเห็น failed jobs ของเคส "ของหมด"

## รายงานผล

สรุปเป็นตาราง: ขั้นตอน | ผลลัพธ์ที่ได้ | ผ่าน/ไม่ผ่าน
ถ้ามีข้อไหนไม่ผ่าน ให้ระบุสาเหตุที่สงสัยและไฟล์ที่ต้องแก้ อย่าแก้เองโดยไม่บอก
