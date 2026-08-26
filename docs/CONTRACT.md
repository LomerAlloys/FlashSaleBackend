# API & Key Contract — ห้ามแก้คนเดียว ต้องตกลงกันทั้งกลุ่มก่อน

เอกสารนี้คือ "สัญญา" ระหว่างงานของสมาชิก 3 คน และระหว่างกลุ่มเรากับกลุ่มเพื่อน
(เพราะต้องใช้ k6 script ตัวเดียวกันยิงข้ามกลุ่มได้)

## 1. Base URL
- ผ่าน Nginx: `http://localhost:8080/api/v1`
- ตรงเข้า instance (debug เท่านั้น): `http://localhost:3000/api/v1`

## 2. Endpoints

### POST /api/v1/auth/token   → ผู้รับผิดชอบ: คนที่ 2
Request:  `{ "userId": "user-999" }`
Response 200:
```json
{ "status": "success", "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6Ik..." }
```

### GET /api/v1/products?page=1&limit=10   → ผู้รับผิดชอบ: คนที่ 1
Response 200:
```json
{
  "status": "success",
  "data": [{
    "productId": "p-1001",
    "name": "Limited Edition Sneaker",
    "price": 2990,
    "availableStock": 50,
    "remainingStock": 30,
    "isFlashSaleActive": true
  }],
  "meta": { "total": 20, "page": 1, "limit": 10, "totalPages": 2 }
}
```

### POST /api/v1/orders   → ผู้รับผิดชอบ: คนที่ 2 (API) + คนที่ 3 (Worker)
Headers: `Authorization: Bearer <JWT>`
Request:  `{ "productId": "p-1001" }`   (ไม่ต้องส่ง quantity — บังคับ 1 ชิ้น)
Response 202:
```json
{ "status": "processing", "orderJobId": "job-12345", "message": "Your order is in the queue." }
```
Error ที่ตกลงกันไว้:
| กรณี | HTTP | body.status |
|---|---|---|
| ไม่มี/JWT ไม่ถูกต้อง | 401 | `error` |
| user คนเดิมกดซ้ำสินค้าเดิม | 409 | `duplicate` |
| ไม่มี productId นี้ | 404 | `error` |

## 3. JWT
- Algorithm: `HS256`, secret จาก env `JWT_SECRET`, `expiresIn = 1h`
- Payload: `{ "sub": "<userId>", "iat": ..., "exp": ... }`  ← **ใช้ `sub` เท่านั้น** ห้ามเปลี่ยนเป็น `userId`
- Stateless 100% — ห้ามเก็บ session ใน memory ของ instance

## 4. Redis Key Convention
| Key | ใช้ทำอะไร | เจ้าของ |
|---|---|---|
| `products:page:{page}:limit:{limit}` | cache ผลลัพธ์ GET /products (TTL 30s) | คนที่ 1 |
| `cache:stats:hit` / `cache:stats:miss` | counter สำหรับ Dashboard | คนที่ 1 |
| `lock:order:{userId}:{productId}` | `SET ... NX EX 60` กันกดรัวๆ ระดับ API | คนที่ 2 |
| `bull:order-queue:*` | BullMQ จัดการเอง | คนที่ 3 |

## 5. Queue
- ชื่อคิว: `order-queue`
- Job data: `{ "userId": "user-1", "productId": "p-1001" }`
- `jobId` = `` `${userId}:${productId}` `` (BullMQ จะกันงานซ้ำให้อีกชั้นโดยอัตโนมัติ)
- Job options: `attempts: 3`, `backoff: { type: 'exponential', delay: 200 }`, `removeOnComplete: false` (ต้องเก็บไว้โชว์ใน Bull-Board)

## 6. กฎเหล็ก
1. Controller ของ `POST /orders` **ห้าม** เขียน DB — ต้อง enqueue แล้วตอบ 202 ทันที
2. Worker เท่านั้นที่ตัดสต็อก และต้องอยู่ใน transaction + row lock
3. ทุกครั้งที่ commit สำเร็จ ต้อง invalidate cache key `products:page:*`
4. `synchronize: false` เสมอ — schema แก้ที่ `db/init.sql` อย่างเดียว

## 7. โครงสร้างโฟลเดอร์ที่ตกลงกัน

repo นี้มี `src/` อยู่ที่ root (ไม่ได้อยู่ใต้ `backend/`) โมดูลที่จะเพิ่มคือ:

```
src/
├── main.ts                 # setGlobalPrefix('api/v1') + Bull-Board
├── app.module.ts
├── common/                 # redis provider, guards, interceptors
├── auth/                   # คนที่ 2
├── products/               # คนที่ 1
├── orders/                 # คนที่ 2 (controller + service: lock + enqueue)
├── worker/                 # คนที่ 3 (order.processor.ts)
├── entities/               # product.entity.ts, order.entity.ts
└── migrations/
db/init.sql                 # schema + seed
loadtest/loadtest.js        # คนที่ 3
```

โมดูล `students/` เดิมให้ลบทิ้งหลังย้าย pattern ที่ใช้ซ้ำออกมาแล้ว
(cache-aside จาก `findOne()`, row lock จาก `enroll()`, SET NX จาก `sendConfirmationEmail()`,
โครง processor จาก `email.processor.ts`)

## 8. ใครแตะไฟล์ไหน (กัน merge conflict)

| ไฟล์ / โฟลเดอร์ | เจ้าของ |
|---|---|
| `docker-compose.yml`, `nginx.conf`, `Dockerfile`, `db/init.sql`, `src/products/`, `src/entities/` | คนที่ 1 |
| `src/auth/`, `src/orders/`, `src/common/guards/` | คนที่ 2 |
| `src/worker/`, `loadtest/`, `main.ts` (ส่วน Bull-Board) | คนที่ 3 |
| `src/app.module.ts`, `docs/CONTRACT.md`, `CLAUDE.md` | **แก้ร่วมกัน — ต้องบอกในกลุ่มก่อนแก้** |
