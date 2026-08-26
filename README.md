# ⚡ คู่มือการใช้งานระบบ Flash Sale Backend (Master Documentation)
*(Mobile Backend Architecture & Performance Testing)*

คู่มือฉบับนี้จัดทำขึ้นสำหรับอธิบายสถาปัตยกรรม วิธีการติดตั้ง รันเซิร์ฟเวอร์ และการทดสอบ API ของระบบ **Flash Sale Backend** อ้างอิงตามข้อกำหนดในเอกสาร **`Flash Sale System.pdf`**

---

## 📐 1. ภาพรวมสถาปัตยกรรมระบบ (Architecture Overview)

ระบบถูกออกแบบให้รองรับปริมาณคำขอพร้อมกันมหาศาล (**High Throughput & Low Latency**) และการันตีความถูกต้องของข้อมูลสต็อกสินค้า (**Data Integrity & Zero Overbooking**) ประกอบด้วยองค์ประกอบหลักดังนี้:

```text
                               ┌───────────────────────────┐
                               │  Client App / k6 Test     │
                               └─────────────┬─────────────┘
                                             │ (Port 80)
                                             ▼
                               ┌───────────────────────────┐
                               │    Nginx Load Balancer    │ (Round-Robin / Least-Conn)
                               └─────────────┬─────────────┘
                                             │
                  ┌──────────────────────────┼──────────────────────────┐
                  ▼                          ▼                          ▼
       ┌────────────────────┐     ┌────────────────────┐     ┌────────────────────┐
       │   api1 (NestJS)    │     │   api2 (NestJS)    │     │   api3 (NestJS)    │
       │    (Instance 1)    │     │    (Instance 2)    │     │    (Instance 3)    │
       └──────────┬─────────┘     └──────────┬─────────┘     └──────────┬─────────┘
                  │                          │                          │
                  ├──────────────────────────┼──────────────────────────┤
                  │ (Redis Caching & Lock)   │ (BullMQ Order Queue)     │ (Pessimistic Lock)
                  ▼                          ▼                          ▼
       ┌────────────────────┐     ┌────────────────────┐     ┌────────────────────┐
       │    Redis Cache     │     │   BullMQ Queue     │     │  PostgreSQL DB     │
       │   (Cache-Aside)    │     │  (Order Worker)    │     │ (Master / Replica) │
       └────────────────────┘     └────────────────────┘     └────────────────────┘
                                             │
                                             ▼
                               ┌───────────────────────────┐
                               │   Bull-Board Dashboard    │ (http://localhost/admin/queues)
                               └───────────────────────────┘
```

### 🌟 ฟีเจอร์สำคัญในระบบ:
1. **Load Balancing (Nginx):** กระจายโหลดคำขอไปยัง 3 Backend Instances ด้วย Round Robin
2. **Stateless Authentication (JWT):** ยืนยันตัวตนด้วย JSON Web Token (ห้ามใช้ In-memory session)
3. **Read-Heavy Caching (Redis Cache-Aside):** แคชรายการสินค้า และทำการ **Cache Invalidation** ทันทีเมื่อสต็อกมีการเปลี่ยนแปลง
4. **API-Level Concurrency Locking (Redis SETNX):** ล็อกสิทธิ์ด้วย Redis Atomic Operation ป้องกันผู้ใช้คนเดิมกดซื้อซ้ำซ้อนเบิ้ลคำขอ
5. **Asynchronous Order Queue (BullMQ):** ส่งคำสั่งซื้อเข้า Message Queue ตอบกลับ `202 Accepted` ทันทีภายใน `< 50ms`
6. **Worker DB Stock Deduction:** Worker ตัดสต็อกใน PostgreSQL ด้วย **Pessimistic Write Locking (`pessimistic_write`)** การันตีว่าสต็อกห้ามติดลบเด็ดขาด

---

## 📂 2. โครงสร้างโฟลเดอร์โปรเจกต์ (Project Directory)

```text
FlashSaleBackend/
├── doc/
│   ├── Flash Sale System.pdf   <-- เอกสารโจทย์หลัก
│   ├── products-seed.json      <-- ข้อมูลสินค้าเริ่มต้น (Auto-seed)
│   ├── loadtest.js             <-- k6 Script สำหรับยิง Load Test
│   └── FlashSale_Guide.md      <-- คู่มือนี้
├── src/
│   ├── auth/                   <-- ระบบ JWT Authentication (POST /api/v1/auth/token)
│   ├── products/               <-- ระบบจัดการและแคชสินค้า (GET /api/v1/products)
│   ├── orders/                 <-- ระบบคิวสั่งซื้อและ Worker (POST /api/v1/orders)
│   ├── app.module.ts
│   └── main.ts                 <-- มีการเปิด Bull-Board Monitoring
├── docker-compose.yml           <-- Nginx + 3 API Instances + PostgreSQL Master/Replica + Redis
├── nginx.conf                  <-- ค่านิวฟิก Nginx Load Balancer
├── .env                        <-- การตั้งค่าตัวแปรระบบ
└── package.json
```

---

