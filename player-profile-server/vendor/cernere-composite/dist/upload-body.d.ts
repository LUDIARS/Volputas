export interface UploadOwner {
    isCurrent: () => boolean;
    signal?: AbortSignal;
}
export interface UploadLimits {
    maximumBytes: number;
    timeoutSeconds: number;
}
/** Protocol ceiling; hosts must independently declare their stricter route/quota. */
export declare const MAX_CAPTURED_UPLOAD_BYTES: number;
/** @implements SPEC-COMPOSITE-UPLOAD-RESERVATION */
export declare function requireUploadLimits(value: UploadLimits): UploadLimits;
/** @implements SPEC-COMPOSITE-UPLOAD-RESERVATION */
export declare function requireUploadOwner(owner: UploadOwner): void;
/** @implements SPEC-COMPOSITE-UPLOAD-RESERVATION */
export declare function digestCapturedBody(body: Blob, maximumBytes: number, owner: UploadOwner): Promise<{
    contentDigest: string;
    byteLength: number;
}>;
