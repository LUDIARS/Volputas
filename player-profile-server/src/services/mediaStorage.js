const config = require('../config');
const { AppError } = require('../middleware/errorHandler');
const { presignGet, presignPut, signRequest } = require('./s3RequestSigner');
const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');

class S3MediaStorage {
  constructor(storageConfig = config.mediaStorage, fetchImplementation = fetch) {
    this.config = storageConfig;
    this.fetch = fetchImplementation;
  }

  isConfigured() {
    return Boolean(
      this.config.endpoint
      && this.config.region
      && this.config.bucket
      && this.config.accessKeyId
      && this.config.secretAccessKey
    );
  }

  requireConfigured() {
    if (!this.isConfigured()) {
      throw new AppError(503, 'MEDIA_STORAGE_UNAVAILABLE', 'Media object storage is not configured');
    }
  }

  createUpload(objectKey, sha256) {
    this.requireConfigured();
    return presignPut(this.publicConfig(), objectKey, sha256, this.config.uploadExpiresSeconds);
  }

  createDownload(objectKey) {
    this.requireConfigured();
    return presignGet(this.publicConfig(), objectKey, this.config.deliveryExpiresSeconds);
  }

  publicConfig() {
    return { ...this.config, endpoint: this.config.publicEndpoint || this.config.endpoint };
  }

  async head(objectKey) {
    this.requireConfigured();
    const request = signRequest(this.config, 'HEAD', objectKey, { 'x-amz-checksum-mode': 'ENABLED' });
    const response = await this.fetch(request.url, { method: 'HEAD', headers: request.headers });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new AppError(503, 'MEDIA_STORAGE_ERROR', `Object storage HEAD failed with status ${response.status}`);
    }
    return {
      sizeBytes: Number.parseInt(response.headers.get('content-length') || '-1', 10),
      checksumSha256: response.headers.get('x-amz-checksum-sha256'),
      metadataSha256: response.headers.get('x-amz-meta-sha256'),
      contentType: response.headers.get('content-type'),
    };
  }

  async delete(objectKey) {
    this.requireConfigured();
    const request = signRequest(this.config, 'DELETE', objectKey);
    const response = await this.fetch(request.url, { method: 'DELETE', headers: request.headers });
    if (!response.ok && response.status !== 404) {
      throw new AppError(503, 'MEDIA_STORAGE_ERROR', `Object storage DELETE failed with status ${response.status}`);
    }
  }

  async download(objectKey, destinationPath) {
    this.requireConfigured();
    const request = signRequest(this.config, 'GET', objectKey);
    const response = await this.fetch(request.url, { method: 'GET', headers: request.headers });
    if (!response.ok || !response.body) {
      throw new AppError(503, 'MEDIA_STORAGE_ERROR', `Object storage GET failed with status ${response.status}`);
    }
    await pipeline(response.body, fs.createWriteStream(destinationPath, { flags: 'wx' }));
  }

  async uploadProcessed(objectKey, sourcePath, mimeType) {
    this.requireConfigured();
    const stat = await fs.promises.stat(sourcePath);
    const headers = { 'content-type': mimeType, 'content-length': String(stat.size) };
    const request = signRequest(this.config, 'PUT', objectKey, headers);
    const response = await this.fetch(request.url, {
      method: 'PUT',
      headers: request.headers,
      body: fs.createReadStream(sourcePath),
      duplex: 'half',
    });
    if (!response.ok) {
      throw new AppError(503, 'MEDIA_STORAGE_ERROR', `Object storage PUT failed with status ${response.status}`);
    }
    return stat.size;
  }
}

module.exports = { S3MediaStorage };
