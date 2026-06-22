FROM node:18-alpine

WORKDIR /app

# Copy shared module
COPY services/shared /app/services/shared
WORKDIR /app/services/shared
RUN npm install

# Setup service
WORKDIR /app/services/json-import-service
COPY services/json-import-service/package*.json ./
RUN npm install

COPY services/json-import-service .

EXPOSE 3007

CMD ["npm", "start"]
