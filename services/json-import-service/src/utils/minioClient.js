const Minio = require('minio');

/**
 * MinIO Client Configuration
 * Handles file uploads to MinIO object storage with organized folder structure
 */

class MinioClient {
    constructor() {
        this.client = new Minio.Client({
            endPoint: process.env.MINIO_ENDPOINT || 'minio',
            port: parseInt(process.env.MINIO_PORT) || 9000,
            useSSL: process.env.MINIO_USE_SSL === 'true',
            accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
            secretKey: process.env.MINIO_SECRET_KEY || 'MinioAdmin123'
        });

        this.bucketName = process.env.MINIO_BUCKET || 'gst-documents';
        this.initialized = false;
    }

    /**
     * Initialize MinIO client and ensure bucket exists
     */
    async initialize() {
        if (this.initialized) return;

        try {
            const bucketExists = await this.client.bucketExists(this.bucketName);

            if (!bucketExists) {
                await this.client.makeBucket(this.bucketName, 'us-east-1');
                console.log(`✅ MinIO bucket '${this.bucketName}' created successfully`);
            } else {
                console.log(`✅ MinIO bucket '${this.bucketName}' already exists`);
            }

            this.initialized = true;
        } catch (error) {
            console.error('❌ MinIO initialization error:', error);
            throw new Error(`Failed to initialize MinIO: ${error.message}`);
        }
    }

    /**
     * Upload file to MinIO with organized folder structure
     * Path format: {tenantUuid}/{gstin}/{financialYear}/{gstrType}/{filename}
     * 
     * @param {string} filePath - Local file path to upload
     * @param {object} metadata - File metadata
     * @returns {object} Upload result with MinIO path and URL
     */
    async uploadFile(filePath, metadata) {
        await this.initialize();

        const {
            tenantUuid,
            gstin,
            financialYear,
            gstrType,
            originalFilename
        } = metadata;

        // Build a timestamp-prefixed filename so every upload is unique and nothing gets overwritten
        // Format: YYYYMMDD_HHmmss_ms_originalFilename  e.g. 20260218_112354_847_GSTR2B_Dec2025.xlsx
        const now = new Date();
        const pad = (n, len = 2) => String(n).padStart(len, '0');
        const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}_${pad(now.getMilliseconds(), 3)}`;
        const uniqueFilename = `${timestamp}_${originalFilename}`;

        // Construct MinIO object path
        const objectPath = `${tenantUuid}/${gstin}/${financialYear}/${gstrType}/${uniqueFilename}`;

        try {
            // Upload file to MinIO
            const fileMetadata = {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'x-amz-meta-tenant': tenantUuid,
                'x-amz-meta-gstin': gstin,
                'x-amz-meta-period': metadata.returnPeriod || '',
                'x-amz-meta-type': gstrType
            };

            await this.client.fPutObject(
                this.bucketName,
                objectPath,
                filePath,
                fileMetadata
            );

            console.log(`✅ File uploaded to MinIO: ${objectPath}`);

            // Generate presigned URL (valid for 7 days)
            const presignedUrl = await this.client.presignedGetObject(
                this.bucketName,
                objectPath,
                7 * 24 * 60 * 60 // 7 days in seconds
            );

            return {
                success: true,
                objectPath,
                presignedUrl,
                bucket: this.bucketName
            };

        } catch (error) {
            console.error('❌ MinIO upload error:', error);
            throw new Error(`Failed to upload file to MinIO: ${error.message}`);
        }
    }

    /**
     * Upload raw data (e.g. JSON object) to MinIO
     */
    async uploadData(data, metadata) {
        await this.initialize();

        const {
            tenantUuid,
            gstin,
            financialYear,
            gstrType,
            originalFilename
        } = metadata;

        const now = new Date();
        const pad = (n, len = 2) => String(n).padStart(len, '0');
        const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}_${pad(now.getMilliseconds(), 3)}`;
        const uniqueFilename = `${timestamp}_${originalFilename || 'data.json'}`;
        const objectPath = `${tenantUuid}/${gstin}/${financialYear}/${gstrType}/${uniqueFilename}`;

        try {
            const buffer = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
            const fileMetadata = {
                'Content-Type': 'application/json',
                'x-amz-meta-tenant': tenantUuid,
                'x-amz-meta-gstin': gstin,
                'x-amz-meta-period': metadata.returnPeriod || '',
                'x-amz-meta-type': gstrType
            };

            await this.client.putObject(
                this.bucketName,
                objectPath,
                buffer,
                buffer.length,
                fileMetadata
            );

            console.log(`✅ Data uploaded to MinIO: ${objectPath}`);

            const presignedUrl = await this.client.presignedGetObject(
                this.bucketName,
                objectPath,
                7 * 24 * 60 * 60
            );

            return {
                success: true,
                objectPath,
                presignedUrl,
                bucket: this.bucketName
            };
        } catch (error) {
            console.error('❌ MinIO direct upload error:', error);
            throw new Error(`Failed to upload data to MinIO: ${error.message}`);
        }
    }

    /**
     * Get presigned URL for an existing object
     * @param {string} objectPath - MinIO object path
     * @param {number} expirySeconds - URL expiry time in seconds (default: 7 days)
     * @returns {string} Presigned URL
     */
    async getPresignedUrl(objectPath, expirySeconds = 7 * 24 * 60 * 60) {
        await this.initialize();

        try {
            const url = await this.client.presignedGetObject(
                this.bucketName,
                objectPath,
                expirySeconds
            );
            return url;
        } catch (error) {
            console.error('❌ Error generating presigned URL:', error);
            throw new Error(`Failed to generate presigned URL: ${error.message}`);
        }
    }

    /**
     * Delete file from MinIO
     * @param {string} objectPath - MinIO object path
     */
    async deleteFile(objectPath) {
        await this.initialize();

        try {
            await this.client.removeObject(this.bucketName, objectPath);
            console.log(`✅ File deleted from MinIO: ${objectPath}`);
            return { success: true };
        } catch (error) {
            console.error('❌ MinIO delete error:', error);
            throw new Error(`Failed to delete file from MinIO: ${error.message}`);
        }
    }

    /**
     * Check if file exists in MinIO
     * @param {string} objectPath - MinIO object path
     * @returns {boolean}
     */
    async fileExists(objectPath) {
        await this.initialize();

        try {
            await this.client.statObject(this.bucketName, objectPath);
            return true;
        } catch (error) {
            if (error.code === 'NotFound') {
                return false;
            }
            throw error;
        }
    }
}

// Export singleton instance
module.exports = new MinioClient();
