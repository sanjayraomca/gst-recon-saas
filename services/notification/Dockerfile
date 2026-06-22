FROM node:18-alpine

WORKDIR /app

# Copy shared module first
COPY services/shared /app/services/shared
WORKDIR /app/services/shared
RUN npm install

# Setup Notification Service
WORKDIR /app/services/notification
COPY services/notification/package.json .
# COPY services/notification/.env . # .env is usually passed by docker-compose, but good to have if file exists

RUN npm install

# Copy source code
COPY services/notification .

EXPOSE 3006 

CMD ["npm", "start"]
