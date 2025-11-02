/**
 * Memory management utilities for WASM
 */

import type { GhosttyWasmExports } from "./types.js";

/**
 * Helper class for managing WASM memory allocations
 */
export class WasmMemoryManager {
  constructor(private exports: GhosttyWasmExports) {}

  /**
   * Get the current WASM memory buffer
   */
  getBuffer(): ArrayBuffer {
    return this.exports.memory.buffer;
  }

  /**
   * Allocate and return a pointer to store an opaque value
   */
  allocOpaque(): number {
    return this.exports.ghostty_wasm_alloc_opaque();
  }

  /**
   * Free an opaque pointer
   */
  freeOpaque(ptr: number): void {
    this.exports.ghostty_wasm_free_opaque(ptr);
  }

  /**
   * Allocate a u8 value
   */
  allocU8(): number {
    return this.exports.ghostty_wasm_alloc_u8();
  }

  /**
   * Free a u8 value
   */
  freeU8(ptr: number): void {
    this.exports.ghostty_wasm_free_u8(ptr);
  }

  /**
   * Allocate a u16 value
   */
  allocU16(): number {
    return this.exports.ghostty_wasm_alloc_u16();
  }

  /**
   * Free a u16 value
   */
  freeU16(ptr: number): void {
    this.exports.ghostty_wasm_free_u16(ptr);
  }

  /**
   * Allocate a u32 value
   */
  allocU32(): number {
    return this.exports.ghostty_wasm_alloc_u32();
  }

  /**
   * Free a u32 value
   */
  freeU32(ptr: number): void {
    this.exports.ghostty_wasm_free_u32(ptr);
  }

  /**
   * Allocate a usize value
   */
  allocUsize(): number {
    return this.exports.ghostty_wasm_alloc_usize();
  }

  /**
   * Free a usize value
   */
  freeUsize(ptr: number): void {
    this.exports.ghostty_wasm_free_usize(ptr);
  }

  /**
   * Allocate a u8 array
   */
  allocU8Array(size: number): number {
    return this.exports.ghostty_wasm_alloc_u8_array(size);
  }

  /**
   * Free a u8 array
   */
  freeU8Array(ptr: number): void {
    this.exports.ghostty_wasm_free_u8_array(ptr);
  }

  /**
   * Read a u8 value from memory
   */
  readU8(ptr: number): number {
    return new Uint8Array(this.getBuffer(), ptr, 1)[0];
  }

  /**
   * Read a u16 value from memory
   */
  readU16(ptr: number): number {
    return new Uint16Array(this.getBuffer(), ptr, 1)[0];
  }

  /**
   * Read a u32 value from memory
   */
  readU32(ptr: number): number {
    return new Uint32Array(this.getBuffer(), ptr, 1)[0];
  }

  /**
   * Read a usize value from memory (same as u32 on wasm32)
   */
  readUsize(ptr: number): number {
    return new Uint32Array(this.getBuffer(), ptr, 1)[0];
  }

  /**
   * Write a u8 value to memory
   */
  writeU8(ptr: number, value: number): void {
    new Uint8Array(this.getBuffer(), ptr, 1)[0] = value;
  }

  /**
   * Copy bytes into WASM memory
   */
  copyToMemory(ptr: number, data: Uint8Array): void {
    const view = new Uint8Array(this.getBuffer(), ptr, data.length);
    view.set(data);
  }

  /**
   * Read bytes from WASM memory
   */
  copyFromMemory(ptr: number, length: number): Uint8Array {
    return new Uint8Array(this.getBuffer(), ptr, length);
  }

  /**
   * Read a string from WASM memory
   */
  readString(ptr: number, length: number): string {
    const bytes = this.copyFromMemory(ptr, length);
    return new TextDecoder().decode(bytes);
  }
}
