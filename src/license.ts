import { verifyLicense, type LicenseVerification } from "./shared/verifyLicense.mjs";

// Same offline verifier/public-key infrastructure as Vault Spotlight. Product binding
// prevents a Vault Spotlight key from unlocking Import Doctor.
const LICENSE_PUBLIC_KEY = "8ybB+nBmz0Tiz5RYCYJsOgEW5+YmROAumf3HHPeC1E0=";
export const PURCHASE_URL = "https://example.com/import-doctor-pro";

export function verifyImportDoctorLicense(key: string): LicenseVerification {
  return verifyLicense(key.trim(), "import-doctor", LICENSE_PUBLIC_KEY);
}
