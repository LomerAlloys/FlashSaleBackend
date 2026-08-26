# Flash Sale System — Project Instructions

โปรเจกต์วิชา Mobile Backend Architecture & Performance Testing (งานกลุ่ม 3 คน)
Backend รองรับ Flash Sale ที่มีคนแย่งกันกดซื้อพร้อมกัน เน้น High Throughput / Low Latency
และต้องไม่เกิด overselling

**ตอบเป็นภาษาไทย** ศัพท์เทคนิคคงภาษาอังกฤษไว้

## Stack ที่บังคับใช้ (ห้ามเปลี่ยนโดยไม่ถาม)

Nginx (LB) · NestJS × 3 instances · PostgreSQL + TypeORM · Redis (cache + lock)
· BullMQ · JWT · Docker Compose

## กฎเหล็ก — ห้ามละเมิดเด็ดขาด

1. **`synchronize: false` เสมอ** — schema มาจาก `db/init.sql` / migration ทางเดียว
   (3 instances บูตพร้อมกันแล้ว sync จะชนกัน)
2. **Controller ของ `POST /orders` ห้ามเขียน DB** — ต้อง enqueue เข้า BullMQ แล้วตอบ
   202 ทันที งานตัดสต็อกเป็นหน้าที่ของ Worker เท่านั้น
3. **ห้ามใช้ in-memory session** — auth ต้อง stateless ด้วย JWT ล้วน ไม่งั้น scale
   แนวนอนไม่ได้
4. **ห้ามใส่ `sleep` / `setTimeout` ในโค้ดที่ถือ row lock หรืออยู่ใน transaction**
   (ของเดิมใน `enroll()` มี delay 500ms ค้างอยู่ตอนถือ pessimistic lock — ถ้าเจอให้ลบ)
5. **ห้ามใช้ DB replication (master/slave)** — read จาก replica มี lag ทำให้
   `remainingStock` ที่ตอบกลับไม่ตรงความจริง ซึ่งขัดข้อกำหนดข้อ 2.2 ของโจทย์โดยตรง
6. ทุก endpoint ขึ้นต้นด้วย `/api/v1` (`app.setGlobalPrefix('api/v1')`)
7. ห้ามแก้ `docs/CONTRACT.md` โดยไม่ได้รับอนุญาต — เป็นสัญญาที่ตกลงกับเพื่อนร่วมกลุ่ม
   และใช้ร่วมกับกลุ่มอื่นตอนยิง load test ข้ามกลุ่ม

## สเปค API (ย่อ — ฉบับเต็มอยู่ใน docs/CONTRACT.md ให้อ่านก่อนแก้โค้ดที่เกี่ยวข้อง)

| Endpoint | หมายเหตุ |
|---|---|
| `POST /api/v1/auth/token` | body `{userId}` → `{status, accessToken}` · JWT payload ใช้ `sub` |
| `GET /api/v1/products?page=1&limit=10` | Cache-Aside + Pagination · response มี `data` + `meta` |
| `POST /api/v1/orders` | Bearer JWT · body `{productId}` · ตอบ **202** `{status:"processing", orderJobId, message}` |

Redis keys: `products:page:{page}:limit:{limit}` · `lock:order:{userId}:{productId}` ·
คิวชื่อ `order-queue` · jobId = `{userId}:{productId}`

## กันซื้อซ้ำ / กัน Race Condition — ต้องมีครบ 3 ชั้น

1. **API**: `SET lock:order:{userId}:{productId} NX EX 60` (atomic) ถ้าไม่ได้ล็อค → 409
2. **Worker**: transaction + `SELECT ... FOR UPDATE` (pessimistic) ก่อนตัดสต็อก
3. **DB**: `UNIQUE(user_id, product_id)` + `CHECK(remaining_stock >= 0)`

ตัดชั้นไหนออกไม่ได้ทั้งนั้น — โจทย์ต้องการหลักฐานว่าสต็อกเหลือ 0 พอดี (ไม่ติดลบ)
และมี order จากผู้ใช้ 50 คนที่ไม่ซ้ำกัน

## เมื่อ Worker commit สำเร็จ

ต้อง invalidate cache `products:page:*` ทุกครั้ง ไม่งั้น `GET /products` จะโชว์สต็อกเก่า

## เป้าหมาย Load Test (k6)

เตรียม JWT 500 users → GET 1,000 concurrent → POST 500 concurrent แย่งซื้อ `p-1001`
ที่มีสต็อก 50 ชิ้น และมีบาง user ยิงซ้ำ 2-3 ครั้งพร้อมกัน

## คำสั่งที่ใช้บ่อย

```bash
docker compose up -d --build
docker compose logs -f api-1
docker compose down -v          # ล้าง volume เพื่อ seed ใหม่
npm run build                   # ใน backend/ ตรวจว่า TypeScript ผ่าน
```

## วิธีทำงานกับ repo นี้

- แก้ทีละก้อน ก้อนละไม่เกิน 3-4 ไฟล์ แล้วให้ผมตรวจ diff ก่อนไปต่อ
- ทุกครั้งที่แก้เสร็จ ต้อง `npm run build` ให้ผ่านก่อนบอกว่าเสร็จ
- ถ้าจะเปลี่ยน dependency ให้เช็คเวอร์ชันจริงบน npm ก่อน อย่าเดา
- โครงสร้าง: `backend/src/{auth,products,orders,worker,common}/`
- ห้าม commit `.env` ขึ้น git
