FROM node:18-alpine

WORKDIR /app

# Copy shared module first (as it's a dependency)
COPY services/shared /app/services/shared
WORKDIR /app/services/shared
RUN npm install

# Setup Tenant Service
WORKDIR /app/services/tenant-services
COPY services/tenant-services/package.json .
<<<<<<< HEAD
COPY services/tenant-services/.env.docker .env
=======

>>>>>>> origin/demot5
# Install dependencies (including local shared link if we used it, but here we likely refer to it by path or just copy code)
# Since package.json might not refer to shared via file:../shared yet, we might need to adjust.
# For now, let's assume we copy shared and the code requires it via relative path.
# But `npm install` inside tenant-services needs to work.
# If tenant-services/package.json deps doesn't explicitly list shared, we are good.
# If it does, we need to ensure it resolves. 
# My created package.json didn't list 'shared' as a dependency, I just required it via relative path in code.
# So standard npm install is fine for external deps.

RUN npm install

# Copy source code
COPY services/tenant-services .

EXPOSE 3001

CMD ["npm", "start"]
