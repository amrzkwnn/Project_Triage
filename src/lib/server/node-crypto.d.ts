declare module 'node:crypto' {
  export interface Hash {
    update(data: string | Uint8Array, inputEncoding?: 'utf8'): this;
    digest(): Uint8Array;
    digest(encoding: 'hex' | 'base64'): string;
  }

  export interface CipherGCM {
    setAAD(buffer: Uint8Array): this;
    update(data: Uint8Array): Uint8Array;
    final(): Uint8Array;
    getAuthTag(): Uint8Array;
  }

  export interface DecipherGCM {
    setAAD(buffer: Uint8Array): this;
    setAuthTag(buffer: Uint8Array): this;
    update(data: Uint8Array): Uint8Array;
    final(): Uint8Array;
  }

  export function createHash(algorithm: string): Hash;
  export function createCipheriv(
    algorithm: 'aes-256-gcm',
    key: Uint8Array,
    iv: Uint8Array
  ): CipherGCM;
  export function createDecipheriv(
    algorithm: 'aes-256-gcm',
    key: Uint8Array,
    iv: Uint8Array
  ): DecipherGCM;
  export function randomBytes(size: number): Uint8Array;
  export function randomUUID(): string;
}
