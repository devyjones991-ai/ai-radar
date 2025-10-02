FROM node:18-alpine

WORKDIR /app

# Установка curl для диагностики
RUN apk add --no-cache curl

COPY package.json ./
RUN npm install --production

COPY memory-service.js ./

EXPOSE 3000

CMD ["npm", "start"]
