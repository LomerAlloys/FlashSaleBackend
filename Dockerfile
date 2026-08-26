# ใช้ Node.js เป็น Base Image
FROM node:18-alpine

# กำหนดโฟลเดอร์ทำงานภายใน Container
WORKDIR /usr/src/app

# ก๊อปปี้ไฟล์ package.json และติดตั้ง dependencies
COPY package*.json ./
RUN npm install

# ก๊อปปี้โค้ดทั้งหมดลงไป และสั่ง Build
COPY . .
RUN npm run build

# เปิดพอร์ต 3000
EXPOSE 3000

# รันแอปพลิเคชัน
CMD ["npm", "run", "start:prod"]