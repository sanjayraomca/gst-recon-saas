FROM node:18-alpine

WORKDIR /app

# Copy and install shared module dependencies first
COPY services/shared/package*.json /app/services/shared/
WORKDIR /app/services/shared
RUN npm install

# Copy shared module code
WORKDIR /app
COPY services/shared /app/services/shared

# Set working directory to service
WORKDIR /app/services/workspace-service

# Copy package files
COPY services/workspace-service/package*.json ./

# Install dependencies
RUN npm install

# Copy service code
COPY services/workspace-service .

EXPOSE 3002

CMD ["npm", "start"]
