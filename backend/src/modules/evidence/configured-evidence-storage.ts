import { backendConfig } from '../../config/environment.js';
import { CloudinaryEvidenceStorage } from './cloudinary-evidence-storage.js';
import { LocalEvidenceStorage } from './local-evidence-storage.js';
import { S3EvidenceStorage } from './s3-evidence-storage.js';
import type { EvidenceObjectStore, EvidenceStorage, EvidenceStorageProvider, EvidenceStorageReference, NewEvidenceStorageReference } from './evidence-storage.js';

let instance: EvidenceStorage | undefined;

class ConfiguredEvidenceStorage implements EvidenceStorage {
  constructor(
    private readonly activeProvider: EvidenceStorageProvider,
    private readonly legacyProvider: 'local' | 's3',
    private readonly stores: Partial<Record<EvidenceStorageProvider, EvidenceObjectStore>>,
  ) {}

  write(bytes: Buffer): Promise<NewEvidenceStorageReference> {
    return this.store(this.activeProvider).write(bytes);
  }

  read(reference: EvidenceStorageReference): Promise<Buffer> {
    const provider = reference.provider ?? this.legacyProvider;
    return this.store(provider).read({ ...reference, provider });
  }

  remove(reference: EvidenceStorageReference): Promise<void> {
    const provider = reference.provider ?? this.legacyProvider;
    return this.store(provider).remove({ ...reference, provider });
  }

  private store(provider: EvidenceStorageProvider): EvidenceObjectStore {
    const store = this.stores[provider];
    if (!store) throw new Error(`Evidence storage provider ${provider} is not configured.`);
    return store;
  }
}

export function getEvidenceStorage(): EvidenceStorage {
  if (instance) return instance;
  const configuration = backendConfig.evidenceStorage;
  const stores: Partial<Record<EvidenceStorageProvider, EvidenceObjectStore>> = {
    local: new LocalEvidenceStorage(),
  };
  if (configuration.endpoint && configuration.bucket && configuration.region && configuration.accessKeyId && configuration.secretAccessKey) {
    stores.s3 = new S3EvidenceStorage({
      endpoint: configuration.endpoint,
      bucket: configuration.bucket,
      region: configuration.region,
      accessKeyId: configuration.accessKeyId,
      secretAccessKey: configuration.secretAccessKey,
    });
  }
  if (configuration.cloudName && configuration.apiKey && configuration.apiSecret) {
    stores.cloudinary = new CloudinaryEvidenceStorage({
      cloudName: configuration.cloudName,
      apiKey: configuration.apiKey,
      apiSecret: configuration.apiSecret,
    });
  }
  if (!stores[configuration.provider]) throw new Error(`${configuration.provider} evidence storage is not fully configured.`);
  if (configuration.legacyProvider === 's3' && !stores.s3) throw new Error('Legacy S3 evidence references require the EVIDENCE_S3_* configuration.');
  instance = new ConfiguredEvidenceStorage(configuration.provider, configuration.legacyProvider, stores);
  return instance;
}
