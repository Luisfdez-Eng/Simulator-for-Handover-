import { Injectable } from '@angular/core';

/**
 * 📄 Interfaz de TLE parseado (formato 3 líneas)
 */
export interface ParsedTle {
  name: string;
  line1: string;
  line2: string;
}

/**
 * 📝 Servicio de parsing y validación de TLE
 */
@Injectable({
  providedIn: 'root'
})
export class TleParserService {

  /**
   * Parsear texto TLE crudo a objetos individuales
   * Maneja formato de 3 líneas (nombre + línea1 + línea2)
   */
  parse(tleData: string): ParsedTle[] {
    const lines = tleData.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const tles: ParsedTle[] = [];

    for (let i = 0; i < lines.length; i += 3) {
      // Verificar que haya al menos 3 líneas disponibles
      if (i + 2 >= lines.length) break;

      const name = lines[i];
      const line1 = lines[i + 1];
      const line2 = lines[i + 2];

      // Validar formato básico
      if (this.isValidTle(line1, line2)) {
        tles.push({
          name: this.cleanName(name),
          line1,
          line2
        });
      } else {
        console.warn(`⚠️ Invalid TLE skipped: ${name}`);
      }
    }

    console.log(`✅ Parsed ${tles.length} valid TLEs`);
    return tles;
  }

  /**
   * Validar formato básico de líneas TLE
   */
  private isValidTle(line1: string, line2: string): boolean {
    // Línea 1 debe empezar con "1 " y tener ~69 caracteres
    if (!line1.startsWith('1 ') || line1.length < 65) {
      return false;
    }

    // Línea 2 debe empezar con "2 " y tener ~69 caracteres
    if (!line2.startsWith('2 ') || line2.length < 65) {
      return false;
    }

    // Validar checksums (último dígito de cada línea)
    if (!this.validateChecksum(line1) || !this.validateChecksum(line2)) {
      return false;
    }

    return true;
  }

  /**
   * Validar checksum de línea TLE
   * Checksum = suma de todos los dígitos (0-9) + 1 por cada '-' mod 10
   */
  private validateChecksum(line: string): boolean {
    if (line.length < 69) return false;

    const data = line.substring(0, 68); // Todos menos el checksum
    const checksumChar = line.charAt(68);
    
    if (!/\d/.test(checksumChar)) return false;
    
    const expectedChecksum = parseInt(checksumChar, 10);
    let calculatedChecksum = 0;

    for (const char of data) {
      if (/\d/.test(char)) {
        calculatedChecksum += parseInt(char, 10);
      } else if (char === '-') {
        calculatedChecksum += 1;
      }
    }

    calculatedChecksum = calculatedChecksum % 10;

    return calculatedChecksum === expectedChecksum;
  }

  /**
   * Limpiar nombre de satélite (remover caracteres especiales)
   */
  private cleanName(name: string): string {
    return name
      .replace(/^0\s+/, '') // Remover "0 " al inicio
      .trim();
  }

  /**
   * Extraer nombre de satélite desde la línea 1 (si no hay línea de nombre)
   */
  extractNameFromLine1(line1: string): string {
    // Formato línea 1: "1 NNNNNC NNNNNAAA NNNNN.NNNNNNNN..."
    // Caracteres 3-7 = número de catálogo NORAD
    const noradId = line1.substring(2, 7).trim();
    return `SAT-${noradId}`;
  }

  /**
   * Validar que el string TLE no esté vacío o corrupto
   */
  validateRawTle(tleData: string): boolean {
    if (!tleData || tleData.trim().length === 0) {
      return false;
    }

    // Verificar que contenga al menos una línea válida
    const hasLine1 = tleData.includes('1 ');
    const hasLine2 = tleData.includes('2 ');

    return hasLine1 && hasLine2;
  }
}
