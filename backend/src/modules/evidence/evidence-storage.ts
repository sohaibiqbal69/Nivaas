export type EvidenceStorageProvider = 'local' | 's3' | 'cloudinary';

/** Internal reference persisted only on Evidence documents; legacy records omit provider. */
export type EvidenceStorageReference = {
  provider?: EvidenceStorageProvider;
  storagePath: string;
  assetId?: string;
  resourceType?: 'image';
  deliveryType?: 'authenticated';
  format?: 'jpg' | 'png';
  version?: number;
};

export type NewEvidenceStorageReference = EvidenceStorageReference & { provider: EvidenceStorageProvider };

export interface EvidenceStorage {
  write(bytes: Buffer): Promise<NewEvidenceStorageReference>;
  read(reference: EvidenceStorageReference): Promise<Buffer>;
  remove(reference: EvidenceStorageReference): Promise<void>;
}

/** One provider implementation used by the configured dispatcher. */
export interface EvidenceObjectStore {
  write(bytes: Buffer): Promise<NewEvidenceStorageReference>;
  read(reference: EvidenceStorageReference): Promise<Buffer>;
  remove(reference: EvidenceStorageReference): Promise<void>;
}

export function evidenceStorageFields(reference: NewEvidenceStorageReference) {
  return {
    storageProvider: reference.provider,
    storagePath: reference.storagePath,
    ...(reference.assetId ? {
      storageAssetId: reference.assetId,
      storageResourceType: reference.resourceType,
      storageDeliveryType: reference.deliveryType,
      storageFormat: reference.format,
      storageVersion: reference.version,
    } : {}),
  };
}

export function evidenceStorageReference(record: {
  storageProvider?: EvidenceStorageProvider;
  storagePath: string;
  storageAssetId?: string;
  storageResourceType?: 'image';
  storageDeliveryType?: 'authenticated';
  storageFormat?: 'jpg' | 'png';
  storageVersion?: number;
}): EvidenceStorageReference {
  return {
    provider: record.storageProvider,
    storagePath: record.storagePath,
    assetId: record.storageAssetId,
    resourceType: record.storageResourceType,
    deliveryType: record.storageDeliveryType,
    format: record.storageFormat,
    version: record.storageVersion,
  };
}
