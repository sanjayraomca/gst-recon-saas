FROM node:18-alpine

WORKDIR /app

# Copy shared module
COPY services/shared /app/services/shared

# Setup service
WORKDIR /app/services/upload-service
COPY services/upload-service/package*.json ./
RUN npm install

COPY services/upload-service .

EXPOSE 3004

CMD ["npm", "start"]
