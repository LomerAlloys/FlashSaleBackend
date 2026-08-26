# ---- Build stage ----
FROM node:18-alpine AS build

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# ---- Production stage ----
FROM node:18-alpine AS production

ENV NODE_ENV=production

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=build /usr/src/app/dist ./dist

EXPOSE 3000

CMD ["npm", "run", "start:prod"]