## 🚀 3. วิธีการรันโปรเจกต์ (How to Run)

### 🔹 วิธีที่ 1: รันทั้งระบบด้วย Docker Compose (แนะนำ 1-Click Start)

เปิด Terminal แล้วย้ายไปที่โฟลเดอร์โปรเจกต์ `FlashSaleBackend`:

```bash
cd "C:\Users\ASUS\Desktop\beckend\moblie\FlashSaleBackend"

# สั่ง Build และเปิดบริการทั้งหมด (Nginx + 3 APIs + Postgres + Redis)
docker-compose up -d --build
```

เช็คสถานะการรัน:
```bash
docker ps
```

---

### 🔹 วิธีที่ 2: รันเฉพาะระบบฐานข้อมูล แล้วรัน NestJS บนเครื่อง (Development Mode)

```bash
cd "C:\Users\ASUS\Desktop\beckend\moblie\FlashSaleBackend"

# เปิดเฉพาะ Postgres DB และ Redis
docker-compose up -d db-primary redis

# สั่งรันแอป NestJS ในโหมด Watch
npm run start:dev
```

---

## 🔌 4. รายละเอียด API Endpoints & วิธีการทดสอบ

 Prefix หลักของทุก API คือ **`/api/v1`**

### 1️⃣ ขอ JWT Token (Authentication)
* **Endpoint:** `POST /api/v1/auth/token`
* **Request Body:**
  ```json
  { "userId": "user-999" }
  ```
* **PowerShell Test:**
  ```powershell
  Invoke-RestMethod -Uri "http://localhost/api/v1/auth/token" -Method Post -ContentType "application/json" -Body '{"userId": "user-999"}'
  ```
* **Response (200 OK):**
  ```json
  {
    "status": "success",
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR..."
  }
  ```

---

### 2️⃣ ดึงรายการสินค้า (Read-Heavy Cache-Aside)
* **Endpoint:** `GET /api/v1/products?page=1&limit=10`
* **PowerShell Test:**
  ```powershell
  Invoke-RestMethod -Uri "http://localhost/api/v1/products?page=1&limit=10" -Method Get
  ```
* **Response (200 OK):**
  ```json
  {
    "status": "success",
    "data": [
      {
        "productId": "p-1001",
        "name": "Limited Edition Sneaker",
        "price": 2990,
        "availableStock": 50,
        "remainingStock": 50,
        "isFlashSaleActive": true
      }
    ],
    "meta": {
      "total": 20,
      "page": 1,
      "limit": 10,
      "totalPages": 2
    }
  }
  ```

---

### 3️⃣ สั่งซื้อสินค้า Flash Sale (Write-Heavy Asynchronous Order)
* **Endpoint:** `POST /api/v1/orders`
* **Headers:** `Authorization: Bearer <accessToken>`
* **Request Body:**
  ```json
  { "productId": "p-1001" }
  ```
* **PowerShell Test:**
  ```powershell
  # 1. ขอ Token
  $token = (Invoke-RestMethod -Uri "http://localhost/api/v1/auth/token" -Method Post -ContentType "application/json" -Body '{"userId": "user-001"}').accessToken

  # 2. สั่งซื้อสินค้า p-1001
  Invoke-RestMethod -Uri "http://localhost/api/v1/orders" -Method Post -Headers @{ "Authorization" = "Bearer $token" } -ContentType "application/json" -Body '{"productId": "p-1001"}'
  ```
* **Response (202 Accepted):**
  ```json
  {
    "status": "processing",
    "orderJobId": "job-1",
    "message": "Your order is in the queue."
  }
  ```

---

## 📊 5. Observability & Queue Dashboard (Bull-Board)

สามารถเปิดดูสถานะการทำงานของคิว (Jobs in Queue, Active, Completed, Failed) ได้ผ่านหน้าเว็บ Dashboard:

👉 **[http://localhost/admin/queues](http://localhost/admin/queues)** (หรือ `http://localhost:3000/admin/queues`)

---

## 🧪 6. วิธีการรัน Load Test ด้วย k6

ติดตั้งเครื่องมือ `k6` จากนั้นรันไฟล์สคริปต์ทดสอบ:

```bash
k6 run doc/loadtest.js
```

### สิ่งที่สคริปต์ k6 ทำการทดสอบ:
1. **Preparation Phase:** วนลูปขอ JWT Token ให้ผู้ใช้ 500 คน (`user-1` ถึง `user-500`)
2. **Read Load:** ยิงทดสอบอ่านรายการสินค้า 1,000 requests
3. **Write Load:** ยิง 500 Concurrent Requests แย่งกันกดสั่งซื้อสินค้า `p-1001` (ซึ่งมีสต็อก 50 ชิ้น) พร้อมกัน
4. **Data Integrity Verification:**
   * สต็อกคงเหลือของ `p-1001` ในฐานข้อมูลต้องลดลงเหลือ `0` พอดี ห้ามติดลบ
   * ในตาราง `orders` ต้องมี Record สั่งซื้อสำเร็จ 50 รายการ และผู้ใช้แต่ละคนต้องไม่ซ้ำกัน
