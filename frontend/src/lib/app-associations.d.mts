export function appAssociations(env?: Record<string, string | undefined>): {
  android: { relation: string[]; target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] } }[];
  ios: { applinks: { apps: string[]; details: { appID: string; paths: string[] }[] } };
};

export function associationEnvironment(env?: Record<string, string | undefined>): Record<string, string | undefined>;
