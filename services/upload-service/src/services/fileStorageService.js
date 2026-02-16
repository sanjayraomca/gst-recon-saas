const { minioClient, BUCKET_NAME } = require('../utils/minioClient');
const fs = require('fs');

class FileStorageService {
    /**
     * Uploads a file to MinIO
     * @param {string} filePath - Local path of the file to upload
     * @param {string} destinationPath - Destination path in MinIO (e.g., TenantId/Org_gst/FY/File.ext)
     * @param {string} contentType - MIME type of the file
     * @returns {Promise<string>} - The uploaded file path/URL
     */
    static async uploadFile(filePath, destinationPath, contentType) {
        return new Promise((resolve, reject) => {
            const extraHeaders = {
                'Content-Type': contentType || 'application/octet-stream'
            };

            minioClient.fPutObject(BUCKET_NAME, destinationPath, filePath, extraHeaders, (err, etag) => {
                if (err) {
                    console.error('MinIO Upload Error:', err);
                    return reject(err);
                }
                console.log(`File uploaded successfully to ${BUCKET_NAME}/${destinationPath}. ETag: ${etag}`);
                resolve(`/${BUCKET_NAME}/${destinationPath}`);
            });
        });
    }

    /**
     * Generates a presigned URL for the file
     * @param {string} filePath - Path of the file in MinIO
     * @returns {Promise<string>} - Presigned URL
     */
    static async getPresignedUrl(filePath) {
        try {
            return await minioClient.presignedGetObject(BUCKET_NAME, filePath, 24 * 60 * 60); // 1 day expiry
        } catch (err) {
            console.error('MinIO Presigned URL Error:', err);
            throw err;
        }
    }
}

module.exports = FileStorageService;
