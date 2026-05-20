FROM node:18-alpine

WORKDIR /app

# Copy shared modules first
COPY services/shared /app/services/shared
WORKDIR /app/services/shared
RUN npm install

# Set working directory to service
WORKDIR /app/services/external-api-service

# Copy package files
COPY services/external-api-service/package*.json ./

# Install dependencies
RUN npm install

# Copy service code
COPY services/external-api-service .

EXPOSE 3008

CMD ["npm", "start"]
