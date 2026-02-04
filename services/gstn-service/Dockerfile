FROM node:18-alpine

WORKDIR /app

# Copy shared modules first
COPY services/shared /app/services/shared

# Set working directory to service
WORKDIR /app/services/gstn-service

# Copy package files
COPY services/gstn-service/package*.json ./

# Install dependencies
RUN npm install

# Copy service code
COPY services/gstn-service .

EXPOSE 3003

CMD ["npm", "start"]
