/**
 * Interface representing the DID Document structure according to the DID PLC spec.
 * @see https://web.plc.directory/spec/v0.1/did-plc
 */
export interface DIDResolutionResponse {
    /** W3C DID Document context URIs */
    "@context": string[];
    
    /** The full DID identifier */
    id: string;
    
    /** Priority-ordered list of URIs indicating other names/aliases */
    alsoKnownAs: string[];
    
    /** Array of verification methods containing public key information */
    verificationMethod: Array<{
        /** Fragment identifier for the verification method */
        id: string;
        
        /** Type of verification method (e.g. EcdsaSecp256r1VerificationKey2019) */
        type: string;
        
        /** The DID that controls this verification method */
        controller: string;
        
        /** Public key in multibase encoding */
        publicKeyMultibase: string;
    }>;
    
    /** Array of services associated with the DID */
    service: Array<{
        /** Fragment identifier for the service */
        id: string;
        
        /** Service type (e.g. AtprotoPersonalDataServer) */
        type: string;
        
        /** URL endpoint for the service */
        serviceEndpoint: string;
    }>;
}

/**
 * Error class for DID resolution failures
 */
class DIDResolutionError extends Error {
    constructor(message: string, public readonly statusCode?: number) {
        super(message);
        this.name = 'DIDResolutionError';
    }
}

/**
 * Validates a DID string format
 * @throws {DIDResolutionError} If DID format is invalid
 */
function validateDIDFormat(did: string): void {
    if (!did.startsWith('did:plc:')) {
        throw new DIDResolutionError('Invalid DID format. Must start with "did:plc:"');
    }
    
    // Validate DID format based on spec requirements
    const didParts = did.split(':');
    if (didParts.length !== 3) {
        throw new DIDResolutionError('Invalid DID format. Must contain exactly two ":" separators');
    }
}

/**
 * Validates the DID resolution response structure
 * @throws {DIDResolutionError} If response format is invalid
 */
function validateResolutionResponse(data: unknown): asserts data is DIDResolutionResponse {
    if (!data || typeof data !== 'object') {
        throw new DIDResolutionError('Invalid response: not an object');
    }

    const response = data as Partial<DIDResolutionResponse>;
    
    if (!response.id || !response['@context'] || !Array.isArray(response['@context'])) {
        throw new DIDResolutionError('Invalid response: missing required fields');
    }
}

/**
 * Resolves a DID using the PLC Directory service.
 * 
 * This implementation follows the DID PLC Method Specification v0.1
 * @see https://web.plc.directory/spec/v0.1/did-plc
 *
 * @param did - The Decentralized Identifier to resolve (must be did:plc format)
 * @returns A Promise resolving to the DID Document
 * @throws {DIDResolutionError} If resolution fails or response is invalid
 * 
 * @example
 * ```typescript
 * try {
 *   const didDoc = await didResolve('did:plc:ewvi7nxzyoun6zhxrhs64oiz');
 *   console.log(didDoc.alsoKnownAs); // ['at://user.bsky.social']
 * } catch (err) {
 *   if (err instanceof DIDResolutionError) {
 *     console.error('Failed to resolve DID:', err.message);
 *   }
 * }
 * ```
 */
export async function didResolve(did: string): Promise<DIDResolutionResponse> {
    // Validate DID format before making request
    validateDIDFormat(did);

    const url = `https://plc.directory/${did}`;
    
    try {
        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json',
            },
            // Add timeout to prevent hanging requests
            signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) {
            throw new DIDResolutionError(
                `Failed to resolve DID: ${response.statusText}`,
                response.status
            );
        }

        const data = await response.json();
        
        // Validate response structure
        validateResolutionResponse(data);

        return data;
        
    } catch (error) {
        if (error instanceof DIDResolutionError) {
            throw error;
        }
        
        // Handle timeout and network errors
        if (error instanceof TypeError || error instanceof DOMException) {
            throw new DIDResolutionError('Network error during DID resolution');
        }

        throw new DIDResolutionError('Unexpected error during DID resolution');
    }
}
