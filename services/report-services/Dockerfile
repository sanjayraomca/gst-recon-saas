FROM node:18-alpine

WORKDIR /app

# Copy shared module first
COPY services/shared /app/services/shared

# Setup Report Service
WORKDIR /app/services/report-services
COPY services/report-services/package*.json ./
# COPY services/report-services/.env ./ # (Env vars usually from docker-compose, but file copy can help)

RUN npm install --production

COPY services/report-services .

# Create directory for generated reports (if it was relative to WORKDIR)
RUN mkdir -p generated_reports

EXPOSE 3005

CMD ["npm", "start"]
